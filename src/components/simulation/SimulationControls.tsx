/**
 * 模拟控制面板
 * 阶段 4 实现完整模拟功能
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Button, Space, Typography, Progress, Divider, Slider, Switch, Segmented, InputNumber, message } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  StepForwardOutlined,
  StepBackwardOutlined,
  FastForwardOutlined,
  FastBackwardOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import { useSimulationStore, useRoadStore, useVehicleStore } from '../../store';
import type { SimulationResult } from '../../core/geometry/types';

const { Paragraph } = Typography;

const SimulationControls: React.FC = () => {
  const status = useSimulationStore((s) => s.status);
  const progress = useSimulationStore((s) => s.progress);
  const result = useSimulationStore((s) => s.result);
  const currentStepIndex = useSimulationStore((s) => s.currentStepIndex);
  const showEnvelope = useSimulationStore((s) => s.showEnvelope);
  const showConflicts = useSimulationStore((s) => s.showConflicts);
  const showVehicleAtStep = useSimulationStore((s) => s.showVehicleAtStep);
  const safetyClearance = useSimulationStore((s) => s.safetyClearance);
  const setStatus = useSimulationStore((s) => s.setStatus);
  const setResult = useSimulationStore((s) => s.setResult);
  const setProgress = useSimulationStore((s) => s.setProgress);
  const setCurrentStepIndex = useSimulationStore((s) => s.setCurrentStepIndex);
  const setShowEnvelope = useSimulationStore((s) => s.setShowEnvelope);
  const setShowConflicts = useSimulationStore((s) => s.setShowConflicts);
  const setShowVehicleAtStep = useSimulationStore((s) => s.setShowVehicleAtStep);
  const setSafetyClearance = useSimulationStore((s) => s.setSafetyClearance);
  const reset = useSimulationStore((s) => s.reset);

  const roadLoaded = useRoadStore((s) => s.isLoaded);
  const roadData = useRoadStore((s) => s.roadData);
  const vehicleConfigured = useVehicleStore((s) => s.isConfigured);
  const vehicleParams = useVehicleStore((s) => s.params);

  const canStart = roadLoaded && vehicleConfigured;
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const totalSteps = result?.steps.length ?? 0;
  const currentStation = result?.steps[currentStepIndex]?.station ?? 0;

  // 自动播放状态
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(50); // ms per step
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simulationWorkerRef = useRef<Worker | null>(null);

  // 停止自动播放
  const stopAutoPlay = useCallback(() => {
    if (autoPlayRef.current !== null) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
    setAutoPlaying(false);
  }, []);

  // 自动播放推进
  useEffect(() => {
    if (!autoPlaying || !result || totalSteps === 0) {
      stopAutoPlay();
      return;
    }
    autoPlayRef.current = setInterval(() => {
      setCurrentStepIndex(
        useSimulationStore.getState().currentStepIndex + 1
      );
    }, playSpeed);
    return () => {
      if (autoPlayRef.current !== null) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [autoPlaying, playSpeed, result, totalSteps, setCurrentStepIndex, stopAutoPlay]);

  // 到达末尾自动停止
  useEffect(() => {
    if (autoPlaying && currentStepIndex >= totalSteps - 1) {
      stopAutoPlay();
    }
  }, [currentStepIndex, totalSteps, autoPlaying, stopAutoPlay]);

  // 切换自动播放
  const toggleAutoPlay = useCallback(() => {
    if (autoPlaying) {
      stopAutoPlay();
    } else {
      // 如果已经在末尾，从头开始
      if (currentStepIndex >= totalSteps - 1) {
        setCurrentStepIndex(0);
      }
      setAutoPlaying(true);
    }
  }, [autoPlaying, currentStepIndex, totalSteps, setCurrentStepIndex, stopAutoPlay]);

  const handleStart = useCallback(() => {
    if (!roadData) return;

    simulationWorkerRef.current?.terminate();
    setStatus('running');
    setProgress(0.02);

    // 规划和完整扫掠校核都在 Worker 中执行，长道路不会阻塞按钮、浏览器或画布交互。
    const worker = new Worker(
      new URL('../../core/simulation/simulation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    simulationWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: 'progress'; progress: number } | { type: 'completed'; result: SimulationResult } | { type: 'failed'; message: string }>) => {
      if (simulationWorkerRef.current !== worker) return;
      if (event.data.type === 'progress') {
        setProgress(Math.max(0.02, Math.min(event.data.progress, 0.99)));
        return;
      }
      worker.terminate();
      simulationWorkerRef.current = null;
      if (event.data.type === 'completed') {
        setResult(event.data.result);
        setProgress(1);
        setStatus('completed');
      } else {
        message.error(event.data.message);
        setStatus('idle');
      }
    };
    worker.onerror = () => {
      if (simulationWorkerRef.current !== worker) return;
      worker.terminate();
      simulationWorkerRef.current = null;
      message.error('模拟工作线程异常，请检查道路与车辆参数。');
      setStatus('idle');
    };
    worker.postMessage({
      centerline: roadData.centerline,
      leftEdge: roadData.leftEdge,
      rightEdge: roadData.rightEdge,
      params: vehicleParams,
      options: {
        speedKph: 5,
        clearance: safetyClearance,
        // V2-3：刚性车与铰接车均由 Worker 生成前进式连续自动安全路线。
        routeMode: 'auto',
      },
    });
  }, [roadData, vehicleParams, safetyClearance, setStatus, setProgress, setResult]);

  const handleCancel = useCallback(() => {
    if (!simulationWorkerRef.current) return;
    simulationWorkerRef.current.terminate();
    simulationWorkerRef.current = null;
    setStatus('idle');
    setProgress(0);
    message.info('已取消本次模拟计算。');
  }, [setProgress, setStatus]);

  const handleReset = useCallback(() => {
    simulationWorkerRef.current?.terminate();
    simulationWorkerRef.current = null;
    stopAutoPlay();
    reset();
  }, [reset, stopAutoPlay]);

  useEffect(() => () => {
    simulationWorkerRef.current?.terminate();
  }, []);

  return (
    <div style={{ padding: '8px 0' }}>
      <Paragraph style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        {vehicleParams.type === 'articulated'
          ? '系统会自动寻找牵引车与半挂车均满足边线、净距和转向连续性的前进路线；前转向轴紫线与挂车轨迹均由同一组连续铰接状态推导。'
          : '系统会在道路横向范围内自动规划刚性车路线，并按完整车身轮廓校核左右道路边线。'}
      </Paragraph>
      <div style={{ fontSize: 12, color: '#8c6d1f', background: '#fffbe6', border: '1px solid #ffe58f', padding: 8, borderRadius: 4, marginBottom: 12 }}>
        本页结果为几何模拟结果。请在用于工程设计前，结合目标车型资料、厂家扫掠图或实车试验复核。
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 前置条件检查 */}
        {!canStart && (
          <div style={{ fontSize: 13, color: '#faad14', background: '#fffbe6', padding: 8, borderRadius: 4 }}>
            ⚠️ 请先完成以下步骤：
            {!vehicleConfigured && <div>· 在「车辆参数」中配置车辆</div>}
            {!roadLoaded && <div>· 在「道路导入」中导入道路 CAD 文件</div>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span>单侧安全净距 (m)</span>
          <InputNumber
            value={safetyClearance}
            min={0}
            max={10}
            step={0.1}
            precision={1}
            onChange={(value) => setSafetyClearance(value ?? 0.5)}
            style={{ width: 112 }}
          />
        </div>
        {vehicleParams.type === 'articulated' && (
          <div style={{ fontSize: 12, color: '#722ed1', background: '#f9f0ff', padding: 8, borderRadius: 4 }}>
            牵引车扫掠为蓝色、半挂车扫掠为粉红色；紫色矩形为当前半挂车车身。红色 X 为牵引车问题，紫色 X 为半挂车问题。
          </div>
        )}
        {/* 控制按钮 */}
        <Space>
          {!isRunning ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              disabled={!canStart}
            >
              开始模拟
            </Button>
          ) : (
            <Button
              icon={<CloseCircleOutlined />}
              onClick={handleCancel}
            >
              取消计算
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={status === 'idle'}
          >
            重置
          </Button>
        </Space>

        {/* 进度 */}
        {status !== 'idle' && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <Progress percent={Math.round(progress * 100)} size="small" />
            <div style={{ fontSize: 13, color: '#666' }}>
              {isRunning ? (vehicleParams.type === 'articulated' ? '正在后台进行牵引车与挂车双车身安全复核；长道路可能需要数秒，可随时取消。' : '正在后台规划与校核；长道路可能需要数秒，可随时取消。') : '速度：5 km/h（1.39 m/s）'}
            </div>
          </>
        )}

        {/* 结果 */}
        {status === 'completed' && result && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <div
              style={{
                fontSize: 13,
                color: result.passed ? '#52c41a' : '#ff4d4f',
                background: result.passed ? '#f6ffed' : '#fff2f0',
                padding: 8,
                borderRadius: 4,
                border: `1px solid ${result.passed ? '#b7eb8f' : '#ffa39e'}`,
              }}
            >
              {result.assessment === 'kinematic_preview' ? (
                <>ℹ️ 铰接车连续运动学预览完成：请回放确认牵引车、第五轮和挂车轨迹连续；本阶段尚未给出道路通行结论。</>
              ) : result.assessment === 'invalid_road_data' ? (
                <>⚠️ 道路导入数据异常：{result.firstIssue?.message ?? '无法建立有效道路安全走廊。'}</>
              ) : result.route && !result.route.feasible ? (
                <>
                  ⚠️ 无连续可行路线：{result.route.message ?? '未找到满足安全净距的连续前进路线。'}
                  <div style={{ marginTop: 4 }}>仅保留最远真实可执行轨迹，并标出 {result.conflicts.length} 处实际问题位置。</div>
                </>
              ) : result.assessment === 'insufficient_clearance' ? (
                <>⚠️ 安全净距不足：{result.firstIssue?.message ?? '车辆未满足设定的侧向安全净距。'}</>
              ) : result.assessment === 'boundary_collision' ? (
                <>❌ 发生边线冲突：{result.firstIssue?.message ?? `检测到 ${result.conflicts.length} 处冲突。`}</>
              ) : result.passed ? (
                <>{vehicleParams.type === 'articulated' ? '✅ 通过：牵引车和半挂车均满足当前连续自动路线下的边线与净距要求。' : '✅ 通过：自动路线未与道路边线发生冲突'}</>
              ) : (
                <>❌ 不通过：检测到 {result.conflicts.length} 处冲突</>
              )}
            </div>
            {result.route && result.route.feasible && result.assessment !== 'kinematic_preview' && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                {result.route.mode === 'auto' ? '自动路线' : '中线引导'}最小净距：{result.route.minimumClearance.toFixed(2)} m（要求：{result.route.requestedClearance.toFixed(2)} m）
                {result.route.message && <div style={{ color: '#fa8c16', marginTop: 2 }}>⚠️ {result.route.message}</div>}
              </div>
            )}
            {result.minimumClearance !== undefined && result.assessment !== 'invalid_road_data' && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                全程最小净距：{result.minimumClearance.toFixed(2)} m（要求：{(result.requestedClearance ?? safetyClearance).toFixed(2)} m）
                {result.firstIssue?.station !== undefined && (
                  <div style={{ color: '#fa8c16', marginTop: 2 }}>首次问题里程：{result.firstIssue.station.toFixed(1)} m</div>
                )}
              </div>
            )}
            {result.route && !result.route.feasible && result.route.failureStation !== undefined && (
              <div style={{ fontSize: 12, color: '#fa8c16', marginTop: 6 }}>
                首次安全路线复核失败里程：{result.route.failureStation.toFixed(1)} m
              </div>
            )}
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              模拟步数：{result.steps.length} | 步长：0.1 m | 路径总长约{' '}
              {result.steps.length > 0
                ? (result.steps[result.steps.length - 1].station).toFixed(0)
                : 0}{' '}
              m
            </div>
          </>
        )}
        {status === 'completed' && !result && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <div
              style={{
                fontSize: 13,
                color: '#999',
                background: '#fafafa',
                padding: 8,
                borderRadius: 4,
              }}
            >
              模拟未产生结果
            </div>
          </>
        )}

        {/* 逐步回放控制 — 仅在模拟完成后显示 */}
        {isCompleted && result && totalSteps > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>
              逐步回放
            </div>

            {/* 步骤滑块 */}
            <Slider
              min={0}
              max={totalSteps - 1}
              value={currentStepIndex}
              onChange={(v) => {
                stopAutoPlay();
                setCurrentStepIndex(v);
              }}
              tooltip={{ formatter: (v) => `步骤 ${v}` }}
              style={{ margin: '4px 0' }}
            />

            {/* 步骤 + 里程信息 */}
            <div style={{ fontSize: 12, color: '#999', textAlign: 'center' }}>
              步骤 {currentStepIndex} / {totalSteps - 1}
              &nbsp;|&nbsp; 里程 {currentStation.toFixed(1)} m
            </div>

            {/* 回放按钮组 */}
            <Space size="small" style={{ justifyContent: 'center', width: '100%' }}>
              <Button
                size="small"
                icon={<FastBackwardOutlined />}
                onClick={() => { stopAutoPlay(); setCurrentStepIndex(0); }}
                disabled={currentStepIndex === 0}
                title="跳到开头"
              />
              <Button
                size="small"
                icon={<StepBackwardOutlined />}
                onClick={() => { stopAutoPlay(); setCurrentStepIndex(Math.max(0, currentStepIndex - 1)); }}
                disabled={currentStepIndex === 0}
                title="上一步"
              />
              <Button
                type={autoPlaying ? 'primary' : 'default'}
                size="small"
                icon={autoPlaying ? <PauseCircleOutlined /> : <CaretRightOutlined />}
                onClick={toggleAutoPlay}
                title={autoPlaying ? '暂停' : '自动播放'}
              />
              <Button
                size="small"
                icon={<StepForwardOutlined />}
                onClick={() => { stopAutoPlay(); setCurrentStepIndex(Math.min(totalSteps - 1, currentStepIndex + 1)); }}
                disabled={currentStepIndex >= totalSteps - 1}
                title="下一步"
              />
              <Button
                size="small"
                icon={<FastForwardOutlined />}
                onClick={() => { stopAutoPlay(); setCurrentStepIndex(totalSteps - 1); }}
                disabled={currentStepIndex >= totalSteps - 1}
                title="跳到末尾"
              />
            </Space>

            {/* 播放速度 */}
            <div style={{ textAlign: 'center' }}>
              <Segmented
                size="small"
                value={playSpeed.toString()}
                onChange={(v) => setPlaySpeed(Number(v))}
                options={[
                  { label: '1×', value: '50' },
                  { label: '2×', value: '25' },
                  { label: '5×', value: '10' },
                  { label: '10×', value: '5' },
                ]}
              />
            </div>
          </>
        )}

        {/* 图层可见性开关 — 模拟完成后显示 */}
        {isCompleted && result && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 13, fontWeight: 'bold', color: '#333', marginBottom: 4 }}>
              图层显示
            </div>
            <div style={{ padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 2, background: '#1677ff', marginRight: 8, verticalAlign: 'middle', borderTop: '2px dashed #1677ff' }} />{' '}
                    扫掠包络线
                  </span>
                  <Switch size="small" checked={showEnvelope} onChange={setShowEnvelope} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 2, background: '#ff4d4f', marginRight: 8, verticalAlign: 'middle' }} />{' '}
                    冲突标记
                  </span>
                  <Switch size="small" checked={showConflicts} onChange={setShowConflicts} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 2, background: '#fa8c16', marginRight: 8, verticalAlign: 'middle' }} />{' '}
                    车辆位置
                  </span>
                  <Switch size="small" checked={showVehicleAtStep} onChange={setShowVehicleAtStep} />
                </div>
              </Space>
            </div>
          </>
        )}
      </Space>
    </div>
  );
};

export default SimulationControls;
