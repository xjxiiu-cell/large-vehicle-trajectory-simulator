/**
 * 2D 几何变换函数
 * 平移、旋转、缩放
 */

import type { Point2D, Vector2D, BoundingBox } from './types';

/**
 * 点平移
 */
export function translatePoint(p: Point2D, dx: number, dy: number): Point2D {
  return { x: p.x + dx, y: p.y + dy, z: p.z };
}

/**
 * 点绕原点旋转
 * @param p 待旋转的点
 * @param angle 旋转角（弧度），逆时针为正
 */
export function rotatePoint(p: Point2D, angle: number): Point2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
    z: p.z,
  };
}

/**
 * 点绕任意中心旋转
 * @param p 待旋转的点
 * @param center 旋转中心
 * @param angle 旋转角（弧度），逆时针为正
 */
export function rotatePointAround(
  p: Point2D,
  center: Point2D,
  angle: number
): Point2D {
  // 先平移到原点
  const translated = translatePoint(p, -center.x, -center.y);
  // 旋转
  const rotated = rotatePoint(translated, angle);
  // 平移回去
  return translatePoint(rotated, center.x, center.y);
}

/**
 * 多点平移
 */
export function translatePoints(
  points: Point2D[],
  dx: number,
  dy: number
): Point2D[] {
  return points.map((p) => translatePoint(p, dx, dy));
}

/**
 * 多点旋转
 */
export function rotatePointsAround(
  points: Point2D[],
  center: Point2D,
  angle: number
): Point2D[] {
  return points.map((p) => rotatePointAround(p, center, angle));
}

/**
 * 两点之间的距离
 */
export function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * 向量长度
 */
export function vectorLength(v: Vector2D): number {
  return Math.sqrt(v.x ** 2 + v.y ** 2);
}

/**
 * 向量归一化
 */
export function normalize(v: Vector2D): Vector2D {
  const len = vectorLength(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * 两点之间的方向向量（从 a 指向 b）
 */
export function directionVector(a: Point2D, b: Point2D): Vector2D {
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * 计算方向角（弧度，从正东方向逆时针）
 */
export function heading(origin: Point2D, target: Point2D): number {
  return Math.atan2(target.y - origin.y, target.x - origin.x);
}

/**
 * 根据方向向量计算朝向角
 */
export function vectorToHeading(v: Vector2D): number {
  return Math.atan2(v.y, v.x);
}

/**
 * 沿给定方向移动一段距离
 */
export function moveAlong(p: Point2D, heading: number, dist: number): Point2D {
  return {
    x: p.x + dist * Math.cos(heading),
    y: p.y + dist * Math.sin(heading),
    z: p.z,
  };
}

/**
 * 垂直向量（逆时针旋转 90°）
 */
export function perpendicular(v: Vector2D): Vector2D {
  return { x: -v.y, y: v.x };
}

/**
 * 点积
 */
export function dotProduct(a: Vector2D, b: Vector2D): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 叉积（z 分量）
 */
export function crossProduct(a: Vector2D, b: Vector2D): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * 计算包围盒
 */
export function computeBoundingBox(points: Point2D[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 包围盒中心点
 */
export function boundingBoxCenter(bb: BoundingBox): Point2D {
  return {
    x: (bb.minX + bb.maxX) / 2,
    y: (bb.minY + bb.maxY) / 2,
  };
}

/**
 * 包围盒尺寸
 */
export function boundingBoxSize(bb: BoundingBox): { width: number; height: number } {
  return {
    width: bb.maxX - bb.minX,
    height: bb.maxY - bb.minY,
  };
}

/**
 * 角度转弧度
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 弧度转角度
 */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * 角度标准化到 [-PI, PI]
 */
export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}
