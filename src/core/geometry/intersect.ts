/**
 * 线段/几何求交函数
 */

import type { Point2D, LineSegment } from './types';
import { crossProduct, dotProduct, directionVector } from './transform';

/**
 * 检查两线段是否相交，返回交点（如有）
 * 使用跨立实验
 */
export function lineSegmentIntersection(
  s1: LineSegment,
  s2: LineSegment
): Point2D | null {
  const { start: a, end: b } = s1;
  const { start: c, end: d } = s2;

  const ab = directionVector(a, b);
  const ac = directionVector(a, c);
  const ad = directionVector(a, d);
  const cd = directionVector(c, d);
  const ca = directionVector(c, a);
  const cb = directionVector(c, b);

  const cross1 = crossProduct(ab, ac);
  const cross2 = crossProduct(ab, ad);
  const cross3 = crossProduct(cd, ca);
  const cross4 = crossProduct(cd, cb);

  // 共线情况
  if (cross1 === 0 && cross2 === 0 && cross3 === 0 && cross4 === 0) {
    return null; // 暂不处理共线重叠
  }

  // 跨立测试
  if (cross1 * cross2 <= 0 && cross3 * cross4 <= 0) {
    // 计算参数 t
    const denominator = crossProduct(ab, cd);
    if (denominator === 0) return null; // 平行

    const t = crossProduct(ac, cd) / denominator;
    return {
      x: a.x + t * ab.x,
      y: a.y + t * ab.y,
    };
  }

  return null;
}

/**
 * 判断点是否在多边形内部（射线法）
 */
export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    if (
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * 点到线段的最短距离
 */
export function pointToSegmentDistance(
  point: Point2D,
  seg: LineSegment
): number {
  const ab = directionVector(seg.start, seg.end);
  const ap = directionVector(seg.start, point);

  const lenSq = dotProduct(ab, ab);
  if (lenSq === 0) {
    // 线段退化
    const dp = directionVector(seg.start, point);
    return Math.sqrt(dotProduct(dp, dp));
  }

  // 投影参数 t
  let t = dotProduct(ap, ab) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projection: Point2D = {
    x: seg.start.x + t * ab.x,
    y: seg.start.y + t * ab.y,
  };

  const d = directionVector(point, projection);
  return Math.sqrt(dotProduct(d, d));
}

/**
 * 线段总长度
 */
export function segmentLength(seg: LineSegment): number {
  const d = directionVector(seg.start, seg.end);
  return Math.sqrt(dotProduct(d, d));
}

/**
 * 折线总长度
 */
export function polylineLength(points: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.sqrt(
      (points[i].x - points[i - 1].x) ** 2 +
        (points[i].y - points[i - 1].y) ** 2
    );
  }
  return len;
}

/**
 * 线段上的点（按参数 t ∈ [0, 1]）
 */
export function pointOnSegment(seg: LineSegment, t: number): Point2D {
  return {
    x: seg.start.x + t * (seg.end.x - seg.start.x),
    y: seg.start.y + t * (seg.end.y - seg.start.y),
  };
}

/**
 * 折线上距起点给定距离的点
 */
export function pointOnPolylineAtDistance(
  polyline: Point2D[],
  distance: number
): { point: Point2D; segmentIndex: number } | null {
  if (polyline.length < 2) return null;

  let accumulated = 0;
  for (let i = 1; i < polyline.length; i++) {
    const segLen = Math.sqrt(
      (polyline[i].x - polyline[i - 1].x) ** 2 +
        (polyline[i].y - polyline[i - 1].y) ** 2
    );
    if (accumulated + segLen >= distance) {
      const remaining = distance - accumulated;
      const t = segLen > 0 ? remaining / segLen : 0;
      const seg: LineSegment = { start: polyline[i - 1], end: polyline[i] };
      return { point: pointOnSegment(seg, t), segmentIndex: i - 1 };
    }
    accumulated += segLen;
  }

  // 超出范围，返回终点
  return { point: { ...polyline[polyline.length - 1] }, segmentIndex: polyline.length - 2 };
}
