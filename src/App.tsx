/**
 * 应用根组件
 * 配置 Ant Design 主题并渲染主布局
 */

import React from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import theme from './theme';
import AppLayout from './components/layout/AppLayout';

const App: React.FC = () => {
  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntApp>
        <AppLayout />
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
