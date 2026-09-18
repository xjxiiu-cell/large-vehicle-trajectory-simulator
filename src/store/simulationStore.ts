/**
 * 模拟状态 Store
 */

import { create } from 'zustand';
import type {
  SimulationResult,
  RadiusWidthTable,
} from '../core/geometry/types';

type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';

interface SimulationState {
  // 模拟状态
  status: SimulationStatus;
  // 模拟结果
  result: SimulationResult | null;
  // 当前步骤索引
  currentStepIndex: number;
  // 进度 (0-1)
  progress: number;
  // 速度 (m/s)
  speed: number;
  // 车辆到任一侧道路边线的最小安全净距（米）
  safetyClearance: number;
  // 转弯半径表
  radiusTable: RadiusWidthTable | null;
  // 最大转弯半径（用户输入）
  maxRadius: number;
  // 图层可见性
  showEnvelope: boolean;
  showConflicts: boolean;
  showVehicleAtStep: boolean;

  // Actions
  setStatus: (status: SimulationStatus) => void;
  setResult: (result: SimulationResult | null) => void;
  setCurrentStepIndex: (index: number) => void;
  setProgress: (progress: number) => void;
  setSpeed: (speed: number) => void;
  setSafetyClearance: (clearance: number) => void;
  setRadiusTable: (table: RadiusWidthTable | null) => void;
  setMaxRadius: (radius: number) => void;
  setShowEnvelope: (show: boolean) => void;
  setShowConflicts: (show: boolean) => void;
  setShowVehicleAtStep: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  status: 'idle' as SimulationStatus,
  result: null,
  currentStepIndex: 0,
  progress: 0,
  speed: 5 / 3.6, // 5 km/h to m/s
  safetyClearance: 0.5,
  radiusTable: null,
  maxRadius: 100,
  showEnvelope: true,
  showConflicts: true,
  showVehicleAtStep: true,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  setResult: (result) => set({ result, currentStepIndex: 0, progress: 0 }),

  setCurrentStepIndex: (currentStepIndex) => {
    set((state) => {
      const total = state.result?.steps.length ?? 1;
      return {
        currentStepIndex,
        progress: Math.min(currentStepIndex / total, 1),
      };
    });
  },

  setProgress: (progress) => set({ progress }),

  setSpeed: (speed) => set({ speed }),

  setSafetyClearance: (safetyClearance) => set({ safetyClearance }),

  setRadiusTable: (radiusTable) => set({ radiusTable }),

  setMaxRadius: (maxRadius) => set({ maxRadius }),

  setShowEnvelope: (showEnvelope) => set({ showEnvelope }),
  setShowConflicts: (showConflicts) => set({ showConflicts }),
  setShowVehicleAtStep: (showVehicleAtStep) => set({ showVehicleAtStep }),

  reset: () => set({ ...initialState }),
}));
