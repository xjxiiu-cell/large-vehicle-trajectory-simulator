/**
 * 刚性前轮转向模拟的关键回归测试。
 *
 * 这些测试不依赖 React 或画布，确保运动学、道路安全走廊、自动路线和扫掠数据
 * 在前端界面修改后仍可独立验证。
 */
import { describe, expect, it } from 'vitest';
import type { Path, Polyline, VehicleParams } from '../geometry/types';
import {
  createRigidVehicleStateFromFrontAxle,
  integrateRigidVehicleState,
} from '../vehicle/ackermann';
import { runSimulation } from './engine';
import { buildSafetyCorridor } from './safetyCorridor';

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

const centerline: Path = [
  { type: 'straight', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
  {
    type: 'arc', center: { x: 50, y: 20 }, radius: 20,
    startAngle: -Math.PI / 2, endAngle: 0, clockwise: false,
    startPoint: { x: 50, y: 0 }, endPoint: { x: 70, y: 20 },
  },
];

const arcEdge = (radius: number): Polyline => Array.from({ length: 17 }, (_, index) => {
  const angle = -Math.PI / 2 + (Math.PI / 2) * index / 16;
  return { x: 50 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
});
const leftEdge: Polyline = [{ x: 0, y: 5 }, { x: 50, y: 5 }, ...arcEdge(15).slice(1)];
const rightEdge: Polyline = [{ x: 0, y: -5 }, { x: 50, y: -5 }, ...arcEdge(25).slice(1)];

describe('刚性车连续运动学与安全路线', () => {
  it('零转向时后轴按直线连续前进', () => {
    const start = createRigidVehicleStateFromFrontAxle(vehicle, { x: 10, y: 0 }, 0);
    expect(start).not.toBeNull();
    const next = integrateRigidVehicleState(vehicle, start!, 0, 5, 5 / 3.6);
    expect(next?.rearAxle.x).toBeCloseTo(start!.rearAxle.x + 5, 8);
    expect(next?.rearAxle.y).toBeCloseTo(start!.rearAxle.y, 8);
  });

  it('转向角变化受速度和最大变化率限制', () => {
    const start = createRigidVehicleStateFromFrontAxle(vehicle, { x: 10, y: 0 }, 0)!;
    const next = integrateRigidVehicleState(vehicle, start, 35 * Math.PI / 180, 0.1, 5 / 3.6)!;
    const allowed = 10 * Math.PI / 180 * (0.1 / (5 / 3.6));
    expect(Math.abs(next.steeringAngle - start.steeringAngle)).toBeLessThanOrEqual(allowed + 1e-10);
  });

  it('可统一反向边线，并拒绝交叉道路边线', () => {
    expect(buildSafetyCorridor([{ x: 0, y: 5 }, { x: 30, y: 5 }], [{ x: 30, y: -5 }, { x: 0, y: -5 }]).valid).toBe(true);
    expect(buildSafetyCorridor([{ x: 0, y: 2 }, { x: 10, y: 2 }], [{ x: 0, y: -2 }, { x: 10, y: 4 }]).valid).toBe(false);
  });

  it('自动路线输出连续前后轴轨迹和相邻扫掠片段', () => {
    const result = runSimulation(centerline, leftEdge, rightEdge, vehicle, 0.1, undefined, {
      routeMode: 'auto', clearance: 0.5, speedKph: 5,
    });
    expect(result.route?.motion?.length).toBe(result.steps.length);
    expect(result.frontAxleTrack?.length).toBe(result.steps.length);
    expect(result.rearAxleTrack?.length).toBe(result.steps.length);
    expect(result.envelope.slices?.length).toBeGreaterThan(0);
    for (let index = 1; index < result.steps.length; index++) {
      const previous = result.steps[index - 1].rearAxle!;
      const current = result.steps[index].rearAxle!;
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThanOrEqual(0.101);
    }
  });
});
