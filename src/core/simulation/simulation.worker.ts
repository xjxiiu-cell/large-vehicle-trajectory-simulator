/**
 * 自动模拟工作线程。
 *
 * Hybrid A* 与完整扫掠校核均为纯计算，放入 Worker 后不会占用浏览器界面线程，
 * 长道路计算期间仍可保持页面响应。
 */
import { runSimulation } from './engine';
import type { Path, Polyline, SimulationResult, VehicleParams } from '../geometry/types';
import type { SimulationOptions } from './engine';

interface SimulationWorkerRequest {
  centerline: Path;
  leftEdge: Polyline;
  rightEdge: Polyline;
  params: VehicleParams;
  options: SimulationOptions;
}

type SimulationWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'completed'; result: SimulationResult }
  | { type: 'failed'; message: string };

self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  try {
    const { centerline, leftEdge, rightEdge, params, options } = event.data;
    const result = runSimulation(
      centerline,
      leftEdge,
      rightEdge,
      params,
      0.1,
      (progress) => self.postMessage({ type: 'progress', progress } satisfies SimulationWorkerResponse),
      options,
    );
    self.postMessage({ type: 'completed', result } satisfies SimulationWorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : '模拟计算失败。';
    self.postMessage({ type: 'failed', message } satisfies SimulationWorkerResponse);
  }
};
