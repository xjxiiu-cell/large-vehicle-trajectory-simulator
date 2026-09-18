/** 前轮转向牵引车 + 单半挂车的参数表单（V2-1）。 */
import React, { useEffect, useRef } from 'react';
import { Alert, Button, Form, InputNumber, Select, Switch, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useVehicleStore } from '../../store';

const { Text } = Typography;

interface ArticulatedVehicleFormProps {
  selectedTarget?: string;
  onSelectTarget?: (target: string) => void;
}

const ArticulatedVehicleForm: React.FC<ArticulatedVehicleFormProps> = ({ selectedTarget, onSelectTarget }) => {
  const params = useVehicleStore((s) => s.params);
  const {
    setTotalLength, setTotalWidth, setFrontOverhang, setRearOverhang,
    setMaxSteerAngle, setMaxSteeringRate, setHitchOffset, setTrailerHitchToAxle,
    updateTrailer, addTrailerAxle, removeTrailerAxle, updateTrailerAxle, updateAxle,
  } = useVehicleStore();
  const trailer = params.trailer;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedTarget) return;
    const target = containerRef.current?.querySelector<HTMLElement>(`#articulated-${selectedTarget}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [selectedTarget]);

  if (!trailer) return null;

  const primarySteeringIndex = Math.max(0, params.axles.findIndex((axle) => axle.isSteering));
  const rearmostTractorIndex = params.axles.reduce((best, axle, index, axles) =>
    axle.distanceFromFront > axles[best].distanceFromFront ? index : best, 0);
  const trailerDimensionLength = trailer.frontOverhang + (params.trailerHitchToAxle ?? 0) + trailer.rearOverhang;
  const highlighted = (target: string) => ({
    borderRadius: 6,
    padding: selectedTarget === target ? '4px 6px' : 0,
    margin: selectedTarget === target ? '0 -6px 4px' : 0,
    background: selectedTarget === target ? '#fff7e6' : undefined,
    boxShadow: selectedTarget === target ? '0 0 0 1px #fa8c16 inset' : undefined,
  });
  const select = (target: string) => onSelectTarget?.(target);

  /** 前悬与第一根前转向轴同步，避免外形尺寸和轴位出现两套真值。 */
  const changeTractorFrontOverhang = (value: number) => {
    setFrontOverhang(value);
    updateAxle(primarySteeringIndex, 'distanceFromFront', value);
  };
  /** 后悬与最末牵引车轴同步。 */
  const changeTractorRearOverhang = (value: number) => {
    setRearOverhang(value);
    updateAxle(rearmostTractorIndex, 'distanceFromFront', Math.max(0, params.totalLength - value));
  };
  /** 保持挂车“前端—牵引销—等效轴组—车尾”尺寸链闭合。 */
  const changeTrailerTotalLength = (value: number) => {
    updateTrailer({
      totalLength: value,
      rearOverhang: Math.max(0, value - trailer.frontOverhang - (params.trailerHitchToAxle ?? 0)),
    });
  };
  const changeTrailerFrontExtension = (value: number) => updateTrailer({
    frontOverhang: value,
    rearOverhang: Math.max(0, trailer.totalLength - value - (params.trailerHitchToAxle ?? 0)),
  });
  const changeTrailerRearOverhang = (value: number) => updateTrailer({
    rearOverhang: value,
    totalLength: trailer.frontOverhang + (params.trailerHitchToAxle ?? 0) + value,
  });
  const changeTrailerHitchToAxle = (value: number) => {
    setTrailerHitchToAxle(value);
    updateTrailer({ rearOverhang: Math.max(0, trailer.totalLength - trailer.frontOverhang - value) });
  };

  return (
    <div ref={containerRef} style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
      <Alert type="info" showIcon style={{ marginBottom: 10, fontSize: 12 }} message="可直接点击上方示意图中的轴线、第五轮或彩色尺寸段，表单会定位并高亮对应参数。" />
      <Form layout="horizontal" size="small" labelCol={{ span: 11 }} wrapperCol={{ span: 13 }}>
        <div style={{ fontWeight: 500, marginBottom: 8, color: '#1677ff' }}>🚛 牵引车</div>
        <div id="articulated-tractor-total-length" style={highlighted('tractor-total-length')}><Form.Item label="总长度 (m)"><InputNumber value={params.totalLength} onChange={(v) => setTotalLength(v ?? 9)} min={5} max={30} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <Form.Item label="总宽度 (m)"><InputNumber value={params.totalWidth} onChange={(v) => setTotalWidth(v ?? 2.5)} min={2} max={8} step={0.1} style={{ width: '100%' }} /></Form.Item>
        <div id="articulated-tractor-front-overhang" style={highlighted('tractor-front-overhang')}><Form.Item label="前悬：车头→前转向轴 (m)"><InputNumber value={params.frontOverhang} onChange={(v) => changeTractorFrontOverhang(v ?? 1.5)} min={0} max={8} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <div id="articulated-tractor-rear-overhang" style={highlighted('tractor-rear-overhang')}><Form.Item label="后悬：最后轴→车尾 (m)"><InputNumber value={params.rearOverhang} onChange={(v) => changeTractorRearOverhang(v ?? 1.5)} min={0} max={8} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <Form.Item label="最大转向角 (°)"><InputNumber value={params.maxSteerAngle} onChange={(v) => setMaxSteerAngle(v ?? 35)} min={5} max={60} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="转向变化率 (°/s)"><InputNumber value={params.maxSteeringRateDegPerSec} onChange={(v) => setMaxSteeringRate(v ?? 10)} min={1} max={90} style={{ width: '100%' }} /></Form.Item>
        <div id="articulated-tractor-hitch" style={highlighted('tractor-hitch')}><Form.Item label="第五轮距最后轴 (m)" tooltip="后方为负、前方为正；常见半挂车第五轮位于牵引车后轴后方。"><InputNumber value={params.hitchOffset} onChange={(v) => setHitchOffset(v ?? -0.8)} min={-5} max={5} step={0.1} style={{ width: '100%' }} /></Form.Item></div>

        <Form.Item label="牵引车轴配置">
          <div style={{ width: '100%' }}>
            {params.axles.map((axle, index) => {
              const target = `tractor-axle-${index}`;
              return <div id={`articulated-${target}`} key={target} onClick={() => select(target)} style={{ border: selectedTarget === target ? '1px solid #fa8c16' : '1px solid #d9d9d9', borderRadius: 6, padding: '6px 8px', marginBottom: 6, background: selectedTarget === target ? '#fff7e6' : '#fafafa', cursor: 'pointer' }}>
                <Text strong style={{ fontSize: 12 }}>第 {index + 1} 轴{axle.isSteering ? '（前转向轴）' : ''}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '4px 0 3px' }}><Text style={{ width: 88, fontSize: 11, flexShrink: 0 }}>距车头 (m)</Text><InputNumber value={axle.distanceFromFront} onChange={(v) => updateAxle(index, 'distanceFromFront', v ?? 0)} min={0} max={params.totalLength} step={0.1} size="small" style={{ flex: 1 }} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Text style={{ width: 88, fontSize: 11, flexShrink: 0 }}>转向轴</Text><Switch size="small" checked={axle.isSteering} onChange={(checked) => updateAxle(index, 'isSteering', checked)} /></div>
              </div>;
            })}
          </div>
        </Form.Item>

        <div style={{ fontWeight: 500, margin: '12px 0 8px', color: '#722ed1' }}>📐 半挂车</div>
        <div id="articulated-trailer-total-length" style={highlighted('trailer-total-length')}><Form.Item label="总长度 (m)"><InputNumber value={trailer.totalLength} onChange={(v) => changeTrailerTotalLength(v ?? 16)} min={5} max={50} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <Form.Item label="总宽度 (m)"><InputNumber value={trailer.totalWidth} onChange={(v) => updateTrailer({ totalWidth: v ?? 3 })} min={2} max={8} step={0.1} style={{ width: '100%' }} /></Form.Item>
        <div id="articulated-trailer-front-overhang" style={highlighted('trailer-front-overhang')}><Form.Item label="牵引销→挂车前端 (m)"><InputNumber value={trailer.frontOverhang} onChange={(v) => changeTrailerFrontExtension(v ?? 2)} min={0} max={12} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <div id="articulated-trailer-hitch-to-axle" style={highlighted('trailer-hitch-to-axle')}><Form.Item label="牵引销→等效轴组 (m)" tooltip="V2-1 的挂车运动学参考点；粉色虚线为该等效轴组中心。"><InputNumber value={params.trailerHitchToAxle} onChange={(v) => changeTrailerHitchToAxle(v ?? 11)} min={1} max={45} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        <div id="articulated-trailer-rear-overhang" style={highlighted('trailer-rear-overhang')}><Form.Item label="等效轴组→车尾 (m)"><InputNumber value={trailer.rearOverhang} onChange={(v) => changeTrailerRearOverhang(v ?? 2)} min={0} max={12} step={0.1} style={{ width: '100%' }} /></Form.Item></div>
        {Math.abs(trailerDimensionLength - trailer.totalLength) > 0.05 && <Alert type="warning" showIcon style={{ marginBottom: 10, fontSize: 12 }} message={`挂车尺寸链为 ${trailerDimensionLength.toFixed(1)} m，与总长度不一致；请调整上述三段尺寸。`} />}
        <Form.Item label="后轴组转向"><Select value={trailer.steeringMode} onChange={(value) => updateTrailer({ steeringMode: value })} options={[
          { value: 'fixed', label: '固定轴组（当前支持）' },
          { value: 'passive_linked', label: '被动随动（V2-1A）', disabled: true },
          { value: 'active_linked', label: '主动联动（V2-1A）', disabled: true },
          { value: 'active_commanded', label: '独立控制（后续）', disabled: true },
        ]} /></Form.Item>
        <Alert type="info" showIcon style={{ marginBottom: 10, fontSize: 12 }} message="V2-1 仅模拟固定挂车轴组；可转向轴需厂家曲线或实测资料后，在 V2-1A 单独验证。" />

        <Form.Item label="挂车实际轴配置">
          <div style={{ width: '100%' }}>
            {trailer.axles.map((axle, index) => {
              const target = `trailer-axle-${index}`;
              return <div id={`articulated-${target}`} key={target} onClick={() => select(target)} style={{ border: selectedTarget === target ? '1px solid #fa8c16' : '1px solid #d9d9d9', borderRadius: 6, padding: '6px 8px', marginBottom: 6, background: selectedTarget === target ? '#fff7e6' : '#fafafa', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><Text strong style={{ fontSize: 12 }}>第 {index + 1} 轴</Text>{trailer.axles.length > 1 && <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); removeTrailerAxle(index); }} />}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}><Text style={{ width: 84, fontSize: 11, flexShrink: 0 }}>距挂车前端 (m)</Text><InputNumber value={axle.distanceFromFront} onChange={(v) => updateTrailerAxle(index, 'distanceFromFront', v ?? 0)} min={0} max={trailer.totalLength} step={0.1} size="small" style={{ flex: 1 }} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Text style={{ width: 84, fontSize: 11, flexShrink: 0 }}>轮距 (m)</Text><InputNumber value={axle.trackWidth} onChange={(v) => updateTrailerAxle(index, 'trackWidth', v ?? 2.5)} min={1} max={trailer.totalWidth + 2} step={0.1} size="small" style={{ flex: 1 }} /></div>
              </div>;
            })}
            <Button type="dashed" block size="small" icon={<PlusOutlined />} onClick={addTrailerAxle} disabled={trailer.axles.length >= 10}>添加挂车轴</Button>
          </div>
        </Form.Item>
        <Form.Item wrapperCol={{ offset: 11, span: 13 }}><Button type="primary" size="small" onClick={() => message.success('铰接车参数已保存')}>应用参数</Button></Form.Item>
      </Form>
    </div>
  );
};

export default ArticulatedVehicleForm;
