/**
 * Ackermann 转向运动学
 *
 * 纯函数模块，无 UI 依赖。提供：
 * - 车辆角点计算（非对称矩形，参考点为最后轴中心）
 * - 最小转弯半径计算（多轴 Ackermann 模型）
 * - 路径上的车辆位姿工厂
 */

import type {
  VehicleParams,
  VehiclePose,
  VehicleCorners,
  AxleConfig,
  Path,
  Point2D,
  RigidVehicleState,
} from '../geometry/types';
import { degToRad } from '../geometry/transform';
import { pointOnPathInfo } from '../geometry/path';
import type { PointOnPathInfo } from '../geometry/path';

/**
 * 找到最后轴（distanceFromFront 最大的轴）
 * 返回轴配置及其索引
 */
export function findRearmostAxle(
  params: VehicleParams
): { axle: AxleConfig; index: number } {
  let rearmostIdx = 0;
  let maxDist = params.axles[0]?.distanceFromFront ?? 0;

  for (let i = 1; i < params.axles.length; i++) {
    if (params.axles[i].distanceFromFront > maxDist) {
      maxDist = params.axles[i].distanceFromFront;
      rearmostIdx = i;
    }
  }

  return { axle: params.axles[rearmostIdx], index: rearmostIdx };
}

/**
 * 找到最靠前的转向轴。
 * 刚性车的控制轨迹以该轴中心为准；目前的车辆模型均为前轴转向。
 */
export function findPrimarySteeringAxle(
  params: VehicleParams
): { axle: AxleConfig; index: number } | null {
  let steeringIndex = -1;
  let minimumDistance = Infinity;

  params.axles.forEach((axle, index) => {
    if (axle.isSteering && axle.distanceFromFront < minimumDistance) {
      minimumDistance = axle.distanceFromFront;
      steeringIndex = index;
    }
  });

  return steeringIndex < 0
    ? null
    : { axle: params.axles[steeringIndex], index: steeringIndex };
}

/** 前转向轴到最后轴的轴距；不存在前转向轴时返回 null。 */
export function getFrontSteeringWheelbase(params: VehicleParams): number | null {
  const steering = findPrimarySteeringAxle(params);
  const { axle: rearmost } = findRearmostAxle(params);
  if (!steering) return null;
  const wheelbase = rearmost.distanceFromFront - steering.axle.distanceFromFront;
  return wheelbase > 0 ? wheelbase : null;
}

/**
 * 前转向轴中心可达到的最小转弯半径。
 * 现有最小半径以最后轴中心计量，两者由同一瞬时转动中心关联。
 */
export function computeFrontSteeringMinTurnRadius(params: VehicleParams): number {
  const rearRadius = computeMinTurnRadius(params);
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase || !Number.isFinite(rearRadius)) return Infinity;
  return Math.hypot(rearRadius, wheelbase);
}

/** 根据前轴路线曲率得到目标前轮转角。 */
export function computeFrontPathSteeringAngle(
  params: VehicleParams,
  frontPathRadius: number,
  turnDirection: -1 | 0 | 1
): number | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase) return null;
  if (turnDirection === 0 || !Number.isFinite(frontPathRadius)) return 0;
  if (frontPathRadius <= wheelbase) return null;
  return turnDirection * Math.asin(Math.min(1, wheelbase / frontPathRadius));
}

/**
 * 根据前转向轴中心的路线反算车辆位姿。
 *
 * 车辆前轴的轨迹切线与车身朝向相差转向角。输入的路径点始终是前转向轴中心，
 * 本函数输出仍保持全项目约定：position 为最后轴中心，供车身角点与包络计算使用。
 */
export function computePoseFromFrontSteeringPath(
  params: VehicleParams,
  frontAxlePoint: { x: number; y: number },
  frontPathHeading: number,
  frontPathRadius: number,
  turnDirection: -1 | 0 | 1
): VehiclePose | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  const steeringAngle = computeFrontPathSteeringAngle(params, frontPathRadius, turnDirection);
  if (!wheelbase || steeringAngle === null) return null;
  const canTurn = steeringAngle !== 0;
  const heading = normalizeAngle(frontPathHeading - steeringAngle);
  const rearPosition = {
    x: frontAxlePoint.x - wheelbase * Math.cos(heading),
    y: frontAxlePoint.y - wheelbase * Math.sin(heading),
  };

  return {
    position: rearPosition,
    heading,
    turnRadius: canTurn ? Math.sqrt(frontPathRadius * frontPathRadius - wheelbase * wheelbase) : Infinity,
  };
}

/**
 * 按有限转向角变化后的滚动距离推进刚性车。
 *
 * 这是逐步模拟的唯一位姿推进方式：后轴从上一帧连续滚动到下一帧，
 * 不会因道路曲率或规划圆弧在段边界突变而横向跳跃。
 */
