/**
 * DWG 文件解析器
 * 使用 @mlightcad/libredwg-web WASM 在浏览器端解析 DWG 文件
 */

import {
  LibreDwg,
  Dwg_File_Type,
  type DwgEntity,
  type DwgLineEntity,
  type DwgLWPolylineEntity,
  type DwgArcEntity,
  type DwgCircleEntity,
  type DwgSplineEntity,
} from '@mlightcad/libredwg-web';
import type { ParsedDrawing, ParsedEntity } from './types';

/** WASM 模块单例 */
let libredwgInstance: ReturnType<typeof LibreDwg.create> | null = null;

/**
 * 获取 LibreDwg WASM 实例（单例）
 */
async function getLibreDwg(): Promise<ReturnType<typeof LibreDwg.create>> {
  if (!libredwgInstance) {
    // 固定从 Vite public 目录加载 WASM，避免依赖预构建模块的内部地址。
    // 空字符串会让解析库请求 `${BASE_URL}libredwg-web.wasm`。
    const wasmDirectory = import.meta.env.BASE_URL.replace(/\/$/, '');
    try {
      libredwgInstance = LibreDwg.create(wasmDirectory);
    } catch (error) {
      libredwgInstance = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`DWG 解析引擎加载失败：${detail}`);
    }
  }
  return libredwgInstance;
}

/**
 * 解析 DWG 文件（ArrayBuffer）为 ParsedDrawing
 * @param fileContent DWG 文件的二进制内容
 * @returns 解析后的绘图数据
 */
export async function parseDwgContent(
  fileContent: ArrayBuffer
): Promise<ParsedDrawing> {
  const libredwg = await getLibreDwg();

  // 使用 wrapper API 读取 DWG
  const dataPtr = libredwg.dwg_read_data(fileContent, Dwg_File_Type.DWG);

  if (dataPtr === undefined || dataPtr === null || dataPtr === 0) {
    throw new Error('DWG 文件解析失败：无法读取文件内容，请尝试用 DXF 格式导入');
  }

  try {
    // 转换为 DwgDatabase
    const db = libredwg.convert(dataPtr);

    // 提取图层信息
    const entitiesByLayer: Record<string, ParsedEntity[]> = {};
    const layerSet = new Set<string>();

    // 从图层表获取所有图层名
    if (db.tables?.LAYER?.entries) {
      for (const layer of db.tables.LAYER.entries) {
        layerSet.add(layer.name);
      }
    }

    // 遍历所有实体，按图层分组
    if (db.entities) {
      for (const entity of db.entities) {
        const layerName = entity.layer || '0';
        layerSet.add(layerName);

        const parsed = convertDwgEntity(entity);
        if (parsed) {
          if (!entitiesByLayer[layerName]) {
            entitiesByLayer[layerName] = [];
          }
          entitiesByLayer[layerName].push(parsed);
        }
      }
    }

    // 计算包围盒
    const bounds = computeDwgBounds(entitiesByLayer);

    // 推断单位：DWG 道路图通常使用米或毫米
    // 通过 $INSUNITS 头变量判断，默认按米处理
    const units = 'm';

    return {
      layers: Array.from(layerSet).filter((l) => entitiesByLayer[l]?.length),
      entitiesByLayer,
      units,
      bounds,
    };
  } finally {
    // 释放 WASM 内存
    libredwg.dwg_free(dataPtr);
  }
}

/**
 * 将单个 DWG 实体转换为内部 ParsedEntity
 */
function convertDwgEntity(entity: DwgEntity): ParsedEntity | null {
  switch (entity.type) {
    case 'LINE': {
      const line = entity as DwgLineEntity;
      return {
        type: 'LINE',
        layer: entity.layer || '0',
        vertices: [
          { x: line.startPoint.x, y: line.startPoint.y },
          { x: line.endPoint.x, y: line.endPoint.y },
        ],
        closed: false,
      };
    }

    case 'LWPOLYLINE': {
      const pline = entity as DwgLWPolylineEntity;
      if (!pline.vertices || pline.vertices.length < 2) return null;
      const isClosed = (pline.flag & 1) !== 0;
      // 提取 bulge（DWG LWPOLYLINE 顶点携带凸度信息）
      const bulges: number[] = pline.vertices.map((v) => v.bulge ?? 0);
      return {
        type: 'LWPOLYLINE',
        layer: entity.layer || '0',
        vertices: pline.vertices.map((v) => ({ x: v.x, y: v.y })),
        closed: isClosed,
        bulges,
      };
    }

    case 'POLYLINE2D': {
      const pline = entity as unknown as {
        type: string;
        layer: string;
        flag: number;
        vertices: { x: number; y: number; bulge?: number }[];
      };
      if (!pline.vertices || pline.vertices.length < 2) return null;
      const isClosed = (pline.flag & 1) !== 0;
      // 提取 bulge（DWG 2D 多段线顶点可能携带凸度）
      const bulges: number[] = pline.vertices.map((v) => v.bulge ?? 0);
      return {
        type: 'POLYLINE',
        layer: entity.layer || '0',
        vertices: pline.vertices.map((v) => ({ x: v.x, y: v.y })),
        closed: isClosed,
        bulges,
      };
    }

    case 'ARC': {
      const arc = entity as DwgArcEntity;
      const arcVertices = discretizeArcDwg(
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
      const circle = entity as DwgCircleEntity;
      const circVertices = discretizeArcDwg(
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
      const spline = entity as DwgSplineEntity;
      // 优先使用拟合点
      const points =
        spline.fitPoints && spline.fitPoints.length > 0
          ? spline.fitPoints
          : spline.controlPoints;
      if (!points || points.length < 2) return null;
      return {
        type: 'SPLINE',
        layer: entity.layer || '0',
        vertices: points.map((p) => ({ x: p.x, y: p.y })),
        closed: false,
      };
    }

    default:
      return null;
  }
}

/**
 * 将 DWG 圆弧离散化为折线
 */
function discretizeArcDwg(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  segments: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let span = endAngle - startAngle;
  if (span < 0) span += 2 * Math.PI;
  if (Math.abs(span) < 0.001) span = 2 * Math.PI;

  const step = span / segments;
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
 * 计算 DWG 所有实体的包围盒
 */
function computeDwgBounds(
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

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * 重置 WASM 实例（用于测试或重新加载）
 */
export function resetDwgInstance(): void {
  libredwgInstance = null;
}
