/**
 * Hybrid A* 主线程响应性能回归。
 *
 * 该场景模拟真实道路的直线接圆弧和完整边线校核；自动选线必须在 1 秒内返回，
 * 否则浏览器在同步计算期间会出现“此页面没有响应”。
 */
import { performance } from 'node:perf_hooks';
import { runSimulation } from '../src/core/simulation/engine';
import { planOptimalRoute } from '../src/core/simulation/routePlanner';
import type { Path, Polyline, VehicleParams } from '../src/core/geometry/types';

const path: Path = [
  { type: 'straight', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
  {
    type: 'arc', center: { x: 50, y: 20 }, radius: 20,
    startAngle: -Math.PI / 2, endAngle: 0, clockwise: false,
    startPoint: { x: 50, y: 0 }, endPoint: { x: 70, y: 20 },
  },
];
const arc = (radius: number): Polyline => Array.from({ length: 33 }, (_, index) => {
  const angle = -Math.PI / 2 + (Math.PI / 2) * index / 32;
  return { x: 50 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
});
const left: Polyline = [{ x: 0, y: 5 }, { x: 50, y: 5 }, ...arc(15).slice(1)];
const right: Polyline = [{ x: 0, y: -5 }, { x: 50, y: -5 }, ...arc(25).slice(1)];
const vehicle: VehicleParams = {
  type: 'rigid', totalLength: 15.1, totalWidth: 3, frontOverhang: 1.5, rearOverhang: 2,
  maxSteerAngle: 35, maxSteeringRateDegPerSec: 10, steeringType: 'front',
  axles: [
    { distanceFromFront: 2, trackWidth: 2.5, isSteering: true, maxSteerAngle: 35 },
    { distanceFromFront: 12, trackWidth: 2.5, isSteering: false },
  ],
};

const planningStartedAt = performance.now();
const plan = planOptimalRoute(path, left, right, vehicle, { clearance: 0.5, speedKph: 5 });
const planningMs = performance.now() - planningStartedAt;
if (!plan.motion?.length) throw new Error('性能场景未生成规划状态。');
const coarsePlanningStartedAt = performance.now();
const coarsePlan = planOptimalRoute(
  path,
  [{ x: 0, y: 5 }, { x: 50, y: 5 }, { x: 65, y: 20 }],
  [{ x: 0, y: -5 }, { x: 50, y: -5 }, { x: 75, y: 20 }],
  vehicle,
  { clearance: 0.5, speedKph: 5 },
);
const coarsePlanningMs = performance.now() - coarsePlanningStartedAt;
if (!coarsePlan.motion?.length) throw new Error('简化边线性能场景未生成规划状态。');

const startedAt = performance.now();
const result = runSimulation(path, left, right, vehicle, 0.1, undefined, {
  routeMode: 'auto', clearance: 0.5, speedKph: 5,
});
const elapsedMs = performance.now() - startedAt;

if (!result.steps.length) throw new Error('性能场景未生成回放步骤。');
if (elapsedMs > 1500) {
  throw new Error(`Hybrid A* 细边线规划 ${planningMs.toFixed(0)}ms，粗边线规划 ${coarsePlanningMs.toFixed(0)}ms，完整模拟 ${elapsedMs.toFixed(0)}ms，超过 1500ms 响应上限。`);
}
console.log(`Hybrid A* 响应性能通过：${elapsedMs.toFixed(0)}ms`);

/**
 * V2 半挂车的规划状态比刚性车多出挂车朝向，不能只沿用刚性车的性能门槛。
 * 该场景覆盖直线入弯、两车身扫掠与 0.5m 净距复核；实际浏览器仍由 Worker 承担计算。
 */
const articulatedVehicle: VehicleParams = {
  type: 'articulated',
  totalLength: 8,
  totalWidth: 2.5,
  frontOverhang: 1.2,
  rearOverhang: 1.2,
  maxSteerAngle: 35,
  maxSteeringRateDegPerSec: 10,
  steeringType: 'front',
  axles: [
    { distanceFromFront: 1.5, trackWidth: 2.1, isSteering: true, maxSteerAngle: 35 },
    { distanceFromFront: 6, trackWidth: 2.1, isSteering: false },
  ],
  hitchOffset: -0.8,
  trailerHitchToAxle: 9,
  trailer: {
    totalLength: 13,
    totalWidth: 2.8,
    frontOverhang: 1.5,
    rearOverhang: 2.5,
    axles: [{ distanceFromFront: 11.5, trackWidth: 2.3, isSteering: false }],
    steeringMode: 'fixed',
  },
};
const articulatedPath: Path = [
  { type: 'straight', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
  {
    type: 'arc', center: { x: 50, y: -50 }, radius: 50,
    startAngle: Math.PI / 2, endAngle: 0, clockwise: true,
    startPoint: { x: 50, y: 0 }, endPoint: { x: 100, y: -50 },
  },
  { type: 'straight', start: { x: 100, y: -50 }, end: { x: 100, y: -90 } },
];
const articulatedArc = (radius: number): Polyline => Array.from({ length: 49 }, (_, index) => {
  const angle = Math.PI / 2 - (Math.PI / 2) * index / 48;
  return { x: 50 + radius * Math.cos(angle), y: -50 + radius * Math.sin(angle) };
});
const articulatedLeft: Polyline = [
  { x: 0, y: 9 }, { x: 50, y: 9 },
  ...articulatedArc(59).slice(1), { x: 109, y: -90 },
];
const articulatedRight: Polyline = [
  { x: 0, y: -9 }, { x: 50, y: -9 },
  ...articulatedArc(41).slice(1), { x: 91, y: -90 },
];
const articulatedStartedAt = performance.now();
const articulatedResult = runSimulation(
  articulatedPath,
  articulatedLeft,
  articulatedRight,
  articulatedVehicle,
  0.1,
  undefined,
  { routeMode: 'auto', clearance: 0.5, speedKph: 5 },
);
const articulatedElapsedMs = performance.now() - articulatedStartedAt;
if (!articulatedResult.route?.articulatedMotion?.length) {
  throw new Error('半挂车性能场景未生成连续铰接状态。');
}
if (!articulatedResult.route.feasible) {
  throw new Error(`半挂车性能场景未找到可行路线：${articulatedResult.route.message ?? '未知原因'}`);
}
if (articulatedElapsedMs > 5000) {
  throw new Error(`半挂车 Hybrid A* 完整规划与双车身复核 ${articulatedElapsedMs.toFixed(0)}ms，超过 5000ms 性能上限。`);
}
console.log(`半挂车 Hybrid A* 响应性能通过：${articulatedElapsedMs.toFixed(0)}ms`);