export function advanceRigidVehiclePose(
  params: VehicleParams,
  previousPose: VehiclePose,
  steeringAngle: number,
  frontAxleTravelDistance: number
): VehiclePose | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase || frontAxleTravelDistance < 0) return null;

  // 前轴速度比后轴速度略大；用后轴实际滚动距离推进车身。
  const rearTravelDistance = frontAxleTravelDistance * Math.cos(steeringAngle);
  const headingChange = rearTravelDistance * Math.tan(steeringAngle) / wheelbase;
  const midHeading = previousPose.heading + headingChange / 2;
  const heading = normalizeAngle(previousPose.heading + headingChange);

  return {
    position: {
      x: previousPose.position.x + rearTravelDistance * Math.cos(midHeading),
      y: previousPose.position.y + rearTravelDistance * Math.sin(midHeading),
    },
    heading,
    turnRadius: Math.abs(steeringAngle) < 1e-8
      ? Infinity
      : Math.abs(wheelbase / Math.tan(steeringAngle)),
  };
}

/** 根据前转向轴的初始位置建立后轴运动状态。仅用于模拟首帧初始化。 */
export function createRigidVehicleStateFromFrontAxle(
  params: VehicleParams,
  frontAxle: Point2D,
  heading: number,
  station: number = 0
): RigidVehicleState | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase) return null;
  return {
    rearAxle: {
      x: frontAxle.x - wheelbase * Math.cos(heading),
      y: frontAxle.y - wheelbase * Math.sin(heading),
    },
    heading: normalizeAngle(heading),
    steeringAngle: 0,
    station,
  };
}

/** 将连续状态转换为项目既有的车辆位姿数据。 */
export function rigidVehicleStateToPose(
  params: VehicleParams,
  state: RigidVehicleState
): VehiclePose {
  const wheelbase = getFrontSteeringWheelbase(params);
  const turnRadius = !wheelbase || Math.abs(state.steeringAngle) < 1e-8
    ? Infinity
    : Math.abs(wheelbase / Math.tan(state.steeringAngle));
  return {
    position: { ...state.rearAxle },
    heading: state.heading,
    turnRadius,
  };
}

/**
 * 以自行车模型连续推进刚性车。
 *
 * 推进距离以后轴滚动距离计量。目标转角会先按车辆速度和最大转向角变化率限幅，
 * 再用该小段的平均转角积分，因此每一帧的后轴位置、朝向和转角都连续。
 */
export function integrateRigidVehicleState(
  params: VehicleParams,
  state: RigidVehicleState,
  targetSteeringAngle: number,
  rearTravelDistance: number,
  speedMps: number
): RigidVehicleState | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase || rearTravelDistance < 0 || speedMps <= 0) return null;

  const steeringAxle = findPrimarySteeringAxle(params)?.axle;
  const maximumSteeringAngle = degToRad(steeringAxle?.maxSteerAngle ?? params.maxSteerAngle);
  const boundedTarget = Math.max(-maximumSteeringAngle, Math.min(maximumSteeringAngle, targetSteeringAngle));
  const maxRate = degToRad(params.maxSteeringRateDegPerSec);
  const durationSeconds = rearTravelDistance / speedMps;
  const maxChange = maxRate * durationSeconds;
  const steeringAngle = Math.max(
    state.steeringAngle - maxChange,
    Math.min(state.steeringAngle + maxChange, boundedTarget)
  );

  // 转向角在一个很小的子步中线性变化，取平均角可避免“转角先跳、再位移”。
  const effectiveSteeringAngle = (state.steeringAngle + steeringAngle) / 2;
  const curvature = Math.tan(effectiveSteeringAngle) / wheelbase;
  const headingChange = curvature * rearTravelDistance;
  const heading = normalizeAngle(state.heading + headingChange);

  let rearAxle: Point2D;
  if (Math.abs(curvature) < 1e-10) {
    rearAxle = {
      x: state.rearAxle.x + rearTravelDistance * Math.cos(state.heading),
      y: state.rearAxle.y + rearTravelDistance * Math.sin(state.heading),
    };
  } else {
    rearAxle = {
      x: state.rearAxle.x + (Math.sin(state.heading + headingChange) - Math.sin(state.heading)) / curvature,
      y: state.rearAxle.y - (Math.cos(state.heading + headingChange) - Math.cos(state.heading)) / curvature,
    };
  }

  return {
    rearAxle,
    heading,
    steeringAngle,
    station: state.station + rearTravelDistance,
  };
}

/** 根据最后轴中心位姿取得前转向轴中心，供画布标注与校核使用。 */
export function getFrontSteeringAxleWorldPoint(
  params: VehicleParams,
  pose: VehiclePose
): { x: number; y: number } | null {
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase) return null;
  return {
    x: pose.position.x + wheelbase * Math.cos(pose.heading),
    y: pose.position.y + wheelbase * Math.sin(pose.heading),
  };
}

/**
 * 计算车辆四个角点的世界坐标
 *
 * 参考点为最后轴中心（Ackermann 标准约定）。
 * 车身矩形相对于参考点是非对称的：
 * - 前向延伸 = 最后轴距前端的距离
 * - 后向延伸 = 总长 - 最后轴距前端的距离
 *
 * @param params 车辆参数
 * @param pose 车辆位姿（position = 最后轴中心, heading = 朝向角）
 * @returns 四个角点的世界坐标
 */
