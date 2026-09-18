/**
 * 路径工具函数
 * 路径（Path）由直线段（StraightPathSegment）和圆弧段（ArcPathSegment）混合组成
 * 供渲染离散化、长度计算、运动学模拟使用
 */

import type {
  Point2D,
  Polyline,
  Path,
  PathSegment,
  StraightPathSegment,
  ArcPathSegment,
} from './types';

/** 默认圆弧离散化分段数（全圆） */
export const DEFAULT_ARC_SEGMENTS = 128;

/**
 * pointOnPath 的增强返回值
 * 在位置和航向之外，额外返回所在段索引、段类型和局部转弯半径
 * 供模拟引擎判断当前是否在圆弧段上
 */
export interface PointOnPathInfo {
  /** 路径上的点坐标 */
  point: Point2D;
  /** 路径在该点的切线方向（弧度，正东=0） */
  heading: number;
  /** 所在段的索引（0-based） */
  segmentIndex: number;
  /** 所在段的类型 */
  segmentType: 'straight' | 'arc';
  /** 当前航点的转弯半径。直线段 = Infinity，圆弧段 = arc.radius */
  turnRadius: number;
  /** 路径几何的转弯方向：1=逆时针（左转），-1=顺时针（右转），0=直线。 */
  turnDirection: -1 | 0 | 1;
}

/**
 * 将路径离散化为折线
 * 圆弧段按指定分段数离散化（自适应：根据弧长调整分段数）
 *
 * @param path 路径
 * @param segmentsPerCircle 全圆分段数基准，默认 128
 * @returns 离散化后的点列
 */
export function pathToPolyline(
  path: Path,
  segmentsPerCircle: number = DEFAULT_ARC_SEGMENTS
): Polyline {
  if (path.length === 0) return [];

  const result: Point2D[] = [];

  for (const seg of path) {
    if (seg.type === 'straight') {
      // 直线段：直接取两端点（避免重复起点）
      if (result.length === 0) {
        result.push({ x: seg.start.x, y: seg.start.y });
      }
      result.push({ x: seg.end.x, y: seg.end.y });
    } else {
      // 圆弧段：动态离散化
      const arc = seg as ArcPathSegment;
      const arcPoints = discretizeArc(arc, segmentsPerCircle);

      if (result.length === 0) {
        result.push(...arcPoints);
      } else {
        // 跳过第一个点（与前一段终点重合）
        result.push(...arcPoints.slice(1));
      }
    }
  }

  return result;
}

/**
 * 将圆弧段离散化为折线点列
 * 分段数根据弧长自适应调整
 */
function discretizeArc(
  arc: ArcPathSegment,
  segmentsPerCircle: number
): Point2D[] {
  const { center, radius, startAngle, endAngle, clockwise } = arc;

  // 计算弧的角跨度
  let angleSpan = endAngle - startAngle;
  if (clockwise) {
    if (angleSpan > 0) angleSpan -= 2 * Math.PI;
  } else {
    if (angleSpan < 0) angleSpan += 2 * Math.PI;
  }

  const absAngleSpan = Math.abs(angleSpan);

  // 全圆检测
  const isFullCircle = Math.abs(absAngleSpan - 2 * Math.PI) < 0.0001;

  // 自适应分段数：弧越长、半径越大，分段越多
  let segments: number;
  if (isFullCircle) {
    segments = segmentsPerCircle;
  } else {
    const arcLength = absAngleSpan * radius;
    // 每个分段对应的弧长不超过 (2πR / segmentsPerCircle)
    const baseSegmentLength = (2 * Math.PI * radius) / segmentsPerCircle;
    segments = Math.max(8, Math.ceil(arcLength / baseSegmentLength));
  }

  const points: Point2D[] = [];
  const step = angleSpan / segments;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + step * i;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }

  return points;
}

/**
 * 计算路径总长度
 * 直线段：欧氏距离；圆弧段：弧长 = 半径 × 角跨度
 */
