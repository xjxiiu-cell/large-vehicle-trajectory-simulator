/**
 * 应用主布局：左侧面板 + 右侧画布
 */

import React from 'react';
import { Layout } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useUIStore } from '../../store';
import LeftPanel from './LeftPanel';
import RoadCanvas from '../road/RoadCanvas';

const { Header, Sider, Content } = Layout;

const AppLayout: React.FC = () => {
  const siderCollapsed = useUIStore((s) => s.siderCollapsed);
  const toggleSider = useUIStore((s) => s.toggleSider);

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 顶部栏 */}
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          height: 48,
          lineHeight: '48px',
          zIndex: 10,
        }}
      >
        <span
          onClick={toggleSider}
          style={{ cursor: 'pointer', fontSize: 16, marginRight: 12 }}
        >
          {siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: '#1677ff',
          }}
        >
          🚛 大型车辆轨迹模拟系统
        </h1>
      </Header>

      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        {/* 左侧参数面板 */}
        <Sider
          width={380}
          collapsedWidth={0}
          collapsed={siderCollapsed}
          theme="light"
          style={{
            borderRight: '1px solid #f0f0f0',
            overflow: 'hidden',
          }}
          zeroWidthTriggerStyle={{ top: 8 }}
        >
          <LeftPanel />
        </Sider>

        {/* 右侧画布区域 */}
        <Content
          style={{
            position: 'relative',
            background: '#f5f5f5',
            overflow: 'hidden',
          }}
        >
          <RoadCanvas />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
