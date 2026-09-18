/** V2-1 铰接车沿道路中线的连续运动学预览（不含安全走廊校核）。 */
import type { ArticulatedVehicleState, Conflict, Path, Point2D, Polyline, SimulationResult, SimulationStep, VehicleParams } from '../geometry/types';
import { isDrivingDirectionForward, pathLength, pointOnPathInfo } from '../geometry/path';
import { normalizeAngle } from '../geometry/transform';
import { computeFrontPathSteeringAngle, computeVehicleCorners, getFrontSteeringAxleWorldPoint } from '../vehicle/ackermann';
import {
  articulatedTractorPose,
  computeTrailerCorners,
  createArticulatedVehicleStateFromFrontAxle,
  getArticulatedGeometry,
  integrateArticulatedVehicleState,
  validateArticulatedVehicle,
} from '../vehicle/articulated';
import { buildSafetyCorridor, evaluateVehicleFootprint } from './safetyCorridor';
import { buildContinuousSweptSlices } from './sweptSlices';

/** V2-2：铰接车两个完整车身的道路安全复核结果。 */
interface ArticulatedSafetyAssessment {
  conflicts: Conflict[];
  minimumClearance: number;
}

/**
 * V2-1 仅验证牵引车—挂车的连续几何约束和轨迹显示。
 * 双车身净距、冲突与扫掠将在 V2-2 接入，不能在此阶段输出“道路已通过”的结论。
 */
export function runArticulatedKinematicPreview(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  stepSize: number,
  speedKph: number,
  onProgress?: (progress: number) => void,
): SimulationResult {
  const validation = validateArticulatedVehicle(params);
  if (validation) throw new Error(validation);
  const totalLength = pathLength(centerline);
  if (totalLength <= 0) throw new Error('道路中线为空或长度为零。');

  const forward = isDrivingDirectionForward(centerline, leftEdge, rightEdge);
  const speedMps = speedKph / 3.6;
  const steps: SimulationStep[] = [];
  const frontAxleTrack: Point2D[] = [];
  const rearAxleTrack: Point2D[] = [];
  const hitchTrack: Point2D[] = [];
  const trailerAxleTrack: Point2D[] = [];
  const totalSteps = Math.ceil(totalLength / stepSize) + 1;
  let lastSegmentIndex = -1;
  let previousStation = 0;
  let state = null as ReturnType<typeof createArticulatedVehicleStateFromFrontAxle>;

  for (let index = 0; index < totalSteps; index++) {
    const station = Math.min(index * stepSize, totalLength);
    const geometricStation = forward ? station : totalLength - station;
    const info = pointOnPathInfo(centerline, geometricStation, lastSegmentIndex);
    if (!info) continue;
    lastSegmentIndex = info.segmentIndex;
    const frontHeading = forward ? info.heading : normalizeAngle(info.heading + Math.PI);
    const desiredSteering = computeFrontPathSteeringAngle(
      params,
      info.turnRadius,
      forward ? info.turnDirection : (info.turnDirection === 0 ? 0 : info.turnDirection === 1 ? -1 : 1),
    );
    if (!state) {
      state = createArticulatedVehicleStateFromFrontAxle(params, info.point, frontHeading, station);
    } else if (desiredSteering !== null) {
      state = integrateArticulatedVehicleState(params, state, desiredSteering, station - previousStation, speedMps) ?? state;
    }
    previousStation = station;
    if (!state) throw new Error('无法建立铰接车初始状态。');
    const tractorPose = articulatedTractorPose(params, state);
    const geometry = getArticulatedGeometry(params, state);
    const trailerCorners = computeTrailerCorners(params, state);
    const frontSteeringAxle = getFrontSteeringAxleWorldPoint(params, tractorPose);
    if (!geometry || !trailerCorners) throw new Error('铰接车几何参数不完整。');

    steps.push({
      index: steps.length,
      station,
      pose: tractorPose,
      corners: computeVehicleCorners(params, tractorPose),
      trailerCorners,
      hitchPoint: geometry.hitchPoint,
      trailerAxle: geometry.trailerAxle,
      trailerHeading: state.trailerHeading,
      frontSteeringAxle: frontSteeringAxle ?? undefined,
      rearAxle: { ...state.tractorRearAxle },
      steeringAngle: state.steeringAngle,
    });
    if (frontSteeringAxle) frontAxleTrack.push(frontSteeringAxle);
    rearAxleTrack.push({ ...state.tractorRearAxle });
    hitchTrack.push({ ...geometry.hitchPoint });
    trailerAxleTrack.push({ ...geometry.trailerAxle });
    if (onProgress && index % 50 === 0) onProgress(index / Math.max(1, totalSteps - 1));
  }
  onProgress?.(1);
  return {
    passed: true,
    envelope: { polygon: { vertices: [] }, tracePoints: [], slices: [] },
    conflicts: [],
    steps,
    frontAxleTrack,
    rearAxleTrack,
    hitchTrack,
    trailerAxleTrack,
    assessment: 'kinematic_preview',
    route: {
      mode: 'centerline', referenceAxle: 'front_steering', path: centerline,
      minimumClearance: 0, requestedClearance: 0, feasible: true,
      message: 'V2-1 连续运动学预览：尚未进行双车身安全净距和冲突校核。',
    },
  };
}

