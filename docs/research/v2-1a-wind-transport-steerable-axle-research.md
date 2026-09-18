# V2-1A：风电运输可转向挂车轴组资料调研

调研日期：2026-09-18  
范围：前轮转向牵引车 + 单半挂车、低速前进；只评估一个“等效可转向后轴组”的首轮实现边界。

## 结论

V2-1A 可以面向风电场超长构件运输启动设计，但**不能把任意“可转向挂车”都套进一条通用转向曲线**。

首个实现应采用：**液压联动的一个等效后轴组**。它以挂车轴组中心为运动学参考，转角受最大角、角速度、死区、回正和厂家/实测联动曲线约束。对同一机构类别的新车型，通常只需录入尺寸和重新标定；只有机构类别改变时才需要扩展代码。

不应把“助手独立遥控转向”或“后随动小车/多铰点组合”假定成自动联动半挂车。前者缺少确定控制输入，后者的拓扑已不是当前单半挂车模型。

## 一手资料与适配判断

| 制造商资料 | 一手事实 | 对 V2-1A 的判断 |
| --- | --- | --- |
| [Nooteboom SUPER WING CARRIER](https://www.nooteboom.com/trailers/specials/super-wing-carrier/) | 面向风机叶片运输；后部为 3 条液压转向摆动轴线，最大转向角 60°；车辆可伸缩、带液压鹅颈。 | 很适合作为“一个等效液压转向后轴组”的**参数上限和验证对象**。但公开页没有给出轴组转角与铰接角/牵引车转角的控制曲线，因此不能据 60° 反推出工程用控制律。 |
| [Nooteboom TELETRAILER LONGRUNNER](https://www.nooteboom.com/trailers/teletrailer-longrunner/) | 2 或 3 根液压转向轴；官方说明包含液压转盘转向和手动转向，最大转角超过 50°。 | 结构上最接近本项目的单半挂车。应向车型方索取其 ASA 对中/液压转向规律后，再作为 V2-1A 的首个标定车型。 |
| [Faymonville Rotor Blade Adapter](https://www.faymonville.com/technology/wind-power/new-the-rotor-blade-adapter/) | 叶片运输的自转向挂车由助手独立于牵引车操作。 | 不适合 V2-1A 的“自动联动”首版；其转向角是外部操作者输入，应归入未来 `active_commanded`，需要控制记录或人工输入。 |
| [Goldhofer self-tracking trailing dolly](https://www.goldhofer.com/en/special-applications/dolly-long-material) | 资料给出 ±50° 转向轴、±20° trailing axle，且使用转盘/后随动小车组合。 | 说明风电运输确有多种可转向拓扑，但该类属于 trailing dolly/多铰点组合，不能用当前“单半挂车 + 一个后轴组”模型替代。 |

公开资料可证明行业常见液压转向、后随动和人工独立操纵三类机构，却没有公开每个车型的完整转向映射。因此，公开数据用于选型和建立参数边界；工程模拟仍需具体车型资料。

## 哪些资料只需配置，哪些需要重新开发

| 情况 | 处理方式 | 是否改核心算法 |
| --- | --- | --- |
| 同为液压联动单半挂车，改变总长、轴组位置、最大角、角速度、死区或标定曲线 | 新建车型配置并重新标定/回归验证。 | 否。 |
| 同为液压联动，但 2/3/4 根后轴共用同一等效转向规律 | 用等效轴组中心表示车身姿态，保留各轴作为显示与资料记录。 | 通常否；若要逐轮轨迹/轮胎磨耗，再扩展。 |
| 机械被动随动，且有可标定的 `δt=f(α)` 或 `δt=f(α,δf)` 曲线 | 选择 `passive_linked` 并录入曲线、限位、回正和锁止条件。 | 否，复用同一“等效转角状态 + 不同控制律”框架。 |
| 液压/电控联动，且有 ECU 或液压阀的确定规律 | 选择 `active_linked` 并录入或导入标定曲线。 | 否，除非规律包含额外车辆状态。 |
| 助手遥控、独立控制或远程 override | 转向角不由铰接状态唯一决定。需有操作指令/记录或先做人工回放。 | 是，未来扩展 `active_commanded` 控制输入与规划维度。 |
| 后随动 dolly、转盘、双铰点、模块车或多个彼此独立的转向轴组 | 车辆拓扑与状态变量改变。 | 是，需要新车型模块，不能只改参数。 |

## V2-1A 建议数据契约

```ts
interface EquivalentTrailerSteering {
  mode: 'passive_linked' | 'active_linked';
  axleGroupCenterFromHitchM: number;
  maxSteeringAngleDeg: number;
  maxSteeringRateDegPerSec: number;
  deadbandDeg: number;
  centerReturnRateDegPerSec: number;
  lockedWhen?: { belowSpeedKph?: number; reverse?: boolean };
  // 至少提供一个经车型资料/实测标定的规律：插值点优先于猜测比例系数
  calibration: Array<{
    articulationAngleDeg: number;
    tractorSteeringAngleDeg?: number;
    trailerSteeringAngleDeg: number;
  }>;
  axleRows: Array<{ offsetFromHitchM: number; steerable: boolean }>;
}
```

运行时新增 `trailerSteeringAngle` 状态。牵引车、第五轮和挂车仍由同一连续状态序列积分；转向角先受标定曲线约束，再受最大转角和转向速率约束。规划器只选择牵引车转角，不能自由捏造挂车转角。

## 进入实现前必须取得的资料

1. 明确目标车型与机构：液压联动、机械随动，还是独立操纵。
2. 挂车每根轴和等效轴组中心相对第五轮的距离；车体尺寸、伸缩状态及载荷工况。
3. 最大转角、最大转向速度、直行回正、死区和低速/倒车锁止条件。
4. 厂家曲线（优先）或低速实测标定点：至少覆盖直行、左/右转、入弯、稳态弯和出弯。
5. 同一车型的厂家扫掠图或实车轨迹，用于验收车身扫掠与转向方向。

缺少第 3–5 项时，软件只能显示“未按目标转向机构标定”，不得把固定轴结果称为该可转向车型的工程结论。
