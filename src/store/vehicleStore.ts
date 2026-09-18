/**
 * 车辆参数 Store
 */

import { create } from 'zustand';
import type { VehicleParams, VehicleType, SteeringType, AxleConfig, TrailerParams } from '../core/geometry/types';

interface VehicleState {
  // 车辆参数
  params: VehicleParams;
  // 是否已配置
  isConfigured: boolean;

  // Actions
  setType: (type: VehicleType) => void;
  setTotalLength: (length: number) => void;
  setTotalWidth: (width: number) => void;
  setFrontOverhang: (overhang: number) => void;
  setRearOverhang: (overhang: number) => void;
  setSteeringType: (type: SteeringType) => void;
  setMaxSteerAngle: (angle: number) => void;
  setMaxSteeringRate: (rate: number) => void;
  setAxles: (axles: AxleConfig[]) => void;
  setHitchOffset: (offset: number) => void;
  setTrailerHitchToAxle: (distance: number) => void;
  updateTrailer: (updates: Partial<Omit<TrailerParams, 'axles'>>) => void;
  addTrailerAxle: () => void;
  removeTrailerAxle: (index: number) => void;
  updateTrailerAxle: (index: number, field: keyof AxleConfig, value: number | boolean) => void;
  addAxle: () => void;
  removeAxle: (index: number) => void;
  updateAxle: (index: number, field: keyof AxleConfig, value: number | boolean) => void;
  resetToDefaults: () => void;
}

const defaultRigidAxles: AxleConfig[] = [
  { distanceFromFront: 2, trackWidth: 2.5, isSteering: true, maxSteerAngle: 35 },
  { distanceFromFront: 10, trackWidth: 2.5, isSteering: false },
  { distanceFromFront: 12, trackWidth: 2.5, isSteering: false },
];

const defaultTrailer: TrailerParams = {
  totalLength: 16,
  totalWidth: 3,
  frontOverhang: 2,
  // 尺寸链：挂车前端—牵引销 2m—等效轴组 11m—车尾 3m = 16m。
  rearOverhang: 3,
  axles: [
    { distanceFromFront: 11, trackWidth: 2.5, isSteering: false },
    { distanceFromFront: 12.4, trackWidth: 2.5, isSteering: false },
  ],
  steeringMode: 'fixed',
};

const defaultParams: VehicleParams = {
  type: 'rigid',
  totalLength: 15,
  totalWidth: 3,
  frontOverhang: 1.5,
  rearOverhang: 2,
  axles: defaultRigidAxles,
  steeringType: 'front',
  maxSteerAngle: 35,
  maxSteeringRateDegPerSec: 10,
};