export function pathLength(path: Path): number {
  let total = 0;

  for (const seg of path) {
    if (seg.type === 'straight') {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      total += Math.sqrt(dx * dx + dy * dy);
    } else {
      const arc = seg as ArcPathSegment;
      let angleSpan = arc.endAngle - arc.startAngle;
      if (arc.clockwise) {
        if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        angleSpan = Math.abs(angleSpan);
      } else {
        if (angleSpan < 0) angleSpan += 2 * Math.PI;
      }
      total += arc.radius * angleSpan;
    }
  }

  return total;
}

/**
 * 获取路径上指定里程处的点和切线方向
 * 用于运动学模拟时车辆沿路径定位
 *
 * @param path 路径
 * @param station 从路径起点起的里程（米）
 * @returns 该位置的点坐标和切线方向角（弧度，正东=0）
 */
export function pointOnPath(
  path: Path,
  station: number
): { point: Point2D; heading: number } | null {
  if (path.length === 0) return null;

  let accumulated = 0;

  for (const seg of path) {
    let segLength: number;

    if (seg.type === 'straight') {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      segLength = Math.sqrt(dx * dx + dy * dy);
    } else {
      const arc = seg as ArcPathSegment;
      let angleSpan = arc.endAngle - arc.startAngle;
      if (arc.clockwise) {
        if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        angleSpan = Math.abs(angleSpan);
      } else {
        if (angleSpan < 0) angleSpan += 2 * Math.PI;
      }
      segLength = arc.radius * angleSpan;
    }

    if (accumulated + segLength >= station) {
      const remaining = station - accumulated;
      return pointOnSegment(seg, remaining);
    }

    accumulated += segLength;
  }

  // 超出路径总长，返回终点
  return pointOnSegment(path[path.length - 1], Infinity);
}

/**
 * 获取路径上指定里程处的点、切线方向、段类型和转弯半径
 *
 * 相比 pointOnPath，额外返回所在段索引、段类型（straight/arc）和局部转弯半径。
 * 模拟引擎用此函数判断车辆当前是否在圆弧段上，以及圆弧的半径。
 *
 * 内部采用段索引缓存优化：station 通常单调递增，从上次段继续搜索而非每次从头遍历。
 *
 * @param path 路径
 * @param station 从路径起点起的里程（米）
 * @param lastSegmentIndex 上次调用所在的段索引（传入 -1 表示从头搜索）
 * @returns 增强的路径信息，含段类型和转弯半径
 */
export function pointOnPathInfo(
  path: Path,
  station: number,
  lastSegmentIndex: number = -1
): PointOnPathInfo | null {
  if (path.length === 0) return null;

  // 段索引缓存：station 单调变化时从上次段继续搜索
  let accumulated = 0;

  // 先计算 lastSegmentIndex 之前各段的累计长度
  let startIdx = Math.max(0, lastSegmentIndex);
  for (let i = 0; i < startIdx && i < path.length; i++) {
    const seg = path[i];
    if (seg.type === 'straight') {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      accumulated += Math.sqrt(dx * dx + dy * dy);
    } else {
      const arc = seg as ArcPathSegment;
      let angleSpan = arc.endAngle - arc.startAngle;
      if (arc.clockwise) {
        if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        angleSpan = Math.abs(angleSpan);
      } else {
        if (angleSpan < 0) angleSpan += 2 * Math.PI;
      }
      accumulated += arc.radius * angleSpan;
    }
  }

  // 反向行驶检测：station 递减时，缓存索引可能超前于实际位置
  // 如果累计里程已超过目标 station，说明 station 已退到缓存段之前，重置搜索
  if (accumulated > station) {
    startIdx = 0;
    accumulated = 0;
  }

  // 从 startIdx 开始搜索
  for (let i = startIdx; i < path.length; i++) {
    const seg = path[i];
    let segLength: number;

    if (seg.type === 'straight') {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      segLength = Math.sqrt(dx * dx + dy * dy);
    } else {
      const arc = seg as ArcPathSegment;
      let angleSpan = arc.endAngle - arc.startAngle;
      if (arc.clockwise) {
        if (angleSpan > 0) angleSpan -= 2 * Math.PI;
        angleSpan = Math.abs(angleSpan);
      } else {
        if (angleSpan < 0) angleSpan += 2 * Math.PI;
      }
      segLength = arc.radius * angleSpan;
    }

    if (accumulated + segLength >= station) {
      const remaining = station - accumulated;
      const result = pointOnSegment(seg, remaining);
      return {
        point: result.point,
        heading: result.heading,
        segmentIndex: i,
        segmentType: seg.type,
        turnRadius: seg.type === 'arc' ? (seg as ArcPathSegment).radius : Infinity,
        turnDirection: seg.type === 'arc' ? ((seg as ArcPathSegment).clockwise ? -1 : 1) : 0,
      };
    }

    accumulated += segLength;
  }

  // 超出路径总长，返回终点所在段信息
  const lastSeg = path[path.length - 1];
  const result = pointOnSegment(lastSeg, Infinity);
  return {
    point: result.point,
    heading: result.heading,
    segmentIndex: path.length - 1,
    segmentType: lastSeg.type,
    turnRadius: lastSeg.type === 'arc' ? (lastSeg as ArcPathSegment).radius : Infinity,
    turnDirection: lastSeg.type === 'arc' ? ((lastSeg as ArcPathSegment).clockwise ? -1 : 1) : 0,
  };
}

