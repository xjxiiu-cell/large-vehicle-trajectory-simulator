/**
 * 模拟引擎
 *
 * 沿规划路线步进计算车辆位姿和角点，构建扫掠包络线，
 * 并检测包络线与道路边线的冲突。
 *
 * 纯函数模块，无 UI 依赖。
 */

import type {
  VehicleParams,
  VehiclePose,
  SimulationStep,
  SimulationResult,
  SweptEnvelope,
  Conflict,
  Path,
  PathSegment,
  Polyline,
  Point2D,
  LineSegment,
  RigidVehicleState,
} from '../geometry/types';
import { pathLength, isDrivingDirectionForward, pointOnPathInfo } from '../geometry/path';
import type { PointOnPathInfo } from '../geometry/path';
import { lineSegmentIntersection, isPointInPolygon } from '../geometry/intersect';
import {
  computeFrontPathSteeringAngle,
  computePoseFromFrontSteeringPath,
  createRigidVehicleStateFromFrontAxle,
  computeVehicleCorners,
  getFrontSteeringAxleWorldPoint,
  integrateRigidVehicleState,
  rigidVehicleStateToPose,
} from '../vehicle/ackermann';
import { normalizeAngle } from '../geometry/transform';
import { planOptimalRoute } from './routePlanner';
import { buildSafetyCorridor, evaluateVehicleFootprint, type SafetyCorridor } from './safetyCorridor';
import { runArticulatedSafetyFromMotion, runArticulatedSafetySimulation } from './articulatedSimulation';
import { planArticulatedRoute } from './articulatedRoutePlanner';

/** 默认模拟步长（米） */
export const DEFAULT_STEP_SIZE = 0.1;

export interface SimulationOptions {
  routeMode?: 'centerline' | 'auto';
  clearance?: number;
  /** 行驶速度（km/h），用于把转向角变化率换算为每个运动子步允许的转角变化。 */
  speedKph?: number;
}

/**
 * 运行模拟。刚性车始终以前转向轴中心为控制路径；传入 centerline 模式可用于对照。
 */
export function runSimulation(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  stepSize: number = DEFAULT_STEP_SIZE,
  onProgress?: (progress: number) => void,
  options: SimulationOptions = {}
): SimulationResult {
  // V2-3：铰接车自动规划的唯一真值是连续铰接状态，不允许重新贴回中线反算车身。
  if (params.type === 'articulated') {
    const requestedClearance = options.clearance ?? 0.5;
    const routeMode = options.routeMode ?? 'auto';
    if (routeMode === 'auto') {
      const route = planArticulatedRoute(centerline, leftEdge, rightEdge, params, {
        clearance: requestedClearance,
        speedKph: options.speedKph ?? 5,
        onProgress: onProgress ? (progress) => onProgress(progress * 0.8) : undefined,
      });
      const result = runArticulatedSafetyFromMotion(
        route.articulatedMotion ?? [], leftEdge, rightEdge, params, requestedClearance,
        onProgress ? (progress) => onProgress(0.8 + progress * 0.2) : undefined,
      );
      const conflicts = mergeConflicts(result.conflicts, route.failureConflicts ?? []);
      const passed = route.feasible && conflicts.length === 0;
      return {
        ...result,
        passed,
        conflicts,
        assessment: passed ? 'passed' : (conflicts.length > 0 ? assessmentFromConflicts(conflicts) : 'insufficient_clearance'),
        firstIssue: conflicts[0] ?? result.firstIssue,
        route,
      };
    }
    return runArticulatedSafetySimulation(
      centerline,
      leftEdge,
      rightEdge,
      params,
      Math.min(stepSize, DEFAULT_STEP_SIZE),
      options.speedKph ?? 5,
      requestedClearance,
      onProgress,
    );
  }
  const routeMode = options.routeMode ?? 'auto';
  const requestedClearance = options.clearance ?? 0.5;
  const safetyCorridor = buildSafetyCorridor(leftEdge, rightEdge);
  if (!safetyCorridor.valid) {
    const issue: Conflict = {
      point: safetyCorridor.polygon[0] ?? { x: 0, y: 0 },
      type: 'invalid_road_data',
      message: safetyCorridor.message ?? '道路边线无法组成有效安全走廊。',
    };
    return {
      passed: false,
      envelope: { polygon: { vertices: [] }, tracePoints: [], slices: [] },
      conflicts: [issue],
      steps: [],
      requestedClearance,
      minimumClearance: 0,
      assessment: 'invalid_road_data',
      firstIssue: issue,
    };
  }
  if (routeMode === 'auto') {
    const route = planOptimalRoute(centerline, leftEdge, rightEdge, params, {
      clearance: requestedClearance,
      speedKph: options.speedKph ?? 5,
      // 自动规划通常比逐帧复核耗时更长；分别占用进度条的前 80% 和后 20%。
      onProgress: onProgress ? (progress) => onProgress(progress * 0.8) : undefined,
    });
    // 自动规划状态是回放、轨迹显示和安全复核的唯一来源；不再把规划结果转回路径后重新反算后轴。
    const result = route.motion && route.motion.length > 0
      ? runSimulationFromRigidMotion(route.motion, params, safetyCorridor, requestedClearance, onProgress ? (progress) => onProgress(0.8 + progress * 0.2) : undefined)
      // 自动规划从起点就无可执行状态时，不能以中线伪造一条“模拟轨迹”。
      : createEmptySimulationResult(requestedClearance);
    const conflicts = mergeConflicts(result.conflicts, route.failureConflicts ?? []);
    const passed = route.feasible && conflicts.length === 0;
    return {
      ...result,
      passed,
      conflicts,
      assessment: passed ? 'passed' : (conflicts.length > 0 ? assessmentFromConflicts(conflicts) : 'insufficient_clearance'),
      firstIssue: conflicts[0] ?? result.firstIssue,
      route,
    };
  }
  const result = runSimulationOnPath(centerline, leftEdge, rightEdge, params, stepSize, onProgress, undefined, options.speedKph ?? 5, safetyCorridor, requestedClearance);
  return {
    ...result,
    route: { mode: 'centerline', referenceAxle: 'front_steering', path: centerline, minimumClearance: result.minimumClearance ?? 0, requestedClearance, feasible: result.passed },
  };
}