/**
 * V2-2：沿中线引导的连续铰接车运动 + 双车身安全走廊校核。
 *
 * 本阶段不自动选线；牵引车和挂车每 0.1m 都分别检查完整外轮廓，
 * 并分别生成扫掠片段。这样挂车内轮差造成的越界不会被牵引车结果掩盖。
 */
export function runArticulatedSafetySimulation(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  stepSize: number,
  speedKph: number,
  requestedClearance: number,
  onProgress?: (progress: number) => void,
): SimulationResult {
  const corridor = buildSafetyCorridor(leftEdge, rightEdge);
  if (!corridor.valid) {
    const issue: Conflict = {
      point: corridor.polygon[0] ?? { x: 0, y: 0 },
      type: 'invalid_road_data',
      message: corridor.message ?? '道路边线无法组成有效安全走廊。',
    };
    return {
      passed: false,
      envelope: { polygon: { vertices: [] }, tracePoints: [], slices: [], tractorSlices: [], trailerSlices: [] },
      conflicts: [issue],
      steps: [],
      requestedClearance,
      minimumClearance: 0,
      assessment: 'invalid_road_data',
      firstIssue: issue,
    };
  }

  // 运动学积分占前半段进度，双车身安全复核占后半段。
  const preview = runArticulatedKinematicPreview(
    centerline, leftEdge, rightEdge, params, stepSize, speedKph,
    onProgress ? (progress) => onProgress(progress * 0.5) : undefined,
  );
  const safety = assessArticulatedFootprints(
    preview.steps,
    corridor,
    requestedClearance,
    onProgress ? (progress) => onProgress(0.5 + progress * 0.5) : undefined,
  );
  const tractorSlices = buildContinuousSweptSlices(preview.steps.map((step) => step.corners));
  const trailerSlices = buildContinuousSweptSlices(
    preview.steps.flatMap((step) => step.trailerCorners ? [step.trailerCorners] : []),
  );
  const conflicts = safety.conflicts;

  return {
    ...preview,
    passed: conflicts.length === 0,
    envelope: {
      // 两个车身并集不是简单多边形，展示以分车身连续扫掠片段为准。
      polygon: { vertices: [] },
      tracePoints: preview.steps.flatMap((step) => [
        step.corners.frontLeft, step.corners.frontRight, step.corners.rearLeft, step.corners.rearRight,
        ...(step.trailerCorners ? [step.trailerCorners.frontLeft, step.trailerCorners.frontRight, step.trailerCorners.rearLeft, step.trailerCorners.rearRight] : []),
      ]),
      slices: tractorSlices,
      tractorSlices,
      trailerSlices,
    },
    conflicts,
    requestedClearance,
    minimumClearance: safety.minimumClearance,
    assessment: assessmentFromConflicts(conflicts),
    firstIssue: conflicts[0],
    route: {
      mode: 'centerline', referenceAxle: 'front_steering', path: centerline,
      minimumClearance: safety.minimumClearance,
      requestedClearance,
      feasible: conflicts.length === 0,
      message: 'V2-2 双车身安全复核：当前以前转向轴沿道路中线引导，尚未进行自动安全选线。',
    },
  };
}

