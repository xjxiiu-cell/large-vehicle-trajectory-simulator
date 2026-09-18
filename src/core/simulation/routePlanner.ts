/**
 * 刚性车前进式 Hybrid A* 路径规划。
 *
 * 搜索状态以后轴中心、车身朝向和实际前轮转角为准。道路中线仅用于衡量行驶进度、
 * 横向偏移和前方朝向目标，绝不再把中线/候选前轴点反算成后轴位姿。
 */

import type { Conflict, Path, Point2D, Polyline, RigidVehicleState, RoutePlan, VehicleParams } from '../geometry/types';
import { isDrivingDirectionForward, pathLength, pointOnPathInfo } from '../geometry/path';
import { normalizeAngle } from '../geometry/transform';
import {
  createRigidVehicleStateFromFrontAxle,
  findPrimarySteeringAxle,
  getFrontSteeringWheelbase,
  getFrontSteeringAxleWorldPoint,
  computeVehicleCorners,
  integrateRigidVehicleState,
  rigidVehicleStateToPose,
} from '../vehicle/ackermann';
import { buildSafetyCorridor, evaluateVehicleFootprintForPlanning, type SafetyCorridor } from './safetyCorridor';

export interface RoutePlannerOptions {
  clearance?: number;
  /** 车辆速度（km/h），用于转向角变化率约束。 */
  speedKph?: number;
  /** 搜索进度（0~1）。由 Worker 转发给界面，避免长道路计算时看似没有响应。 */
  onProgress?: (progress: number) => void;
}

interface SearchNode {
  state: RigidVehicleState;
  /** 沿道路行驶方向的进度，供道路引导和终点判定使用。 */
  progress: number;
  /** 从起点到当前状态的全程最小净距。 */
  minimumClearance: number;
  /** 在最小净距相同的条件下比较平顺、偏移和前瞻跟踪误差。 */
  secondaryCost: number;
  parent: SearchNode | null;
  /** 父状态到当前状态的 0.1m 连续积分片段。 */
  primitive: RigidVehicleState[];
}

const PRIMITIVE_LENGTH = 0.5;
const COLLISION_STEP = 0.1;
// 每个道路进度层保留有限的代表状态；9 个动作仍覆盖全转向范围，避免搜索宽度失控。
const MAX_NODES_PER_LAYER = 8;
const LATERAL_BIN = 0.2;
const HEADING_BIN = 2 * Math.PI / 180;
const STEERING_BIN = 2 * Math.PI / 180;

/**
 * 生成连续、只前进的安全路线。
 * 没有可行解时返回最远的连续部分状态及最接近失败位置的冲突点，不回退为中线假轨迹。
 */
