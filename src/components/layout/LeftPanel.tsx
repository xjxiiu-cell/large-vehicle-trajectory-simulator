/**
 * 左侧参数面板，包含 Tab 页签
 */

import React from 'react';
import { Tabs } from 'antd';
import {
  CarOutlined,
  UploadOutlined,
  PlayCircleOutlined,
  TableOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useUIStore } from '../../store';
import VehiclePanel from '../vehicle/VehiclePanel';
import RoadPanel from '../road/RoadPanel';
import SimulationControls from '../simulation/SimulationControls';
import TurnRadiusTable from '../table/TurnRadiusTable';
import ExportPanel from '../export/ExportPanel';

const LeftPanel: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const items = [
    {
      key: 'vehicle',
      label: (
        <span>
          <CarOutlined /> 车辆参数
        </span>
      ),
      children: <VehiclePanel />,
    },
    {
      key: 'road',
      label: (
        <span>
          <UploadOutlined /> 道路导入
        </span>
      ),
      children: <RoadPanel />,
    },
    {
      key: 'simulation',
      label: (
        <span>
          <PlayCircleOutlined /> 模拟控制
        </span>
      ),
      children: <SimulationControls />,
    },
    {
      key: 'table',
      label: (
        <span>
          <TableOutlined /> 转弯半径表
        </span>
      ),
      children: <TurnRadiusTable />,
    },
    {
      key: 'export',
      label: (
        <span>
          <ExportOutlined /> 结果导出
        </span>
      ),
      children: <ExportPanel />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={items}
      tabPosition="top"
      size="small"
      style={{ padding: '0 8px', height: '100%' }}
      tabBarStyle={{ marginBottom: 0 }}
    />
  );
};

export default LeftPanel;
