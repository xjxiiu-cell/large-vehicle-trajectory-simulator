/**
 * 几何类型系统
 * 所有几何运算基于此类型定义
 * 预留 z 坐标用于未来 3D 扩展
 */

/** 二维/三维点 */
export interface Point2D {
  x: number;
  y: number;
  z?: number; // 预留 3D
}

/** 二维向量 */
export interface Vector2D {
  x: number;
  y: number;
}

/** 线段（两点间） */
export interface LineSegment {
  start: Point2D;
  end: Point2D;
}

/** 折线（有序点列） */
export type Polyline = Point2D[];

/** 路径直线段（用于路径表示） */
export interface StraightPathSegment {
  type: 'straight';
  start: Point2D;
  end: Point2D;
}

/** 路径圆弧段（保留原始几何参数，供精确渲染和运动学模拟使用） */
export interface ArcPathSegment {
  type: 'arc';
  center: Point2D;
  radius: number;
  startAngle: number; // 弧度
  endAngle: number;   // 弧度
  clockwise: boolean;
  /** 弧段起点（导出值） */
  startPoint: Point2D;
  /** 弧段终点（导出值） */
  endPoint: Point2D;
}

/** 路径段：直线或圆弧 */
export type PathSegment = StraightPathSegment | ArcPathSegment;

/** 路径：由连续直线段和圆弧段组成的有序序列 */
export type Path = PathSegment[];

/** 包围盒 */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** CAD 图纸坐标单位。进入模拟引擎前统一转换为米。 */
export type CadUnit = 'm' | 'mm';

/** 多边形（闭合折线） */
export interface Polygon {
  vertices: Point2D[]; // 按顺序排列，首尾相连
}

/** 道路几何数据（内部 Schema） */
export interface RoadGeometry {
  /** 道路中线 — 由直线段和圆弧段混合组成的路径 */
  centerline: Path;
  /** 左边线 — 高精度折线（已离散化） */
  leftEdge: Polyline;
  /** 右边线 — 高精度折线（已离散化） */
  rightEdge: Polyline;
  /** 模拟内部单位，固定为米 */
  units: 'm';
  /** 导入图纸的原始坐标单位 */
  sourceUnits: CadUnit;
  /** 包围盒 */
  bounds: BoundingBox;
  /** 预留：高程剖面 */
  elevationProfile?: ElevationPoint[];
}

/** 高程点（预留 3D） */
export interface ElevationPoint {
  station: number; // 桩号
  elevation: number; // 高程
}

/** 车辆类型 */
export type VehicleType = 'rigid' | 'articulated';

/** 转向方式 */
export type SteeringType = 'front' | 'all-wheel';

/** 轴配置 */
export interface AxleConfig {
  /** 轴距车辆前端的距离（米） */
  distanceFromFront: number;
  /** 轴宽/轮距（米） */
  trackWidth: number;
  /** 是否为转向轴 */
  isSteering: boolean;
  /** 最大转向角（度），仅转向轴有效 */
  maxSteerAngle?: number;
}

/** 车辆参数 */
export interface VehicleParams {
  type: VehicleType;
  /** 总长度（米） */
  totalLength: number;
  /** 总宽度（米） */
  totalWidth: number;
  /** 前悬（米） */
  frontOverhang: number;
  /** 后悬（米） */
  rearOverhang: number;
  /** 轴配置列表 */
  axles: AxleConfig[];
  /** 转向方式（仅刚性车） */
  steeringType: SteeringType;
  /** 最大转向角（度）—— 简化输入时的默认值 */
  maxSteerAngle: number;
  /** 最大转向角变化率（度/秒）。刚性前转向车辆的方向盘不能瞬时跳变。 */
  maxSteeringRateDegPerSec: number;
  // ---- 铰接车专用 ----
  /** 铰接点距牵引车后轴的距离（米） */
  hitchOffset?: number;
  /** 拖车轴距铰接点的距离（米） */
  trailerHitchToAxle?: number;
  /** 拖车参数 */
  trailer?: TrailerParams;
  // ---- 预留 3D ----
  /** 离地间隙（毫米） */
  clearance?: number;
  /** 轮胎半径（毫米） */
  tireRadius?: number;
}

/** 挂车等效轴组的转向机构类型。V2-1 仅实现 fixed。 */
export type TrailerAxleSteeringMode = 'fixed' | 'passive_linked' | 'active_linked' | 'active_commanded';

