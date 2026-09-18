/**
 * 实体转换器
 * 将 ParsedDrawing 转换为内部 RoadGeometry 格式
 *
 * 支持两种 CAD 图层组织方式：
 * 1. 【推荐】3 图层模式：道路中线 / 道路左边线 / 道路右边线 各一个图层
 * 2. 2 图层模式：道路中线 一个图层 + 道路边线 一个图层（含左右两条独立多段线）
 *
 * 关键改进：中线保留圆弧原始参数（ArcPathSegment），不再早期离散化
 * - 渲染时动态离散化，保证任意缩放级别的视觉精度
 * - 模拟时可直接计算圆弧上的精确位置和曲率
 */

import type {
  Point2D,
  Polyline,
  BoundingBox,
  Path,
  PathSegment,
  StraightPathSegment,
  ArcPathSegment,
  RoadGeometry,
} from '../geometry/types';
import { pathToPolyline, bulgeToArcSegment } from '../geometry/path';
import type { ParsedDrawing, ParsedEntity, LayerMapping } from './types';

/**
 * 将 ParsedDrawing 转换为 RoadGeometry
 */
export function convertToRoadGeometry(
  drawing: ParsedDrawing,
  mapping?: LayerMapping
): RoadGeometry {
  const layers = drawing.layers;

  if (layers.length === 0) {
    throw new Error('未找到任何包含几何图形的图层');
  }

  let centerlineLayer: string;
  let leftEdgeLayer: string | null = null;
  let rightEdgeLayer: string | null = null;
  let combinedEdgeLayer: string | null = null;

  if (mapping) {
    centerlineLayer = mapping.centerlineLayer;

    if (mapping.leftEdgeLayer && mapping.rightEdgeLayer) {
      leftEdgeLayer = mapping.leftEdgeLayer;
      rightEdgeLayer = mapping.rightEdgeLayer;
    } else if (mapping.edgeLayer) {
      combinedEdgeLayer = mapping.edgeLayer;
    } else if (mapping.leftEdgeLayer || mapping.rightEdgeLayer) {
      throw new Error(
        '图层映射不完整：请同时指定 leftEdgeLayer 和 rightEdgeLayer，或只指定 edgeLayer'
      );
    } else {
      throw new Error('图层映射缺少边线图层信息');
    }
  } else {
    const detected = autoDetectLayers(drawing);
    centerlineLayer = detected.centerlineLayer;
    leftEdgeLayer = detected.leftEdgeLayer ?? null;
    rightEdgeLayer = detected.rightEdgeLayer ?? null;
    combinedEdgeLayer = detected.edgeLayer ?? null;
  }

  // 验证中线图层存在
  if (!drawing.entitiesByLayer[centerlineLayer]) {
    throw new Error(`中线图层 "${centerlineLayer}" 不存在`);
  }

  // 构建中线路径（保留圆弧参数）
  const centerline = buildCenterlinePath(drawing.entitiesByLayer[centerlineLayer]);
  if (centerline.length === 0) {
    throw new Error(`中线图层 "${centerlineLayer}" 中未找到有效几何图形`);
  }

  // 边线分离需要中线折线 → 临时离散化
  const centerPolyline = pathToPolyline(centerline, 256);

  let leftEdge: Polyline;
  let rightEdge: Polyline;

  if (leftEdgeLayer && rightEdgeLayer) {
    // ---- 3 图层模式：直接提取 ----
    if (!drawing.entitiesByLayer[leftEdgeLayer]) {
      throw new Error(`左边线图层 "${leftEdgeLayer}" 不存在`);
    }
    if (!drawing.entitiesByLayer[rightEdgeLayer]) {
      throw new Error(`右边线图层 "${rightEdgeLayer}" 不存在`);
    }

    leftEdge = extractEdgePolyline(drawing.entitiesByLayer[leftEdgeLayer]);
    rightEdge = extractEdgePolyline(drawing.entitiesByLayer[rightEdgeLayer]);

    if (leftEdge.length < 2) {
      throw new Error(`左边线图层 "${leftEdgeLayer}" 中未找到有效折线`);
    }
    if (rightEdge.length < 2) {
      throw new Error(`右边线图层 "${rightEdgeLayer}" 中未找到有效折线`);
    }
  } else if (combinedEdgeLayer) {
    // ---- 2 图层模式：自动分离左右边线 ----
    if (!drawing.entitiesByLayer[combinedEdgeLayer]) {
      throw new Error(`边线图层 "${combinedEdgeLayer}" 不存在`);
    }

    const edgeEntities = drawing.entitiesByLayer[combinedEdgeLayer];
    const result = separateEdgePolylines(centerPolyline, edgeEntities);
    leftEdge = result.leftEdge;
    rightEdge = result.rightEdge;

    if (leftEdge.length < 2 && rightEdge.length < 2) {
      throw new Error(
        `边线图层 "${combinedEdgeLayer}" 中未找到有效的左右边线。` +
        `请确保该图层包含两条独立的多段线（左路边线和右路边线），` +
        `或在 CAD 中分成 3 个图层：道路中线、道路左边线、道路右边线。`
      );
    }

    if (leftEdge.length < 2) {
      throw new Error(
        `未能识别左边线。边线图层 "${combinedEdgeLayer}" 中所有多段线都被判定为右侧。` +
        `建议在 CAD 中将左右边线分成独立图层。`
      );
    }
    if (rightEdge.length < 2) {
      throw new Error(
        `未能识别右边线。边线图层 "${combinedEdgeLayer}" 中所有多段线都被判定为左侧。` +
        `建议在 CAD 中将左右边线分成独立图层。`
      );
    }
  } else {
    throw new Error(
      '无法确定边线图层。请在 CAD 中将道路分为 2 个图层（中线 + 边线）' +
      '或 3 个图层（中线 + 左边线 + 右边线）。'
    );
  }

  // 计算包围盒
  const centerlinePoints = pathToPolyline(centerline);
  const bounds = computeRoadBounds(centerlinePoints, leftEdge, rightEdge);

  return {
    centerline,
    leftEdge,
    rightEdge,
    units: 'm',
    sourceUnits: drawing.units,
    bounds,
  };
}

