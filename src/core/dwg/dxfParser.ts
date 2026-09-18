/**
 * DXF 文件解析器
 * 使用 dxf-parser 库解析 DXF 文本格式，提取几何实体
 */

import DxfParser, {
  type IDxf,
  type IEntity,
} from 'dxf-parser';
import type { CadUnit } from '../geometry/types';
import type { ParsedDrawing, ParsedEntity } from './types';

/**
 * 解析 DXF 文本内容为 ParsedDrawing
 * @param content DXF 文件的文本内容
 * @returns 解析后的绘图数据
 */
export function parseDxfContent(content: string): ParsedDrawing {
  const parser = new DxfParser();
  const dxf = parser.parseSync(content);

  if (!dxf) {
    throw new Error('DXF 文件解析失败：无法解析文件内容');
  }

  return convertDxfToDrawing(dxf);
}

/**
 * 将 dxf-parser 的 IDxf 转换为内部 ParsedDrawing 格式
 */
function convertDxfToDrawing(dxf: IDxf): ParsedDrawing {
  const entitiesByLayer: Record<string, ParsedEntity[]> = {};
  const layerSet = new Set<string>();

  // 获取图层列表
  const layerTable = dxf.tables?.layer;
  if (layerTable?.layers) {
    for (const layerName of Object.keys(layerTable.layers)) {
      layerSet.add(layerName);
    }
  }

  // 遍历所有实体，按图层分组
  for (const entity of dxf.entities) {
    const layerName = entity.layer || '0';
    layerSet.add(layerName);

    const parsed = convertEntity(entity);
    if (parsed) {
      if (!entitiesByLayer[layerName]) {
        entitiesByLayer[layerName] = [];
      }
      entitiesByLayer[layerName].push(parsed);
    }
  }

  // 计算包围盒
  const bounds = computeBounds(entitiesByLayer);

  const units = detectDxfUnits(dxf.header as Record<string, unknown> | undefined);

  return {
    layers: Array.from(layerSet).filter((l) => entitiesByLayer[l]?.length),
    entitiesByLayer,
    units,
    bounds,
  };
}

/**
 * DXF 的 $INSUNITS 表示插入单位：4=毫米，6=米。
 * 图纸未标注或使用不支持单位时按米处理，导入面板可由用户覆盖。
 */
function detectDxfUnits(header: Record<string, unknown> | undefined): CadUnit {
  const value = header?.$INSUNITS;
  const unit = typeof value === 'number' ? value : Number(value);
  if (unit === 4) return 'mm';
  if (unit === 6) return 'm';
  return 'm';
}

/**
 * 将单个 DXF 实体转换为内部 ParsedEntity
 */
function convertEntity(entity: IEntity): ParsedEntity | null {
  // 根据类型分别处理
  switch (entity.type) {
    case 'LINE': {
      const line = entity as unknown as {
        vertices: { x: number; y: number }[];
      };
      if (!line.vertices || line.vertices.length < 2) return null;
      return {
        type: 'LINE',
        layer: entity.layer || '0',
        vertices: line.vertices.map((v) => ({ x: v.x, y: v.y })),
        closed: false,
      };
    }

    case 'LWPOLYLINE': {
      const pline = entity as unknown as {
        vertices: { x: number; y: number; bulge: number }[];
        shape?: boolean;
      };
      if (!pline.vertices || pline.vertices.length < 2) return null;
      // 提取 bulge（每个顶点对应到下一顶点的弧段凸度，最后一个顶点 bulge 无意义）
      const bulges: number[] = pline.vertices.map((v) => v.bulge ?? 0);
      return {
        type: 'LWPOLYLINE',
        layer: entity.layer || '0',
        vertices: pline.vertices.map((v) => ({ x: v.x, y: v.y })),
        closed: pline.shape === true,
        bulges,
      };
    }

    case 'POLYLINE': {
      const pline = entity as unknown as {
        vertices: { x: number; y: number; bulge: number }[];
        shape?: boolean;
      };
      if (!pline.vertices || pline.vertices.length < 2) return null;
      // 提取 bulge
      const bulges: number[] = pline.vertices.map((v) => v.bulge ?? 0);
      return {
        type: 'POLYLINE',
        layer: entity.layer || '0',
        vertices: pline.vertices.map((v) => ({ x: v.x, y: v.y })),
        closed: pline.shape === true,
        bulges,
      };
    }

    case 'ARC': {
      const arc = entity as unknown as {
        center: { x: number; y: number };
        radius: number;
        startAngle: number;
        endAngle: number;
      };
      // 离散化用于预览（高精度 128 段/全圆）
      const arcVertices = discretizeArc(
        arc.center.x,
        arc.center.y,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        128
      );
      if (arcVertices.length < 2) return null;
      return {
        type: 'ARC',
        layer: entity.layer || '0',
        vertices: arcVertices,
        closed: false,
        // 保留原始圆弧参数
        arcCenter: { x: arc.center.x, y: arc.center.y },
        arcRadius: arc.radius,
        arcStartAngle: arc.startAngle,
        arcEndAngle: arc.endAngle,
      };
    }

    case 'CIRCLE': {
      const circle = entity as unknown as {
        center: { x: number; y: number };
        radius: number;
      };
      const circVertices = discretizeArc(
        circle.center.x,
        circle.center.y,
        circle.radius,
        0,
        2 * Math.PI,
        128
      );
      return {
        type: 'CIRCLE',
        layer: entity.layer || '0',
        vertices: circVertices,
        closed: true,
        // 保留原始圆弧参数
        arcCenter: { x: circle.center.x, y: circle.center.y },
        arcRadius: circle.radius,
        arcStartAngle: 0,
        arcEndAngle: 2 * Math.PI,
      };
    }

    case 'SPLINE': {
      const spline = entity as unknown as {
        controlPoints?: { x: number; y: number }[];
        fitPoints?: { x: number; y: number }[];
      };
      // 优先使用拟合点，否则用控制点
      const points = spline.fitPoints || spline.controlPoints;
      if (!points || points.length < 2) return null;
      return {
        type: 'SPLINE',
        layer: entity.layer || '0',
        vertices: points.map((p) => ({ x: p.x, y: p.y })),
        closed: false,
      };
    }

    default:
      // 忽略不支持的类型（TEXT, MTEXT, INSERT 等）
      return null;
  }
}

/**
 * 将圆弧离散化为折线点列
 * @param cx 圆心 X
 * @param cy 圆心 Y
 * @param r 半径
 * @param startAngle 起始角（弧度）
 * @param endAngle 终止角（弧度）
 * @param segments 分段数
 */
function discretizeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  segments: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let angleSpan = endAngle - startAngle;

  // 处理全圆
  if (Math.abs(angleSpan - 2 * Math.PI) < 0.001) {
    angleSpan = 2 * Math.PI;
  }

  // 确保角度范围为正
  if (angleSpan < 0) {
    angleSpan += 2 * Math.PI;
  }

  const step = angleSpan / segments;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + step * i;
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  return points;
}

/**
 * 计算所有图层的包围盒
 */
function computeBounds(
  entitiesByLayer: Record<string, ParsedEntity[]>
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const entities of Object.values(entitiesByLayer)) {
    for (const entity of entities) {
      for (const v of entity.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
    }
  }

  // 处理无实体情况
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  return { minX, minY, maxX, maxY };
}
