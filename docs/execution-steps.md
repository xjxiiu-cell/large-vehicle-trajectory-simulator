# 执行步骤

## 阶段 1：基础搭建 ✅ (2026-06-18)

### 1.1 项目初始化
- [x] 初始化 Vite + React + TypeScript 项目
- [x] 安装依赖：antd, @ant-design/icons, react-konva, konva, zustand
- [x] 创建项目目录结构

### 1.2 文档体系
- [x] 创建 `/docs/requirements.md`
- [x] 创建 `/docs/tech-spec.md`
- [x] 创建 `/docs/design-standards.md`
- [x] 创建 `/docs/execution-steps.md`

### 1.3 开发基础设施
- [x] 创建 `/devlog/` 及自动日志工具
- [x] 创建/更新 CLAUDE.md

### 1.4 核心代码
- [x] 配置 Ant Design 淡蓝色主题 (`src/theme.ts`)
- [x] 实现几何类型系统 (`src/core/geometry/types.ts`)
- [x] 实现 2D 变换函数 (`src/core/geometry/transform.ts`)
- [x] 实现线段求交 (`src/core/geometry/intersect.ts`)
- [x] 实现多边形工具 (`src/core/geometry/polygon.ts`)
- [x] 实现平行偏移 (`src/core/geometry/offset.ts`)
- [x] 搭建 AppLayout 布局 (`src/components/layout/`)
- [x] 构建车辆类型选择组件
- [x] 构建刚性车参数表单
- [x] 构建铰接车参数表单（简化版）
- [x] 构建车辆示意图预览 (SVG)
- [x] 设置 Zustand Store 骨架（4个 store）

---

## 阶段 2：道路导入 ✅ (2026-06-18)

### 2.1 DWG/DXF 解析引擎
- [x] 安装 `dxf-parser` DXF 解析库
- [x] 安装 `@mlightcad/libredwg-web` DWG WASM 解析库
- [x] 创建 `src/core/dwg/types.ts` 内部类型定义
- [x] 创建 `src/core/dwg/dxfParser.ts` DXF 解析器
- [x] 创建 `src/core/dwg/dwgParser.ts` DWG WASM 解析器
- [x] 创建 `src/core/dwg/converter.ts` 实体→RoadGeometry 转换器
- [x] 创建 `src/core/dwg/reader.ts` 主入口（格式检测+解析+转换）
- [x] 创建 `src/core/dwg/index.ts` 统一导出

### 2.2 文件导入组件
- [x] 更新 `RoadImportButton.tsx` — 接入真实解析流程
- [x] 创建 `RoadPanel.tsx` — 导入按钮+图层可见性切换
- [x] 更新 `roadStore.ts` — 增加图层预览状态
- [x] 更新 `LeftPanel.tsx` — 使用 RoadPanel

### 2.3 道路画布渲染
- [x] 更新 `RoadCanvas.tsx` — 渲染中线（蓝色虚线）、边线（红/绿）
- [x] 实现世界坐标→屏幕坐标自适应适配
- [x] 实现滚轮缩放（以鼠标位置为中心）
- [x] 实现画布拖拽平移
- [x] 添加起点/终点文字标记

### 2.4 基础设施
- [x] 复制 WASM 文件到 public/
- [x] 更新 Vite 配置（assetsInclude, optimizeDeps）
- [x] TypeScript 编译零错误
- [x] Vite 开发服务器正常启动

### 2.5 修复：边线分离算法重写 (2026-06-18)
- [x] 边线分离由"逐点分类"改为"按多段线整体分类"
- [x] 新增 3 图层模式支持（中线/左边线/右边线）
- [x] 图层自动检测支持 3 图层识别

### 2.6 修复：圆弧精度提升 (2026-06-18)
- [x] 新增 Path 类型系统（StraightPathSegment + ArcPathSegment）
- [x] 中线保留圆弧原始参数，渲染时动态离散化
- [x] 新增 pathToPolyline / pathLength / pointOnPath 工具函数

