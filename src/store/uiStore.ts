/**
 * UI 状态 Store
 */

import { create } from 'zustand';

interface UIState {
  // 左侧面板是否折叠
  siderCollapsed: boolean;
  // 当前激活的 Tab
  activeTab: string;
  // Canvas 缩放比例
  canvasScale: number;
  // Canvas 偏移
  canvasOffsetX: number;
  canvasOffsetY: number;

  // Actions
  toggleSider: () => void;
  setSiderCollapsed: (collapsed: boolean) => void;
  setActiveTab: (tab: string) => void;
  setCanvasScale: (scale: number) => void;
  setCanvasOffset: (x: number, y: number) => void;
  resetCanvas: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  siderCollapsed: false,
  activeTab: 'vehicle',
  canvasScale: 1,
  canvasOffsetX: 0,
  canvasOffsetY: 0,

  toggleSider: () => set((state) => ({ siderCollapsed: !state.siderCollapsed })),

  setSiderCollapsed: (siderCollapsed) => set({ siderCollapsed }),

  setActiveTab: (activeTab) => set({ activeTab }),

  setCanvasScale: (canvasScale) => set({ canvasScale }),

  setCanvasOffset: (canvasOffsetX, canvasOffsetY) =>
    set({ canvasOffsetX, canvasOffsetY }),

  resetCanvas: () =>
    set({ canvasScale: 1, canvasOffsetX: 0, canvasOffsetY: 0 }),
}));
