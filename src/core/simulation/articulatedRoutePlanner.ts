/**
 * 前进式单半挂车 Hybrid A* 路线规划。
 *
 * 搜索状态只包含连续运动学真值：牵引车后轴、两段车身朝向和实际前轮转角。
 * 中线只用于衡量行驶进度与引导代价；任何挂车位置都不允许独立选点或瞬移。
 */
import type { ArticulatedVehicleState, Conflict, Path, Point2D, Polyline, RoutePlan, VehicleParams } from '../geometry/types';
import { isDrivingDirectionForward, pathLength, pointOnPathInfo } from '../geometry/path';
import { normalizeAngle } from '../geometry/transform';
import { computeVehicleCorners, findPrimarySteeringAxle, getFrontSteeringAxleWorldPoint } from '../vehicle/ackermann';
import {
  articulatedTractorPose,
  computeTrailerCorners,
  createArticulatedVehicleStateFromFrontAxle,
  integrateArticulatedVehicleState,
  validateArticulatedVehicle,
} from '../vehicle/articulated';
import { buildSafetyCorridor, evaluateVehicleFootprintForPlanning, type SafetyCorridor } from './safetyCorridor';

export interface ArticulatedRoutePlannerOptions {
  clearance?: number;
  speedKph?: number;
  onProgress?: (progress: number) => void;
}

interface SearchNode {
  state: ArticulatedVehicleState;
  progress: number;
  minimumClearance: number;
  secondaryCost: number;
  parent: SearchNode | null;
  primitive: ArticulatedVehicleState[];
}

const PRIMITIVE_LENGTH = 0.5;
const COLLISION_STEP = 0.1;
// 铰接车需要在进弯前保留“向内提前调整”的分支；过窄的波束会只留下直行候选。
const MAX_NODES_PER_LAYER = 18;
const LATERAL_BIN = 0.25;
const HEADING_BIN = 3 * Math.PI / 180;
const ARTICULATION_BIN = 3 * Math.PI / 180;
const STEERING_BIN = 3 * Math.PI / 180;

