/** V2-1 单半挂车连续运动学回归测试。 */
import { describe, expect, it } from 'vitest';
import type { Path, Polyline, VehicleParams } from '../geometry/types';
import { runSimulation } from './engine';
import {
  createArticulatedVehicleStateFromFrontAxle,
  computeTrailerCorners,
  getArticulatedGeometry,
  integrateArticulatedVehicleState,
} from '../vehicle/articulated';

const vehicle: VehicleParams = {
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

function quarterArcPoints(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number, count: number): Polyline {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = startAngle + (endAngle - startAngle) * index / count;
    return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
  });
}

describe('V2-1 固定挂车轴连续运动学', () => {
  it('直行时铰接角为零，铰接约束长度保持不变', () => {
    const start = createArticulatedVehicleStateFromFrontAxle(vehicle, { x: 5, y: 0 }, 0)!;
    const next = integrateArticulatedVehicleState(vehicle, start, 0, 10, 5 / 3.6)!;
    const geometry = getArticulatedGeometry(vehicle, next)!;
    const trailerCorners = computeTrailerCorners(vehicle, next)!;
    expect(next.tractorHeading).toBeCloseTo(0, 8);
    expect(next.trailerHeading).toBeCloseTo(0, 8);
    expect(geometry.articulationAngle).toBeCloseTo(0, 8);
    expect(Math.hypot(geometry.hitchPoint.x - geometry.trailerAxle.x, geometry.hitchPoint.y - geometry.trailerAxle.y)).toBeCloseTo(9, 8);
    expect(trailerCorners.frontLeft.x - geometry.hitchPoint.x).toBeCloseTo(1.5, 8);
    expect(trailerCorners.frontLeft.x - trailerCorners.rearLeft.x).toBeCloseTo(13, 8);
  });

  it('恒定左转时挂车朝向连续滞后于牵引车，形成合理内轮差', () => {
    let state = createArticulatedVehicleStateFromFrontAxle(vehicle, { x: 5, y: 0 }, 0)!;
    for (let index = 0; index < 100; index++) {
      const previous = state;
      state = integrateArticulatedVehicleState(vehicle, state, 20 * Math.PI / 180, 0.1, 5 / 3.6)!;
      expect(Math.hypot(state.tractorRearAxle.x - previous.tractorRearAxle.x, state.tractorRearAxle.y - previous.tractorRearAxle.y)).toBeLessThanOrEqual(0.101);
    }
    expect(state.tractorHeading).toBeGreaterThan(state.trailerHeading);
    expect(getArticulatedGeometry(vehicle, state)!.articulationAngle).toBeGreaterThan(0);
  });

  it('牵引车与挂车数据均进入模拟回放，并完成双车身安全校核', () => {
    const path: Path = [{ type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }];
    const left: Polyline = [{ x: 0, y: 10 }, { x: 30, y: 10 }];
    const right: Polyline = [{ x: 0, y: -10 }, { x: 30, y: -10 }];
    const result = runSimulation(path, left, right, vehicle, 0.1, undefined, { routeMode: 'centerline', speedKph: 5 });
    expect(result.assessment).toBe('passed');
    expect(result.steps.every((step) => Boolean(step.trailerCorners && step.hitchPoint && step.trailerAxle))).toBe(true);
    expect(result.hitchTrack?.length).toBe(result.steps.length);
    expect(result.trailerAxleTrack?.length).toBe(result.steps.length);
    expect(result.envelope.tractorSlices?.length).toBeGreaterThan(0);
    expect(result.envelope.trailerSlices?.length).toBeGreaterThan(0);
  });

  it('窄路中挂车先越过边线时，冲突必须归属半挂车', () => {
    const path: Path = [{ type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }];
    const left: Polyline = [{ x: 0, y: 1.3 }, { x: 30, y: 1.3 }];
    const right: Polyline = [{ x: 0, y: -1.3 }, { x: 30, y: -1.3 }];
    const result = runSimulation(path, left, right, vehicle, 0.1, undefined, {
      routeMode: 'centerline', clearance: 0, speedKph: 5,
    });
    expect(result.assessment).toBe('boundary_collision');
    expect(result.conflicts.some((conflict) => conflict.vehicleBody === 'trailer')).toBe(true);
    expect(result.steps.some((step) => step.trailerSafetyReason === 'intersection')).toBe(true);
  });

  it('尚未碰线但净距不足时，记录发生问题的半挂车和最小净距', () => {
    const path: Path = [{ type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }];
    const left: Polyline = [{ x: 0, y: 2 }, { x: 30, y: 2 }];
    const right: Polyline = [{ x: 0, y: -2 }, { x: 30, y: -2 }];
    const result = runSimulation(path, left, right, vehicle, 0.1, undefined, {
      routeMode: 'centerline', clearance: 1, speedKph: 5,
    });
    expect(result.assessment).toBe('insufficient_clearance');
    expect(result.conflicts.some((conflict) => conflict.vehicleBody === 'trailer' && conflict.type === 'insufficient_clearance')).toBe(true);
    expect(result.minimumClearance).toBeCloseTo(0.6, 5);
  });

  it('自动规划只输出连续铰接状态，且在宽直路完成前进行驶', () => {
    const path: Path = [{ type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }];
    const left: Polyline = [{ x: 0, y: 10 }, { x: 30, y: 10 }];
    const right: Polyline = [{ x: 0, y: -10 }, { x: 30, y: -10 }];
    const result = runSimulation(path, left, right, vehicle, 0.1, undefined, {
      routeMode: 'auto', clearance: 0.5, speedKph: 5,
    });
    expect(result.passed).toBe(true);
    expect(result.route?.feasible).toBe(true);
    expect(result.route?.articulatedMotion?.length).toBeGreaterThan(100);
    for (let index = 1; index < result.steps.length; index++) {
      const previous = result.steps[index - 1].rearAxle!;
      const current = result.steps[index].rearAxle!;
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThanOrEqual(0.101);
    }
  });

  it('无连续安全路线时只保留真实可执行部分，不伪造后续中线轨迹', () => {
    const path: Path = [{ type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }];
    const left: Polyline = [{ x: 0, y: 1.3 }, { x: 30, y: 1.3 }];
    const right: Polyline = [{ x: 0, y: -1.3 }, { x: 30, y: -1.3 }];
    const result = runSimulation(path, left, right, vehicle, 0.1, undefined, {
      routeMode: 'auto', clearance: 0, speedKph: 5,
    });
    expect(result.passed).toBe(false);
    expect(result.route?.feasible).toBe(false);
    expect(result.steps.length).toBeLessThan(300);
    expect(result.route?.failureStation).toBeLessThan(30);
    expect(result.steps.at(-1)?.station).toBeCloseTo(result.route?.failureStation ?? 0, 5);
  });

  it('中线引导可通过的直线接弯道，自动规划不得在弯前过早中断', () => {
    const center: Path = [
      { type: 'straight', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
      {
        type: 'arc', center: { x: 30, y: -50 }, radius: 50, startAngle: Math.PI / 2, endAngle: 0,
        clockwise: true, startPoint: { x: 30, y: 0 }, endPoint: { x: 80, y: -50 },
      },
      { type: 'straight', start: { x: 80, y: -50 }, end: { x: 80, y: -75 } },
    ];
    const left: Polyline = [
      { x: 0, y: 8 }, { x: 30, y: 8 },
      ...quarterArcPoints(30, -50, 58, Math.PI / 2, 0, 24).slice(1),
      { x: 88, y: -75 },
    ];
    const right: Polyline = [
      { x: 0, y: -8 }, { x: 30, y: -8 },
      ...quarterArcPoints(30, -50, 42, Math.PI / 2, 0, 24).slice(1),
      { x: 72, y: -75 },
    ];
    const guided = runSimulation(center, left, right, vehicle, 0.1, undefined, {
      routeMode: 'centerline', clearance: 0.5, speedKph: 5,
    });
    expect(guided.passed).toBe(true);
    const automatic = runSimulation(center, left, right, vehicle, 0.1, undefined, {
      routeMode: 'auto', clearance: 0.5, speedKph: 5,
    });
    expect(automatic.passed).toBe(true);
    expect(automatic.steps.at(-1)?.station).toBeGreaterThan(120);
  });
});
