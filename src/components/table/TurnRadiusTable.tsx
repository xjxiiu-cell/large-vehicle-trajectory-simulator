/**
 * 转弯半径-道路宽度计算表
 * 阶段 3 实现自动计算逻辑
 */

import React from 'react';
import { Table, InputNumber, Button, Space, Typography, Divider, Empty, Alert } from 'antd';
import { CalculatorOutlined } from '@ant-design/icons';
import { useSimulationStore, useVehicleStore } from '../../store';
import { generateRadiusWidthTable } from '../../core/vehicle';

const { Paragraph, Text } = Typography;

const TurnRadiusTable: React.FC = () => {
  const maxRadius = useSimulationStore((s) => s.maxRadius);
  const setMaxRadius = useSimulationStore((s) => s.setMaxRadius);
  const radiusTable = useSimulationStore((s) => s.radiusTable);
  const setRadiusTable = useSimulationStore((s) => s.setRadiusTable);

  const vehicleConfigured = useVehicleStore((s) => s.isConfigured);
  const params = useVehicleStore((s) => s.params);

  const handleCalculate = () => {
    const table = generateRadiusWidthTable(params, maxRadius);
    setRadiusTable(table);
  };

  const columns = [
    {
      title: '转弯半径 (m)',
      dataIndex: 'radius',
      key: 'radius',
      width: 120,
      align: 'right' as const,
      render: (v: number, _: unknown, idx: number) =>
        idx === 0 ? `${v}（最小）` : v,
    },
    {
      title: '所需道路宽度 (m)',
      dataIndex: 'width',
      key: 'width',
      align: 'right' as const,
      render: (v: number) => v.toFixed(2),
    },
  ];

  return (
    <div style={{ padding: '8px 0' }}>
      <Paragraph style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        根据车辆参数自动计算不同转弯半径下所需的最小道路宽度。
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>最大半径 (m)：</Text>
          <InputNumber
            value={maxRadius}
            onChange={(v) => setMaxRadius(v ?? 100)}
            min={10}
            max={500}
            step={5}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<CalculatorOutlined />}
            onClick={handleCalculate}
            disabled={!vehicleConfigured}
            size="small"
          >
            计算
          </Button>
        </div>

        {!vehicleConfigured && (
          <div style={{ fontSize: 12, color: '#999' }}>
            请先在「车辆参数」中配置车辆
          </div>
        )}

        <Divider style={{ margin: '4px 0' }} />

        {radiusTable ? (
          <>
            {radiusTable.minRadius === 0 ? (
              <Alert
                type="warning"
                message="该车辆未配置转向轴，只能直线行驶，无法生成转弯半径表。"
                style={{ fontSize: 12, marginBottom: 8 }}
              />
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                  车辆：{radiusTable.vehicleName} | 最小转弯半径：
                  <Text strong>{radiusTable.minRadius} m</Text>
                </div>
                <Table
                  dataSource={radiusTable.entries}
                  columns={columns}
                  rowKey="radius"
                  size="small"
                  pagination={false}
                  scroll={{ y: 300 }}
                  bordered
                />
              </>
            )}
          </>
        ) : (
          <Empty
            description="点击「计算」生成转弯半径表"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Space>
    </div>
  );
};

export default TurnRadiusTable;
