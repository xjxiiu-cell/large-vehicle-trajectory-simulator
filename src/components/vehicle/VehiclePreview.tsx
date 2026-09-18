/**
 * 车辆 2D 示意图预览。
 * 铰接车模式中的轴线、第五轮和尺寸段可点击，并与参数表单定位联动。
 */

import React, { useMemo } from 'react';
import { useVehicleStore } from '../../store';

const PREVIEW_HEIGHT = 120;
const PREVIEW_WIDTH = 340;

interface VehiclePreviewProps {
  selectedTarget?: string;
  onSelectTarget?: (target: string) => void;
}

const VehiclePreview: React.FC<VehiclePreviewProps> = ({ selectedTarget, onSelectTarget }) => {
  const params = useVehicleStore((s) => s.params);

  const viewBox = useMemo(() => {
    const margin = 4;
    const scaleX = (PREVIEW_WIDTH - margin * 2) / params.totalLength;
    const scaleY = (PREVIEW_HEIGHT - margin * 2) / params.totalWidth;
    const scale = Math.min(scaleX, scaleY);
    const drawLen = params.totalLength * scale;
    const drawWid = params.totalWidth * scale;
    return {
      scale,
      drawLen,
      drawWid,
      offsetX: (PREVIEW_WIDTH - drawLen) / 2,
      offsetY: (PREVIEW_HEIGHT - drawWid) / 2,
    };
  }, [params.totalLength, params.totalWidth]);

  if (params.type === 'articulated') {
    const trailer = params.trailer;
    if (!trailer) return null;
    const hitchToAxle = params.trailerHitchToAxle ?? 0;
    // 半挂车的车身尺寸链：前端—牵引销—等效后轴组—车尾。
    const dimensionLength = trailer.frontOverhang + hitchToAxle + trailer.rearOverhang;
    const totalDrawLength = params.totalLength + dimensionLength + 1.5;
    const scale = Math.min(
      (PREVIEW_WIDTH - 16) / totalDrawLength,
      (PREVIEW_HEIGHT - 30) / Math.max(params.totalWidth, trailer.totalWidth),
    );
    const tractorLength = params.totalLength * scale;
    const trailerLength = dimensionLength * scale;
    const gap = 0.45 * scale;
    const tractorX = (PREVIEW_WIDTH - (tractorLength + trailerLength + gap)) / 2;
    const trailerX = tractorX + tractorLength + gap;
    const tractorY = (PREVIEW_HEIGHT - params.totalWidth * scale) / 2 - 5;
    const trailerY = (PREVIEW_HEIGHT - trailer.totalWidth * scale) / 2 - 5;
    const centerY = PREVIEW_HEIGHT / 2 - 5;
    const primarySteeringIndex = params.axles.findIndex((axle) => axle.isSteering);
    const primarySteering = params.axles[Math.max(0, primarySteeringIndex)];
    const rearmostIndex = params.axles.reduce((best, axle, index, axles) =>
      axle.distanceFromFront > axles[best].distanceFromFront ? index : best, 0);
    const rearmostAxle = params.axles[rearmostIndex];
    const frontSteeringX = tractorX + (primarySteering.distanceFromFront / params.totalLength) * tractorLength;
    const rearTractorAxleX = tractorX + (rearmostAxle.distanceFromFront / params.totalLength) * tractorLength;
    // 图中从左到右是由车头到车尾；内部符号中后方为负，因此需要反向换算。
    const fifthWheelX = rearTractorAxleX - (params.hitchOffset ?? 0) * scale;
    const trailerHitchX = trailerX + trailer.frontOverhang * scale;
    const trailerEquivalentAxleX = trailerHitchX + hitchToAxle * scale;
    const isSelected = (target: string) => selectedTarget === target;
    const select = (target: string) => onSelectTarget?.(target);
    const regionStyle = (target: string) => ({
      fill: isSelected(target) ? '#faad14' : '#1677ff',
      fillOpacity: isSelected(target) ? 0.22 : 0.06,
      stroke: isSelected(target) ? '#fa8c16' : 'none',
      cursor: 'pointer',
    });

    return (
      <div style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, background: '#fafafa', borderRadius: 4, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}>
          <rect x={tractorX} y={tractorY} width={tractorLength} height={params.totalWidth * scale} fill="#e6f4ff" stroke="#1677ff" strokeWidth={1.5} rx={2} />
          <rect x={trailerX} y={trailerY} width={trailerLength} height={trailer.totalWidth * scale} fill="#f9f0ff" stroke="#722ed1" strokeWidth={1.5} rx={2} />

          {/* 可点击尺寸段：颜色高亮后会定位到对应输入项。 */}
          <rect x={tractorX} y={tractorY} width={Math.max(2, frontSteeringX - tractorX)} height={params.totalWidth * scale} onClick={() => select('tractor-front-overhang')} {...regionStyle('tractor-front-overhang')}><title>牵引车前悬：车头至前转向轴</title></rect>
          <rect x={rearTractorAxleX} y={tractorY} width={Math.max(2, tractorX + tractorLength - rearTractorAxleX)} height={params.totalWidth * scale} onClick={() => select('tractor-rear-overhang')} {...regionStyle('tractor-rear-overhang')}><title>牵引车后悬：最后轴至车尾</title></rect>
          <rect x={trailerX} y={trailerY} width={Math.max(2, trailerHitchX - trailerX)} height={trailer.totalWidth * scale} onClick={() => select('trailer-front-overhang')} {...regionStyle('trailer-front-overhang')}><title>牵引销至挂车前端</title></rect>
          <rect x={trailerEquivalentAxleX} y={trailerY} width={Math.max(2, trailerX + trailerLength - trailerEquivalentAxleX)} height={trailer.totalWidth * scale} onClick={() => select('trailer-rear-overhang')} {...regionStyle('trailer-rear-overhang')}><title>挂车等效后轴组至车尾</title></rect>

          <line x1={fifthWheelX} y1={centerY} x2={trailerHitchX} y2={centerY} stroke="#fa8c16" strokeWidth={2} strokeDasharray="3 2" />
          <circle cx={fifthWheelX} cy={centerY} r={isSelected('tractor-hitch') ? 5 : 3.5} fill="#fa8c16" stroke={isSelected('tractor-hitch') ? '#d46b08' : 'none'} onClick={() => select('tractor-hitch')} style={{ cursor: 'pointer' }}><title>第五轮距牵引车后轴</title></circle>
          <circle cx={trailerHitchX} cy={centerY} r={isSelected('trailer-front-overhang') ? 4 : 2.5} fill="#fa8c16" onClick={() => select('trailer-front-overhang')} style={{ cursor: 'pointer' }}><title>牵引销</title></circle>
          <line x1={trailerEquivalentAxleX} y1={trailerY - 4} x2={trailerEquivalentAxleX} y2={trailerY + trailer.totalWidth * scale + 4} stroke={isSelected('trailer-hitch-to-axle') ? '#fa8c16' : '#eb2f96'} strokeWidth={isSelected('trailer-hitch-to-axle') ? 2.5 : 1.5} strokeDasharray="3 2" onClick={() => select('trailer-hitch-to-axle')} style={{ cursor: 'pointer' }}><title>第五轮至等效后轴组中心</title></line>

          {params.axles.map((axle, index) => {
            const x = tractorX + axle.distanceFromFront / params.totalLength * tractorLength;
            const target = `tractor-axle-${index}`;
            return <line key={target} x1={x} y1={tractorY - 3} x2={x} y2={tractorY + params.totalWidth * scale + 3} stroke={isSelected(target) ? '#fa8c16' : axle.isSteering ? '#1677ff' : '#666'} strokeWidth={isSelected(target) ? 2.5 : 1.2} onClick={() => select(target)} style={{ cursor: 'pointer' }}><title>牵引车第 {index + 1} 轴</title></line>;
          })}
          {trailer.axles.map((axle, index) => {
            const x = trailerX + axle.distanceFromFront * scale;
            const target = `trailer-axle-${index}`;
            return <line key={target} x1={x} y1={trailerY - 3} x2={x} y2={trailerY + trailer.totalWidth * scale + 3} stroke={isSelected(target) ? '#fa8c16' : '#722ed1'} strokeWidth={isSelected(target) ? 2.5 : 1.2} onClick={() => select(target)} style={{ cursor: 'pointer' }}><title>挂车第 {index + 1} 轴（距挂车前端）</title></line>;
          })}
          <text x={tractorX + tractorLength / 2} y={PREVIEW_HEIGHT - 5} textAnchor="middle" fontSize={10} fill="#1677ff">牵引车 {params.totalLength.toFixed(1)}m</text>
          <text x={trailerX + trailerLength / 2} y={PREVIEW_HEIGHT - 5} textAnchor="middle" fontSize={10} fill={Math.abs(dimensionLength - trailer.totalLength) > 0.05 ? '#ff4d4f' : '#722ed1'}>挂车 {trailer.totalLength.toFixed(1)}m</text>
        </svg>
      </div>
    );
  }

  return (
    <div style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, background: '#fafafa', borderRadius: 4, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
      <svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}>
        <rect x={viewBox.offsetX} y={viewBox.offsetY} width={viewBox.drawLen} height={viewBox.drawWid} fill="#e6f4ff" stroke="#1677ff" strokeWidth={1.5} rx={2} />
        {params.axles.map((axle, idx) => {
          const axleX = viewBox.offsetX + (axle.distanceFromFront / params.totalLength) * viewBox.drawLen;
          const axleDrawHalfWidth = (axle.trackWidth * viewBox.scale) / 2;
          const bodyCenterY = viewBox.offsetY + viewBox.drawWid / 2;
          return <g key={idx}><line x1={axleX} y1={bodyCenterY - axleDrawHalfWidth} x2={axleX} y2={bodyCenterY + axleDrawHalfWidth} stroke={axle.isSteering ? '#1677ff' : '#666'} strokeWidth={axle.isSteering ? 2 : 1} /><rect x={axleX - 2} y={bodyCenterY - axleDrawHalfWidth - 2.5} width={4} height={5} fill={axle.isSteering ? '#1677ff' : '#666'} rx={1} /><rect x={axleX - 2} y={bodyCenterY + axleDrawHalfWidth - 2.5} width={4} height={5} fill={axle.isSteering ? '#1677ff' : '#666'} rx={1} /></g>;
        })}
        <text x={viewBox.offsetX + viewBox.drawLen / 2} y={viewBox.offsetY + viewBox.drawWid + 16} textAnchor="middle" fontSize={10} fill="#666">{params.totalLength.toFixed(1)} m</text>
      </svg>
    </div>
  );
};

export default VehiclePreview;
