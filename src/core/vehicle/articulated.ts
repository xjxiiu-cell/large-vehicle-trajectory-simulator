/**
 * 单半挂车低速连续运动学。
 *
 * 本模块只覆盖“前轮转向牵引车 + 单半挂车 + 固定挂车轴组 + 前进”。
 * 所有函数均为纯函数，不依赖画布或状态管理。
 */
import type {
  ArticulatedVehicleState,
  Point2D,
  TrailerParams,
  VehicleCorners,
  VehicleParams,
  VehiclePose,
} from '../geometry/types';
import { normalizeAngle, degToRad } from '../geometry/transform';
import { findPrimarySteeringAxle, getFrontSteeringWheelbase } from './ackermann';

export interface ArticulatedGeometry {
  hitchPoint: Point2D;
  trailerAxle: Point2D;
  articulationAngle: number;
}

/** 检查 V2-1 所需的半挂车几何参数是否完整。 */
export function validateArticulatedVehicle(params: VehicleParams): string | null {
  if (params.type !== 'articulated') return '当前车辆不是铰接车。';
  if (!params.trailer) return '请填写挂车尺寸与轴配置。';
  if (params.trailer.steeringMode !== 'fixed') return '当前阶段仅支持固定挂车轴组；可转向挂车轴将在 V2-1A 按车型资料验证。';
  if (!getFrontSteeringWheelbase(params)) return '牵引车需要一根位于最后轴前方的前转向轴。';
  if (!Number.isFinite(params.hitchOffset)) return '请填写第五轮相对牵引车后轴的位置。';
  if (!params.trailerHitchToAxle || params.trailerHitchToAxle <= 0) return '请填写第五轮至挂车等效轴组中心的距离。';
  if (params.trailer.axles.length === 0) return '挂车至少需要一根轴。';
  return null;
}

/** 以牵引车前转向轴的初始位置建立铰接车状态。 */
export function createArticulatedVehicleStateFromFrontAxle(
  params: VehicleParams,
  frontAxle: Point2D,
  heading: number,
  station: number = 0,
): ArticulatedVehicleState | null {
  if (validateArticulatedVehicle(params)) return null;
  const wheelbase = getFrontSteeringWheelbase(params);
  if (!wheelbase) return null;
  return {
    tractorRearAxle: {
      x: frontAxle.x - wheelbase * Math.cos(heading),
      y: frontAxle.y - wheelbase * Math.sin(heading),
    },
    tractorHeading: normalizeAngle(heading),
    // 初始进入道路时牵引车与挂车共线；之后由连续方程自然形成铰接角。
    trailerHeading: normalizeAngle(heading),
    steeringAngle: 0,
    station,
  };
}

/** 从连续状态推导第五轮、挂车等效轴组和铰接角。 */
export function getArticulatedGeometry(params: VehicleParams, state: ArticulatedVehicleState): ArticulatedGeometry | null {
  const hitchOffset = params.hitchOffset;
  if (!params.trailer || hitchOffset === undefined || !Number.isFinite(hitchOffset) || !params.trailerHitchToAxle) return null;
  const hitchPoint = {
    x: state.tractorRearAxle.x + hitchOffset * Math.cos(state.tractorHeading),
    y: state.tractorRearAxle.y + hitchOffset * Math.sin(state.tractorHeading),
  };
  const trailerAxle = {
    x: hitchPoint.x - params.trailerHitchToAxle * Math.cos(state.trailerHeading),
    y: hitchPoint.y - params.trailerHitchToAxle * Math.sin(state.trailerHeading),
  };
  return {
    hitchPoint,
    trailerAxle,
    articulationAngle: normalizeAngle(state.tractorHeading - state.trailerHeading),
  };
}

/** 将连续状态转换为牵引车项目既有位姿。 */
export function articulatedTractorPose(params: VehicleParams, state: ArticulatedVehicleState): VehiclePose {
  const wheelbase = getFrontSteeringWheelbase(params);
  return {
    position: { ...state.tractorRearAxle },
    heading: state.tractorHeading,
    turnRadius: !wheelbase || Math.abs(state.steeringAngle) < 1e-8
      ? Infinity
      : Math.abs(wheelbase / Math.tan(state.steeringAngle)),
    articulationAngle: normalizeAngle(state.tractorHeading - state.trailerHeading),
  };
}

/** 挂车位姿的参考点固定为等效后轴组中心。 */
export function articulatedTrailerPose(params: VehicleParams, state: ArticulatedVehicleState): VehiclePose | null {
  const geometry = getArticulatedGeometry(params, state);
  if (!geometry) return null;
  return {
    position: geometry.trailerAxle,
    heading: state.trailerHeading,
    turnRadius: Infinity,
    articulationAngle: geometry.articulationAngle,
  };
}

