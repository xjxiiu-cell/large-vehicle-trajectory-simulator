/**
 * 车辆参数面板：类型选择 + 条件表单 + 预览图
 */

import React, { useState } from 'react';
import { Radio, Divider } from 'antd';
import { useVehicleStore } from '../../store';
import type { VehicleType } from '../../core/geometry/types';
import RigidVehicleForm from './RigidVehicleForm';
import ArticulatedVehicleForm from './ArticulatedVehicleForm';
import VehiclePreview from './VehiclePreview';

const VehiclePanel: React.FC = () => {
  const vehicleType = useVehicleStore((s) => s.params.type);
  const setType = useVehicleStore((s) => s.setType);
  // 示意图与参数表单共享当前选中的尺寸/轴位，确保用户点到哪里就改到哪里。
  const [selectedTarget, setSelectedTarget] = useState<string | undefined>();

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ marginRight: 8, fontWeight: 500 }}>车辆类型：</span>
        <Radio.Group
          value={vehicleType}
          onChange={(e) => setType(e.target.value as VehicleType)}
          optionType="button"
          buttonStyle="solid"
          size="middle"
        >
          <Radio.Button value="rigid">刚性车辆</Radio.Button>
          <Radio.Button value="articulated">牵引车+挂车</Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* 车辆 2D 示意图 */}
      <VehiclePreview selectedTarget={selectedTarget} onSelectTarget={setSelectedTarget} />

      <Divider style={{ margin: '8px 0' }} />

      {/* 参数表单：根据类型切换 */}
      {vehicleType === 'rigid' ? (
        <RigidVehicleForm />
      ) : (
        <ArticulatedVehicleForm selectedTarget={selectedTarget} onSelectTarget={setSelectedTarget} />
      )}
    </div>
  );
};

export default VehiclePanel;