/** 自动路线没有任何可执行状态时返回空结果，供界面明确呈现不可通行结论。 */
function createEmptySimulationResult(requestedClearance: number): SimulationResult {
  return {
    passed: false,
    envelope: { polygon: { vertices: [] }, tracePoints: [], slices: [] },
    conflicts: [],
    steps: [],
    frontAxleTrack: [],
    rearAxleTrack: [],
    requestedClearance,
    minimumClearance: 0,
    assessment: 'insufficient_clearance',
  };
}

/** 将 Hybrid A* 输出的后轴连续状态直接转换为模拟回放结果。 */
function runSimulationFromRigidMotion(
  motion: RigidVehicleState[],
  params: VehicleParams,
  safetyCorridor: SafetyCorridor,
  requestedClearance: number,
  onProgress?: (progress: number) => void,
): SimulationResult {
  const steps: SimulationStep[] = [];
  const frontAxleTrack: Point2D[] = [];
  const rearAxleTrack: Point2D[] = [];
  for (let index = 0; index < motion.length; index++) {
    const state = motion[index];
    const pose = rigidVehicleStateToPose(params, state);
    const frontSteeringAxle = getFrontSteeringAxleWorldPoint(params, pose);
    steps.push({
      index,
      station: state.station,
      pose,
      corners: computeVehicleCorners(params, pose),
      frontSteeringAxle: frontSteeringAxle ?? undefined,
      rearAxle: { ...state.rearAxle },
      steeringAngle: state.steeringAngle,
    });
    if (frontSteeringAxle) frontAxleTrack.push(frontSteeringAxle);
    rearAxleTrack.push({ ...state.rearAxle });
    if (onProgress && index % 50 === 0) onProgress(index / Math.max(1, motion.length - 1));
  }
  if (onProgress) onProgress(1);
  const safety = assessVehicleFootprints(steps, safetyCorridor, requestedClearance);
  const conflicts = safety.conflicts;
  return {
    passed: conflicts.length === 0,
    envelope: buildSweptEnvelope(steps),
    conflicts,
    steps,
    frontAxleTrack,
    rearAxleTrack,
    requestedClearance,
    minimumClearance: safety.minimumClearance,
    assessment: assessmentFromConflicts(conflicts),
    firstIssue: conflicts[0],
  };
}

