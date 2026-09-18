/**
 * 刚性车前轴转向连续性回归检查。
 *
 * 覆盖直线直接接圆弧的道路：相邻模拟帧中最后轴中心不能出现米级横跳。
 */
import { runSimulation } from '../src/core/simulation/engine';
import {
  createRigidVehicleStateFromFrontAxle,
  getFrontSteeringAxleWorldPoint,
  integrateRigidVehicleState,
  rigidVehicleStateToPose,
} from '../src/core/vehicle/ackermann';
import { computeVehicleCorners } from '../src/core/vehicle/ackermann';
import { buildSafetyCorridor, evaluateVehicleFootprint } from '../src/core/simulation/safetyCorridor';
import type { Path, Polyline, VehicleParams } from '../src/core/geometry/types';

const path: Path = [
  { type: 'straight', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
  {
    type: 'arc',
    center: { x: 50, y: 20 },
    radius: 20,
    startAngle: -Math.PI / 2,
    endAngle: 0,
    clockwise: false,
    startPoint: { x: 50, y: 0 },
    endPoint: { x: 70, y: 20 },
  },
];

const leftEdge: Polyline = [{ x: 0, y: 100 }, { x: 70, y: 100 }];
const rightEdge: Polyline = [{ x: 0, y: -100 }, { x: 70, y: -100 }];
const vehicle: VehicleParams = {
  type: 'rigid',
  totalLength: 15.1,
  totalWidth: 3,
  frontOverhang: 1.5,
  rearOverhang: 2,
  maxSteerAngle: 35,
  maxSteeringRateDegPerSec: 10,
  steeringType: 'front',
  axles: [
    { distanceFromFront: 2, trackWidth: 2.5, isSteering: true, maxSteerAngle: 35 },
    { distanceFromFront: 12, trackWidth: 2.5, isSteering: false },
  ],
};

const originalLog = console.log;
console.log = () => undefined;
const result = runSimulation(path, leftEdge, rightEdge, vehicle, 0.1, undefined, { routeMode: 'centerline', speedKph: 5 });
console.log = originalLog;

let maximumRearAxleStep = 0;
for (let index = 1; index < result.steps.length; index++) {
  const previous = result.steps[index - 1].pose.position;
  const current = result.steps[index].pose.position;
  maximumRearAxleStep = Math.max(maximumRearAxleStep, Math.hypot(current.x - previous.x, current.y - previous.y));
}

if (maximumRearAxleStep > 0.101) {
  throw new Error(`后轴出现非连续跳变：相邻帧最大位移 ${maximumRearAxleStep.toFixed(3)}m`);
}
if (!result.frontAxleTrack || result.frontAxleTrack.length !== result.steps.length) {
  throw new Error('未输出与每一帧对应的实际前转向轴轨迹。');
}
if (!result.rearAxleTrack || result.rearAxleTrack.length !== result.steps.length) {
  throw new Error('未输出与每一帧对应的实际后轴轨迹。');
}

// 直行：后轴和前轴均应以同一朝向连续前进。
const start = createRigidVehicleStateFromFrontAxle(vehicle, { x: 10, y: 0 }, 0);
if (!start) throw new Error('无法建立刚性车初始状态。');
const straight = integrateRigidVehicleState(vehicle, start, 0, 5, 5 / 3.6);
if (!straight || Math.abs(straight.rearAxle.x - (start.rearAxle.x + 5)) > 1e-8 || Math.abs(straight.rearAxle.y - start.rearAxle.y) > 1e-8) {
  throw new Error('零转向直行积分结果错误。');
}

// 恒定转角圆弧：后轴应落在理论圆上，前轴与后轴的距离始终等于轴距。
const delta = 20 * Math.PI / 180;
const arcStart = { ...start, steeringAngle: delta };
const arcDistance = 10;
const arc = integrateRigidVehicleState(vehicle, arcStart, delta, arcDistance, 5 / 3.6);
if (!arc) throw new Error('恒定转角圆弧积分失败。');
const expectedRadius = 10 / Math.tan(delta);
const expectedHeading = arcDistance / expectedRadius;
if (Math.abs(arc.heading - expectedHeading) > 1e-8) {
  throw new Error('恒定转角圆弧朝向不符合理论值。');
}
const arcPose = rigidVehicleStateToPose(vehicle, arc);
const arcFront = getFrontSteeringAxleWorldPoint(vehicle, arcPose);
if (!arcFront || Math.abs(Math.hypot(arcFront.x - arc.rearAxle.x, arcFront.y - arc.rearAxle.y) - 10) > 1e-8) {
  throw new Error('前后轴距在连续积分后不一致。');
}

// 转向速率：每一个 0.1m 子步的实际转角变化不得超出“变化率 × 行驶时间”。
const maxChange = vehicle.maxSteeringRateDegPerSec * Math.PI / 180 * (0.1 / (5 / 3.6));
for (let index = 1; index < result.steps.length; index++) {
  const previous = result.steps[index - 1].steeringAngle ?? 0;
  const current = result.steps[index].steeringAngle ?? 0;
  if (Math.abs(current - previous) > maxChange + 1e-8) {
    throw new Error(`转向角变化过快：第 ${index} 帧变化 ${(Math.abs(current - previous) * 180 / Math.PI).toFixed(3)}°`);
  }
}

// 安全走廊：右边线反向导入时应自动统一方向；净距和碰撞必须按完整车身轮廓计算。
const corridor = buildSafetyCorridor(
  [{ x: 0, y: 5 }, { x: 30, y: 5 }],
  [{ x: 30, y: -5 }, { x: 0, y: -5 }],
);
if (!corridor.valid) throw new Error(`有效道路被误判为异常：${corridor.message}`);
const safeCorners = computeVehicleCorners(vehicle, rigidVehicleStateToPose(vehicle, { ...start, rearAxle: { x: 15, y: 0 } }));
const insufficient = evaluateVehicleFootprint(safeCorners, corridor, 15, 4);
if (insufficient.minimumClearance >= 4 || insufficient.conflicts[0]?.type !== 'insufficient_clearance') {
  throw new Error('完整车身的安全净距不足未被正确识别。');
}
const collisionCorners = computeVehicleCorners(vehicle, rigidVehicleStateToPose(vehicle, { ...start, rearAxle: { x: 15, y: 4 } }));
const collision = evaluateVehicleFootprint(collisionCorners, corridor, 15, 0);
if (collision.conflicts[0]?.type !== 'intersection') {
  throw new Error('完整车身与道路侧边线的碰撞未被正确识别。');
}
const invalidCorridor = buildSafetyCorridor(
  [{ x: 0, y: 2 }, { x: 10, y: 2 }],
  [{ x: 0, y: -2 }, { x: 10, y: 4 }],
);
if (invalidCorridor.valid) throw new Error('交叉边线未被识别为道路导入异常。');

// Hybrid A*：在直线进入左弯前必须提前建立连续转向，且规划结果直接输出后轴状态序列。
const arcPoints = (radius: number): Polyline => Array.from({ length: 17 }, (_, index) => {
  const angle = -Math.PI / 2 + (Math.PI / 2) * index / 16;
  return { x: 50 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
});
const curvedLeft: Polyline = [{ x: 0, y: 5 }, { x: 50, y: 5 }, ...arcPoints(15).slice(1)];
const curvedRight: Polyline = [{ x: 0, y: -5 }, { x: 50, y: -5 }, ...arcPoints(25).slice(1)];
const automatic = runSimulation(path, curvedLeft, curvedRight, vehicle, 0.1, undefined, {
  routeMode: 'auto', clearance: 0.5, speedKph: 5,
});
if (!automatic.route?.motion || automatic.route.motion.length !== automatic.steps.length) {
  throw new Error('Hybrid A* 未将连续后轴状态直接输出给模拟回放。');
}
if (!automatic.route.feasible || !automatic.passed) {
  throw new Error(`Hybrid A* 在宽度充足的直线—圆弧道路上未找到安全路线：${automatic.route.message ?? '未知原因'}`);
}
const firstTurningStep = automatic.steps.findIndex((step) => Math.abs(step.steeringAngle ?? 0) > 0.01);
if (firstTurningStep < 0 || automatic.steps[firstTurningStep].station >= 50) {
  throw new Error('Hybrid A* 没有在圆弧前提前建立转向。');
}

console.log(`刚性车连续运动学通过：${result.steps.length} 帧，后轴相邻帧最大位移 ${maximumRearAxleStep.toFixed(3)}m`);