// ============================================================
// 中线路径构建（保留圆弧参数）
// ============================================================

/**
 * 从实体列表构建中线路径
 * 对 ARC/CIRCLE 实体，使用原始圆弧参数构建 ArcPathSegment
 * 对 LINE/POLYLINE 实体，构建 StraightPathSegment
 */
function buildCenterlinePath(entities: ParsedEntity[]): Path {
  if (!entities || entities.length === 0) return [];

  // 提取所有路径段
  const allSegments: (PathSegment & { _entityIndex: number })[] = [];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];

    if (
      (entity.type === 'ARC' || entity.type === 'CIRCLE') &&
      entity.arcCenter &&
      entity.arcRadius !== undefined &&
      entity.arcStartAngle !== undefined &&
      entity.arcEndAngle !== undefined
    ) {
      // 使用原始圆弧参数构建 ArcPathSegment
      const arc: ArcPathSegment = {
        type: 'arc',
        center: { x: entity.arcCenter.x, y: entity.arcCenter.y },
        radius: entity.arcRadius,
        startAngle: entity.arcStartAngle,
        endAngle: entity.arcEndAngle,
        clockwise: false, // DXF/DWG 圆弧默认逆时针
        startPoint: {
          x: entity.arcCenter.x + entity.arcRadius * Math.cos(entity.arcStartAngle),
          y: entity.arcCenter.y + entity.arcRadius * Math.sin(entity.arcStartAngle),
        },
        endPoint: {
          x: entity.arcCenter.x + entity.arcRadius * Math.cos(entity.arcEndAngle),
          y: entity.arcCenter.y + entity.arcRadius * Math.sin(entity.arcEndAngle),
        },
      };
      allSegments.push({ ...arc, _entityIndex: i });
    } else if (entity.vertices.length >= 2) {
      // 折线/直线实体：根据 bulge 值创建 ArcPathSegment 或 StraightPathSegment
      const bulges = entity.bulges;
      for (let j = 1; j < entity.vertices.length; j++) {
        const start = entity.vertices[j - 1];
        const end = entity.vertices[j];
        const bulge = bulges ? (bulges[j - 1] ?? 0) : 0;

        const arcSeg = bulgeToArcSegment(
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
          bulge
        );

        if (arcSeg) {
          allSegments.push({ ...arcSeg, _entityIndex: i });
        } else {
          const seg: StraightPathSegment = {
            type: 'straight',
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
          };
          allSegments.push({ ...seg, _entityIndex: i });
        }
      }
    }
  }

  if (allSegments.length === 0) return [];
  if (allSegments.length === 1) {
    const { _entityIndex, ...seg } = allSegments[0];
    return [seg];
  }

  // 贪心排序：从第一个段开始，找首尾相连的下一个段
  const result: PathSegment[] = [allSegments[0]];
  const used = new Set<number>([0]);

  while (result.length < allSegments.length) {
    const lastSeg = result[result.length - 1];
    const lastEnd =
      lastSeg.type === 'straight' ? lastSeg.end : lastSeg.endPoint;

    let bestIndex = -1;
    let bestDist = Infinity;
    let needsReverse = false;

    for (let i = 0; i < allSegments.length; i++) {
      if (used.has(i)) continue;

      const seg = allSegments[i];
      const segStart = seg.type === 'straight' ? seg.start : seg.startPoint;
      const segEnd = seg.type === 'straight' ? seg.end : seg.endPoint;

      const distForward = distance2D(lastEnd, segStart);
      if (distForward < bestDist) {
        bestDist = distForward;
        bestIndex = i;
        needsReverse = false;
      }

      const distBackward = distance2D(lastEnd, segEnd);
      if (distBackward < bestDist) {
        bestDist = distBackward;
        bestIndex = i;
        needsReverse = true;
      }
    }

    if (bestIndex === -1) break;

    const bestSeg = allSegments[bestIndex];
    used.add(bestIndex);

    if (needsReverse) {
      result.push(reverseSegment(bestSeg));
    } else {
      const { _entityIndex, ...clean } = bestSeg;
      result.push(clean);
    }
  }

  return result;
}

