/**
 * 道路画布 — 使用 Konva.js 多层 Canvas
 * 渲染道路中线（Path，含圆弧段）、左边线、右边线
 * 圆弧段动态离散化以保证任意缩放级别的精度
 * 支持拖拽平移和滚轮缩放
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Text, Group, Circle, Shape } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useUIStore, useRoadStore, useSimulationStore, useVehicleStore } from '../../store';
import type { Point2D, BoundingBox, Path } from '../../core/geometry/types';
import { pathToPolyline, isDrivingDirectionForward } from '../../core/geometry/path';
import { getFrontSteeringAxleWorldPoint } from '../../core/vehicle/ackermann';

/** 画布内边距（像素） */
const CANVAS_PADDING = 60;

/** 最小/最大缩放比例 */
const MIN_SCALE = 0.05;
const MAX_SCALE = 50;

/** 网格大小（世界单位） */
const GRID_SIZE = 50;

/** 圆弧渲染精度：全圆分段数基准 */
const ARC_SEGMENTS = 256;

const RoadCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const roadData = useRoadStore((s) => s.roadData);
  const showCenterline = useRoadStore((s) => s.showCenterline);
  const showLeftEdge = useRoadStore((s) => s.showLeftEdge);
  const showRightEdge = useRoadStore((s) => s.showRightEdge);

  const canvasScale = useUIStore((s) => s.canvasScale);
  const canvasOffsetX = useUIStore((s) => s.canvasOffsetX);
  const canvasOffsetY = useUIStore((s) => s.canvasOffsetY);
  const setCanvasScale = useUIStore((s) => s.setCanvasScale);
  const setCanvasOffset = useUIStore((s) => s.setCanvasOffset);

  // 模拟结果订阅
  const simResult = useSimulationStore((s) => s.result);
  const currentStepIndex = useSimulationStore((s) => s.currentStepIndex);
  const showEnvelope = useSimulationStore((s) => s.showEnvelope);
  const showConflicts = useSimulationStore((s) => s.showConflicts);
  const showVehicleAtStep = useSimulationStore((s) => s.showVehicleAtStep);
  const vehicleParams = useVehicleStore((s) => s.params);

  // 响应式尺寸
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // 道路加载后自动适配视图
  useEffect(() => {
    if (roadData && dimensions.width > 0 && dimensions.height > 0) {
      fitViewToRoad(roadData.bounds, dimensions.width, dimensions.height);
    }
  }, [roadData]);

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.08;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      let newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const newX = pointer.x - mousePointTo.x * newScale;
      const newY = pointer.y - mousePointTo.y * newScale;

      setCanvasScale(newScale);
      setCanvasOffset(newX, newY);
    },
    [setCanvasScale, setCanvasOffset]
  );

  // 适配视图到道路范围
  const fitViewToRoad = useCallback(
    (bounds: BoundingBox, canvasW: number, canvasH: number) => {
      const dataW = bounds.maxX - bounds.minX;
      const dataH = bounds.maxY - bounds.minY;

      if (dataW <= 0 || dataH <= 0) return;

      const availableW = canvasW - CANVAS_PADDING * 2;
      const availableH = canvasH - CANVAS_PADDING * 2;

      const scaleX = availableW / dataW;
      const scaleY = availableH / dataH;
      const scale = Math.min(scaleX, scaleY);

      const offsetX =
        (canvasW - dataW * scale) / 2 - bounds.minX * scale;
      const offsetY =
        (canvasH - dataH * scale) / 2 - bounds.minY * scale;

      setCanvasScale(scale);
      setCanvasOffset(offsetX, offsetY);
    },
    [setCanvasScale, setCanvasOffset]
  );

  // 将 Path 转为屏幕坐标点列（圆弧动态离散化）
  const pathToFlatPoints = useCallback(
    (path: Path): number[] => {
      const polyline = pathToPolyline(path, ARC_SEGMENTS);
      const flat: number[] = [];
      for (const p of polyline) {
        flat.push(p.x, p.y);
      }
      return flat;
    },
    []
  );

  // 将折线转为屏幕坐标点列
  const polylineToFlatPoints = useCallback(
    (points: Point2D[]): number[] => {
      const flat: number[] = [];
      for (const p of points) {
        flat.push(p.x, p.y);
      }
      return flat;
    },
    []
  );

  // 当前模拟步骤（用于渲染车辆位置）
  const currentStep = useMemo(() => {
    if (!simResult || simResult.steps.length === 0) return null;
    const idx = Math.min(currentStepIndex, simResult.steps.length - 1);
    return simResult.steps[idx];
  }, [simResult, currentStepIndex]);

  // 紫色控制路线与该点重合：它是车辆前转向轴的中心，而非最后轴。
  const currentFrontSteeringAxle = useMemo(
    () => currentStep?.frontSteeringAxle ?? (currentStep ? getFrontSteeringAxleWorldPoint(vehicleParams, currentStep.pose) : null),
    [currentStep, vehicleParams]
  );
  const currentRearAxle = currentStep?.rearAxle ?? currentStep?.pose.position ?? null;
  const currentHitchPoint = currentStep?.hitchPoint ?? null;
  const currentTrailerAxle = currentStep?.trailerAxle ?? null;

  // 冲突 X 标记臂长（世界单位），缩放时自然调整
  const CONFLICT_ARM = 2;

  // 获取路径首尾点（根据边线端点与中线端点的邻近关系判断行驶方向）
  // 原理：边线的几何起点（CAD 画线时的第一点）靠近中线的行驶起点
  const getPathEndpoints = useCallback(
    (path: Path, leftEdge: Point2D[], rightEdge: Point2D[]): { start: Point2D; end: Point2D } | null => {
      if (path.length === 0) return null;
      const first = path[0];
      const last = path[path.length - 1];

      const pathStart = first.type === 'straight' ? first.start : first.startPoint;
      const pathEnd = last.type === 'straight' ? last.end : last.endPoint;

      // 比较边线端点与中线首点的距离，判断中线是否被反向构建
      const forward = isDrivingDirectionForward(path, leftEdge, rightEdge, ARC_SEGMENTS);

      return {
        start: forward ? pathStart : pathEnd,
        end: forward ? pathEnd : pathStart,
      };
    },
    []
  );

  // 网格线
  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    const viewW = dimensions.width;
    const viewH = dimensions.height;

    const worldMinX = -canvasOffsetX / Math.max(canvasScale, 0.01);
    const worldMinY = -canvasOffsetY / Math.max(canvasScale, 0.01);
    const worldMaxX = worldMinX + viewW / Math.max(canvasScale, 0.01);
    const worldMaxY = worldMinY + viewH / Math.max(canvasScale, 0.01);

    const startX = Math.floor(worldMinX / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(worldMinY / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil(worldMaxX / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil(worldMaxY / GRID_SIZE) * GRID_SIZE;

    for (let x = startX; x <= endX; x += GRID_SIZE) {
      lines.push(
        <Line
          key={`gx-${x}`}
          points={[x, startY, x, endY]}
          stroke="#e8e8e8"
          strokeWidth={0.3}
          strokeScaleEnabled={false}
          listening={false}
        />
      );
    }
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      lines.push(
        <Line
          key={`gy-${y}`}
          points={[startX, y, endX, y]}
          stroke="#e8e8e8"
          strokeWidth={0.3}
          strokeScaleEnabled={false}
          listening={false}
        />
      );
    }

    return lines;
  }, [dimensions, canvasScale, canvasOffsetX, canvasOffsetY]);

  const endpoints = roadData
    ? getPathEndpoints(roadData.centerline, roadData.leftEdge, roadData.rightEdge)
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        overflow: 'hidden',
        background: '#fafafa',
      }}
    >
      <Stage
        ref={stageRef as React.RefObject<any>}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={canvasScale}
        scaleY={canvasScale}
        x={canvasOffsetX}
        y={canvasOffsetY}
        draggable
        onWheel={handleWheel}
      >
        {/* 网格层 */}
        <Layer listening={false}>
          {gridLines}
        </Layer>

        {/* 道路数据层 */}
        <Layer>
          {/* 左边线 — 红色 */}
          {roadData && showLeftEdge && roadData.leftEdge.length >= 2 && (
            <Line
              points={polylineToFlatPoints(roadData.leftEdge)}
              stroke="#ff4d4f"
              strokeWidth={1}
              strokeScaleEnabled={false}
              tension={0}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}

          {/* 右边线 — 绿色 */}
          {roadData && showRightEdge && roadData.rightEdge.length >= 2 && (
            <Line
              points={polylineToFlatPoints(roadData.rightEdge)}
              stroke="#52c41a"
              strokeWidth={1}
              strokeScaleEnabled={false}
              tension={0}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}

          {/* 中线 — 蓝色虚线（含圆弧段，动态离散化） */}
          {roadData && showCenterline && roadData.centerline.length > 0 && (
            <Line
              points={pathToFlatPoints(roadData.centerline)}
              stroke="#1677ff"
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              dash={[12, 6]}
              tension={0}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}

          {/* 道路起点/终点标记 */}
          {endpoints && (
            <>
              <Text
                x={endpoints.start.x - 22}
                y={endpoints.start.y - 26}
                text="起点"
                fontSize={13}
                fill="#1677ff"
                fontStyle="bold"
                listening={false}
              />
              <Text
                x={endpoints.end.x - 22}
                y={endpoints.end.y + 10}
                text="终点"
                fontSize={13}
                fill="#1677ff"
                fontStyle="bold"
                listening={false}
              />
            </>
          )}

          {/* 空状态提示 */}
          {!roadData && (
            <>
              <Text
                x={-160}
                y={-40}
                text="📂 请导入道路 CAD 文件"
                fontSize={18}
                fill="#999"
                listening={false}
              />
              <Text
                x={-120}
                y={-10}
                text="支持 DWG / DXF 格式"
                fontSize={13}
                fill="#bbb"
                listening={false}
              />
              <Text
                x={-215}
                y={12}
                text="（推荐：中线 + 左边线 + 右边线，3 个图层）"
                fontSize={12}
                fill="#ccc"
                listening={false}
              />
            </>
          )}
        </Layer>

        {/* 扫掠包络层：铰接车分别显示牵引车（蓝）和挂车（紫）扫掠。 */}
        {simResult && showEnvelope && (simResult.envelope.tractorSlices?.length || simResult.envelope.trailerSlices?.length || simResult.envelope.slices?.length || simResult.envelope.polygon.vertices.length >= 3) && (
          <Layer listening={false}>
            {simResult.envelope.tractorSlices && simResult.envelope.trailerSlices ? (
              <>
                <Shape
                  sceneFunc={(context, shape) => {
                    for (const slice of simResult.envelope.tractorSlices ?? []) {
                      const [first, ...rest] = slice.vertices;
                      if (!first) continue;
                      context.beginPath(); context.moveTo(first.x, first.y);
                      for (const point of rest) context.lineTo(point.x, point.y);
                      context.closePath(); context.fillStrokeShape(shape);
                    }
                  }}
                  fill="rgba(22,119,255,0.07)" stroke="rgba(22,119,255,0.26)" strokeWidth={0.35} strokeScaleEnabled={false} listening={false}
                />
                <Shape
                  sceneFunc={(context, shape) => {
                    for (const slice of simResult.envelope.trailerSlices ?? []) {
                      const [first, ...rest] = slice.vertices;
                      if (!first) continue;
                      context.beginPath(); context.moveTo(first.x, first.y);
                      for (const point of rest) context.lineTo(point.x, point.y);
                      context.closePath(); context.fillStrokeShape(shape);
                    }
                  }}
                  fill="rgba(235,47,150,0.10)" stroke="rgba(235,47,150,0.36)" strokeWidth={0.35} strokeScaleEnabled={false} listening={false}
                />
              </>
            ) : simResult.envelope.slices && simResult.envelope.slices.length > 0 ? (
              <Shape
                sceneFunc={(context, shape) => {
                  for (const slice of simResult.envelope.slices ?? []) {
                    const [first, ...rest] = slice.vertices;
                    if (!first) continue;
                    context.beginPath();
                    context.moveTo(first.x, first.y);
                    for (const point of rest) context.lineTo(point.x, point.y);
                    context.closePath();
                    context.fillStrokeShape(shape);
                  }
                }}
                fill="rgba(22,119,255,0.10)"
                stroke="rgba(22,119,255,0.28)"
                strokeWidth={0.35}
                strokeScaleEnabled={false}
                listening={false}
              />
            ) : (
              <Line
                points={polylineToFlatPoints(simResult.envelope.polygon.vertices)}
                closed={true}
                fill="rgba(22,119,255,0.10)"
                stroke="#1677ff"
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[10, 5]}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
          </Layer>
        )}

        {/* 实际轴轨迹层：均由连续后轴状态计算，不使用前轴路径反推车身。 */}
        {simResult?.frontAxleTrack && simResult.frontAxleTrack.length > 1 && (
          <Layer listening={false}>
            <Line
              points={polylineToFlatPoints(simResult.frontAxleTrack)}
              stroke="#722ed1"
              strokeWidth={1.8}
              strokeScaleEnabled={false}
              dash={[8, 4]}
              lineCap="round"
              listening={false}
            />
            {simResult.rearAxleTrack && simResult.rearAxleTrack.length > 1 && (
              <Line
                points={polylineToFlatPoints(simResult.rearAxleTrack)}
                stroke="#13c2c2"
                strokeWidth={1.4}
                strokeScaleEnabled={false}
                dash={[5, 4]}
                lineCap="round"
                listening={false}
              />
            )}
            {simResult.hitchTrack && simResult.hitchTrack.length > 1 && (
              <Line
                points={polylineToFlatPoints(simResult.hitchTrack)}
                stroke="#fa8c16"
                strokeWidth={1.1}
                strokeScaleEnabled={false}
                dash={[3, 3]}
                lineCap="round"
                listening={false}
              />
            )}
            {simResult.trailerAxleTrack && simResult.trailerAxleTrack.length > 1 && (
              <Line
                points={polylineToFlatPoints(simResult.trailerAxleTrack)}
                stroke="#eb2f96"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                dash={[6, 3]}
                lineCap="round"
                listening={false}
              />
            )}
          </Layer>
        )}

        {/* 冲突标记 + 车辆当前位置层 */}
        {(simResult || (simResult && showVehicleAtStep && currentStep)) && (
          <Layer>
            {/* 冲突 X 标记 + 高亮包络线段 */}
            {simResult && showConflicts && simResult.conflicts.map((c, i) => (
              <Group key={`conflict-${i}`} listening={false}>
                {/* X 标记 */}
                <Line
                  points={[
                    c.point.x - CONFLICT_ARM, c.point.y - CONFLICT_ARM,
                    c.point.x + CONFLICT_ARM, c.point.y + CONFLICT_ARM,
                  ]}
                  stroke={c.vehicleBody === 'trailer' ? '#722ed1' : '#ff4d4f'}
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  lineCap="round"
                  listening={false}
                />
                <Line
                  points={[
                    c.point.x - CONFLICT_ARM, c.point.y + CONFLICT_ARM,
                    c.point.x + CONFLICT_ARM, c.point.y - CONFLICT_ARM,
                  ]}
                  stroke={c.vehicleBody === 'trailer' ? '#722ed1' : '#ff4d4f'}
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  lineCap="round"
                  listening={false}
                />
                {/* 冲突涉及的包络线段高亮 */}
                {c.envelopeSegment && (
                  <Line
                    points={[
                      c.envelopeSegment.start.x, c.envelopeSegment.start.y,
                      c.envelopeSegment.end.x, c.envelopeSegment.end.y,
                    ]}
                    stroke={c.vehicleBody === 'trailer' ? '#722ed1' : '#ff4d4f'}
                    strokeWidth={2}
                    strokeScaleEnabled={false}
                    lineCap="round"
                    listening={false}
                  />
                )}
              </Group>
            ))}

            {/* 车辆当前位置矩形 */}
            {simResult && showVehicleAtStep && currentStep && (
              <>
                <Line
                  points={[
                    currentStep.corners.frontLeft.x, currentStep.corners.frontLeft.y,
                    currentStep.corners.frontRight.x, currentStep.corners.frontRight.y,
                    currentStep.corners.rearRight.x, currentStep.corners.rearRight.y,
                    currentStep.corners.rearLeft.x, currentStep.corners.rearLeft.y,
                  ]}
                  closed={true}
                  fill={currentStep.tractorSafetyReason ? 'rgba(255,77,79,0.32)' : 'rgba(250,140,22,0.30)'}
                  stroke={currentStep.tractorSafetyReason ? '#ff4d4f' : '#fa8c16'}
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                {currentStep.trailerCorners && (
                  <Line
                    points={[
                      currentStep.trailerCorners.frontLeft.x, currentStep.trailerCorners.frontLeft.y,
                      currentStep.trailerCorners.frontRight.x, currentStep.trailerCorners.frontRight.y,
                      currentStep.trailerCorners.rearRight.x, currentStep.trailerCorners.rearRight.y,
                      currentStep.trailerCorners.rearLeft.x, currentStep.trailerCorners.rearLeft.y,
                    ]}
                    closed={true}
                    fill={currentStep.trailerSafetyReason ? 'rgba(255,77,79,0.30)' : 'rgba(114,46,209,0.22)'}
                    stroke={currentStep.trailerSafetyReason ? '#ff4d4f' : '#722ed1'}
                    strokeWidth={1}
                    strokeScaleEnabled={false}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
                {currentFrontSteeringAxle && (
                  <Circle
                    x={currentFrontSteeringAxle.x}
                    y={currentFrontSteeringAxle.y}
                    radius={0.35}
                    fill="#722ed1"
                    stroke="#ffffff"
                    strokeWidth={0.12}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                )}
                {currentRearAxle && (
                  <Circle
                    x={currentRearAxle.x}
                    y={currentRearAxle.y}
                    radius={0.3}
                    fill="#13c2c2"
                    stroke="#ffffff"
                    strokeWidth={0.12}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                )}
                {currentHitchPoint && (
                  <Circle
                    x={currentHitchPoint.x}
                    y={currentHitchPoint.y}
                    radius={0.34}
                    fill="#fa8c16"
                    stroke="#ffffff"
                    strokeWidth={0.12}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                )}
                {currentTrailerAxle && (
                  <Circle
                    x={currentTrailerAxle.x}
                    y={currentTrailerAxle.y}
                    radius={0.34}
                    fill="#eb2f96"
                    stroke="#ffffff"
                    strokeWidth={0.12}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                )}
              </>
            )}
          </Layer>
        )}
      </Stage>

      {/* 图例叠加层 */}
      {roadData && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: 'rgba(255,255,255,0.85)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: '20px',
            color: '#666',
            border: '1px solid #e8e8e8',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div><span style={{color:'#1677ff',fontWeight:'bold'}}>━ ━</span> 道路中线</div>
          <div><span style={{color:'#ff4d4f',fontWeight:'bold'}}>━━</span> 左侧边线</div>
          <div><span style={{color:'#52c41a',fontWeight:'bold'}}>━━</span> 右侧边线</div>
          {simResult && showEnvelope && (
            <div><span style={{color:'#1677ff',fontWeight:'bold'}}>◧</span> 扫掠包络</div>
          )}
          {simResult?.frontAxleTrack && simResult.frontAxleTrack.length > 1 && (
            <div><span style={{color:'#722ed1',fontWeight:'bold'}}>┄ ┄</span> 前转向轴实际轨迹</div>
          )}
          {simResult?.rearAxleTrack && simResult.rearAxleTrack.length > 1 && (
            <div><span style={{color:'#13c2c2',fontWeight:'bold'}}>┄ ┄</span> 后轴实际轨迹</div>
          )}
          {simResult?.hitchTrack && simResult.hitchTrack.length > 1 && (
            <div><span style={{color:'#fa8c16',fontWeight:'bold'}}>┄ ┄</span> 第五轮轨迹</div>
          )}
          {simResult?.trailerAxleTrack && simResult.trailerAxleTrack.length > 1 && (
            <div><span style={{color:'#eb2f96',fontWeight:'bold'}}>┄ ┄</span> 挂车轴组轨迹</div>
          )}
          {simResult?.envelope.tractorSlices && simResult?.envelope.trailerSlices && (
            <div><span style={{color:'#1677ff',fontWeight:'bold'}}>▧</span> 牵引车扫掠（含外侧前角） <span style={{color:'#eb2f96',fontWeight:'bold'}}>▧</span> 挂车扫掠</div>
          )}
          {simResult && showConflicts && simResult.conflicts.length > 0 && (
            <div><span style={{color:'#ff4d4f',fontWeight:'bold'}}>✕</span> 牵引车冲突 <span style={{color:'#722ed1',fontWeight:'bold'}}>✕</span> 挂车冲突（{simResult.conflicts.length}）</div>
          )}
          {simResult && showVehicleAtStep && currentStep && (
            <div><span style={{color:'#fa8c16',fontWeight:'bold'}}>■</span> 牵引车 <span style={{color:'#722ed1',fontWeight:'bold'}}>■</span> 挂车 <span style={{color:'#fa8c16',fontWeight:'bold'}}>●</span> 第五轮 <span style={{color:'#eb2f96',fontWeight:'bold'}}>●</span> 挂车轴组</div>
          )}
        </div>
      )}
    </div>
  );
};

export default RoadCanvas;
