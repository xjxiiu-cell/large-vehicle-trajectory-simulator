/**
 * 道路面板
 * 组合导入按钮 + 图层可见性切换
 */

import React from 'react';
import { Switch, Space, Typography, Divider } from 'antd';
import { useRoadStore } from '../../store';
import RoadImportButton from './RoadImportButton';

const { Text } = Typography;

const RoadPanel: React.FC = () => {
  const isLoaded = useRoadStore((s) => s.isLoaded);
  const showCenterline = useRoadStore((s) => s.showCenterline);
  const showLeftEdge = useRoadStore((s) => s.showLeftEdge);
  const showRightEdge = useRoadStore((s) => s.showRightEdge);
  const setShowCenterline = useRoadStore((s) => s.setShowCenterline);
  const setShowLeftEdge = useRoadStore((s) => s.setShowLeftEdge);
  const setShowRightEdge = useRoadStore((s) => s.setShowRightEdge);

  return (
    <div>
      <RoadImportButton />

      {/* 图层可见性切换 — 仅在道路加载后显示 */}
      {isLoaded && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong style={{ fontSize: 13 }}>
            图层显示
          </Text>
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: '#fafafa',
              borderRadius: 6,
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 2,
                      background: '#1677ff',
                      marginRight: 8,
                      verticalAlign: 'middle',
                      borderTop: '2px dashed #1677ff',
                    }}
                  />{' '}
                  道路中线
                </span>
                <Switch
                  size="small"
                  checked={showCenterline}
                  onChange={setShowCenterline}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 2,
                      background: '#ff4d4f',
                      marginRight: 8,
                      verticalAlign: 'middle',
                    }}
                  />{' '}
                  左侧边线
                </span>
                <Switch
                  size="small"
                  checked={showLeftEdge}
                  onChange={setShowLeftEdge}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 2,
                      background: '#52c41a',
                      marginRight: 8,
                      verticalAlign: 'middle',
                    }}
                  />{' '}
                  右侧边线
                </span>
                <Switch
                  size="small"
                  checked={showRightEdge}
                  onChange={setShowRightEdge}
                />
              </div>
            </Space>
          </div>
        </>
      )}
    </div>
  );
};

export default RoadPanel;