### 2.7 修复：多段线 bulge 支持 (2026-06-22)
- [x] DXF/DWG 解析器保留多段线 bulge 值
- [x] 新增 bulgeToArcSegment() 凸度→圆弧转换函数
- [x] buildCenterlinePath 支持 bulge 弧段
- [x] 边线提取使用 bulge 高精度离散化

### 2.8 修复：顺时针圆弧方向修正 (2026-06-22)
- [x] discretizeArcFromParams 新增 clockwise 参数
- [x] 顺时针弧确保 span 为负（角度递减）
- [x] 修复 bulge<0 时边线圆弧渲染在反侧的问题

---

## 阶段 3：运动学引擎 ✅ (2026-06-22)

### 3.1 Ackermann 转向运动学
- [x] 车辆角点计算（非对称矩形，参考点为最后轴中心）
- [x] 最小转弯半径计算（多轴 Ackermann）
- [x] 路径位姿定位（pointOnPathInfo 返回段类型和转弯半径）
- [x] `src/core/vehicle/ackermann.ts`
- [x] `src/core/vehicle/index.ts`

### 3.2 转弯半径-宽度表
- [x] 自动计算最小转弯半径
- [x] 半径表生成（R_min 上取整 5m → 每 5m 递增 → maxRadius）
- [x] 稳态转弯所需路宽计算
- [x] `src/core/vehicle/turn-radius.ts`

### 3.3 模拟引擎
- [x] 沿中线步进（0.2m 步长，段索引缓存优化）
- [x] 行驶方向自动判定 + 反向行驶处理
- [x] 扫掠包络（所有角点 convexHull）
- [x] 冲突检测（包络边 vs 道路边线求交 + 顶点走廊判定）
- [x] `src/core/simulation/engine.ts`
- [x] `src/core/simulation/index.ts`

### 3.4 路径工具扩展
- [x] 新增 `PointOnPathInfo` 接口（segmentIndex, segmentType, turnRadius）
- [x] 新增 `pointOnPathInfo()` 函数（段索引缓存优化）
- [x] `src/core/geometry/path.ts`

### 3.5 动态轴编辑器
- [x] 增删轴按钮（最多 10 轴）
- [x] 每轴独立设置：距前端、轮距、是否转向（Switch）、最大转角（条件显示）
- [x] Store 新增 addAxle/removeAxle/updateAxle actions
- [x] `src/components/vehicle/RigidVehicleForm.tsx`
- [x] `src/store/vehicleStore.ts`

### 3.6 UI 连线
- [x] TurnRadiusTable 替换 mock 数据为 generateRadiusWidthTable()
- [x] SimulationControls 连线 runSimulation()，显示通过/不通过
- [x] VehiclePreview 轴渲染改用实际 trackWidth

### 3.7 暂缓
- [ ] 铰接车运动学（等刚性车跑通后再完善）

---

## 阶段 4：模拟可视化 ✅ (2026-06-22)

### 4.1 Canvas 模拟可视化层
- [x] 扫掠包络层（半透明淡蓝填充 + 虚线边框 Konva Line closed polygon）
- [x] 冲突标记层（红色 X 标记 + 冲突包络线段高亮）
- [x] 车辆当前位置层（橙色半透明矩形）
- [x] HTML 图例叠加层（Canvas 右下角）
- [x] `src/components/road/RoadCanvas.tsx`

### 4.2 逐步回放控制
- [x] 步骤 Slider（0 ~ totalSteps-1）
- [x] 步骤/里程信息显示
- [x] 回放按钮组（跳到开头/上一步/自动播放/下一步/跳到末尾）
- [x] 自动播放 + 速度选择（1×/2×/5×/10×）
- [x] `src/components/simulation/SimulationControls.tsx`

### 4.3 Store 扩展
- [x] 新增 showEnvelope / showConflicts / showVehicleAtStep 可见性状态
- [x] 新增对应 setter actions
- [x] 图层可见性 Switch 开关（模拟控制面板中）
- [x] `src/store/simulationStore.ts`