export function computeVehicleCorners(
  params: VehicleParams,
  pose: VehiclePose
): VehicleCorners {
  const { axle: rearmost } = findRearmostAxle(params);

  const frontExtent = rearmost.distanceFromFront; // 参考点 → 前保险杠
  const rearExtent = params.totalLength - rearmost.distanceFromFront; // 参考点 → 后保险杠
  const halfWidth = params.totalWidth / 2;

  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);

  // 前向向量
  const fwdX = frontExtent * cos;
  const fwdY = frontExtent * sin;
  // 后向向量
  const rearX = rearExtent * cos;
  const rearY = rearExtent * sin;
  // 左向向量（逆时针旋转 90°）
  const leftX = halfWidth * -sin;
  const leftY = halfWidth * cos;

  return {
    frontLeft: {
      x: pose.position.x + fwdX + leftX,
      y: pose.position.y + fwdY + leftY,
    },
    frontRight: {
      x: pose.position.x + fwdX - leftX,
      y: pose.position.y + fwdY - leftY,
    },
    rearLeft: {
      x: pose.position.x - rearX + leftX,
      y: pose.position.y - rearY + leftY,
    },
    rearRight: {
      x: pose.position.x - rearX - leftX,
      y: pose.position.y - rearY - leftY,
    },
  };
}

/**
 * 计算多轴 Ackermann 车辆的最小转弯半径
 *
 * 算法：
 * 1. 找到最后轴作为参考轴（ICR 位于该轴延长线上）
 * 2. 对每个转向轴（distanceFromFront < 参考轴），计算其限制的最小半径
 *    R_i = wheelbase_i / tan(δ_max_i)
 * 3. R_min = max(R_i) + 参考轴轮距/2
 *
 * 如果无转向轴或所有转向角 ≥ 89.5°，返回 Infinity（只能直行）
 *
 * @param params 车辆参数
 * @returns 最小转弯半径（米），或 Infinity
 */
export function computeMinTurnRadius(params: VehicleParams): number {
  const { axle: rearmost } = findRearmostAxle(params);

  // 过滤出参考轴前方的转向轴
  const steeringAxles = params.axles.filter(
    (a) =>
      a.isSteering &&
      a.distanceFromFront < rearmost.distanceFromFront
  );

  if (steeringAxles.length === 0) return Infinity;

  let maxRKinematic = 0;

  for (const sa of steeringAxles) {
    const wheelbase = rearmost.distanceFromFront - sa.distanceFromFront;
    if (wheelbase <= 0) continue; // 跳过与参考轴重合的轴

    const maxAngleDeg = sa.maxSteerAngle ?? params.maxSteerAngle;
    // 转向角接近 90° 时不限制转弯（tan 趋近无穷大）
    if (maxAngleDeg >= 89.5) continue;

    const maxAngleRad = degToRad(maxAngleDeg);
    const R = wheelbase / Math.tan(maxAngleRad);
    if (R > maxRKinematic) {
      maxRKinematic = R;
    }
  }

  if (maxRKinematic === 0) return Infinity;

  // 加上参考轴轮距的一半（从车辆中心线到外轮的物理偏移）
  return maxRKinematic + rearmost.trackWidth / 2;
}

/**
 * 获取路径上指定里程处的转弯半径
 *
 * 直线段返回 Infinity，圆弧段返回圆弧半径。
 * 这只是 `pointOnPathInfo()` 的便捷封装。
 *
 * @param centerline 中线路径
 * @param station 里程（米）
 * @param lastSegmentIndex 上次段索引缓存
 * @returns 转弯半径（米），或 Infinity（直线段）
 */
export function computeTurnRadiusAtStation(
  centerline: Path,
  station: number,
  lastSegmentIndex: number = -1
): number {
  const info = pointOnPathInfo(centerline, station, lastSegmentIndex);
  if (!info) return Infinity;
  return info.turnRadius;
}

/**
 * 从路径信息构建车辆位姿
 *
 * 当 path 几何方向与行驶方向一致时，heading = path 切线方向；
 * 当几何方向与行驶方向相反时，heading = 切线 + π（车辆沿反方向行驶，
 * 但刚性车扫掠区域在 heading 和 heading+π 下是对称的，所以结果等效）。
 *
 * @param pathInfo 路径点信息（来自 pointOnPathInfo）
 * @param headingOffset 航向修正量（0 = 正向, π = 反向），由调用方通过 isDrivingDirectionForward 决定
 * @returns 车辆位姿
 */
export function computeAckermannPose(
  pathInfo: PointOnPathInfo,
  headingOffset: number = 0
): VehiclePose {
  return {
    position: { x: pathInfo.point.x, y: pathInfo.point.y },
    heading: headingOffset === 0 ? pathInfo.heading : normalizeAngle(pathInfo.heading + headingOffset),
    turnRadius: pathInfo.turnRadius,
  };
}

/**
 * 标准化角度到 [-π, π] 范围
 */
function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle <= -Math.PI) angle += 2 * Math.PI;
  return angle;
}