function mergeConflicts(primary: Conflict[], extra: Conflict[]): Conflict[] {
  const merged = [...primary];
  for (const candidate of extra) {
    const duplicate = merged.some((existing) =>
      existing.type === candidate.type &&
      Math.abs(existing.point.x - candidate.point.x) < 0.01 &&
      Math.abs(existing.point.y - candidate.point.y) < 0.01
    );
    if (!duplicate) merged.push(candidate);
  }
  return merged;
}

/**
 * 计算单个路径段的长度
 * 直线段：欧氏距离；圆弧段：弧长 = 半径 × 角跨度
 */
function segmentLength(seg: PathSegment): number {
  if (seg.type === 'straight') {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    return Math.sqrt(dx * dx + dy * dy);
  } else {
    let angleSpan = seg.endAngle - seg.startAngle;
    if (seg.clockwise) {
      if (angleSpan > 0) angleSpan -= 2 * Math.PI;
      angleSpan = Math.abs(angleSpan);
    } else {
      if (angleSpan < 0) angleSpan += 2 * Math.PI;
    }
    return seg.radius * angleSpan;
  }
}

/**
 * 计算从路径起点到指定段起点的累计里程
 * 用于确定段边界处的 station 值
 */
function segmentStartStation(path: Path, segIndex: number): number {
  let cum = 0;
  for (let i = 0; i < segIndex && i < path.length; i++) {
    cum += segmentLength(path[i]);
  }
  return cum;
}

/** 几何路径反向行驶时，左/右转方向随之翻转。 */
function travelTurnDirection(direction: -1 | 0 | 1, forward: boolean): -1 | 0 | 1 {
  if (forward || direction === 0) return direction;
  return direction === 1 ? -1 : 1;
}

/**
 * 将前转向轴控制路径上的路径信息转为车辆参考位姿。
 * 刚性车的 position 仍是最后轴中心，确保既有车身角点、包络和碰撞模块无需改变。
 */
function poseFromControlPath(
  params: VehicleParams,
  info: PointOnPathInfo,
  forward: boolean
): VehiclePose {
  const frontHeading = forward
    ? info.heading
    : normalizeAngle(info.heading + Math.PI);
  const pose = params.type === 'rigid'
    ? computePoseFromFrontSteeringPath(
        params,
        info.point,
        frontHeading,
        info.turnRadius,
        travelTurnDirection(info.turnDirection, forward)
      )
    : null;

  // 铰接车尚未接入本阶段的运动学；保留旧约定以避免影响未完成模块。
  return pose ?? {
    position: { x: info.point.x, y: info.point.y },
    heading: frontHeading,
    turnRadius: info.turnRadius,
  };
}

/**
 * 用轨迹追踪法构建扫掠包络多边形
 *
 * 替代全局凸包：全局凸包会将路径弯道之间的空白区域填满，导致：
 * 1. 包络范围"过大"（实际上包含了车辆从未经过的区域）
 * 2. 在直线段产生虚假冲突（凸包边穿越了弯道附近的道路边线）
 *
 * 轨迹追踪法沿车辆外角点构建多边形：
 *   左边界 = 前左角点序列
 *   右边界 = 前右角点序列（反向）
 *   首尾 = 车辆前后轮廓闭合
 *
 * 对于 frontExtent >> rearExtent 的车辆（如前伸12m后伸3m），
 * 前角点定义了全路径上的最大横向范围，后角点仅在路径起终点闭合时使用。
 */