/**
 * 反转路径段（用于连接排序）
 */
function reverseSegment(seg: PathSegment): PathSegment {
  if (seg.type === 'straight') {
    return {
      type: 'straight',
      start: { ...seg.end },
      end: { ...seg.start },
    };
  } else {
    const arc = seg as ArcPathSegment;
    return {
      type: 'arc',
      center: { ...arc.center },
      radius: arc.radius,
      startAngle: arc.endAngle,
      endAngle: arc.startAngle,
      clockwise: !arc.clockwise,
      startPoint: { ...arc.endPoint },
      endPoint: { ...arc.startPoint },
    };
  }
}

// ============================================================
// 边线提取（高精度离散化）
// ============================================================

/**
 * 从边线图层实体提取折线（高精度离散化）
 */
function extractEdgePolyline(entities: ParsedEntity[]): Polyline {
  if (!entities || entities.length === 0) return [];

  const polylines: Point2D[][] = [];

  for (const entity of entities) {
    if (
      (entity.type === 'ARC' || entity.type === 'CIRCLE') &&
      entity.arcCenter &&
      entity.arcRadius !== undefined &&
      entity.arcStartAngle !== undefined &&
      entity.arcEndAngle !== undefined
    ) {
      // 圆弧 → 高精度离散化 (256 段/全圆)
      const pts = discretizeArcFromParams(
        entity.arcCenter.x,
        entity.arcCenter.y,
        entity.arcRadius,
        entity.arcStartAngle,
        entity.arcEndAngle,
        256
      );
      if (pts.length >= 2) polylines.push(pts);
    } else if (entity.vertices.length >= 2) {
      // 使用 bulge 信息高精度离散化多段线中的圆弧段
      polylines.push(verticesToPolylineWithBulges(entity.vertices, entity.bulges, 256));
    }
  }

  if (polylines.length === 0) return [];
  if (polylines.length === 1) return polylines[0];
  return mergePolylines(polylines);
}

/**
 * 将带 bulge 的顶点列表转换为高精度折线
 * 对 bulge≠0 的段使用圆弧离散化，bulge=0 的段保留原始顶点
 */
function verticesToPolylineWithBulges(
  vertices: Point2D[],
  bulges: number[] | undefined,
  segmentsPerCircle: number
): Point2D[] {
  if (vertices.length < 2) return [...vertices];

  const result: Point2D[] = [{ x: vertices[0].x, y: vertices[0].y }];

  for (let j = 1; j < vertices.length; j++) {
    const start = vertices[j - 1];
    const end = vertices[j];
    const bulge = bulges ? (bulges[j - 1] ?? 0) : 0;

    const arc = bulgeToArcSegment(
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
      bulge
    );

    if (arc) {
      // 圆弧段：高精度离散化
      const arcPts = discretizeArcFromParams(
        arc.center.x,
        arc.center.y,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        segmentsPerCircle,
        arc.clockwise
      );
      // 跳过第一个点（与上一段终点重合）
      result.push(...arcPts.slice(1));
    } else {
      // 直线段：直接加终点
      result.push({ x: end.x, y: end.y });
    }
  }

  return result;
}

