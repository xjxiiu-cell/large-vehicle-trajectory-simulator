/**
 * 刚性车辆参数表单
 */

import React from 'react';
import { Form, InputNumber, Select, Button, Switch, Typography, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useVehicleStore } from '../../store';
import type { SteeringType } from '../../core/geometry/types';

const { Text } = Typography;

const RigidVehicleForm: React.FC = () => {
  const params = useVehicleStore((s) => s.params);
  const {
    setTotalLength,
    setTotalWidth,
    setFrontOverhang,
    setRearOverhang,
    setSteeringType,
    setMaxSteerAngle,
    setMaxSteeringRate,
    addAxle,
    removeAxle,
    updateAxle,
  } = useVehicleStore();

  const handleApply = () => {
    message.success('车辆参数已保存');
  };

  return (
    <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
      <Form layout="horizontal" size="small" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }}>
        <Form.Item label="总长度 (m)">
          <InputNumber
            value={params.totalLength}
            onChange={(v) => setTotalLength(v ?? 15)}
            min={5}
            max={50}
            step={0.1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="总宽度 (m)">
          <InputNumber
            value={params.totalWidth}
            onChange={(v) => setTotalWidth(v ?? 3)}
            min={2}
            max={10}
            step={0.1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="前悬 (m)">
          <InputNumber
            value={params.frontOverhang}
            onChange={(v) => setFrontOverhang(v ?? 1.5)}
            min={0}
            max={10}
            step={0.1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="后悬 (m)">
          <InputNumber
            value={params.rearOverhang}
            onChange={(v) => setRearOverhang(v ?? 2)}
            min={0}
            max={10}
            step={0.1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="转向方式">
          <Select
            value={params.steeringType}
            onChange={(v) => setSteeringType(v as SteeringType)}
            options={[
              { value: 'front', label: '前轮转向' },
              { value: 'all-wheel', label: '全轮转向' },
            ]}
          />
        </Form.Item>

        <Form.Item label="最大转向角 (°)">
          <InputNumber
            value={params.maxSteerAngle}
            onChange={(v) => setMaxSteerAngle(v ?? 35)}
            min={10}
            max={60}
            step={1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="转向变化率 (°/s)" tooltip="车辆以 5 km/h 行驶时，前轮转角每秒允许变化的最大值。">
          <InputNumber
            value={params.maxSteeringRateDegPerSec}
            onChange={(v) => setMaxSteeringRate(v ?? 10)}
            min={1}
            max={90}
            step={1}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="轴配置">
          <div style={{ width: '100%' }}>
            {params.axles.map((axle, idx) => (
              <div
                key={idx}
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 6,
                  padding: '6px 8px',
                  marginBottom: 6,
                  background: '#fafafa',
                }}
              >
                {/* 轴标题行 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <Text strong style={{ fontSize: 12 }}>
                    第 {idx + 1} 轴
                  </Text>
                  {params.axles.length > 1 && (
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => removeAxle(idx)}
                    />
                  )}
                </div>

                {/* 距前端距离 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 3,
                  }}
                >
                  <Text style={{ width: 72, fontSize: 11, flexShrink: 0 }}>
                    距前端 (m)
                  </Text>
                  <InputNumber
                    value={axle.distanceFromFront}
                    onChange={(v) =>
                      updateAxle(idx, 'distanceFromFront', v ?? 0)
                    }
                    min={0}
                    max={params.totalLength}
                    step={0.1}
                    size="small"
                    style={{ flex: 1 }}
                  />
                </div>

                {/* 轮距 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 3,
                  }}
                >
                  <Text style={{ width: 72, fontSize: 11, flexShrink: 0 }}>
                    轮距 (m)
                  </Text>
                  <InputNumber
                    value={axle.trackWidth}
                    onChange={(v) =>
                      updateAxle(idx, 'trackWidth', v ?? 2.5)
                    }
                    min={1}
                    max={params.totalWidth + 2}
                    step={0.1}
                    size="small"
                    style={{ flex: 1 }}
                  />
                </div>

                {/* 转向开关 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 3,
                  }}
                >
                  <Text style={{ fontSize: 11 }}>转向轴</Text>
                  <Switch
                    size="small"
                    checked={axle.isSteering}
                    onChange={(checked) =>
                      updateAxle(idx, 'isSteering', checked)
                    }
                  />
                </div>

                {/* 最大转向角（条件显示） */}
                {axle.isSteering && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ width: 72, fontSize: 11, flexShrink: 0 }}>
                      最大转角 (°)
                    </Text>
                    <InputNumber
                      value={axle.maxSteerAngle ?? params.maxSteerAngle}
                      onChange={(v) =>
                        updateAxle(idx, 'maxSteerAngle', v ?? 35)
                      }
                      min={5}
                      max={60}
                      step={1}
                      size="small"
                      style={{ flex: 1 }}
                    />
                  </div>
                )}
              </div>
            ))}

            <Button
              type="dashed"
              block
              size="small"
              icon={<PlusOutlined />}
              onClick={addAxle}
              disabled={params.axles.length >= 10}
            >
              添加轴
            </Button>
          </div>
        </Form.Item>

        <Form.Item wrapperCol={{ offset: 10, span: 14 }}>
          <Button type="primary" onClick={handleApply} size="small">
            应用参数
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default RigidVehicleForm;