/** 生成只前进、转向连续、牵引车和半挂车均满足安全要求的路线。 */
export function planArticulatedRoute(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  options: ArticulatedRoutePlannerOptions = {},
): RoutePlan {
  const requestedClearance = options.clearance ?? 0.5;
  const speedMps = (options.speedKph ?? 5) / 3.6;
  const totalLength = pathLength(centerline);
  const fail = (message: string, articulatedMotion: ArticulatedVehicleState[] = [], failureStation?: number, failureConflicts?: Conflict[]): RoutePlan => ({
    mode: 'auto', referenceAxle: 'rear_axle', path: [], articulatedMotion,
    minimumClearance: 0, requestedClearance, feasible: false, message, failureStation, failureConflicts,
  });

  const vehicleIssue = validateArticulatedVehicle(params);
  if (vehicleIssue) return fail(vehicleIssue);
  if (totalLength <= 0) return fail('道路中线为空或长度为零。');
  const corridor = buildSafetyCorridor(leftEdge, rightEdge);
  if (!corridor.valid) return fail(corridor.message ?? '道路边线无法建立安全走廊。');

  const forward = isDrivingDirectionForward(centerline, leftEdge, rightEdge);
  const startFrame = roadFrame(centerline, totalLength, 0, forward);
  if (!startFrame) return fail('无法定位道路起点。');
  const start = createArticulatedVehicleStateFromFrontAxle(params, startFrame.point, startFrame.heading, 0);
  if (!start) return fail('无法建立铰接车初始连续状态。');

  const steeringAxle = findPrimarySteeringAxle(params)?.axle;
  const maxSteeringAngle = ((steeringAxle?.maxSteerAngle ?? params.maxSteerAngle) * Math.PI) / 180;
  const targetSteeringAngles = Array.from({ length: 9 }, (_, index) => maxSteeringAngle * (index - 4) / 4);
  // 提前观察至少一个挂车轴组距离，给受转向变化率约束的牵引车留出入弯过渡。
  const lookAheadDistance = Math.max(12, (params.trailerHitchToAxle ?? 8) * 1.5);
  let layer: SearchNode[] = [{ state: start, progress: 0, minimumClearance: Infinity, secondaryCost: 0, parent: null, primitive: [start] }];
  let best = layer[0];
  let lastReportedProgress = -1;

  while (layer.length > 0 && layer[0].progress < totalLength - 1e-8) {
    const layerProgress = Math.min(best.progress / totalLength, 1);
    if (options.onProgress && layerProgress >= lastReportedProgress + 0.01) {
      options.onProgress(layerProgress);
      lastReportedProgress = layerProgress;
    }
    const nextByState = new Map<string, SearchNode>();
    const actionFailures: Conflict[] = [];

    for (const node of layer) {
      const travel = Math.min(PRIMITIVE_LENGTH, totalLength - node.progress);
      for (const targetSteeringAngle of targetSteeringAngles) {
        const expanded = expandPrimitive(node, targetSteeringAngle, travel, params, speedMps, corridor, requestedClearance);
        if (!expanded.node) {
          if (expanded.conflict) actionFailures.push(expanded.conflict);
          continue;
        }
        const frame = roadFrame(centerline, totalLength, expanded.node.progress, forward);
        const lookAheadFrame = roadFrame(centerline, totalLength, Math.min(totalLength, expanded.node.progress + lookAheadDistance), forward);
        if (!frame || !lookAheadFrame) continue;
        const tractorPose = articulatedTractorPose(params, expanded.node.state);
        const front = getFrontSteeringAxleWorldPoint(params, tractorPose);
        if (!front) continue;
        const lateralOffset = signedLateralOffset(front, frame.point, frame.heading);
        const headingError = normalizeAngle(expanded.node.state.tractorHeading - frame.heading);
        const lookAheadHeadingError = normalizeAngle(expanded.node.state.tractorHeading - lookAheadFrame.heading);
        const articulation = normalizeAngle(expanded.node.state.tractorHeading - expanded.node.state.trailerHeading);
        const parentArticulation = normalizeAngle(node.state.tractorHeading - node.state.trailerHeading);
        const steeringChange = Math.abs(expanded.node.state.steeringAngle - node.state.steeringAngle);
        expanded.node.secondaryCost +=
          lateralOffset * lateralOffset * 0.08 +
          headingError * headingError * 0.9 +
          lookAheadHeadingError * lookAheadHeadingError * 1.8 +
          Math.abs(expanded.node.state.steeringAngle) * 0.03 +
          steeringChange * 0.5 +
          articulation * articulation * 0.35 +
          Math.abs(articulation - parentArticulation) * 0.4;

        const key = stateKey(lateralOffset, headingError, articulation, expanded.node.state.steeringAngle);
        const incumbent = nextByState.get(key);
        if (!incumbent || isBetter(expanded.node, incumbent)) nextByState.set(key, expanded.node);
      }
    }

    const next = selectDiverseBeam([...nextByState.values()], MAX_NODES_PER_LAYER);
    if (next.length === 0) {
      const failure = actionFailures[0];
      return fail(
        `里程 ${best.progress.toFixed(1)}m 后没有满足牵引车、半挂车、转向连续性与 ${requestedClearance.toFixed(2)}m 安全净距的前进路线。`,
        reconstruct(best), best.progress, failure ? [failure] : undefined,
      );
    }
    layer = next;
    if (isBetter(layer[0], best) || layer[0].progress > best.progress) best = layer[0];
  }

  const winner = [...layer].sort(compareNodes)[0] ?? best;
  options.onProgress?.(1);
  return {
    mode: 'auto', referenceAxle: 'rear_axle', path: [], articulatedMotion: reconstruct(winner),
    minimumClearance: Number.isFinite(winner.minimumClearance) ? winner.minimumClearance : 0,
    requestedClearance, feasible: true,
  };
}