/**
 * 获取路径段上指定距离处的点和切线方向
 */
function pointOnSegment(
  seg: PathSegment,
  dist: number
): { point: Point2D; heading: number } {
  if (seg.type === 'straight') {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) {
      return {
        point: { x: seg.start.x, y: seg.start.y },
        heading: 0,
      };
    }

    const t = Math.min(1, dist / len);
    return {
      point: {
        x: seg.start.x + t * dx,
        y: seg.start.y + t * dy,
      },
      heading: Math.atan2(dy, dx),
    };
  } else {
    const arc = seg as ArcPathSegment;
    let angleSpan = arc.endAngle - arc.startAngle;

    if (arc.clockwise) {
      if (angleSpan > 0) angleSpan -= 2 * Math.PI;
    } else {
      if (angleSpan < 0) angleSpan += 2 * Math.PI;
    }

    const arcLength = arc.radius * Math.abs(angleSpan);
    const fraction = arcLength > 0 ? Math.min(1, dist / arcLength) : 0;
    const angle = arc.startAngle + angleSpan * fraction;

    // 切线方向：顺时针转时切线角 = 当前角 - π/2，逆时针 = 当前角 + π/2
    const tangentAngle = arc.clockwise
      ? angle - Math.PI / 2
      : angle + Math.PI / 2;

    return {
      point: {
        x: arc.center.x + arc.radius * Math.cos(angle),
        y: arc.center.y + arc.radius * Math.sin(angle),
      },
      heading: tangentAngle,
    };
  }
}

/**
 * 创建直线路径段
 */
export function createStraightSegment(
  start: Point2D,
  end: Point2D
): StraightPathSegment {
  return { type: 'straight', start: { ...start }, end: { ...end } };
}

/**
 * 创建圆弧路径段
 */
export function createArcSegment(
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean = false
): ArcPathSegment {
  return {
    type: 'arc',
    center: { ...center },
    radius,
    startAngle,
    endAngle,
    clockwise,
    startPoint: {
      x: center.x + radius * Math.cos(startAngle),
      y: center.y + radius * Math.sin(startAngle),
    },
    endPoint: {
      x: center.x + radius * Math.cos(endAngle),
      y: center.y + radius * Math.sin(endAngle),
    },
  };
}

