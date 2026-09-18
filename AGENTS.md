# AGENTS.md — 大型车辆轨迹模拟软件

## 项目简介

网页端大型车辆行驶轨迹模拟工具，用于风力发电道路设计。模拟 20-40m 超长车辆在 5km/h 下的行驶轨迹，支持 DWG 导入导出。

## 关键文件路径

### 标准文档 (`/docs/`)
- [需求文档](docs/requirements.md) — 功能需求、用户操作流程
- [技术规格](docs/tech-spec.md) — 技术栈、架构、算法、数据 Schema
- [设计规范](docs/design-standards.md) — 颜色、布局、组件规范
- [执行步骤](docs/execution-steps.md) — 各阶段任务清单及进度

### 开发日志 (`/devlog/`)
- 每日自动记录，文件命名格式：`YYYY-MM-DD.md`
- 日志工具：`src/utils/devlog.ts`

### 源代码 (`/src/`)
```
src/
├── core/           ← 纯逻辑层（无 UI 依赖）
│   ├── geometry/   ← 几何类型、变换、求交、多边形
│   ├── vehicle/    ← 车辆运动学（Ackermann、铰接车）
│   ├── dwg/        ← DWG/DXF 读写解析
│   └── simulation/ ← 模拟引擎、碰撞检测
├── components/     ← React 组件
│   ├── layout/     ← 布局组件
│   ├── vehicle/    ← 车辆参数表单
│   ├── road/       ← 道路画布
│   ├── simulation/ ← 模拟控制
│   ├── table/      ← 半径-宽度表
│   └── export/     ← 导出面板
├── store/          ← Zustand 状态管理
├── hooks/          ← 自定义 React Hooks
└── utils/          ← 工具函数
```

## 工作原则

1. **分阶段推进**：每阶段产出可运行成果，不一口气做完
2. **先刚性车后铰接车**：降低复杂度
3. **核心逻辑与 UI 分离**：`core/` 下所有代码必须是纯函数，不依赖 React
4. **DWG 优先 DXF 备用**：WASM 读取 DWG，失败时回退到 DXF
5. **代码注释使用中文**：方便非专业开发者后续理解
6. **每天更新开发日志**：调用 `src/utils/devlog.ts` 记录进展
7. **修改任何标准文档前先阅读对应文件**

## 技术要点

- 3D 预留：Point 类型携带可选 `z` 坐标，车辆参数预留 `clearance`/`tireRadius`
- 主题色 `#1677ff`（淡蓝），使用 Ant Design ConfigProvider
- Canvas 使用 Konva 多层架构：grid → road → envelope → conflict
- 状态管理使用 Zustand，分 vehicle/road/simulation/ui 四个 store

## 常用命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 生产构建
npm run preview  # 预览生产构建
npm run test     # 运行测试（后续配置）
```
