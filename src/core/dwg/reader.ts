/**
 * DWG/DXF 文件读取器
 * 主入口：检测文件格式 → 调用对应解析器 → 转换为 RoadGeometry
 */

import type { CadUnit, Point2D, RoadGeometry } from '../geometry/types';
import type { ParsedDrawing, LayerMapping } from './types';
import { parseDxfContent } from './dxfParser';
import { parseDwgContent } from './dwgParser';
import { convertToRoadGeometry, getLayerSuggestions } from './converter';

/** 支持的文件扩展名 */
const SUPPORTED_EXTENSIONS = ['.dwg', '.dxf'] as const;

/**
 * 文件读取选项
 */
export interface ReadOptions {
  /** 手动指定的图层映射（可选） */
  layerMapping?: LayerMapping;
  /** 覆盖图纸自动识别到的原始坐标单位 */
  sourceUnit?: CadUnit;
}

/**
 * 读取并解析 CAD 文件，返回 RoadGeometry
 *
 * 流程：
 * 1. 读取文件内容
 * 2. 根据扩展名选择解析器
 * 3. 解析为 ParsedDrawing
 * 4. 转换为 RoadGeometry
 *
 * @param file 用户上传的 File 对象
 * @param options 读取选项
 * @returns 道路几何数据
 */
export async function readRoadFile(
  file: File,
  options: ReadOptions = {}
): Promise<RoadGeometry> {
  // 验证文件扩展名
  const ext = getFileExtension(file.name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext as '.dwg')) {
    throw new Error(`不支持的文件格式：${ext}，请使用 DWG 或 DXF 格式`);
  }

  // 读取文件内容
  let drawing: ParsedDrawing;

  if (ext === '.dwg') {
    // DWG：读取为 ArrayBuffer
    const buffer = await readFileAsArrayBuffer(file);
    drawing = await parseDwgContent(buffer);
  } else {
    // DXF：读取为文本
    const text = await readFileAsText(file);
    drawing = parseDxfContent(text);
  }

  // 检查是否有图层
  if (drawing.layers.length === 0) {
    throw new Error('文件中未找到任何图层数据');
  }

  if (drawing.layers.length < 2) {
    throw new Error(
      `需要至少 2 个图层（中线和边线），当前文件只有 ${drawing.layers.length} 个图层：${drawing.layers.join(', ')}`
    );
  }

  // 转换为 RoadGeometry
  const sourceUnit = options.sourceUnit ?? drawing.units;
  const normalizedDrawing = normalizeDrawingToMeters(drawing, sourceUnit);
  const roadGeometry = convertToRoadGeometry(normalizedDrawing, options.layerMapping);

  return { ...roadGeometry, sourceUnits: sourceUnit };
}

/**
 * 快速预览：解析文件并返回图层信息（不进行 RoadGeometry 转换）
 * 用于让用户在导入前选择图层映射
 *
 * @param file 用户上传的 File 对象
 * @returns 解析后的绘图数据
 */
export async function previewRoadFile(file: File): Promise<ParsedDrawing> {
  const ext = getFileExtension(file.name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext as '.dwg')) {
    throw new Error(`不支持的文件格式：${ext}`);
  }

  let drawing: ParsedDrawing;

  if (ext === '.dwg') {
    const buffer = await readFileAsArrayBuffer(file);
    drawing = await parseDwgContent(buffer);
  } else {
    const text = await readFileAsText(file);
    drawing = parseDxfContent(text);
  }

  return drawing;
}

/**
 * 获取图层选择建议
 */
export function suggestLayers(drawing: ParsedDrawing) {
  return getLayerSuggestions(drawing);
}

/** 将 CAD 原始坐标复制并统一换算为米，避免修改预览数据。 */
export function normalizeDrawingToMeters(
  drawing: ParsedDrawing,
  sourceUnit: CadUnit
): ParsedDrawing {
  const scale = sourceUnit === 'mm' ? 0.001 : 1;
  if (scale === 1) return { ...drawing, units: 'm' };

  const scalePoint = (point: Point2D): Point2D => ({
    x: point.x * scale,
    y: point.y * scale,
    ...(point.z === undefined ? {} : { z: point.z * scale }),
  });

  return {
    ...drawing,
    units: 'm',
    bounds: {
      minX: drawing.bounds.minX * scale,
      minY: drawing.bounds.minY * scale,
      maxX: drawing.bounds.maxX * scale,
      maxY: drawing.bounds.maxY * scale,
    },
    entitiesByLayer: Object.fromEntries(
      Object.entries(drawing.entitiesByLayer).map(([layer, entities]) => [
        layer,
        entities.map((entity) => ({
          ...entity,
          vertices: entity.vertices.map(scalePoint),
          arcCenter: entity.arcCenter ? scalePoint(entity.arcCenter) : undefined,
          arcRadius: entity.arcRadius === undefined ? undefined : entity.arcRadius * scale,
        })),
      ])
    ),
  };
}

// ---- 工具函数 ----

/**
 * 获取文件扩展名（含点号）
 */
function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex) : '';
}

/**
 * 读取文件为 ArrayBuffer
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 读取文件为文本
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