/** 对牵引车与挂车各自的完整矩形轮廓做安全校核，并保留车体归属。 */
function assessArticulatedFootprints(
  steps: SimulationStep[],
  corridor: ReturnType<typeof buildSafetyCorridor>,
  requestedClearance: number,
  onProgress?: (progress: number) => void,
): ArticulatedSafetyAssessment {
  const conflicts: Conflict[] = [];
  let minimumClearance = Infinity;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const tractorSafety = evaluateVehicleFootprint(step.corners, corridor, step.station, requestedClearance);
    const trailerSafety = step.trailerCorners
      ? evaluateVehicleFootprint(step.trailerCorners, corridor, step.station, requestedClearance)
      : { minimumClearance: Infinity, conflicts: [] };
    step.tractorMinimumClearance = tractorSafety.minimumClearance;
    step.trailerMinimumClearance = Number.isFinite(trailerSafety.minimumClearance) ? trailerSafety.minimumClearance : undefined;
    step.tractorSafetyReason = tractorSafety.conflicts[0]?.type;
    step.trailerSafetyReason = trailerSafety.conflicts[0]?.type;
    step.minimumClearance = Math.min(tractorSafety.minimumClearance, trailerSafety.minimumClearance);
    step.safetyReason = tractorSafety.conflicts[0]?.type ?? trailerSafety.conflicts[0]?.type;
    minimumClearance = Math.min(minimumClearance, step.minimumClearance);

    addBodyConflicts(conflicts, tractorSafety.conflicts, 'tractor');
    addBodyConflicts(conflicts, trailerSafety.conflicts, 'trailer');
    if (onProgress && index % 50 === 0) onProgress(index / Math.max(1, steps.length - 1));
  }
  onProgress?.(1);
  return { conflicts, minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 0 };
}

function addBodyConflicts(target: Conflict[], source: Conflict[], vehicleBody: 'tractor' | 'trailer'): void {
  for (const conflict of source) {
    const candidate: Conflict = {
      ...conflict,
      vehicleBody,
      message: `${vehicleBody === 'tractor' ? '牵引车' : '半挂车'}：${conflict.message ?? '车身未满足道路安全要求。'}`,
    };
    const duplicate = target.some((existing) =>
      existing.vehicleBody === vehicleBody &&
      existing.type === candidate.type &&
      Math.abs(existing.point.x - candidate.point.x) < 0.01 &&
      Math.abs(existing.point.y - candidate.point.y) < 0.01,
    );
    if (!duplicate) target.push(candidate);
  }
}

function assessmentFromConflicts(conflicts: Conflict[]): NonNullable<SimulationResult['assessment']> {
  if (conflicts.length === 0) return 'passed';
  if (conflicts.some((conflict) => conflict.type === 'invalid_road_data')) return 'invalid_road_data';
  if (conflicts.some((conflict) => conflict.type === 'intersection' || conflict.type === 'outside_corridor')) return 'boundary_collision';
  return 'insufficient_clearance';
}

/**
 * 将自动规划器产出的铰接车连续状态直接转换为双车身安全结果。
 * 规划状态是唯一来源，禁止把路线重新贴回中线后再反推牵引车或挂车位姿。
 */