export function planOptimalRoute(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  options: RoutePlannerOptions = {}
): RoutePlan {
  const requestedClearance = options.clearance ?? 0.5;
  const speedMps = (options.speedKph ?? 5) / 3.6;
  const totalLength = pathLength(centerline);
  const fail = (message: string, motion: RigidVehicleState[] = [], failureStation?: number, failureConflicts?: Conflict[]): RoutePlan => ({
    mode: 'auto', referenceAxle: 'rear_axle', path: [], motion, minimumClearance: 0,
    requestedClearance, feasible: false, message, failureStation, failureConflicts,
  });

  if (params.type !== 'rigid' || params.steeringType !== 'front') {
    return fail('连续自动路线当前仅支持刚性前轮转向车辆。');
  }
  if (totalLength <= 0) return fail('道路中线为空或长度为零。');
  const corridor = buildSafetyCorridor(leftEdge, rightEdge);
  if (!corridor.valid) return fail(corridor.message ?? '道路边线无法建立安全走廊。');

  const forward = isDrivingDirectionForward(centerline, leftEdge, rightEdge);
  const startFrame = roadFrame(centerline, totalLength, 0, forward);
  if (!startFrame) return fail('无法定位道路起点。');
  const start = createRigidVehicleStateFromFrontAxle(params, startFrame.point, startFrame.heading, 0);
  if (!start) return fail('车辆缺少位于最后轴前方的前转向轴配置。');

  const steeringAxle = findPrimarySteeringAxle(params)?.axle;
  const maxSteeringAngle = ((steeringAxle?.maxSteerAngle ?? params.maxSteerAngle) * Math.PI) / 180;
  const targetSteeringAngles = Array.from({ length: 9 }, (_, index) => maxSteeringAngle * (index - 4) / 4);
  const lookAheadDistance = Math.max(8, (getFrontSteeringWheelbase(params) ?? 5) * 1.5);

  let layer: SearchNode[] = [{ state: start, progress: 0, minimumClearance: Infinity, secondaryCost: 0, parent: null, primitive: [start] }];
  let best = layer[0];
  let lastReportedProgress = -1;

  while (layer.length > 0 && layer[0].progress < totalLength - 1e-8) {
    const layerProgress = Math.min(best.progress / totalLength, 1);
    // 以 1% 为粒度回报，既能反映长道路搜索，又不会制造大量跨线程消息。
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
        const front = getFrontSteeringAxleWorldPoint(params, rigidVehicleStateToPose(params, expanded.node.state));
        if (!front) continue;
        const lateralOffset = signedLateralOffset(front, frame.point, frame.heading);
        const currentHeadingError = normalizeAngle(expanded.node.state.heading - frame.heading);
        const lookAheadHeadingError = normalizeAngle(expanded.node.state.heading - lookAheadFrame.heading);
        const steeringChange = Math.abs(expanded.node.state.steeringAngle - node.state.steeringAngle);
        expanded.node.secondaryCost +=
          lateralOffset * lateralOffset * 0.06 +
          currentHeadingError * currentHeadingError * 0.8 +
          lookAheadHeadingError * lookAheadHeadingError * 1.6 +
          Math.abs(expanded.node.state.steeringAngle) * 0.025 +
          steeringChange * 0.45;

        const key = stateKey(lateralOffset, currentHeadingError, expanded.node.state.steeringAngle);
        const incumbent = nextByState.get(key);
        if (!incumbent || isBetter(expanded.node, incumbent)) nextByState.set(key, expanded.node);
      }
    }

    const next = [...nextByState.values()].sort(compareNodes).slice(0, MAX_NODES_PER_LAYER);
    if (next.length === 0) {
      const failure = actionFailures[0];
      return fail(
        `里程 ${best.progress.toFixed(1)}m 后没有满足车辆转向连续性与 ${requestedClearance.toFixed(2)}m 安全净距的前进路线。`,
        reconstruct(best), best.progress, failure ? [failure] : undefined,
      );
    }
    layer = next;
    if (isBetter(layer[0], best) || layer[0].progress > best.progress) best = layer[0];
  }

  const winner = [...layer].sort(compareNodes)[0] ?? best;
  options.onProgress?.(1);
  return {
    mode: 'auto', referenceAxle: 'rear_axle', path: [], motion: reconstruct(winner),
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
  const primitive: RigidVehicleState[] = [];

  while (remaining > 1e-8) {
    const subStep = Math.min(COLLISION_STEP, remaining);
    const next = integrateRigidVehicleState(params, state, targetSteeringAngle, subStep, speedMps);
    if (!next) return {};
    state = next;
    primitive.push(state);
    const pose = rigidVehicleStateToPose(params, state);
    const safety = evaluateVehicleFootprintForPlanning(computeVehicleCorners(params, pose), corridor, state.station, requestedClearance);
    minimumClearance = Math.min(minimumClearance, safety.minimumClearance);
    if (safety.conflicts.length > 0) return { conflict: safety.conflicts[0] };
    remaining -= subStep;
  }

  return {
    node: { state, progress: parent.progress + travel, minimumClearance, secondaryCost: parent.secondaryCost, parent, primitive },
  };
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

function stateKey(lateralOffset: number, headingError: number, steeringAngle: number): string {
  return [Math.round(lateralOffset / LATERAL_BIN), Math.round(headingError / HEADING_BIN), Math.round(steeringAngle / STEERING_BIN)].join(':');
}

/** 先比较全程最小净距；净距相同时才比较平顺与偏移。 */
function isBetter(candidate: SearchNode, incumbent: SearchNode): boolean {
  if (candidate.minimumClearance > incumbent.minimumClearance + 1e-5) return true;
  if (incumbent.minimumClearance > candidate.minimumClearance + 1e-5) return false;
  return candidate.secondaryCost < incumbent.secondaryCost;
}

function compareNodes(first: SearchNode, second: SearchNode): number {
  if (Math.abs(first.minimumClearance - second.minimumClearance) > 1e-5) return second.minimumClearance - first.minimumClearance;
  return first.secondaryCost - second.secondaryCost;
}

function reconstruct(last: SearchNode): RigidVehicleState[] {
  const chunks: RigidVehicleState[][] = [];
  let cursor: SearchNode | null = last;
  while (cursor) {
    chunks.unshift(cursor.primitive);
    cursor = cursor.parent;
  }
  const states = chunks.flat();
  return states.filter((state, index) => index === 0 || Math.hypot(
    state.rearAxle.x - states[index - 1].rearAxle.x,
    state.rearAxle.y - states[index - 1].rearAxle.y,
  ) > 1e-9);
}