function buildSweptEnvelope(steps: SimulationStep[]): SweptEnvelope {
  if (steps.length === 0) {
    return { polygon: { vertices: [] }, tracePoints: [] };
  }

  const first = steps[0];
  const last = steps[steps.length - 1];
  const vertices: Point2D[] = [];

  // ── 构建多边形：顺时针绕行 ──
  // 1. 起点后左角（闭合用的起始顶点）
  vertices.push({
    x: first.corners.rearLeft.x,
    y: first.corners.rearLeft.y,
  });

  // 2. 左边界：所有步的前左角点（车辆沿路径行驶的最外侧左边界）
  for (const step of steps) {
    vertices.push({
      x: step.corners.frontLeft.x,
      y: step.corners.frontLeft.y,
    });
  }

  // 3. 终点前沿：末步的前左→前右（闭合包络的前端）
  // 注意：末步的前右角点由右侧追踪的第一个元素自然提供，
  // 这里先添加用于清晰表达"前端闭合"，右侧追踪跳过末步避免重复
  vertices.push({
    x: last.corners.frontRight.x,
    y: last.corners.frontRight.y,
  });

  // 4. 右边界：所有步的前右角点（反向，跳过末步避免重复）
  for (let i = steps.length - 2; i >= 0; i--) {
    vertices.push({
      x: steps[i].corners.frontRight.x,
      y: steps[i].corners.frontRight.y,
    });
  }

  // 5. 起点后右角（闭合用，回连到起点后左角形成车辆尾部轮廓）
  vertices.push({
    x: first.corners.rearRight.x,
    y: first.corners.rearRight.y,
  });

  return {
    polygon: { vertices },
    tracePoints: steps.flatMap((s) => [
      s.corners.frontLeft,
      s.corners.frontRight,
      s.corners.rearLeft,
      s.corners.rearRight,
    ]),
    slices: buildSweptSlices(steps),
  };
}

/**
 * 用相邻两帧车身的凸包构造连续扫掠片段。
 * 步长不超过 0.1m，凸包相对真实连续扫掠只产生极小保守量，且不会跨越整段弯道。
 */
function buildSweptSlices(steps: SimulationStep[]): import('../geometry/types').Polygon[] {
  const slices: import('../geometry/types').Polygon[] = [];
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1].corners;
    const current = steps[index].corners;
    const vertices = convexHull([
      previous.frontLeft, previous.frontRight, previous.rearLeft, previous.rearRight,
      current.frontLeft, current.frontRight, current.rearLeft, current.rearRight,
    ]);
    if (vertices.length >= 3) slices.push({ vertices });
  }
  return slices;
}

function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
  const cross = (origin: Point2D, first: Point2D, second: Point2D) =>
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const lower: Point2D[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((point) => ({ ...point }));
}

/**
 * 运行模拟
 *
 * 沿道路中线从起点到终点，以 stepSize 为步长逐步计算车辆位姿和角点。
 * 收集所有角点求凸包得到扫掠包络线，然后检测与道路边线的冲突。
 *
 * @param centerline 道路中线路径
 * @param leftEdge 道路左边线（已离散化）
 * @param rightEdge 道路右边线（已离散化）
 * @param params 车辆参数
 * @param stepSize 步长（米），默认 0.2
 * @param onProgress 进度回调，0~1
 * @returns 模拟结果（包含扫掠包络、冲突列表、所有模拟步）
 */
