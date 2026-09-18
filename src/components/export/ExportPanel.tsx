/**
 * 结果导出面板
 * 阶段 5 实现 DWG/DXF 导出功能
 */

import React from 'react';
import { Button, Space, Typography, Divider, Radio } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useSimulationStore } from '../../store';

const { Paragraph, Text } = Typography;

const ExportPanel: React.FC = () => {
  const status = useSimulationStore((s) => s.status);
  const hasResult = status === 'completed';

  return (
    <div style={{ padding: '8px 0' }}>
      <Paragraph style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        将扫掠包络线导出为 CAD 格式，可在 AutoCAD 中打开叠加到原始道路图上。
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text style={{ fontSize: 13 }}>导出格式：</Text>
          <Radio.Group defaultValue="dxf" size="small" style={{ marginTop: 4 }}>
            <Radio.Button value="dxf">DXF（推荐）</Radio.Button>
            <Radio.Button value="dwg" disabled>
              DWG（需要服务端转换）
            </Radio.Button>
          </Radio.Group>
        </div>

        <div style={{ fontSize: 12, color: '#999' }}>
          导出内容：扫掠包络线、冲突区域（如有）
        </div>

        <Button
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!hasResult}
          block
        >
          {hasResult ? '导出 DXF 文件' : '请先完成模拟'}
        </Button>

        <Divider style={{ margin: '4px 0' }} />

        <div style={{ fontSize: 12, color: '#999' }}>
          <Text strong>提示：</Text>
          导出的 DXF 文件可在 AutoCAD 2012-2022 中通过
          <Text code>DXFIN</Text> 命令导入。
        </div>
      </Space>
    </div>
  );
};

export default ExportPanel;