function expandPrimitive(
  parent: SearchNode,
  targetSteeringAngle: number,
  travel: number,
  params: VehicleParams,
  speedMps: number,
  corridor: SafetyCorridor,
  requestedClearance: number,
): { node?: SearchNode; conflict?: Conflict } {
  let state = parent.state;
  let remaining = travel;
  let minimumClearance = parent.minimumClearance;
  const primitive: ArticulatedVehicleState[] = [];
  while (remaining > 1e-8) {
    const subStep = Math.min(COLLISION_STEP, remaining);
    const next = integrateArticulatedVehicleState(params, state, targetSteeringAngle, subStep, speedMps);
    if (!next) return {};
    state = next;
    primitive.push(state);
    const tractorSafety = evaluateVehicleFootprintForPlanning(
      computeVehicleCorners(params, articulatedTractorPose(params, state)), corridor, state.station, requestedClearance,
    );
    const trailerCorners = computeTrailerCorners(params, state);
    const trailerSafety = trailerCorners
      ? evaluateVehicleFootprintForPlanning(trailerCorners, corridor, state.station, requestedClearance)
      : { minimumClearance: 0, conflicts: [] };
    minimumClearance = Math.min(minimumClearance, tractorSafety.minimumClearance, trailerSafety.minimumClearance);
    const tractorConflict = tractorSafety.conflicts[0];
    const trailerConflict = trailerSafety.conflicts[0];
    if (tractorConflict || trailerConflict) {
      const raw = tractorConflict ?? trailerConflict!;
      return {
        conflict: {
          ...raw,
          vehicleBody: tractorConflict ? 'tractor' : 'trailer',
          message: `${tractorConflict ? '牵引车' : '半挂车'}：${raw.message ?? '车身未满足道路安全要求。'}`,
        },
      };
    }
    remaining -= subStep;
  }
  return { node: { state, progress: parent.progress + travel, minimumClearance, secondaryCost: parent.secondaryCost, parent, primitive } };
}

function roadFrame(centerline: Path, totalLength: number, progress: number, forward: boolean): { point: Point2D; heading: number } | null {
  const geometryStation = forward ? progress : totalLength - progress;
  const info = pointOnPathInfo(centerline, geometryStation);
  if (!info) return null;
  return { point: info.point, heading: forward ? info.heading : normalizeAngle(info.heading + Math.PI) };
}

function signedLateralOffset(point: Point2D, center: Point2D, roadHeading: number): number {
  const normal = { x: -Math.sin(roadHeading), y: Math.cos(roadHeading) };
  return (point.x - center.x) * normal.x + (point.y - center.y) * normal.y;
}

function stateKey(lateralOffset: number, headingError: number, articulation: number, steering: number): string {
  return [
    Math.round(lateralOffset / LATERAL_BIN),
    Math.round(headingError / HEADING_BIN),
    Math.round(articulation / ARTICULATION_BIN),
    Math.round(steering / STEERING_BIN),
  ].join(':');
}

function isBetter(candidate: SearchNode, incumbent: SearchNode): boolean {
  if (candidate.minimumClearance > incumbent.minimumClearance + 1e-5) return true;
  if (incumbent.minimumClearance > candidate.minimumClearance + 1e-5) return false;
  return candidate.secondaryCost < incumbent.secondaryCost;
}

function compareNodes(first: SearchNode, second: SearchNode): number {
  if (Math.abs(first.minimumClearance - second.minimumClearance) > 1e-5) return second.minimumClearance - first.minimumClearance;
  return first.secondaryCost - second.secondaryCost;
}

/**
 * 选择下一层候选时保留左转、直行、右转三类可行状态。
 *
 * 全程最小净距仍是最终路线的第一排序条件；但在搜索中若只按当前净距截断，
 * 进弯前略向内调整的候选会被直行候选全部挤掉，从而产生“到弯口才发现转不过去”的假无解。
 */
function selectDiverseBeam(candidates: SearchNode[], capacity: number): SearchNode[] {
  const sorted = [...candidates].sort(compareNodes);
  const selected: SearchNode[] = [];
  const add = (node: SearchNode | undefined) => {
    if (node && !selected.includes(node) && selected.length < capacity) selected.push(node);
  };
  const steeringGroups: Array<(node: SearchNode) => boolean> = [
    (node) => node.state.steeringAngle < -1e-5,
    (node) => Math.abs(node.state.steeringAngle) <= 1e-5,
    (node) => node.state.steeringAngle > 1e-5,
  ];
  for (const group of steeringGroups) add(sorted.find(group));
  for (const node of sorted) add(node);
  return selected;
}

function reconstruct(last: SearchNode): ArticulatedVehicleState[] {
  const chunks: ArticulatedVehicleState[][] = [];
  let cursor: SearchNode | null = last;
  while (cursor) {
    chunks.unshift(cursor.primitive);
    cursor = cursor.parent;
  }
  const states = chunks.flat();
  return states.filter((state, index) => index === 0 || Math.hypot(
    state.tractorRearAxle.x - states[index - 1].tractorRearAxle.x,
    state.tractorRearAxle.y - states[index - 1].tractorRearAxle.y,
  ) > 1e-9);
}