/**
 * 根据参数离散化圆弧
 * @param clockwise true=顺时针（角度递减），false=逆时针（角度递增）
 */
function discretizeArcFromParams(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  segmentsPerCircle: number,
  clockwise: boolean = false
): Point2D[] {
  let span = endAngle - startAngle;
  if (clockwise) {
    // 顺时针：确保 span 为负（角度递减）
    if (span > 0) span -= 2 * Math.PI;
  } else {
    // 逆时针：确保 span 为正（角度递增）
    if (span < 0) span += 2 * Math.PI;
  }
  if (Math.abs(span) < 0.001) span = clockwise ? -2 * Math.PI : 2 * Math.PI;

  const absSpan = Math.abs(span);
  const segments = Math.max(16, Math.ceil((absSpan / (2 * Math.PI)) * segmentsPerCircle));
  const step = span / segments;
  const points: Point2D[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + step * i;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }

  return points;
}

// ============================================================
// 图层自动检测
// ============================================================

interface DetectedLayers {
  centerlineLayer: string;
  leftEdgeLayer?: string;
  rightEdgeLayer?: string;
  edgeLayer?: string;
}

function autoDetectLayers(drawing: ParsedDrawing): DetectedLayers {
  const layers = drawing.layers;

  const stats = layers
    .map((name) => ({
      name,
      entityCount: drawing.entitiesByLayer[name]?.length ?? 0,
      totalVertices:
        drawing.entitiesByLayer[name]?.reduce(
          (sum, e) => sum + e.vertices.length,
          0
        ) ?? 0,
    }))
    .filter((s) => s.entityCount > 0)
    .sort((a, b) => b.entityCount - a.entityCount);

  if (stats.length < 2) {
    throw new Error(
      `需要至少 2 个包含图形的图层，当前只有 ${stats.length} 个：` +
      layers.join(', ')
    );
  }

  if (stats.length >= 3) {
    const top3 = stats.slice(0, 3);
    top3.sort((a, b) => a.totalVertices - b.totalVertices);

    const centerlineLayer = top3[0].name;
    const edge1 = top3[1];
    const edge2 = top3[2];

    const centerEntities = drawing.entitiesByLayer[centerlineLayer];
    const centerPolyline = extractEdgePolyline(centerEntities);

    const e1First = drawing.entitiesByLayer[edge1.name]?.[0]?.vertices?.[0];
    const e2First = drawing.entitiesByLayer[edge2.name]?.[0]?.vertices?.[0];

    let leftEdgeLayer: string;
    let rightEdgeLayer: string;

    if (e1First && e2First && centerPolyline.length >= 2) {
      const { side: side1 } = pointSideOnCenterline(e1First, centerPolyline);
      if (side1 > 0) {
        leftEdgeLayer = edge1.name;
        rightEdgeLayer = edge2.name;
      } else {
        leftEdgeLayer = edge2.name;
        rightEdgeLayer = edge1.name;
      }
    } else {
      const nameLower1 = edge1.name.toLowerCase();
      const nameLower2 = edge2.name.toLowerCase();
      if (nameLower1.includes('左') || nameLower1.includes('left')) {
        leftEdgeLayer = edge1.name;
        rightEdgeLayer = edge2.name;
      } else if (nameLower2.includes('左') || nameLower2.includes('left')) {
        leftEdgeLayer = edge2.name;
        rightEdgeLayer = edge1.name;
      } else if (nameLower1.includes('右') || nameLower1.includes('right')) {
        rightEdgeLayer = edge1.name;
        leftEdgeLayer = edge2.name;
      } else if (nameLower2.includes('右') || nameLower2.includes('right')) {
        rightEdgeLayer = edge2.name;
        leftEdgeLayer = edge1.name;
      } else {
        leftEdgeLayer = edge1.name;
        rightEdgeLayer = edge2.name;
      }
    }

    return { centerlineLayer, leftEdgeLayer, rightEdgeLayer };
  }

  // 2 图层模式
  const centerlineLayer = stats[1].name;
  const edgeLayer = stats[0].name;
  return { centerlineLayer, edgeLayer };
}

// ============================================================
// 边线分离（2 图层模式核心算法）
// ============================================================

