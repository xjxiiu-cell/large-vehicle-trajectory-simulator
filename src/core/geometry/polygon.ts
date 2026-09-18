/**
 * 多边形/凸包/面积计算
 */

import type { Point2D } from './types';
import { crossProduct, directionVector } from './transform';

/**
 * Andrew 算法求凸包
 * O(n log n)
 */
export function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return [...points];

  // 排序：先 x 后 y
  const sorted = [...points].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.y - b.y
  );

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      crossProduct(
        directionVector(lower[lower.length - 2], lower[lower.length - 1]),
        directionVector(lower[lower.length - 1], p)
      ) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      crossProduct(
        directionVector(upper[upper.length - 2], upper[upper.length - 1]),
        directionVector(upper[upper.length - 1], p)
      ) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  // 去掉首尾重复点
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * 多边形面积（Shoelace 公式）
 * 顶点按逆时针排列 → 正面积
 */
export function polygonArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;

  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * 多边形周长
 */
export function polygonPerimeter(vertices: Point2D[]): number {
  let perimeter = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j].x - vertices[i].x;
    const dy = vertices[j].y - vertices[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/**
 * 多边形简化（Douglas-Peucker 算法去掉共线点）
 */
export function simplifyPolygon(
  points: Point2D[],
  tolerance: number
): Point2D[] {
  if (points.length <= 3) return [...points];

  // 首尾相同，去掉末尾
  const n =
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
      ? points.length - 1
      : points.length;

  const result = douglasPeucker(points.slice(0, n), tolerance);
  // 保证闭合
  if (result.length > 2) {
    result.push({ ...result[0] });
  }
  return result;
}

function douglasPeucker(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    // 合并，去掉重复点
    left.pop();
    return [...left, ...right];
  }

  return [first, last];
}

/**
 * 点到线段的垂直距离
 */
function perpendicularDistance(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = point.x - lineStart.x;
    const py = point.y - lineStart.y;
    return Math.sqrt(px * px + py * py);
  }
  const t =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  const clampedT = Math.max(0, Math.min(1, t));
  const projX = lineStart.x + clampedT * dx;
  const projY = lineStart.y + clampedT * dy;
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

/**
 * 生成矩形角点（从中心、朝向、尺寸）
 */
export function rectangleCorners(
  center: Point2D,
  heading: number,
  length: number,
  width: number
): { frontLeft: Point2D; frontRight: Point2D; rearLeft: Point2D; rearRight: Point2D } {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const halfL = length / 2;
  const halfW = width / 2;

  // 前向（heading 方向）
  const fwdX = halfL * cos;
  const fwdY = halfL * sin;
  // 右侧（顺时针 90°）
  const rightX = halfW * sin;
  const rightY = -halfW * cos;

  return {
    frontLeft: {
      x: center.x + fwdX - rightX,
      y: center.y + fwdY - rightY,
    },
    frontRight: {
      x: center.x + fwdX + rightX,
      y: center.y + fwdY + rightY,
    },
    rearLeft: {
      x: center.x - fwdX - rightX,
      y: center.y - fwdY - rightY,
    },
    rearRight: {
      x: center.x - fwdX + rightX,
      y: center.y - fwdY + rightY,
    },
  };
}
