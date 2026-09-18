/**
 * 平行曲线偏移（用于道路边线生成）
 */

import type { Point2D } from './types';
import { normalize, perpendicular, directionVector } from './transform';

/**
 * 将折线向一侧偏移指定距离
 * @param polyline 原始折线
 * @param offset 偏移距离，正值 = 左侧，负值 = 右侧（相对于行进方向）
 */
export function offsetPolyline(
  polyline: Point2D[],
  offset: number
): Point2D[] {
  if (polyline.length < 2 || offset === 0) return [...polyline];

  const result: Point2D[] = [];

  for (let i = 0; i < polyline.length; i++) {
    let normalX = 0;
    let normalY = 0;

    if (i === 0) {
      // 起点：只用第一段的法向量
      const dir = directionVector(polyline[0], polyline[1]);
      const perp = perpendicular(normalize(dir));
      normalX = perp.x;
      normalY = perp.y;
    } else if (i === polyline.length - 1) {
      // 终点：只用最后一段的法向量
      const dir = directionVector(polyline[i - 1], polyline[i]);
      const perp = perpendicular(normalize(dir));
      normalX = perp.x;
      normalY = perp.y;
    } else {
      // 中间点：两段法向量的平均值
      const dir1 = directionVector(polyline[i - 1], polyline[i]);
      const dir2 = directionVector(polyline[i], polyline[i + 1]);
      const n1 = normalize(dir1);
      const n2 = normalize(dir2);
      const perp1 = perpendicular(n1);
      const perp2 = perpendicular(n2);
      // 平分角方向
      const sumX = perp1.x + perp2.x;
      const sumY = perp1.y + perp2.y;
      const len = Math.sqrt(sumX * sumX + sumY * sumY);
      if (len > 0) {
        normalX = sumX / len;
        normalY = sumY / len;
      }
    }

    result.push({
      x: polyline[i].x + normalX * offset,
      y: polyline[i].y + normalY * offset,
    });
  }

  return result;
}