function separateEdgePolylines(
  centerline: Polyline,
  edgeEntities: ParsedEntity[]
): { leftEdge: Polyline; rightEdge: Polyline } {
  if (centerline.length < 2) {
    return { leftEdge: [], rightEdge: [] };
  }

  const edgePolylines: Point2D[][] = [];

  for (const entity of edgeEntities) {
    if (
      (entity.type === 'ARC' || entity.type === 'CIRCLE') &&
      entity.arcCenter &&
      entity.arcRadius !== undefined &&
      entity.arcStartAngle !== undefined &&
      entity.arcEndAngle !== undefined
    ) {
      const pts = discretizeArcFromParams(
        entity.arcCenter.x,
        entity.arcCenter.y,
        entity.arcRadius,
        entity.arcStartAngle,
        entity.arcEndAngle,
        256
      );
      if (pts.length >= 2) edgePolylines.push(pts);
    } else if (entity.vertices.length >= 2) {
      // 使用 bulge 信息高精度离散化多段线中的圆弧段
      edgePolylines.push(verticesToPolylineWithBulges(entity.vertices, entity.bulges, 256));
    }
  }

  if (edgePolylines.length === 0) {
    return { leftEdge: [], rightEdge: [] };
  }

  if (edgePolylines.length === 1) {
    return separateSingleEdgePolyline(centerline, edgePolylines[0]);
  }

  const leftPolylines: Point2D[][] = [];
  const rightPolylines: Point2D[][] = [];

  for (const polyline of edgePolylines) {
    const samples = [
      polyline[0],
      polyline[Math.floor(polyline.length / 2)],
      polyline[polyline.length - 1],
    ];

    let totalSide = 0;
    let validSamples = 0;

    for (const pt of samples) {
      const { side } = pointSideOnCenterline(pt, centerline);
      totalSide += side;
      validSamples++;
    }

    if (validSamples === 0) continue;

    if (totalSide / validSamples > 0) {
      leftPolylines.push(polyline);
    } else {
      rightPolylines.push(polyline);
    }
  }

  const leftEdge = sortAndMergePolylines(centerline, leftPolylines);
  const rightEdge = sortAndMergePolylines(centerline, rightPolylines);

  return { leftEdge, rightEdge };
}

function separateSingleEdgePolyline(
  centerline: Polyline,
  polyline: Point2D[]
): { leftEdge: Polyline; rightEdge: Polyline } {
  const distances: number[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const dx = polyline[i + 1].x - polyline[i].x;
    const dy = polyline[i + 1].y - polyline[i].y;
    distances.push(Math.sqrt(dx * dx + dy * dy));
  }

  const sorted = [...distances].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const JUMP_THRESHOLD = 5;
  const jumpIndices: number[] = [];
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] > median * JUMP_THRESHOLD && distances[i] > 10) {
      jumpIndices.push(i);
    }
  }

  const segments: Point2D[][] = [];
  let segStart = 0;

  for (const jumpIdx of jumpIndices) {
    if (jumpIdx > segStart) {
      segments.push(polyline.slice(segStart, jumpIdx + 1));
    }
    segStart = jumpIdx + 1;
  }
  if (segStart < polyline.length - 1) {
    segments.push(polyline.slice(segStart));
  }

  if (segments.length >= 2) {
    const fakeEntities: ParsedEntity[] = segments.map((verts) => ({
      type: 'POLYLINE',
      layer: '',
      vertices: verts,
      closed: false,
    }));
    return separateEdgePolylines(centerline, fakeEntities);
  }

  const leftPoints: Point2D[] = [];
  const rightPoints: Point2D[] = [];

  for (const pt of polyline) {
    const { side } = pointSideOnCenterline(pt, centerline);
    if (side > 0) {
      leftPoints.push(pt);
    } else {
      rightPoints.push(pt);
    }
  }

  sortPointsAlongCenterline(leftPoints, centerline);
  sortPointsAlongCenterline(rightPoints, centerline);

  return { leftEdge: leftPoints, rightEdge: rightPoints };
}

function pointSideOnCenterline(
  point: Point2D,
  centerline: Polyline
): { side: number; dist: number; t: number } {
  const { t, dist } = closestPointOnPolyline(point, centerline);

  const idx = Math.max(0, Math.min(centerline.length - 2, Math.floor(t)));
  const p0 = centerline[idx];
  const p1 = centerline[Math.min(idx + 1, centerline.length - 1)];

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    return { side: 0, dist, t };
  }

  const cross = dx * (point.y - p0.y) - dy * (point.x - p0.x);
  return { side: cross, dist, t };
}

