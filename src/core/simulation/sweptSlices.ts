/** 连续扫掠片段构建：相邻 0.1m 车身轮廓的保守凸包。 */
import type { Point2D, Polygon, VehicleCorners } from '../geometry/types';

/**
 * 将一组连续车身矩形转成相邻扫掠片段。
 * 每个片段只覆盖相邻帧，避免跨弯道首尾连线产生虚假的大扇形。
 */
export function buildContinuousSweptSlices(frames: VehicleCorners[]): Polygon[] {
  const slices: Polygon[] = [];
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1];
    const current = frames[index];
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