/** 拖车参数 */
export interface TrailerParams {
  /**
   * 挂车车身总长。V2-1 的尺寸链为：牵引销至前端 + 牵引销至等效轴组 +
   * 等效轴组至车尾，三段之和应等于总长度。
   */
  totalLength: number;
  totalWidth: number;
  /** 牵引销至挂车前端的距离（米）。历史字段名保留，避免破坏既有数据。 */
  frontOverhang: number;
  /** 挂车等效后轴组中心至车尾的距离（米）。 */
  rearOverhang: number;
  axles: AxleConfig[];
  /** 挂车等效轴组的转向机构类型。 */
  steeringMode: TrailerAxleSteeringMode;
}

/** 车辆位姿（某一时刻的状态） */
export interface VehiclePose {
  /** 参考点位置（后轴中心） */
  position: Point2D;
  /** 朝向角（弧度，0 = 正东方向） */
  heading: number;
  /** 瞬时转弯半径（米），Infinity = 直线 */
  turnRadius: number;
  /** 铰接角（弧度，仅铰接车有效） */
  articulationAngle?: number;
}

/**
 * 刚性车的连续运动状态。
 *
 * 后轴中心是运动学积分的唯一参考点；前转向轴位置始终由该状态和轴距推导，
 * 因此不会出现“前轴在路线、后轴横向跳变”的不一致状态。
 */
export interface RigidVehicleState {
  /** 最后轴中心坐标 */
  rearAxle: Point2D;
  /** 车身朝向（弧度，0 = 正东方向） */
  heading: number;
  /** 实际前轮等效转向角（弧度） */
  steeringAngle: number;
  /** 已行驶里程（以后轴滚动距离计） */
  station: number;
}

/**
 * 前轮转向牵引车 + 单半挂车的连续运动状态。
 *
 * 挂车后轴位置、铰接点均由本状态和几何约束推导，绝不独立累积，
 * 从根源避免挂车在相邻帧发生漂移或“脱钩”。
 */
export interface ArticulatedVehicleState {
  /** 牵引车最后轴中心。 */
  tractorRearAxle: Point2D;
  /** 牵引车车身朝向（弧度）。 */
  tractorHeading: number;
  /** 挂车车身朝向（弧度）。 */
  trailerHeading: number;
  /** 牵引车实际前轮等效转向角（弧度）。 */
  steeringAngle: number;
  /** 以牵引车后轴滚动距离计的里程。 */
  station: number;
}

/** 车辆角点（用于计算扫掠包络） */
export interface VehicleCorners {
  /** 车身四个角点 */
  frontLeft: Point2D;
  frontRight: Point2D;
  rearLeft: Point2D;
  rearRight: Point2D;
}

/** 扫掠包络 */
export interface SweptEnvelope {
  /** 包络多边形 */
  polygon: Polygon;
  /** 组成包络的所有轨迹点列 */
  tracePoints: Point2D[];
  /** 相邻车辆轮廓之间的连续扫掠片段，用于准确展示弯道扫掠过程。 */
  slices?: Polygon[];
  /** 铰接车牵引车车身的连续扫掠片段。 */
  tractorSlices?: Polygon[];
  /** 铰接车半挂车车身的连续扫掠片段。 */
  trailerSlices?: Polygon[];
}

/** 碰撞/冲突 */
export interface Conflict {
  /** 冲突点 */
  point: Point2D;
  /** 冲突类型 */
  type: 'intersection' | 'outside_corridor' | 'insufficient_clearance' | 'invalid_road_data';
  /** 问题发生时的模拟里程。 */
  station?: number;
  /** 问题发生时车辆到道路侧边的最小距离（米）。 */
  clearance?: number;
  /** 面向用户的原因说明。 */
  message?: string;
  /** 铰接车发生问题的车体；刚性车不填。 */
  vehicleBody?: 'tractor' | 'trailer';
  /** 涉及的包络线段 */
  envelopeSegment?: LineSegment;
  /** 涉及的道路边线段 */
  edgeSegment?: LineSegment;
}