function sortAndMergePolylines(
  centerline: Polyline,
  polylines: Point2D[][]
): Point2D[] {
  if (polylines.length === 0) return [];
  if (polylines.length === 1) return [...polylines[0]];

  const withT = polylines.map((pline) => {
    const { t } = pointSideOnCenterline(pline[0], centerline);
    return { pline, t };
  });

  withT.sort((a, b) => a.t - b.t);

  const result: Point2D[] = [];
  for (const { pline } of withT) {
    if (result.length > 0) {
      const last = result[result.length - 1];
      const distForward = distance2D(last, pline[0]);
      const distBackward = distance2D(last, pline[pline.length - 1]);

      if (distBackward < distForward) {
        result.push(...[...pline].reverse());
      } else {
        result.push(...pline);
      }
    } else {
      result.push(...pline);
    }
  }

  return result;
}

function sortPointsAlongCenterline(
  points: Point2D[],
  centerline: Polyline
): void {
  const withT = points.map((pt) => {
    const { t } = pointSideOnCenterline(pt, centerline);
    return { pt, t };
  });

  withT.sort((a, b) => a.t - b.t);

  for (let i = 0; i < points.length; i++) {
    points[i] = withT[i].pt;
  }
}

// ============================================================
// 多段线合并
// ============================================================

function mergePolylines(lines: Point2D[][]): Point2D[] {
  if (lines.length === 0) return [];
  if (lines.length === 1) return [...lines[0]];

  const result: Point2D[] = [...lines[0]];
  const remaining = lines.slice(1).map((l) => [...l]);

  while (remaining.length > 0) {
    const lastPoint = result[result.length - 1];
    let bestIndex = 0;
    let bestDist = Infinity;
    let reverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      const distForward = distance2D(lastPoint, seg[0]);
      if (distForward < bestDist) {
        bestDist = distForward;
        bestIndex = i;
        reverse = false;
      }
      const distBackward = distance2D(lastPoint, seg[seg.length - 1]);
      if (distBackward < bestDist) {
        bestDist = distBackward;
        bestIndex = i;
        reverse = true;
      }
    }

    const next = remaining.splice(bestIndex, 1)[0];
    if (reverse) {
      result.push(...next.reverse());
    } else {
      result.push(...next);
    }
  }

  return result;
}

// ============================================================
// 几何工具
// ============================================================

function distance2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function closestPointOnPolyline(
  point: Point2D,
  polyline: Polyline
): { t: number; dist: number } {
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const { t: segT, dist } = closestPointOnSegment(
      point,
      polyline[i],
      polyline[i + 1]
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestT = i + Math.max(0, Math.min(1, segT));
    }
  }

  return { t: bestT, dist: bestDist };
}

function closestPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const dist = Math.sqrt(distance2D(p, a));
    return { t: 0, dist };
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const dist = Math.sqrt(
    (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY)
  );

  return { t, dist };
}

function computeRoadBounds(
  centerline: Polyline,
  leftEdge: Polyline,
  rightEdge: Polyline
): BoundingBox {
  const allPoints = [...centerline, ...leftEdge, ...rightEdge];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const p of allPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

// ============================================================
// 图层建议
// ============================================================

export function getLayerSuggestions(drawing: ParsedDrawing): {
  centerlineCandidates: string[];
  edgeCandidates: string[];
  leftEdgeCandidates: string[];
  rightEdgeCandidates: string[];
} {
  const layers = drawing.layers;

  const stats = layers
    .map((name) => ({
      name,
      entityCount: drawing.entitiesByLayer[name]?.length ?? 0,
      totalVertices:
        drawing.entitiesByLayer[name]?.reduce(
          (sum, e) => sum + e.vertices.length,
          0
        ) ?? 0,
    }))
    .filter((s) => s.entityCount > 0)
    .sort((a, b) => b.entityCount - a.entityCount);

  if (stats.length >= 3) {
    const top3 = stats.slice(0, 3);
    const sortedByVertices = [...top3].sort(
      (a, b) => a.totalVertices - b.totalVertices
    );
    return {
      centerlineCandidates: [sortedByVertices[0].name],
      leftEdgeCandidates: [sortedByVertices[1].name],
      rightEdgeCandidates: [sortedByVertices[2].name],
      edgeCandidates: [],
    };
  }

  if (stats.length === 2) {
    return {
      centerlineCandidates: [stats[1].name],
      edgeCandidates: [stats[0].name],
      leftEdgeCandidates: [],
      rightEdgeCandidates: [],
    };
  }

  return {
    centerlineCandidates: [],
    edgeCandidates: [],
    leftEdgeCandidates: [],
    rightEdgeCandidates: [],
  };
}