export function runArticulatedSafetyFromMotion(
  motion: ArticulatedVehicleState[],
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  requestedClearance: number,
  onProgress?: (progress: number) => void,
): SimulationResult {
  const corridor = buildSafetyCorridor(leftEdge, rightEdge);
  if (!corridor.valid) {
    const issue: Conflict = {
      point: corridor.polygon[0] ?? { x: 0, y: 0 }, type: 'invalid_road_data',
      message: corridor.message ?? '道路边线无法组成有效安全走廊。',
    };
    return {
      passed: false,
      envelope: { polygon: { vertices: [] }, tracePoints: [], slices: [], tractorSlices: [], trailerSlices: [] },
      conflicts: [issue], steps: [], requestedClearance, minimumClearance: 0,
      assessment: 'invalid_road_data', firstIssue: issue,
    };
  }
  const steps: SimulationStep[] = [];
  const frontAxleTrack: Point2D[] = [];
  const rearAxleTrack: Point2D[] = [];
  const hitchTrack: Point2D[] = [];
  const trailerAxleTrack: Point2D[] = [];
  for (let index = 0; index < motion.length; index++) {
    const step = articulatedStepFromState(params, motion[index], index);
    if (!step) continue;
    steps.push(step);
    if (step.frontSteeringAxle) frontAxleTrack.push(step.frontSteeringAxle);
    if (step.rearAxle) rearAxleTrack.push(step.rearAxle);
    if (step.hitchPoint) hitchTrack.push(step.hitchPoint);
    if (step.trailerAxle) trailerAxleTrack.push(step.trailerAxle);
    if (onProgress && index % 50 === 0) onProgress(index / Math.max(1, motion.length - 1));
  }
  const safety = assessArticulatedFootprints(
    steps, corridor, requestedClearance,
    onProgress ? (progress) => onProgress(progress) : undefined,
  );
  const tractorSlices = buildContinuousSweptSlices(steps.map((step) => step.corners));
  const trailerSlices = buildContinuousSweptSlices(steps.flatMap((step) => step.trailerCorners ? [step.trailerCorners] : []));
  onProgress?.(1);
  return {
    passed: safety.conflicts.length === 0,
    envelope: {
      polygon: { vertices: [] },
      tracePoints: steps.flatMap((step) => [
        step.corners.frontLeft, step.corners.frontRight, step.corners.rearLeft, step.corners.rearRight,
        ...(step.trailerCorners ? [step.trailerCorners.frontLeft, step.trailerCorners.frontRight, step.trailerCorners.rearLeft, step.trailerCorners.rearRight] : []),
      ]),
      slices: tractorSlices, tractorSlices, trailerSlices,
    },
    conflicts: safety.conflicts,
    steps,
    frontAxleTrack, rearAxleTrack, hitchTrack, trailerAxleTrack,
    requestedClearance,
    minimumClearance: safety.minimumClearance,
    assessment: assessmentFromConflicts(safety.conflicts),
    firstIssue: safety.conflicts[0],
  };
}

function articulatedStepFromState(params: VehicleParams, state: ArticulatedVehicleState, index: number): SimulationStep | null {
  const pose = articulatedTractorPose(params, state);
  const geometry = getArticulatedGeometry(params, state);
  const trailerCorners = computeTrailerCorners(params, state);
  const frontSteeringAxle = getFrontSteeringAxleWorldPoint(params, pose);
  if (!geometry || !trailerCorners) return null;
  return {
    index,
    station: state.station,
    pose,
    corners: computeVehicleCorners(params, pose),
    trailerCorners,
    hitchPoint: geometry.hitchPoint,
    trailerAxle: geometry.trailerAxle,
    trailerHeading: state.trailerHeading,
    frontSteeringAxle: frontSteeringAxle ?? undefined,
    rearAxle: { ...state.tractorRearAxle },
    steeringAngle: state.steeringAngle,
  };
}