function runSimulationOnPath(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  params: VehicleParams,
  stepSize: number = DEFAULT_STEP_SIZE,
  onProgress?: (progress: number) => void,
  drivingForward?: boolean,
  speedKph: number = 5,
  safetyCorridor?: SafetyCorridor,
  requestedClearance: number = 0
): SimulationResult {
  // 空路径
  if (centerline.length === 0) {
    return {
      passed: true,
      envelope: { polygon: { vertices: [] }, tracePoints: [] },
      conflicts: [],
      steps: [],
    };
  }

  const totalLen = pathLength(centerline);
  if (totalLen <= 0) {
    return {
      passed: true,
      envelope: { polygon: { vertices: [] }, tracePoints: [] },
      conflicts: [],
      steps: [],
    };
  }

  // 判断行驶方向：中线几何方向是否与行驶方向一致
  const forward = drivingForward ?? isDrivingDirectionForward(centerline, leftEdge, rightEdge);
  // 反向行驶时 heading 偏移量
  const headingOffset = forward ? 0 : Math.PI;

  // ── 诊断日志 ──
  console.log('══════════ 模拟引擎诊断 ══════════');
  console.log('行驶方向 forward:', forward, '(headingOffset:', headingOffset, 'rad =', (headingOffset * 180 / Math.PI).toFixed(0), '°)');
  console.log('路径总长:', totalLen.toFixed(2), 'm, 段数:', centerline.length);
  console.log('车辆: 长', params.totalLength, 'm × 宽', params.totalWidth, 'm, 轴数:', params.axles.length);
  const rearmostAxle = params.axles.reduce((a, b) => a.distanceFromFront > b.distanceFromFront ? a : b);
  console.log('参考轴(最后轴)距前端:', rearmostAxle.distanceFromFront, 'm → frontExtent:', rearmostAxle.distanceFromFront, 'm, rearExtent:', (params.totalLength - rearmostAxle.distanceFromFront), 'm');
  centerline.forEach((seg, i) => {
    const sLen = segmentLength(seg);
    const sStart = segmentStartStation(centerline, i);
    if (seg.type === 'arc') {
      console.log('  段' + i + ': ' + seg.type + ', 长度=' + sLen.toFixed(2) + 'm, 起点里程=' + sStart.toFixed(2) + 'm, R=' + seg.radius.toFixed(2) + 'm, ' + (seg.clockwise ? '顺时针' : '逆时针') + ', 起角=' + (seg.startAngle * 180 / Math.PI).toFixed(1) + '°, 终角=' + (seg.endAngle * 180 / Math.PI).toFixed(1) + '°, 圆心=(' + seg.center.x.toFixed(2) + ',' + seg.center.y.toFixed(2) + ')');
    } else {
      console.log('  段' + i + ': ' + seg.type + ', 长度=' + sLen.toFixed(2) + 'm, 起点里程=' + sStart.toFixed(2) + 'm');
    }
  });

  const steps: SimulationStep[] = [];
  const allCornerPoints: Point2D[] = [];
  const frontAxleTrack: Point2D[] = [];
  const rearAxleTrack: Point2D[] = [];
  const totalSteps = Math.ceil(totalLen / stepSize) + 1;

  // 段索引缓存：station 单调递增，避免每次从头遍历路径段
  let lastSegmentIndex = -1;
  // 后轴是刚性车唯一的运动学状态源；前轴轨迹只由该状态推导。
  let rigidState: RigidVehicleState | null = null;
  let previousStation = 0;
  const speedMps = speedKph / 3.6;

  // 诊断：记录是否曾进入圆弧段
  let everOnArc = false;
  let firstArcStepIndex = -1;

  for (let i = 0; i < totalSteps; i++) {
    const station = Math.min(i * stepSize, totalLen);
    // 反向行驶时从路径终点向起点步进
    const actualStation = forward ? station : totalLen - station;

    const info: PointOnPathInfo | null = pointOnPathInfo(
      centerline,
      actualStation,
      lastSegmentIndex
    );
    if (!info) continue;

    // 更新段索引缓存
    lastSegmentIndex = info.segmentIndex;

    // 诊断：首次进入圆弧段时 + 每50步在圆弧上输出 + 自洽性检查
    if (info.segmentType === 'arc') {
      // 自洽性检查：参考点距圆心应等于圆弧半径
      const arcSeg = centerline[info.segmentIndex];
      let distFromCenter = -1, radiusError = -1;
      if (arcSeg.type === 'arc') {
        distFromCenter = Math.sqrt(
          (info.point.x - arcSeg.center.x) ** 2 +
          (info.point.y - arcSeg.center.y) ** 2
        );
        radiusError = Math.abs(distFromCenter - arcSeg.radius);
      }

      if (!everOnArc) {
        everOnArc = true;
        firstArcStepIndex = i;
        console.log('🔍 首次入弧: 步骤' + i + ' stn=' + station.toFixed(1) + ' actualStn=' + actualStation.toFixed(2) + ' seg=' + info.segmentIndex + ' turnR=' + (info.turnRadius === Infinity ? '∞' : info.turnRadius.toFixed(1)) + ' hdg=' + (info.heading * 180 / Math.PI).toFixed(1) + '°');
        if (arcSeg.type === 'arc') {
          console.log('   ✅ 自洽检查: 圆心距=' + distFromCenter.toFixed(4) + 'm, 圆弧R=' + arcSeg.radius.toFixed(4) + 'm, 偏差=' + (radiusError * 1000).toFixed(2) + 'mm ' + (radiusError < 0.01 ? '✅ 在中心线上' : '❌ 偏离中心线!'));
          console.log('   圆心=(' + arcSeg.center.x.toFixed(2) + ',' + arcSeg.center.y.toFixed(2) + '), 起角=' + (arcSeg.startAngle * 180 / Math.PI).toFixed(1) + '°, 终角=' + (arcSeg.endAngle * 180 / Math.PI).toFixed(1) + '°, ' + (arcSeg.clockwise ? '顺时针' : '逆时针'));
        }
      }
      if (i % 50 === 0) {
        console.log('🔍 弧上步骤' + i + ': stn=' + station.toFixed(1) + ' actualStn=' + actualStation.toFixed(2) + ' seg=' + info.segmentIndex + ' R=' + (info.turnRadius === Infinity ? '∞' : info.turnRadius.toFixed(1)) + ' hdg=' + (info.heading * 180 / Math.PI).toFixed(1) + '° 圆心距=' + distFromCenter.toFixed(2) + 'm err=' + (radiusError * 1000).toFixed(1) + 'mm');
      }
    }

    // 中线或规划路径只提供目标转角；车辆位置仅由上一帧后轴状态连续积分。
    const desiredSteeringAngle = params.type === 'rigid'
      ? computeFrontPathSteeringAngle(
          params,
          info.turnRadius,
          travelTurnDirection(info.turnDirection, forward)
        )
      : null;
    const rearTravelDistance = Math.max(0, station - previousStation);
    let pose: VehiclePose;
    if (params.type === 'rigid') {
      const frontHeading = forward
        ? info.heading
        : normalizeAngle(info.heading + Math.PI);
      if (!rigidState) {
        rigidState = createRigidVehicleStateFromFrontAxle(params, info.point, frontHeading, station);
      } else if (desiredSteeringAngle !== null) {
        rigidState = integrateRigidVehicleState(
          params,
          rigidState,
          desiredSteeringAngle,
          rearTravelDistance,
          speedMps
        ) ?? rigidState;
      }
      pose = rigidState
        ? rigidVehicleStateToPose(params, rigidState)
        : poseFromControlPath(params, info, forward);
    } else {
      pose = poseFromControlPath(params, info, forward);
    }
    previousStation = station;

    // 计算车辆四个角点
    const corners = computeVehicleCorners(params, pose);

    const frontAxlePoint = getFrontSteeringAxleWorldPoint(params, pose);
    steps.push({
      index: steps.length,
      station,
      pose,
      corners,
      frontSteeringAxle: frontAxlePoint ?? undefined,
      rearAxle: { ...pose.position },
      steeringAngle: rigidState?.steeringAngle,
    });

    if (frontAxlePoint) frontAxleTrack.push(frontAxlePoint);
    rearAxleTrack.push({ ...pose.position });

    allCornerPoints.push(
      corners.frontLeft,
      corners.frontRight,
      corners.rearLeft,
      corners.rearRight
    );

    // 每 100 步报告一次进度
    if (onProgress && i % 100 === 0) {
      onProgress(Math.min(i / totalSteps, 1));
    }
  }

  // 最终进度回调
  if (onProgress) {
    onProgress(1);
  }

  // 计算扫掠包络线（轨迹追踪多边形，而非全局凸包）
  // 全局凸包会将路径弯道之间的空白区域填满，导致包络过大和误报冲突
  const envelope = buildSweptEnvelope(steps);

  // 以每一步的完整车辆轮廓校核两侧边线及安全净距。
  // 扫掠包络用于展示，不能直接拿首尾闭合边进行碰撞判定。
  const safety = assessVehicleFootprints(
    steps,
    safetyCorridor ?? buildSafetyCorridor(leftEdge, rightEdge),
    requestedClearance
  );
  const conflicts = safety.conflicts;

  // ── 诊断日志：采样 + 包络 + 冲突 ──
  console.log('总步数:', steps.length, '(含过渡步骤)');
  console.log('角点总数:', allCornerPoints.length);
  console.log('是否曾入弧:', everOnArc, everOnArc ? '首次弧步=' + firstArcStepIndex : '(全程未入弧 ⚠️)');
  // 采样：路径首尾 + 中间 + 圆弧段
  const sampleIndices = new Set([
    0, 1, 2,
    Math.floor(steps.length / 2),
    steps.length - 3, steps.length - 2, steps.length - 1,
  ]);
  // 追加圆弧段区域采样
  for (let i = 0; i < steps.length; i += 200) {
    const s = steps[i];
    if (s && s.pose.turnRadius !== Infinity && s.pose.turnRadius > 0) {
      sampleIndices.add(i);
    }
  }
  for (const idx of sampleIndices) {
    if (idx >= 0 && idx < steps.length) {
      const s = steps[idx];
      const hdgDeg = (s.pose.heading * 180 / Math.PI).toFixed(1);
      const fl = s.corners.frontLeft;
      const fr = s.corners.frontRight;
      const rl = s.corners.rearLeft;
      const actualW = Math.sqrt((fl.x - fr.x) ** 2 + (fl.y - fr.y) ** 2).toFixed(2);
      const actualL = Math.sqrt((fl.x - rl.x) ** 2 + (fl.y - rl.y) ** 2).toFixed(2);
      const segLabel = s.pose.turnRadius === Infinity ? '直' : '弧R' + s.pose.turnRadius.toFixed(0);
      console.log('  步骤' + idx + '(stn=' + s.station.toFixed(1) + '): pos=(' + s.pose.position.x.toFixed(2) + ',' + s.pose.position.y.toFixed(2) + '), heading=' + hdgDeg + '°, ' + segLabel + ', 车宽=' + actualW + 'm, 车长=' + actualL + 'm');
    }
  }
  // 包络范围
  const envVerts = envelope.polygon.vertices;
  if (envVerts.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of envVerts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    console.log('包络顶点数:', envVerts.length, '(轨迹追踪法) 包围盒:',
      'X[' + minX.toFixed(2) + ', ' + maxX.toFixed(2) + '] Y[' + minY.toFixed(2) + ', ' + maxY.toFixed(2) + ']',
      '宽' + (maxX - minX).toFixed(2) + 'm × 高' + (maxY - minY).toFixed(2) + 'm');
  }
  // 冲突详情
  console.log('冲突数:', conflicts.length);
  for (let i = 0; i < Math.min(conflicts.length, 10); i++) {
    const c = conflicts[i];
    console.log('  冲突' + i + ': type=' + c.type + ', point=(' + c.point.x.toFixed(2) + ',' + c.point.y.toFixed(2) + ')');
  }
  // 道路范围
  {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of leftEdge) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    for (const p of rightEdge) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    console.log('道路边线范围:', 'X[' + minX.toFixed(2) + ', ' + maxX.toFixed(2) + '] Y[' + minY.toFixed(2) + ', ' + maxY.toFixed(2) + ']',
      '宽' + (maxX-minX).toFixed(2) + 'm × 高' + (maxY-minY).toFixed(2) + 'm');
  }
  console.log('══════════════════════════════════');

  return {
    passed: conflicts.length === 0,
    envelope,
    conflicts,
    steps,
    frontAxleTrack,
    rearAxleTrack,
    requestedClearance,
    minimumClearance: safety.minimumClearance,
    assessment: assessmentFromConflicts(conflicts),
    firstIssue: conflicts[0],
  };
}

