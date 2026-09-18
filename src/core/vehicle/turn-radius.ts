/**
 * 转弯半径-道路宽度计算表
 *
 * 根据车辆参数自动生成转弯半径与所需道路宽度的对照表。
 * 纯函数模块，无 UI 依赖。
 */

import type { VehicleParams, RadiusWidthTable, RadiusWidthEntry } from '../geometry/types';
import { computeMinTurnRadius, findRearmostAxle } from './ackermann';

/**
 * 生成转弯半径-宽度表
 *
 * 1. 计算最小转弯半径 R_min
 * 2. R_start = ceil(R_min / 5) × 5（向上取整到 5 的倍数）
 * 3. 生成条目：R = R_start, R_start+5, ..., maxRadius
 * 4. 每个 R 对应的所需道路宽度 = 稳态转弯扫掠宽度
 *
 * @param params 车辆参数
 * @param maxRadius 用户指定的最大转弯半径（米），默认 100
 * @returns 完整的转弯半径-宽度表
 */
export function generateRadiusWidthTable(
  params: VehicleParams,
  maxRadius: number = 100
): RadiusWidthTable {
  const R_min = computeMinTurnRadius(params);

  const vehicleName =
    params.type === 'rigid'
      ? `刚性车 ${params.totalLength.toFixed(1)}m × ${params.totalWidth.toFixed(1)}m`
      : `铰接车 ${params.totalLength.toFixed(1)}m`;

  // 无转向轴：只能直行
  if (!isFinite(R_min)) {
    return {
      vehicleName,
      minRadius: 0,
      maxRadius,
      entries: [
        {
          radius: Infinity,
          width: params.totalWidth,
        } as RadiusWidthEntry,
      ],
    };
  }

  const R_start = Math.ceil(R_min / 5) * 5;

  const entries: RadiusWidthEntry[] = [];
  for (let R = R_start; R <= maxRadius; R += 5) {
    entries.push({
      radius: R,
      width: round2(computeRequiredRoadWidth(params, R)),
    });
  }

  return {
    vehicleName,
    minRadius: round2(R_min),
    maxRadius,
    entries,
  };
}

/**
 * 计算稳态转弯时所需的道路宽度
 *
 * 车辆以固定半径 R 稳态转弯：
 * - ICR（瞬时旋转中心）位于后轴延长线上，距车辆中心线距离 = R
 * - 最外侧轨迹 = 前外侧角点绕 ICR 的半径
 * - 最内侧轨迹 = 后内侧角点绕 ICR 的半径
 * - 所需路宽 = 外侧半径 - 内侧半径
 *
 * 公式：
 *   R_outer = sqrt((R + W/2)² + L_front²)
 *   R_inner = sqrt(max(0, R - W/2)² + L_rear²)
 *   width = R_outer - R_inner
 *
 * @param params 车辆参数
 * @param R 转弯半径（米），即后轴中心轨迹半径
 * @returns 所需道路宽度（米）
 */
export function computeRequiredRoadWidth(
  params: VehicleParams,
  R: number
): number {
  const { axle: rearmost } = findRearmostAxle(params);

  const L_front = rearmost.distanceFromFront; // 后轴 → 前保险杠
  const L_rear = params.totalLength - rearmost.distanceFromFront; // 后轴 → 后保险杠
  const W = params.totalWidth;

  // 外侧半径：前外角到 ICR 的距离
  const R_outer = Math.sqrt((R + W / 2) ** 2 + L_front ** 2);

  // 内侧半径：后内角到 ICR 的距离
  // 当 R < W/2 时，内侧点可能在 ICR 另一侧，用 0 防止负数开方
  const innerOffset = Math.max(0, R - W / 2);
  const R_inner = Math.sqrt(innerOffset ** 2 + L_rear ** 2);

  return R_outer - R_inner;
}

/**
 * 四舍五入到两位小数
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