export const useVehicleStore = create<VehicleState>((set) => ({
  params: { ...defaultParams },
  isConfigured: false,

  setType: (type) =>
    set((state) => ({
      params: type === 'articulated'
        ? {
            ...state.params,
            type,
            // 第五轮位于牵引车后轴后方时取负；这是 V2 半挂车模型的统一符号。
            hitchOffset: state.params.hitchOffset ?? -0.8,
            trailerHitchToAxle: state.params.trailerHitchToAxle ?? 11,
            trailer: state.params.trailer ?? { ...defaultTrailer, axles: [...defaultTrailer.axles] },
          }
        : { ...state.params, type },
      isConfigured: true,
    })),

  setTotalLength: (totalLength) =>
    set((state) => ({
      params: { ...state.params, totalLength },
      isConfigured: true,
    })),

  setTotalWidth: (totalWidth) =>
    set((state) => ({
      params: { ...state.params, totalWidth },
      isConfigured: true,
    })),

  setFrontOverhang: (frontOverhang) =>
    set((state) => ({
      params: { ...state.params, frontOverhang },
      isConfigured: true,
    })),

  setRearOverhang: (rearOverhang) =>
    set((state) => ({
      params: { ...state.params, rearOverhang },
      isConfigured: true,
    })),

  setSteeringType: (steeringType) =>
    set((state) => ({
      params: { ...state.params, steeringType },
      isConfigured: true,
    })),

  setMaxSteerAngle: (maxSteerAngle) =>
    set((state) => ({
      params: { ...state.params, maxSteerAngle },
      isConfigured: true,
    })),

  setMaxSteeringRate: (maxSteeringRateDegPerSec) =>
    set((state) => ({
      params: { ...state.params, maxSteeringRateDegPerSec },
      isConfigured: true,
    })),

  setAxles: (axles) =>
    set((state) => ({
      params: { ...state.params, axles },
      isConfigured: true,
    })),

  setHitchOffset: (hitchOffset) =>
    set((state) => ({
      params: { ...state.params, hitchOffset },
      isConfigured: true,
    })),

  setTrailerHitchToAxle: (trailerHitchToAxle) =>
    set((state) => ({
      params: { ...state.params, trailerHitchToAxle },
      isConfigured: true,
    })),

  updateTrailer: (updates) =>
    set((state) => ({
      params: {
        ...state.params,
        trailer: { ...(state.params.trailer ?? { ...defaultTrailer, axles: [...defaultTrailer.axles] }), ...updates },
      },
      isConfigured: true,
    })),

  addTrailerAxle: () =>
    set((state) => {
      const trailer = state.params.trailer ?? { ...defaultTrailer, axles: [...defaultTrailer.axles] };
      if (trailer.axles.length >= 10) return state;
      const rearMost = Math.max(...trailer.axles.map((axle) => axle.distanceFromFront));
      const axle: AxleConfig = {
        distanceFromFront: Math.min(trailer.totalLength, Math.round((rearMost + 1) * 10) / 10),
        trackWidth: Math.max(1, trailer.totalWidth - 0.5),
        isSteering: false,
      };
      return { params: { ...state.params, trailer: { ...trailer, axles: [...trailer.axles, axle] } }, isConfigured: true };
    }),

  removeTrailerAxle: (index) =>
    set((state) => {
      const trailer = state.params.trailer;
      if (!trailer || trailer.axles.length <= 1) return state;
      return {
        params: { ...state.params, trailer: { ...trailer, axles: trailer.axles.filter((_, axleIndex) => axleIndex !== index) } },
        isConfigured: true,
      };
    }),

  updateTrailerAxle: (index, field, value) =>
    set((state) => {
      const trailer = state.params.trailer ?? { ...defaultTrailer, axles: [...defaultTrailer.axles] };
      const axles = trailer.axles.map((axle, axleIndex) => axleIndex === index ? { ...axle, [field]: value } : axle);
      return { params: { ...state.params, trailer: { ...trailer, axles } }, isConfigured: true };
    }),

  addAxle: () =>
    set((state) => {
      const axles = [...state.params.axles];
      if (axles.length >= 10) return state; // 最多 10 轴
      // 新轴默认放在已有轴的中间位置
      const frontMost = axles.length > 0 ? Math.min(...axles.map((a) => a.distanceFromFront)) : 2;
      const rearMost = axles.length > 0 ? Math.max(...axles.map((a) => a.distanceFromFront)) : 10;
      const midDist = (frontMost + rearMost) / 2;
      const newAxle: AxleConfig = {
        distanceFromFront: Math.round(midDist * 10) / 10,
        trackWidth: state.params.totalWidth - 0.5,
        isSteering: false,
      };
      return {
        params: { ...state.params, axles: [...axles, newAxle] },
        isConfigured: true,
      };
    }),

  removeAxle: (index) =>
    set((state) => {
      if (state.params.axles.length <= 1) return state; // 至少保留 1 轴
      const axles = state.params.axles.filter((_, i) => i !== index);
      // 如果删除的是唯一的转向轴，将第一轴设为转向轴
      const hasSteering = axles.some((a) => a.isSteering);
      if (!hasSteering) {
        axles[0] = { ...axles[0], isSteering: true, maxSteerAngle: state.params.maxSteerAngle };
      }
      return {
        params: { ...state.params, axles },
        isConfigured: true,
      };
    }),

  updateAxle: (index, field, value) =>
    set((state) => {
      const axles = state.params.axles.map((a, i) => {
        if (i !== index) return a;
        const updated = { ...a, [field]: value };
        // 关闭转向时清除 maxSteerAngle，开启时设为全局默认值
        if (field === 'isSteering') {
          if (value) {
            updated.maxSteerAngle = state.params.maxSteerAngle;
          } else {
            delete updated.maxSteerAngle;
          }
        }
        return updated;
      });
      return {
        params: { ...state.params, axles },
        isConfigured: true,
      };
    }),

  resetToDefaults: () =>
    set({
      params: { ...defaultParams },
      isConfigured: false,
    }),
}));