/**
 * 检测扫掠包络线与道路边线的冲突
 *
 * 两种检测方式：
 * 1. 包络多边形边 vs 道路边线段的交点
 * 2. 包络顶点是否在道路走廊之外
 *
 * @param envelope 扫掠包络线
 * @param leftEdge 左边线
 * @param rightEdge 右边线
 * @returns 冲突列表
 */
export function detectConflicts(
  envelope: SweptEnvelope,
  leftEdge: Polyline,
  rightEdge: Polyline
): Conflict[] {
  const conflicts: Conflict[] = [];
  const vertices = envelope.polygon.vertices;

  if (vertices.length < 3) return conflicts;

  // 1. 包络边 vs 道路边线求交
  const envelopeEdges = getEdges(vertices);
  const leftEdges = getEdges(leftEdge);
  const rightEdges = getEdges(rightEdge);

  for (const envEdge of envelopeEdges) {
    // 检测与左边线的交点
    for (const edgeEdge of leftEdges) {
      const intersection = lineSegmentIntersection(envEdge, edgeEdge);
      if (intersection) {
        conflicts.push({
          point: intersection,
          type: 'intersection',
          envelopeSegment: envEdge,
          edgeSegment: edgeEdge,
        });
      }
    }
    // 检测与右边线的交点
    for (const edgeEdge of rightEdges) {
      const intersection = lineSegmentIntersection(envEdge, edgeEdge);
      if (intersection) {
        conflicts.push({
          point: intersection,
          type: 'intersection',
          envelopeSegment: envEdge,
          edgeSegment: edgeEdge,
        });
      }
    }
  }

  // 2. 包络顶点是否在道路走廊之外
  // 构建道路走廊多边形：左边线 + 反向右边线 围成的闭合区域
  const corridor = buildCorridorPolygon(leftEdge, rightEdge);
  if (corridor.length >= 3) {
    for (const v of vertices) {
      if (!isPointInPolygon(v, corridor)) {
        // 避免重复：同一位置的点只记录一次
        const alreadyRecorded = conflicts.some(
          (c) =>
            c.type === 'outside_corridor' &&
            Math.abs(c.point.x - v.x) < 0.001 &&
            Math.abs(c.point.y - v.y) < 0.001
        );
        if (!alreadyRecorded) {
          conflicts.push({
            point: { x: v.x, y: v.y },
            type: 'outside_corridor',
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * 检查每一帧车辆矩形轮廓是否与两侧道路边线相交。
 * 仅将左右边线视为障碍物：车辆可以从道路起点进入、从终点驶出，
 * 不把导入折线的端点封口误判为碰撞。
 */
export function detectVehicleFootprintConflicts(
  steps: SimulationStep[],
  leftEdge: Polyline,
  rightEdge: Polyline,
  requestedClearance: number = 0
): Conflict[] {
  const corridor = buildSafetyCorridor(leftEdge, rightEdge);
  return assessVehicleFootprints(steps, corridor, requestedClearance).conflicts;
}

/**
 * 对每个 0.1m 运动子步检查完整车辆轮廓。
 * 侧边线交叉与安全净距不足分别报告，且将净距回写到回放帧。
 */
export function assessVehicleFootprints(
  steps: SimulationStep[],
  corridor: SafetyCorridor,
  requestedClearance: number
): { conflicts: Conflict[]; minimumClearance: number } {
  const conflicts: Conflict[] = [];
  let minimumClearance = Infinity;

  for (const step of steps) {
    const safety = evaluateVehicleFootprint(step.corners, corridor, step.station, requestedClearance);
    step.minimumClearance = safety.minimumClearance;
    step.safetyReason = safety.conflicts[0]?.type;
    minimumClearance = Math.min(minimumClearance, safety.minimumClearance);
    for (const conflict of safety.conflicts) {
      const duplicate = conflicts.some((existing) =>
        existing.type === conflict.type &&
        Math.abs(existing.point.x - conflict.point.x) < 0.01 &&
        Math.abs(existing.point.y - conflict.point.y) < 0.01
      );
      if (!duplicate) conflicts.push(conflict);
    }
  }

  return { conflicts, minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 0 };
}

function assessmentFromConflicts(
  conflicts: Conflict[]
): NonNullable<SimulationResult['assessment']> {
  if (conflicts.length === 0) return 'passed';
  if (conflicts.some((conflict) => conflict.type === 'invalid_road_data')) return 'invalid_road_data';
  if (conflicts.some((conflict) => conflict.type === 'intersection' || conflict.type === 'outside_corridor')) return 'boundary_collision';
  return 'insufficient_clearance';
}

/**
 * 从多边形顶点列表提取边（线段）列表
 */
function getEdges(points: Polyline): LineSegment[] {
  const edges: LineSegment[] = [];
  if (points.length < 2) return edges;
  for (let i = 0; i < points.length - 1; i++) {
    edges.push({ start: points[i], end: points[i + 1] });
  }
  // 闭合边（首尾相连）
  if (points.length > 2) {
    edges.push({
      start: points[points.length - 1],
      end: points[0],
    });
  }
  return edges;
}

/**
 * 构建道路走廊多边形
 * 由左边线（正向）+ 右边线（反向）围成
 */
function buildCorridorPolygon(
  leftEdge: Polyline,
  rightEdge: Polyline
): Point2D[] {
  if (leftEdge.length < 2 || rightEdge.length < 2) return [];

  // 左边线正向 + 右边线反向
  const reversedRight = [...rightEdge].reverse();
  return [...leftEdge, ...reversedRight];
}
