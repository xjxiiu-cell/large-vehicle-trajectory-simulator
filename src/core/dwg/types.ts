/**
 * DWG/DXF 解析内部类型
 * 用于将不同格式的 CAD 数据统一为中间表示
 */

import type { CadUnit, Polyline, Point2D } from '../geometry/types';

/** 解析后的 CAD 实体（中间格式） */
export interface ParsedEntity {
  /** 实体类型 */
  type: 'LINE' | 'POLYLINE' | 'LWPOLYLINE' | 'ARC' | 'CIRCLE' | 'SPLINE';
  /** 所属图层名 */
  layer: string;
  /** 离散化后的顶点列表（用于预览和边线处理） */
  vertices: Polyline;
  /** 是否闭合 */
  closed: boolean;
  /** 圆弧/圆原始参数（保留用于精确渲染和运动学模拟） */
  arcCenter?: Point2D;
  arcRadius?: number;
  arcStartAngle?: number;
  arcEndAngle?: number;
  /**
   * 多段线顶点凸度（bulge）
   * bulge[i] 对应 vertices[i] 到 vertices[i+1] 段的圆弧凸度
   * bulge > 0：逆时针圆弧（圆心在弦左侧），bulge < 0：顺时针
   * bulge = 0 或 undefined：直线段
   */
  bulges?: number[];
}

/** 按图层分组的解析结果 */
export interface ParsedDrawing {
  /** 图层名称列表 */
  layers: string[];
  /** 按图层分组的实体 */
  entitiesByLayer: Record<string, ParsedEntity[]>;
  /** CAD 图纸的原始坐标单位 */
  units: CadUnit;
  /** 所有实体的包围盒 */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** 图层映射配置（支持 2 图层和 3 图层两种模式） */
export interface LayerMapping {
  /** 中线所在图层名（必填） */
  centerlineLayer: string;
  /**
   * 2 图层模式：合并的边线图层名（含左+右两条多段线）
   * 与 leftEdgeLayer/rightEdgeLayer 互斥
   */
  edgeLayer?: string;
  /**
   * 3 图层模式：左边线图层名
   * 需与 rightEdgeLayer 同时指定
   */
  leftEdgeLayer?: string;
  /**
   * 3 图层模式：右边线图层名
   * 需与 leftEdgeLayer 同时指定
   */
  rightEdgeLayer?: string;
}

/** 导入结果 */
export interface ImportResult {
  /** 导入是否成功 */
  success: boolean;
  /** 成功时的解析结果 */
  drawing?: ParsedDrawing;
  /** 失败时的错误信息 */
  error?: string;
}
