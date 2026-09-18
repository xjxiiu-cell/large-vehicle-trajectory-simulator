# V2 铰接车轨迹模拟：GitHub 源码调研

调研日期：2026-09-17  
范围：低速（本项目默认 5 km/h）、只前进的牵引车—单半挂车组合。本文只记录调研和 V2 建议，不是工程设计结论，也不直接引入第三方代码。

## 结论先行

V1 已经采用“**最后轴中心为内部状态、前转向轴为显示/跟踪轨迹**”的连续刚性车模型。V2 不应把牵引车与挂车分别贴到两条道路曲线上；应把它们作为一个连续的五维状态积分：

`牵引车后轴 (x, y) + 牵引车朝向 θ + 挂车朝向 θt + 实际转向角 δ`。

挂车后轴位置每一帧都应由“铰接点 + 挂车朝向 + 铰接点到挂车轴距离”推导，而不是从某条挂车参考线反算。这样可从模型层面避免 V1 曾出现过的“前轴正常、后轴突然漂移”类错误。

现有 V1 的 Worker、0.1m 子步、转角变化率限制、道路安全走廊、连续扫掠片段和 Hybrid A* 框架均可复用；需要把单车身状态、单矩形碰撞和三维去重状态，扩展为铰接状态和“双车身”检查。V2 第一轮建议仅做**单牵引车 + 单半挂车、前进、非转向挂车轴**；倒车、多挂、可转向挂车轴和动力学轮胎模型另列后续阶段。

## 一手源码案例与许可证

