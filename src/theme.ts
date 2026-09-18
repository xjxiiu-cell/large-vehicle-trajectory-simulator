/**
 * Ant Design 淡蓝色主题配置
 */

import type { ThemeConfig } from 'antd';

const theme: ThemeConfig = {
  token: {
    // 主色：淡蓝色
    colorPrimary: '#1677ff',
    // 信息色
    colorInfo: '#1677ff',
    // 成功色
    colorSuccess: '#52c41a',
    // 警告色
    colorWarning: '#faad14',
    // 错误色
    colorError: '#ff4d4f',
    // 圆角
    borderRadius: 6,
    // 字体
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`,
    // 背景色
    colorBgLayout: '#f0f5ff',
    colorBgContainer: '#ffffff',
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      triggerBg: '#e6f4ff',
      triggerColor: '#1677ff',
    },
    Menu: {
      itemSelectedBg: '#e6f4ff',
      itemSelectedColor: '#1677ff',
    },
  },
};

export default theme;
