/**
 * 道路导入面板
 * 支持 DWG/DXF 文件拖拽上传，自动解析并渲染道路
 *
 * CAD 图层建议：
 *   【推荐】3 图层模式：道路中线 / 道路左边线 / 道路右边线 — 各一个图层
 *   2 图层模式：道路中线一个图层 + 道路边线一个图层（含左右两条独立多段线）
 */

import React, { useState } from 'react';
import {
  Upload,
  Button,
  Space,
  Typography,
  Divider,
  Alert,
  Tag,
  Spin,
  Select,
} from 'antd';
import {
  FileAddOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useRoadStore } from '../../store';
import { readRoadFile, previewRoadFile } from '../../core/dwg';
import { pathLength } from '../../core/geometry/path';
import type { CadUnit } from '../../core/geometry/types';

const { Text, Paragraph } = Typography;

const RoadImportButton: React.FC = () => {
  const isLoaded = useRoadStore((s) => s.isLoaded);
  const isLoading = useRoadStore((s) => s.isLoading);
  const error = useRoadStore((s) => s.error);
  const importedFileName = useRoadStore((s) => s.importedFileName);
  const parsedDrawing = useRoadStore((s) => s.parsedDrawing);

  const setRoadData = useRoadStore((s) => s.setRoadData);
  const setParsedDrawing = useRoadStore((s) => s.setParsedDrawing);
  const setImportedFileName = useRoadStore((s) => s.setImportedFileName);
  const setLoading = useRoadStore((s) => s.setLoading);
  const setError = useRoadStore((s) => s.setError);
  const clearRoadData = useRoadStore((s) => s.clearRoadData);

  const [parsingStage, setParsingStage] = useState<string>('');
  const [sourceUnit, setSourceUnit] = useState<'auto' | CadUnit>('auto');

  /** 处理文件导入 */
  const handleFileImport = async (file: File) => {
    setLoading(true);
    setError(null);
    setParsedDrawing(null);
    setParsingStage('正在读取文件...');

    try {
      // 第一步：预览解析（获取图层信息）
      setParsingStage('正在解析图层...');
      const drawing = await previewRoadFile(file);
      setParsedDrawing(drawing);
      setImportedFileName(file.name);

      // 第二步：自动转换为 RoadGeometry
      setParsingStage('正在生成道路几何...');
      const roadGeometry = await readRoadFile(file, {
        sourceUnit: sourceUnit === 'auto' ? undefined : sourceUnit,
      });
      setRoadData(roadGeometry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setError(msg);
      console.error('道路导入失败:', err);
    } finally {
      setLoading(false);
      setParsingStage('');
    }

    return false; // 阻止 Upload 组件的默认上传行为
  };

  /** 重新选择文件 */
  const handleReset = () => {
    clearRoadData();
    setParsedDrawing(null);
    setImportedFileName(null);
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <Paragraph style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        导入 CAD 道路文件（DWG/DXF），自动识别图层并渲染道路。
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {!isLoaded && (
          <div>
            <Text style={{ fontSize: 13 }}>CAD 坐标单位：</Text>
            <Select
              value={sourceUnit}
              onChange={setSourceUnit}
              size="small"
              style={{ width: '100%', marginTop: 4 }}
              options={[
                { value: 'auto', label: '自动识别（未标注时按米）' },
                { value: 'm', label: '米（m）' },
                { value: 'mm', label: '毫米（mm）' },
              ]}
            />
          </div>
        )}
        {/* 上传区域 - 已加载时隐藏 */}
        {!isLoaded && (
          <Upload.Dragger
            accept=".dwg,.dxf"
            maxCount={1}
            beforeUpload={handleFileImport}
            showUploadList={false}
            disabled={isLoading}
          >
            {isLoading ? (
              <div style={{ padding: '12px 0' }}>
                <Spin size="default" />
                <p style={{ marginTop: 8, fontSize: 13, color: '#999' }}>
                  {parsingStage || '正在处理...'}
                </p>
              </div>
            ) : (
              <>
                <p className="ant-upload-drag-icon">
                  <FileAddOutlined style={{ fontSize: 36, color: '#1677ff' }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 14 }}>
                  点击或拖拽文件到此区域
                </p>
                <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                  支持 DWG (AutoCAD 2012-2022) 和 DXF 格式
                </p>
              </>
            )}
          </Upload.Dragger>
        )}

        {/* 已加载状态 */}
        {isLoaded && (
          <Alert
            message={
              <Space>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <span>道路已加载</span>
              </Space>
            }
            description={
              <div>
                <Text style={{ fontSize: 12 }}>
                  文件名：{importedFileName}
                </Text>
                <br />
                <Text style={{ fontSize: 12 }}>
                  道路长度：{computeRoadLength()} | 图纸单位：
                  {useRoadStore.getState().roadData?.sourceUnits === 'mm' ? '毫米' : '米'}（已统一换算为米）
                </Text>
                <br />
                {parsedDrawing && parsedDrawing.layers.length >= 3 && (
                  <Text style={{ fontSize: 11, color: '#52c41a' }}>
                    ✅ 已自动识别为 3 图层模式（中线 + 左边线 + 右边线）
                  </Text>
                )}
                {parsedDrawing && parsedDrawing.layers.length === 2 && (
                  <Text style={{ fontSize: 11, color: '#faad14' }}>
                    ⚠️ 2 图层模式，已自动分离左右边线。建议在 CAD 中使用 3 个图层以获得最准确结果。
                  </Text>
                )}
              </div>
            }
            type="success"
            showIcon={false}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleReset}
              >
                重新导入
              </Button>
            }
          />
        )}

        {/* 图层信息 */}
        {parsedDrawing && isLoaded && (
          <div
            style={{
              background: '#fafafa',
              borderRadius: 6,
              padding: '8px 12px',
            }}
          >
            <Text style={{ fontSize: 12, color: '#999' }}>
              <InfoCircleOutlined /> 识别到的图层：
            </Text>
            <div style={{ marginTop: 4 }}>
              {parsedDrawing.layers.map((layer) => {
                const entityCount =
                  parsedDrawing.entitiesByLayer[layer]?.length || 0;
                const totalVerts =
                  parsedDrawing.entitiesByLayer[layer]?.reduce(
                    (sum, e) => sum + e.vertices.length,
                    0
                  ) ?? 0;
                return (
                  <Tag key={layer} style={{ marginBottom: 4, fontSize: 11 }}>
                    {layer}
                    <span style={{ color: '#999' }}>
                      {' '}
                     （{entityCount}实体/{totalVerts}顶点）
                    </span>
                  </Tag>
                );
              })}
            </div>
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <Alert
            message="导入失败"
            description={
              <div>
                <p>{error}</p>
                <Divider style={{ margin: '8px 0' }} />
                <Text style={{ fontSize: 12, color: '#666' }}>
                  <strong>常见解决方法：</strong>
                  <br />
                  1. 确保 CAD 中有至少 2 个图层（中线 + 边线）
                  <br />
                  2. <strong>推荐</strong>：在 CAD 中分成 3 个图层 ——
                  「道路中线」「道路左边线」「道路右边线」
                  <br />
                  3. 如果 DWG 解析失败，用 <Text code>DXFOUT</Text> 导出 DXF 重试
                </Text>
              </div>
            }
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}

        <Divider style={{ margin: '8px 0' }} />

        <div style={{ fontSize: 13, color: '#999' }}>
          <Text strong>💡 提示：</Text>
          推荐在 CAD 中将道路分为{' '}
          <Text code>道路中线</Text>、<Text code>道路左边线</Text>、<Text code>道路右边线</Text>{' '}
          三个独立图层，识别最准确。
        </div>
      </Space>
    </div>
  );
};

/**
 * 计算已加载道路的中线长度
 */
function computeRoadLength(): string {
  const state = useRoadStore.getState();
  const centerline = state.roadData?.centerline;
  if (!centerline || centerline.length === 0) return '--';

  const len = pathLength(centerline);
  return len.toFixed(1) + ' m';
}

export default RoadImportButton;