/** 模拟步骤结果 */
export interface SimulationStep {
  /** 步骤索引 */
  index: number;
  /** 沿道路中线的里程（米） */
  station: number;
  /** 车辆位姿 */
  pose: VehiclePose;
  /** 车辆角点 */
  corners: VehicleCorners;
  /** 铰接车拖车角点 */
  trailerCorners?: VehicleCorners;
  /** 铰接点（第五轮）世界坐标。 */
  hitchPoint?: Point2D;
  /** 挂车等效后轴组中心世界坐标。 */
  trailerAxle?: Point2D;
  /** 挂车车身朝向（弧度）。 */
  trailerHeading?: number;
  /** 实际前转向轴中心；刚性车由后轴状态推导。 */
  frontSteeringAxle?: Point2D;
  /** 实际最后轴中心，便于回放与连续性校核。 */
  rearAxle?: Point2D;
  /** 实际前轮等效转向角（弧度）。 */
  steeringAngle?: number;
  /** 完整车身到左右道路边线的最小净距（米）。 */
  minimumClearance?: number;
  /** 该步的首个安全问题原因。 */
  safetyReason?: Conflict['type'];
  /** 牵引车车身到侧边线的最小净距（仅铰接车）。 */
  tractorMinimumClearance?: number;
  /** 挂车车身到侧边线的最小净距（仅铰接车）。 */
  trailerMinimumClearance?: number;
  /** 牵引车本步的首个问题原因（仅铰接车）。 */
  tractorSafetyReason?: Conflict['type'];
  /** 挂车本步的首个问题原因（仅铰接车）。 */
  trailerSafetyReason?: Conflict['type'];
}

/** 模拟结果 */
export interface SimulationResult {
  /** 是否通过（无冲突） */
  passed: boolean;
  /** 扫掠包络 */
  envelope: SweptEnvelope;
  /** 冲突列表 */
  conflicts: Conflict[];
  /** 所有模拟步 */
  steps: SimulationStep[];
  /** 实际前转向轴中心轨迹。转向角渐变时可与规划参考路径略有不同。 */
  frontAxleTrack?: Polyline;
  /** 实际最后轴中心轨迹。 */
  rearAxleTrack?: Polyline;
  /** 铰接点轨迹。 */
  hitchTrack?: Polyline;
  /** 挂车等效后轴组中心轨迹。 */
  trailerAxleTrack?: Polyline;
  /** 本次模拟要求的最小侧向安全净距（米）。 */
  requestedClearance?: number;
  /** 全程车身到左右道路边线的最小净距（米）。 */
  minimumClearance?: number;
  /** 结果分类，避免用单一“通过/不通过”掩盖原因。 */
  assessment?: 'passed' | 'boundary_collision' | 'insufficient_clearance' | 'invalid_road_data' | 'kinematic_preview';
  /** 首个问题点，供结果面板直接定位。 */
  firstIssue?: Conflict;
  /** 实际用于模拟的参考路径；自动规划时不再等同于道路中线 */
  route?: RoutePlan;
}

/** 自动规划出的车辆参考轴行驶路线 */
export interface RoutePlan {
  mode: 'centerline' | 'auto';
  /** 自动规划的运动学状态基准。刚性车固定以后轴为内部状态源。 */
  referenceAxle: 'front_steering' | 'rear_axle';
  path: Path;
  minimumClearance: number;
  requestedClearance: number;
  feasible: boolean;
  message?: string;
  /** 无安全路线时，首次无法满足约束的路线里程。 */
  failureStation?: number;
  /** true 表示自动规划在生成阶段失败，path 为仅供定位冲突的中线回退轨迹。 */
  isFallback?: boolean;
  /** 规划器输出的连续刚性车状态；存在时必须作为模拟、回放与显示的唯一来源。 */
  motion?: RigidVehicleState[];
  /** 铰接车规划器输出的连续状态；牵引车和挂车轨迹、车身与扫掠必须均由其推导。 */
  articulatedMotion?: ArticulatedVehicleState[];
  /** 自动规划无法继续时，最接近失败状态的真实安全问题。 */
  failureConflicts?: Conflict[];
}

/** 转弯半径-宽度表条目 */
export interface RadiusWidthEntry {
  radius: number;   // 转弯半径（米）
  width: number;    // 所需道路宽度（米）
}

/** 转弯半径表 */
export interface RadiusWidthTable {
  vehicleName: string;
  minRadius: number;
  maxRadius: number;
  entries: RadiusWidthEntry[];
}

/** 内部消息/通知 */
export interface AppMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  content: string;
  duration?: number;
}
