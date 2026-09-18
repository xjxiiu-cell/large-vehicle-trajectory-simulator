# GitHub 车辆低速轨迹与扫掠包络开源实现调研

调研日期：2026-09-08。目标是为本项目的“刚性车、前转向轴控制、道路边线净距、扫掠包络”重构寻找可验证的算法与实现参考；**不是**直接把第三方项目整体嵌入现有 Web 工程。

## 先给结论

现有“先选出若干道路点，再把车身姿态反算出来”的路线不适合作为最终模型。它会在曲率或转向角切换处产生前、后轴不一致的问题。应改为以车辆状态 `(后轴位置, 车身航向, 转向角)` 和控制量 `(行驶距离, 转向角变化率)` 逐步积分；每一个候选动作都对完整车身轮廓做连续碰撞检查。这个判断直接对应 Hybrid A* 的运动原语做法，而非 UI 绘制问题。

建议下一开发阶段只借鉴并实现下列最小组合：

1. 采用 `auto-parking-sim` 的 Web 侧分层思路：运动学积分、规划、碰撞检查分开；但**不接入**其受限的学习模型。
2. 采用 PythonRobotics 的 Reeds–Shepp / Hybrid A* 作为公式、测试样例和搜索结构参考；因其是 Python，按 MIT 许可证在 TypeScript 中重新实现，不复制整套运行时。
3. 用前转向轴作为用户可见的“控制/跟踪点”，但规划内部状态仍以**后轴中心 + 车身航向 + 实际转向角**表示；前轴位置由该状态正向算出。这避免“前轴正确、后轴跳变”。
4. 碰撞不能仅检查轨迹折线或角点；每段运动原语按不大于 0.05–0.10 m 的弧长采样完整车辆多边形，并与“道路可行驶面（道路边线向内偏置 0.5 m 后形成的多边形）”做包含/相交检查。

本项目是前进风电运输道路验算，不需要倒车泊车的完整能力。第一阶段应只开放前进挡、有限转向角和有限转向角变化率；Reeds–Shepp 倒车能力保留为后续独立功能。

## 候选项目对比