| 仓库 | 源码中可核验的做法 | 许可证/复用判断 | 对本项目的取舍 |
| --- | --- | --- | --- |
| [ompugao/HybridAStarTrailer](https://github.com/ompugao/HybridAStarTrailer) | Julia 实现。`lib/trailer_hybrid_a_star.jl` 的搜索节点保存 `x,y,yaw,yaw1,steer`，将挂车朝向加入离散状态；每个原语按 0.1m 积分。`lib/trailerlib.jl` 同时校验牵引车、挂车两矩形，并用 articulation/jackknife 成本排序。 | 仓库 [LICENSE](https://github.com/ompugao/HybridAStarTrailer/blob/master/LICENSE) 为 MIT，可依法复用，但若复制实质代码须保留版权和许可文本。 | **最接近 V2 目标的参考实现。** 采用其状态定义、双矩形检查和折角成本思想；不直接移植 Julia 代码，重写为本项目 TypeScript 纯函数，并保留转向角速率约束。 |
| [GPrathap/hybrid_a_star_trailer](https://github.com/GPrathap/hybrid_a_star_trailer) | C++ 版同类连续拖挂 Hybrid A*，关键代码为 `include/lib_cpp_hybrid_a_star/trailerlib.hpp`、`src/trailerlib.cpp` 与 `src/trailer_hybrid_a_star.cpp`；分离了车体几何、积分、两段矩形碰撞和路径节点。 | 仓库 [LICENSE](https://github.com/GPrathap/hybrid_a_star_trailer/blob/master/LICENSE) 为 MIT。 | 用于与 Julia 实现交叉核对公式、接口和边界条件；两个项目属于同一算法脉络，选择其一的思想实现即可，不能因为都是 MIT 而混合复制。 |
| [vtavakkoli/Kinematic-Parking-Simulator](https://github.com/vtavakkoli/Kinematic-Parking-Simulator) | 浏览器端 JavaScript 铰接车停车模拟器；[`index.html`](https://github.com/vtavakkoli/Kinematic-Parking-Simulator/blob/master/index.html) 集中实现前进/倒车的逐帧运动、挂车状态和碰撞/画布交互。 | 仓库 [LICENSE](https://github.com/vtavakkoli/Kinematic-Parking-Simulator/blob/master/LICENSE) 为 MIT。 | 是直接浏览器实现的交互参考，可借鉴帧步进与状态可视化；单文件结构不适合并入本项目 React + TypeScript 架构，只参考并独立实现。 |
| [MCastelyns/BEP-Motion-planning-for-Truck-Trailers](https://github.com/MCastelyns/BEP-Motion-planning-for-Truck-Trailers) | Unity + Python/CasADi 项目。`PythonParts/truck_trailer_model.py` 明确建立牵引车/半挂车状态与铰接点几何；`Assets/Scripts/Pathfinding/Hybrid A star/HybridAStar.cs` 对前进、倒车、转角、转角变化、铰接角分别计费，并包含牵引车和拖车碰撞检查。 | [LICENSE](https://github.com/MCastelyns/BEP-Motion-planning-for-Truck-Trailers/blob/main/LICENSE) 文本为 MIT；但仓库还含 Unity 资源且 README 指明其以其他项目为基础，**不整体复制**，只把源码作为模型和测试场景参考。 | 采用“轨迹代价中显式惩罚铰接角/转向变化”的做法；不引入 CasADi、Unity、MPC 或其资源。V2 前进行驶不需要倒车 anti-jackknife 控制器。 |
| [AtsushiSakai/PythonRobotics – Hybrid A*](https://github.com/AtsushiSakai/PythonRobotics/tree/master/PathPlanning/HybridAStar) | 成熟的基础 Hybrid A* 参考。`hybrid_a_star.py` 以连续 0.1m 采样展开原语、KD-tree 预筛障碍、车辆矩形精检、转向与转向变化代价，并使用解析连接加速。 | [LICENSE](https://github.com/AtsushiSakai/PythonRobotics/blob/master/LICENSE) 为 MIT。该模块本身是单刚性车，不提供半挂车状态。 | 不用于铰接运动学；用于复核 V1/V2 的原语展开、碰撞预筛和“解析连接需逐点验证”的工程模式。 |
| [tanujthakkar/Voronoi-Based-Hybrid-Astar](https://github.com/tanujthakkar/Voronoi-Based-Hybrid-Astar) | 面向 tractor-trailer 的 ROS/C++ Hybrid A*；README 明示为拖车模型扩展  Hybrid A*，并以 Voronoi 图辅助启发式/解析扩展。 | 仓库根目录未提供许可证文件（GitHub License API 返回 404）。默认不拥有复制、修改或分发源代码的授权。 | 只作为“通过道路中心/骨架提高净距”的算法资料，**不得复制源码**。当前道路设计工具优先沿用 V1 的“最小净距优先”代价，无须引入 ROS/Voronoi 依赖。 |

> 许可证结论仅针对调研时仓库公开的根许可证文本；在真正复制任何第三方实质代码或发布产品前，仍须再次核对许可证、依赖和版权声明。数学思想、公开接口和自行独立实现不等于复制原代码。

## 低速半挂车运动学：建议的正式定义

### 1. 坐标与参数（必须先统一符号）

```
前进方向 →
牵引车前转向轴 ── L ── 牵引车后轴 R ── a ── 铰接点 H ── b ── 挂车后轴 T
```

- `R = (x, y)`：牵引车最后轴中心，也是积分参考点。
- `θ`：牵引车车身朝向；`θt`：挂车车身朝向。
- `δ`：牵引车等效前轮转角；`L`：前转向轴至牵引车后轴的轴距。
- `a`：从牵引车后轴到铰接点、沿牵引车前向的**有符号**距离。半挂车常见的第五轮在后轴之后，因此通常 `a < 0`。现有字段 `hitchOffset` 在 V2 必须明确采用这个符号约定，或改名为 `hitchOffsetFromTractorRearAxleM`。
- `b > 0`：从铰接点到挂车最后轴、沿挂车后向的距离，即现有 `trailerHitchToAxle`。
- `α = wrap(θ - θt)`：铰接角。显示时应同时给数值和正负方向，不应只显示绝对值。

位置约束为：

```text
H = R + a · (cos θ, sin θ)
T = H - b · (cos θt, sin θt)
```

这个约束应在每帧由状态重新计算，不能把 `T` 当作独立累积位置；否则数值误差会积累成“挂车脱钩/漂移”。[HybridAStarTrailer 的 `trailer_motion_model`](https://github.com/ompugao/HybridAStarTrailer/blob/master/lib/trailerlib.jl) 是 `a = 0` 的简化特例；[TU Delft 项目的模型](https://github.com/MCastelyns/BEP-Motion-planning-for-Truck-Trailers/blob/main/PythonParts/truck_trailer_model.py) 则显式包含后轴到铰接点的偏移量。

### 2. 前进、无侧滑的连续方程

令 `κ = tan(δ) / L`，`v > 0` 为牵引车后轴速度。依据上述有符号 `a` 定义：

```text
ẋ  = v cos θ
ẏ  = v sin θ
θ̇  = v κ
θ̇t = (v / b) · [sin(θ - θt) + a κ cos(θ - θt)]
δ̇  = clamp((δ目标 - δ) / Δt, -δ̇max, +δ̇max)
```

当 `a = 0` 时，第四式退化为 `θ̇t = v / b · sin(θ - θt)`，与 [HybridAStarTrailer 源码](https://github.com/ompugao/HybridAStarTrailer/blob/master/lib/trailerlib.jl) 的 `yaw1 += D / d * sin(yaw0 - yaw1)` 一致。带 `a` 的符号应以本节坐标约定为准；不要混用第三方项目中以“挂车相对角”而非“世界朝向”定义的变量。

### 3. 本项目应采用的单步积分

沿 V1 已验证的“按后轴距离 `ds`”推进方式，保持 `ds ≤ 0.1m`；弯道、铰接角快速变化或最终复核可降到 `0.05m`。每步顺序：

1. 用 `dt = ds / v` 对 `δ` 应用既有 `maxSteeringRateDegPerSec` 限幅，取前后转角均值计算 `κ`。
2. 牵引车后轴使用 V1 已有的精确圆弧公式更新 `R, θ`，不以“下一帧路径点”倒推。
3. 对 `θt` 用中点法（RK2）积分上式；每步都 `wrap` 到 `(-π, π]`。
4. 用新的 `R, θ, θt` 重建 `H` 和 `T`。牵引车和挂车矩形分别以 `R`、`T` 为参考点生成。
5. 记录 `R、H、T、θ、θt、δ、α、station`；紫线仍是由 `R, θ` 推导的牵引车前转向轴实际轨迹。

这比“先给前轴一条路线、再反推牵引车、最后给挂车贴线”的做法多了一个状态，但能保持铰接约束恒成立。

## 碰撞、净距与扫掠：不可只检查一条轴线

开源铰接规划器均将牵引车与挂车分别作为碰撞体：HybridAStarTrailer 的 `check_trailer_collision` 分别检查两个矩形；其 Hybrid A* 节点还在每个原语内以 0.1m 插值检查。[源码位置](https://github.com/ompugao/HybridAStarTrailer/blob/master/lib/trailer_hybrid_a_star.jl)

V2 应把 V1 的 `evaluateVehicleFootprint` 抽象为“多个车身矩形”的统一输入：

- 每个 0.1m 子步同时检查牵引车矩形和挂车矩形是否完整位于道路安全走廊内；两者任一不足净距即记录冲突。
- 结果应保存冲突所属车体（`tractor` / `trailer`）、角点/边、最小净距和里程，UI 用不同标记区分，不能只显示“车辆碰撞”。
- 每对相邻状态分别为牵引车与挂车生成扫掠片段；两类片段求并集显示。急弯、长后悬或铰接角变化快时自适应缩小子步，避免用跨帧直连形成假的红色扇形。
- 同时校验牵引车与挂车轮廓是否异常重叠。前进行驶时超出工程阈值的 `|α|` 应给“铰接角过大”警告；物理相交才报碰撞。阈值须由车型参数给出，不能硬编码为通用工程结论。

道路端部继续沿用 V1 规则：允许由端部进入/驶出，左右边线始终参与净距检查。

## 自动安全路线：从 V1 继续演进的方案

V1 的前进式搜索状态为“牵引车后轴、朝向、转向角”，已经解决刚性车的位姿突变。V2 把状态扩展为：

```text
(tractorRearX, tractorRearY, tractorHeading, trailerHeading, steeringAngle, roadProgress)
```

搜索原语保留当前模式：目标转角离散 9 档、每原语 0.5m、内部 0.1m 连续积分和双车身安全检查、只前进。去重键至少应包含道路进度、横向偏移、牵引车朝向误差、**铰接角**和转向角；不能把不同铰接角的节点合并，否则会得到同位置但不可连续接上的挂车姿态。

建议的排序（前进道路模拟，而非倒车泊车）：

1. 最大化全程最小净距（牵引车和挂车共同取最小值）；
2. 最小化转向角与转向变化；
3. 最小化铰接角及铰接角变化；
4. 最小化牵引车前转向轴对道路引导线的偏移。

此顺序对应 [HybridAStarTrailer](https://github.com/ompugao/HybridAStarTrailer/blob/master/lib/trailer_hybrid_a_star.jl) 将 `yaw1` 纳入状态、并对 `|yaw-yaw1|` 施加 jackknife 代价的经验；但 V2 不应照搬其 2m 栅格、20 档转角和倒车代价。当前项目使用 Web Worker，需继续保留节点上限、进度回报与取消信号，避免再次阻塞网页。

**无安全路线**时只能返回已连续执行的最远状态序列，并指出是“牵引车冲突”“挂车冲突”“安全净距不足”还是“铰接角/道路数据限制”；不得把挂车补贴回道路中线来伪造后续结果。

## 建议的 V2 分阶段交付

### V2-1：铰接车连续运动学与显示（先验证）

- 新增 `ArticulatedVehicleState` 和纯函数积分器；补全现有 `hitchOffset`/`trailerHitchToAxle` 的单位、方向和必填校验。
- 完整显示牵引车、挂车、铰接点、牵引车前转向轴紫线、牵引车后轴轨迹、挂车后轴轨迹、铰接角。
- 自动化测试：直行时 `α=0`；恒定转角时挂车内轮差；铰接约束长度不变；转向角速率限制；所有相邻状态连续。
- **停下由用户用直线、左弯、右弯图纸确认，不进入碰撞/规划阶段。**

### V2-2：双车身安全走廊、冲突与扫掠（先验证）

- 把 V1 单矩形安全判断与扫掠片段扩展为两段车身。
- 输出冲突车体、位置、净距、里程和原因；回放中高亮实际发生冲突的牵引车或挂车。
- **停下由用户以 0m / 0.5m / 1m 净距对真实图纸验证。**

### V2-3：铰接车自动安全路线（先验证）

- 仅在 V2-1/V2-2 连续性和净距结果已验收后，扩展 V1 Hybrid A* 状态与代价。
- 保留 Worker 计算、进度、取消和最远可执行部分轨迹；完成后停止用户验收。

### V2-4：交付验证（先验证）

- 真实 DXF/DWG 回归：直线、左右弯、不同导入方向、窄路不可通过；补齐测试与文档。
- 在真实项目图纸和车型尺寸完成比对前，页面结果继续标为“几何模拟结果”，不作为最终工程设计结论。

## 实施前需要用户确认的车型事实

这些不是算法可以合理猜测的参数；错误输入会直接改变内轮差与扫掠包络：

1. 目标是**半挂车**（第五轮在牵引车上）还是全挂/中置转向轴挂车？本调研的方程只覆盖前者。
2. 第五轮相对于牵引车最后轴是前方还是后方，实测距离是多少？
3. 铰接点到挂车最后轴（或等效多轴组中心）距离、挂车前悬/后悬、车宽和是否存在转向挂车轴。
4. 是否只需前进 5 km/h。倒车会显著提高 jackknife 风险，不能作为“顺手支持”的小改动。
