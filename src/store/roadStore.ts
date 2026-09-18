/**
 * 道路数据 Store
 */

import { create } from 'zustand';
import type { RoadGeometry } from '../core/geometry/types';
import type { ParsedDrawing } from '../core/dwg/types';

interface RoadState {
  // 道路几何数据
  roadData: RoadGeometry | null;
  // 解析预览数据（用于图层选择）
  parsedDrawing: ParsedDrawing | null;
  // 已导入文件名
  importedFileName: string | null;
  // 是否已加载
  isLoaded: boolean;
  // 加载状态
  isLoading: boolean;
  // 错误信息
  error: string | null;
  // 图层可见性
  showCenterline: boolean;
  showLeftEdge: boolean;
  showRightEdge: boolean;
  // 当前使用的单位
  displayUnit: 'mm' | 'm';

  // Actions
  setRoadData: (data: RoadGeometry) => void;
  setParsedDrawing: (drawing: ParsedDrawing | null) => void;
  setImportedFileName: (name: string | null) => void;
  clearRoadData: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setShowCenterline: (show: boolean) => void;
  setShowLeftEdge: (show: boolean) => void;
  setShowRightEdge: (show: boolean) => void;
  setDisplayUnit: (unit: 'mm' | 'm') => void;
}

export const useRoadStore = create<RoadState>((set) => ({
  roadData: null,
  parsedDrawing: null,
  importedFileName: null,
  isLoaded: false,
  isLoading: false,
  error: null,
  showCenterline: true,
  showLeftEdge: true,
  showRightEdge: true,
  displayUnit: 'm',

  setRoadData: (data) =>
    set({
      roadData: data,
      isLoaded: true,
      isLoading: false,
      error: null,
    }),

  setParsedDrawing: (drawing) => set({ parsedDrawing: drawing }),

  setImportedFileName: (name) => set({ importedFileName: name }),

  clearRoadData: () =>
    set({
      roadData: null,
      parsedDrawing: null,
      importedFileName: null,
      isLoaded: false,
      error: null,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setShowCenterline: (showCenterline) => set({ showCenterline }),

  setShowLeftEdge: (showLeftEdge) => set({ showLeftEdge }),

  setShowRightEdge: (showRightEdge) => set({ showRightEdge }),

  setDisplayUnit: (displayUnit) => set({ displayUnit }),
}));