/**
 * 判断路径的行驶方向是否与几何方向一致
 *
 * 原理：边线的几何起点（CAD 中画的第一点）应该靠近中线的行驶起点。
 * 不依赖左右判断（因为左右标注本身就是基于中线方向算出来的，会循环论证）。
 *
 * 方法：比较中线几何首点的位置——左边线的起点离得近还是终点离得近。
 * 如果边线终点更靠近中线几何首点 → 中线被反向构建了 → 需要翻转。
 *
 * @param centerline 中线路径
 * @param leftEdge 左边线折线
 * @param rightEdge 右边线折线
 * @param segmentsPerCircle 中线离散化精度
 * @returns true = 几何方向与行驶方向一致，false = 需要翻转
 */
export function isDrivingDirectionForward(
  centerline: Path,
  leftEdge: Polyline,
  rightEdge: Polyline,
  segmentsPerCircle: number = 256
): boolean {
  if (centerline.length === 0) return true;
  if (leftEdge.length < 2 && rightEdge.length < 2) return true;

  const centerPolyline = pathToPolyline(centerline, segmentsPerCircle);
  if (centerPolyline.length < 2) return true;

  const cpStart = centerPolyline[0];

  // 统计左边线的首尾端点分别离中线首点有多远
  const leftStart = leftEdge[0];
  const leftEnd = leftEdge[leftEdge.length - 1];
  const leftStartDist = (leftStart.x - cpStart.x) ** 2 + (leftStart.y - cpStart.y) ** 2;
  const leftEndDist = (leftEnd.x - cpStart.x) ** 2 + (leftEnd.y - cpStart.y) ** 2;

  // 同理统计右边线
  const rightStart = rightEdge[0];
  const rightEnd = rightEdge[rightEdge.length - 1];
  const rightStartDist = (rightStart.x - cpStart.x) ** 2 + (rightStart.y - cpStart.y) ** 2;
  const rightEndDist = (rightEnd.x - cpStart.x) ** 2 + (rightEnd.y - cpStart.y) ** 2;

  // 如果边线终点比起点更靠近中线首点 → 中线方向反了
  const leftVote = leftStartDist <= leftEndDist ? 1 : -1;
  const rightVote = rightStartDist <= rightEndDist ? 1 : -1;

  // 两边线投票：至少一边有效且投票翻转即翻转
  const voteSum = leftVote + rightVote;
  return voteSum >= 0;
}

/**
 * 从 bulge（凸度）值和弦端点创建 ArcPathSegment
 *
 * bulge = tan(θ/4)，其中 θ 是圆弧的总扫掠角
 * bulge > 0：逆时针（圆心在弦的左侧）
 * bulge < 0：顺时针（圆心在弦的右侧）
 *
 * @param start 弧段起点（弦起点）
 * @param end 弧段终点（弦终点）
 * @param bulge 凸度值
 * @returns ArcPathSegment，或 bulge=0 时返回 null（表示直线段）
 */
export function bulgeToArcSegment(
  start: Point2D,
  end: Point2D,
  bulge: number
): ArcPathSegment | null {
  // 凸度接近 0 → 直线段
  if (Math.abs(bulge) < 1e-8) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLen = Math.sqrt(dx * dx + dy * dy);

  if (chordLen < 1e-12) return null; // 退化为点

  const absB = Math.abs(bulge);
  const r = chordLen * (1 + bulge * bulge) / (4 * absB); // 半径（始终为正）

  // 弦中点到圆心的有向距离（沿左法线方向）
  const offset = chordLen * (1 - bulge * bulge) / (4 * bulge);

  // 弦中点
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // 左法线单位向量（逆时针旋转 90°）
  const nx = -dy / chordLen;
  const ny = dx / chordLen;

  // 圆心坐标
  const cx = midX + nx * offset;
  const cy = midY + ny * offset;

  // 起止角度
  const startAngle = Math.atan2(start.y - cy, start.x - cx);
  const endAngle = Math.atan2(end.y - cy, end.x - cx);

  return {
    type: 'arc',
    center: { x: cx, y: cy },
    radius: r,
    startAngle,
    endAngle,
    clockwise: bulge < 0,
    startPoint: { x: start.x, y: start.y },
    endPoint: { x: end.x, y: end.y },
  };
}