### 4.4 刚性车自动安全路线 ✅ (2026-08-27)
- [x] 在道路横向范围内生成候选位置，并以动态规划选择平顺路线
- [x] 将单侧 0.5m 净距和完整车身轮廓不碰边线作为硬约束
- [x] 保持原道路的行驶方向，在 0.2m 模拟步长上复核最终路线
- [x] 无连续安全路线时仍完成全程模拟、逐步回放与冲突标记；画布显示紫色虚线自动路线
- [x] 候选点改为受车辆最大转向角可达扇形约束，禁止将不可达位置以突变折线连接
- [x] 自动路线按首尾相切圆弧输出；复核失败时保留候选自动路线与冲突点，避免中线回退掩盖提前转向效果
- [x] 自动路线改为以前转向轴中心为控制点；依据前轴轨迹切线和曲率反算后轴位置、车身朝向及车身四角
- [x] 画布紫色虚线明确标为前转向轴路线，并以紫色圆点标出回放车辆的前转向轴中心
- [x] 去除直线/圆弧交接处的“原地换向”帧；前轮转角按有限变化率渐变，后轴以滚动积分连续推进
- [x] 新增 `npm run test` 前轴转向连续性回归检查：直线接圆弧时，后轴相邻帧位移不超过模拟步长量级
- [x] 使用 `test 文件/test-1.dwg` 与 `test 文件/test-2.dwg` 验证：当前 15.1m × 3.0m 车辆在约 342.8m 处无满足 0.5m 净距的连续路线

## 阶段 5：表格、导出与完善
（待启动）

## 阶段 6：稳定与预留
（待启动）

---

## V2：前轮转向牵引车 + 单半挂车 ✅（代码交付：2026-09-18）

### V2-1：连续运动学与参数交互
- [x] 建立牵引车后轴、两车朝向、实际前轮转角为唯一状态的连续积分器。
- [x] 第五轮与挂车等效轴组每帧由几何约束重建；显示牵引车前/后轴、第五轮和挂车轴组轨迹。
- [x] 参数示意图可点选轴、第五轮与尺寸段，并定位到对应输入项。

### V2-2：双车身安全与扫掠
- [x] 牵引车与半挂车分别按 0.1m 子步校核道路边线与单侧安全净距。
- [x] 冲突标记携带牵引车/半挂车归属；两车身分别形成连续扫掠片段。

### V2-3：自动安全路线
- [x] 建立只前进的铰接车 Hybrid A*；状态包含牵引车后轴、两车朝向和实际前轮转角。
- [x] 无解时只保留最远真实连续轨迹，不生成后续中线伪轨迹。
- [x] 修正进弯前候选被剪枝造成的中途假无解风险。

### V2-4：交付验证与同步
- [x] 增加半挂车直线入弯、双车身校核的性能回归；本机基准为 5 秒内完成。
- [x] Worker 进度与取消计算复核；界面补充“几何模拟结果”工程提示。
- [x] 更新需求、技术规格、V2 开发计划与开发日志。
- [x] 单元测试、刚性车连续性/性能回归、半挂车性能回归和生产构建通过。
- [x] 用户确认 V2-4 图纸验收；固定挂车轴 V2 功能交付闭环。
- [ ] 可转向挂车轴 V2-1A：待取得目标车型转向机构资料后单独启动；未标定车型不得作为工程设计结论。

---

## 刚性车连续轨迹与安全路线重构 ✅ (2026-09-08)

- [x] 阶段 1：建立后轴状态、前轮转向速率限制和 0.1m 连续积分；画布同时显示前/后轴实际轨迹。
- [x] 阶段 2：建立道路安全走廊，以完整车身轮廓判定碰撞与单侧净距；扫掠改为相邻轮廓片段。
- [x] 阶段 3：以只前进的 Hybrid A* 取代横向选点规划；无解时仅保留真实连续可执行部分。
- [x] 阶段 4：自动计算移入 Web Worker；增加规划与复核进度、真实取消和长道路提示；添加 Vitest 单元测试与性能回归入口。
- [x] 生产构建、连续性回归和性能回归通过。

### 验收边界

- [ ] 用户以实际 DWG/DXF 在直线、左弯、右弯、反向导入情况下完成最终工程复核。
- [ ] 在实际项目图纸验收前，界面结果仅作为“几何模拟结果”，不作为最终工程设计结论。