/** 用挂车最后轴组中心作为参考点计算挂车车身四角。 */
export function computeTrailerCorners(params: VehicleParams, state: ArticulatedVehicleState): VehicleCorners | null {
  const trailer = params.trailer;
  const pose = articulatedTrailerPose(params, state);
  const hitchToAxle = params.trailerHitchToAxle;
  if (!trailer || !pose || !hitchToAxle) return null;
  return computeBodyCorners(trailer, pose, hitchToAxle);
}

/**
 * 以“等效后轴组中心”为参考点计算挂车矩形车身角点。
 *
 * 挂车尺寸不再从明细轴的最末一根反推：运动学使用的等效后轴组才是
 * 参考点。尺寸链固定为“挂车前端—牵引销—等效后轴组—车尾”。
 */
export function computeBodyCorners(body: TrailerParams, pose: VehiclePose, hitchToAxleDistance: number): VehicleCorners {
  const frontExtent = hitchToAxleDistance + body.frontOverhang;
  const rearExtent = body.rearOverhang;
  const halfWidth = body.totalWidth / 2;
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  const leftX = -halfWidth * sin;
  const leftY = halfWidth * cos;
  return {
    frontLeft: { x: pose.position.x + frontExtent * cos + leftX, y: pose.position.y + frontExtent * sin + leftY },
    frontRight: { x: pose.position.x + frontExtent * cos - leftX, y: pose.position.y + frontExtent * sin - leftY },
    rearLeft: { x: pose.position.x - rearExtent * cos + leftX, y: pose.position.y - rearExtent * sin + leftY },
    rearRight: { x: pose.position.x - rearExtent * cos - leftX, y: pose.position.y - rearExtent * sin - leftY },
  };
}

/**
 * 以无侧滑半挂车模型推进一个后轴距离子步。
 * 使用牵引车转角平均值和挂车朝向 RK2 中点积分，保证转角与铰接角均连续。
 */
export function integrateArticulatedVehicleState(
  params: VehicleParams,
  state: ArticulatedVehicleState,
  targetSteeringAngle: number,
  rearTravelDistance: number,
  speedMps: number,
): ArticulatedVehicleState | null {
  const invalid = validateArticulatedVehicle(params);
  const wheelbase = getFrontSteeringWheelbase(params);
  const trailerDistance = params.trailerHitchToAxle;
  if (invalid || !wheelbase || !trailerDistance || rearTravelDistance < 0 || speedMps <= 0) return null;

  const steeringAxle = findPrimarySteeringAxle(params)?.axle;
  const maxSteering = degToRad(steeringAxle?.maxSteerAngle ?? params.maxSteerAngle);
  const boundedTarget = Math.max(-maxSteering, Math.min(maxSteering, targetSteeringAngle));
  const maxChange = degToRad(params.maxSteeringRateDegPerSec) * (rearTravelDistance / speedMps);
  const steeringAngle = Math.max(
    state.steeringAngle - maxChange,
    Math.min(state.steeringAngle + maxChange, boundedTarget),
  );
  const effectiveSteering = (state.steeringAngle + steeringAngle) / 2;
  const curvature = Math.tan(effectiveSteering) / wheelbase;
  const headingChange = curvature * rearTravelDistance;
  const tractorHeading = normalizeAngle(state.tractorHeading + headingChange);
  const midHeading = state.tractorHeading + headingChange / 2;

  const tractorRearAxle = Math.abs(curvature) < 1e-10
    ? {
        x: state.tractorRearAxle.x + rearTravelDistance * Math.cos(state.tractorHeading),
        y: state.tractorRearAxle.y + rearTravelDistance * Math.sin(state.tractorHeading),
      }
    : {
        x: state.tractorRearAxle.x + (Math.sin(state.tractorHeading + headingChange) - Math.sin(state.tractorHeading)) / curvature,
        y: state.tractorRearAxle.y - (Math.cos(state.tractorHeading + headingChange) - Math.cos(state.tractorHeading)) / curvature,
      };

  const trailerDerivative = (tractorHeadingValue: number, trailerHeadingValue: number) => {
    const alpha = normalizeAngle(tractorHeadingValue - trailerHeadingValue);
    const hitchOffset = params.hitchOffset ?? 0;
    return (Math.sin(alpha) + hitchOffset * curvature * Math.cos(alpha)) / trailerDistance;
  };
  const k1 = trailerDerivative(state.tractorHeading, state.trailerHeading);
  const trailerMidHeading = state.trailerHeading + rearTravelDistance * k1 / 2;
  const k2 = trailerDerivative(midHeading, trailerMidHeading);

  return {
    tractorRearAxle,
    tractorHeading,
    trailerHeading: normalizeAngle(state.trailerHeading + rearTravelDistance * k2),
    steeringAngle,
    station: state.station + rearTravelDistance,
  };
}