| 项目 | 与本项目的直接关系 | 可借鉴内容 | 许可证与集成判断 | 主要风险 |
| --- | --- | --- | --- | --- |
| [pansong/auto-parking-sim](https://github.com/pansong/auto-parking-sim) | 浏览器端低速汽车完整链路；README 明确列出 Hybrid A*、轨迹优化、MPC 和运动学自行车模型 | `src/kinematics/ackermann.js`、`vehicle.js` 的逐步积分边界；`src/environment` 的场景/障碍物职责划分；规划—跟踪—碰撞分层 | 模拟器、规划器和可视化为 MIT，可作为 TypeScript/JavaScript 最接近的实现参考；其 `src/plant/` 学习动力学模型是 PolyForm Noncommercial，必须排除 | 项目面向乘用车泊车、3D 场景与倒车；不等于长大件运输车辆扫掠分析，不能原样用于工程结论 |
| [AtsushiSakai/PythonRobotics](https://github.com/AtsushiSakai/PythonRobotics) | 具有 2,228 次提交、测试目录和清晰教材的算法样例库 | `PathPlanning/HybridAStar` 的连续可行运动原语与离散搜索；Reeds–Shepp、状态格、Pure Pursuit/Stanley 的数学及测试用例 | MIT；适合按公式和结构重写为本项目纯 TypeScript `core/` 模块 | 它是教学样例，车辆常按点/简化矩形处理，未提供可直接用于道路边界的工程级扫掠包络；Python/NumPy 不能直接接入 Web |
| [joelgraff/freecad.turns](https://github.com/joelgraff/freecad.turns) | 唯一定位完全一致的 CAD/道路出入口扫掠分析工作台 | 车辆对象、路径分析结果在 CAD 中呈现的产品结构；可作为 DXF/DWG 结果图层和用户工作流参考 | LGPL-2.1；当前 README 标注 Alpha、文档不可用，且依赖 FreeCAD/Python | 不作为算法依赖或移植来源；成熟度不足，LGPL 与 Web/TypeScript 集成成本也不划算 |
| [FabienD/swept-path](https://github.com/FabienD/swept-path) | 精确命中“扫掠路径 + WebAssembly + 车辆净距” | 后轴状态的自行车模型、Dubins/Reeds–Shepp/Hybrid A* 三层求解、把“可行性/净距/求解置信度”分别报告、以米和弧度作为核心单位 | `swept-core` 为 MIT 或 Apache-2.0，适合研究其几何接口；应用层/求解层/WASM 为 AGPL-3.0，不能直接并入闭源或非 AGPL 的本项目 | 仅适合对称狭窄开口，且仓库规模小；不能替代道路多段边线、超长车辆参数和 CAD 导入 |
| [CommonRoad/commonroad-drivability-checker](https://github.com/CommonRoad/commonroad-drivability-checker) | 成熟的运动可行性、道路合规、碰撞验证工具箱 | 将“运动学可行、碰撞、道路合规”作为独立校核结果，不用一个“通过/失败”混在一起；用于测试口径参考 | BSD-3-Clause；Python + C++17，依赖 Box2D/FCL/libccd 等，适合离线交叉验证而非前端直接调用 | 不是 JavaScript/WASM，转换成本高；近期坐标系模块有拆包提示，需要锁定版本 |
| [ompl/ompl](https://github.com/ompl/ompl) / [Autoware Universe](https://github.com/autowarefoundation/autoware_universe) | 规划算法与工程化安全校核的上游参考 | OMPL 的 Dubins/Reeds–Shepp 状态空间；Autoware 用完整车辆 footprint 对可行驶区域和障碍物净距做安全判断的策略 | OMPL 为 BSD；Autoware Universe 为 Apache-2.0 | 均为 C++/ROS 生态，规模远大于本项目；只取模型/测试思想，不引入依赖 |

## 一手证据摘录与核验

- `auto-parking-sim` 的 README 给出 `src/kinematics/ackermann.js`、`vehicle.js`、Hybrid A* 和碰撞相关模块，并明确：模拟器 MIT，而 `src/plant/` 为 PolyForm Noncommercial；[仓库 README 与许可证说明](https://github.com/pansong/auto-parking-sim)。因此只能复用前者的思想/代码许可证范围，不能引入学习模型。
- PythonRobotics 自述是“易读、选取广泛实用算法、最少依赖”的教材型代码库，列出 Hybrid A*、Reeds–Shepp、状态格、路径跟踪等模块；其仓库明示 MIT 许可，[README](https://github.com/AtsushiSakai/PythonRobotics)。它是本次重写运动原语与测试用例的首选参考，不是直接运行依赖。
- FreeCAD Turns README 明示“vehicle swept-path / turning analyses for highway intersections and other entrances”，同时状态为 Alpha、文档不可用，许可证为 LGPL-2.1；[仓库](https://github.com/joelgraff/freecad.turns)。
- swept-path README 明示：状态是后轴 pose；使用运动学自行车模型；依次运行 Dubins/Reeds–Shepp 穷举、Hybrid A* 和二分；核心为 MIT/Apache-2.0 而应用/求解/WASM 是 AGPL-3.0；[README 与许可证说明](https://github.com/FabienD/swept-path)。这直接支持“状态必须连续、净距为独立结果”的改造方向。
- CommonRoad Drivability Checker 明示将碰撞规避、运动学可行性、道路合规统一为校核工具，并以 BSD-3-Clause 发布；[README](https://github.com/CommonRoad/commonroad-drivability-checker)。
- Autoware 的规划文档明确以车辆尺寸/footprint 与障碍物距离判断可行性，并按多个净距阈值优先寻找更大净距的路径；[Start Planner 文档](https://github.com/autowarefoundation/autoware_universe/blob/main/planning/behavior_path_planner/autoware_behavior_path_start_planner_module/README.md)。

## 建议的本项目模块接口（下一阶段，不在本次调研中实施）

```ts
// 规划内部唯一真源：后轴中心，避免每帧由前轴轨迹“反算”造成漂移。
type RigidVehicleState = {
  rearAxle: Point2D;
  bodyHeading: number;
  steeringAngle: number;
  station: number;
};

type MotionControl = {
  distance: number;       // 单步弧长，前进阶段始终 > 0
  steeringTarget: number; // [-maxSteeringAngle, maxSteeringAngle]
};

// step 内限制转向角变化量，再用自行车模型积分；返回连续的新状态。
function integrateRigidVehicle(
  state: RigidVehicleState,
  control: MotionControl,
  params: RigidVehicleParams,
  maxSteeringRate: number,
): RigidVehicleState;
```

每个扩展动作必须依次执行：

1. `steeringAngle` 按 `maxSteeringRate × Δt` 限制到目标值；
2. 用 `yawRate = v * tan(steeringAngle) / wheelbase` 积分后轴与车身航向；
3. 从新状态前算前转向轴点，作为紫线显示；
4. 前算车辆轮廓，检查轮廓是否完全处于有效道路面；
5. 只将通过上述连续采样的状态加入搜索队列；代价同时含横向偏移、转向量、转向变化、距边线净距的惩罚。

这比“从道路中线离散选点并以扇形约束下一点”多了一项不可缺少的状态变量 `steeringAngle`，能解释并修复用户已观察到的后轴不连续问题。

## 验收与风险控制

- 首先建立不依赖 CAD 的固定算例：直线接左圆弧、直线接右圆弧、反向曲线；断言相邻帧后轴位移接近步长、航向连续、转向角变化不超限、所有车身角点都在道路面内。
- 再以现有 `test 文件/test-1.dwg` 做可视验收。紫色线应标注为“实际前转向轴轨迹”；后轴轨迹应单独可开关显示，不能再用理论中线冒充实际轨迹。
- “无安全路径”时仍输出到首次碰撞前的连续轨迹及碰撞位置，但不得把该轨迹标记为可通行。
- 工程设计结论仍需实际车型参数、驾驶策略、道路单位和图纸边线完整性共同确认。低速无侧滑模型不覆盖坡度、横坡、轮胎变形、悬挂与驾驶员多次修正。

