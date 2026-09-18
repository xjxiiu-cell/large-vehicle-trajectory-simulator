/**
 * 道路安全走廊。
 *
 * 左右边线只表示道路两侧的连续边界；道路起终点不作为障碍物。
 * 本模块负责校验导入边线、完整车身轮廓的侧边碰撞，以及车身到侧边的最小净距。
 */

import type { Conflict, LineSegment, Point2D, Polyline, VehicleCorners } from '../geometry/types';
import { lineSegmentIntersection, pointToSegmentDistance } from '../geometry/intersect';

export interface SafetyCorridor {
  valid: boolean;
  message?: string;
  /** 用于导入有效性校验的闭合道路区域，端部封口不参与车辆碰撞。 */
  polygon: Point2D[];
  leftSide: LineSegment[];
  rightSide: LineSegment[];
  /** 规划阶段使用的道路侧边空间索引，避免每个候选动作扫描全部边线。 */
  spatialIndex: Map<string, LineSegment[]>;
  spatialCellSize: number;
}

export interface FootprintSafetyResult {
  minimumClearance: number;
  conflicts: Conflict[];
}

/**
 * 建立并校验道路走廊。
 * 右边线可与左边线同向或反向导入；根据端点配对自动统一方向。
 */
export function buildSafetyCorridor(leftEdge: Polyline, rightEdge: Polyline): SafetyCorridor {
  if (leftEdge.length < 2 || rightEdge.length < 2) {
    return invalid('左右道路边线至少各需要两个点。', leftEdge, rightEdge);
  }

  const leftSide = openEdges(leftEdge);
  const rawRight = [...rightEdge];
  if (leftSide.length === 0 || openEdges(rawRight).length === 0) {
    return invalid('道路边线包含零长度线段，无法建立安全走廊。', leftEdge, rightEdge);
  }

  // 选择端点配对距离更短的右边线方向，避免 CAD 中一条边线反向时形成蝴蝶形区域。
  const sameDirectionCost = distance(leftEdge[0], rawRight[0]) + distance(leftEdge.at(-1)!, rawRight.at(-1)!);
  const reversedRight = [...rawRight].reverse();
  const reverseDirectionCost = distance(leftEdge[0], reversedRight[0]) + distance(leftEdge.at(-1)!, reversedRight.at(-1)!);
  const right = reverseDirectionCost < sameDirectionCost ? reversedRight : rawRight;
  const polygon = [...leftEdge, ...right.reverse()];
  const allEdges = closedEdges(polygon);

  if (hasSelfIntersection(allEdges)) {
    return invalid('左右道路边线无法组成无交叉的道路区域，请检查断线、交叉或图层选择。', leftEdge, rightEdge);
  }

  const rightSide = openEdges([...right].reverse());
  const sideEdges = [...leftSide, ...rightSide];
  return {
    valid: true,
    polygon,
    leftSide,
    rightSide,
    spatialIndex: buildSpatialIndex(sideEdges, 5),
    spatialCellSize: 5,
  };
}

/** 完整车辆矩形相对道路两侧的安全检查。 */
export function evaluateVehicleFootprint(
  corners: VehicleCorners,
  corridor: SafetyCorridor,
  station: number,
  requestedClearance: number
): FootprintSafetyResult {
  if (!corridor.valid) {
    return {
      minimumClearance: 0,
      conflicts: [{
        point: corridor.polygon[0] ?? { x: 0, y: 0 },
        type: 'invalid_road_data',
        station,
        message: corridor.message,
      }],
    };
  }

  return evaluateAgainstEdges(corners, station, requestedClearance, [...corridor.leftSide, ...corridor.rightSide]);
}

/**
 * Hybrid A* 扩展专用校核。
 * 只取车辆周围网格中的边线做求交和测距；连续 0.1m 推进保证车辆不可能跨过远处边线而漏检。
 */
export function evaluateVehicleFootprintForPlanning(
  corners: VehicleCorners,
  corridor: SafetyCorridor,
  station: number,
  requestedClearance: number
): FootprintSafetyResult {
  if (!corridor.valid) return evaluateVehicleFootprint(corners, corridor, station, requestedClearance);
  const sideEdges = nearbySideEdges(corners, corridor, Math.max(requestedClearance, 1));
  if (sideEdges.length === 0) {
    // 周围 1m 无边线时必然满足当前净距；用 8m 作为规划排序的保守下限。
    return { minimumClearance: 8, conflicts: [] };
  }
  return evaluateAgainstEdges(corners, station, requestedClearance, sideEdges);
}

function evaluateAgainstEdges(
  corners: VehicleCorners,
  station: number,
  requestedClearance: number,
  sideEdges: LineSegment[],
): FootprintSafetyResult {
  const vehicleEdges = vehicleOutlineEdges(corners);
  const intersections: Conflict[] = [];
  let minimumClearance = Infinity;

  for (const vehicleEdge of vehicleEdges) {
    for (const sideEdge of sideEdges) {
      const intersection = lineSegmentIntersection(vehicleEdge, sideEdge);
      if (intersection) {
        minimumClearance = 0;
        addUnique(intersections, {
          point: intersection,
          type: 'intersection',
          station,
          clearance: 0,
          message: '车辆轮廓与道路侧边线相交。',
          envelopeSegment: vehicleEdge,
          edgeSegment: sideEdge,
        });
      } else {
        minimumClearance = Math.min(minimumClearance, segmentToSegmentDistance(vehicleEdge, sideEdge));
      }
    }
  }

  // 边线只作为侧向障碍：道路端部允许车辆进出，因此不把闭合多边形的端盖计入碰撞。
  const conflicts = [...intersections];
  if (intersections.length === 0 && minimumClearance < requestedClearance) {
    conflicts.push({
      point: nearestVehiclePoint(corners, sideEdges),
      type: 'insufficient_clearance',
      station,
      clearance: minimumClearance,
      message: `车辆距道路侧边最小净距 ${minimumClearance.toFixed(2)}m，小于要求的 ${requestedClearance.toFixed(2)}m。`,
    });
  }

  return { minimumClearance, conflicts };
}

export function vehicleOutlineEdges(corners: VehicleCorners): LineSegment[] {
  return [
    { start: corners.frontLeft, end: corners.frontRight },
    { start: corners.frontRight, end: corners.rearRight },
    { start: corners.rearRight, end: corners.rearLeft },
    { start: corners.rearLeft, end: corners.frontLeft },
  ];
}

function invalid(message: string, left: Polyline, right: Polyline): SafetyCorridor {
  return {
    valid: false,
    message,
    polygon: [...left, ...right],
    leftSide: openEdges(left),
    rightSide: openEdges(right),
    spatialIndex: new Map(),
    spatialCellSize: 5,
  };
}

function buildSpatialIndex(edges: LineSegment[], cellSize: number): Map<string, LineSegment[]> {
  const index = new Map<string, LineSegment[]>();
  for (const edge of edges) {
    const minX = Math.floor(Math.min(edge.start.x, edge.end.x) / cellSize);
    const maxX = Math.floor(Math.max(edge.start.x, edge.end.x) / cellSize);
    const minY = Math.floor(Math.min(edge.start.y, edge.end.y) / cellSize);
    const maxY = Math.floor(Math.max(edge.start.y, edge.end.y) / cellSize);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x}:${y}`;
        const bucket = index.get(key) ?? [];
        bucket.push(edge);
        index.set(key, bucket);
      }
    }
  }
  return index;
}

function nearbySideEdges(corners: VehicleCorners, corridor: SafetyCorridor, margin: number): LineSegment[] {
  const points = [corners.frontLeft, corners.frontRight, corners.rearLeft, corners.rearRight];
  const minX = Math.floor((Math.min(...points.map((point) => point.x)) - margin) / corridor.spatialCellSize);
  const maxX = Math.floor((Math.max(...points.map((point) => point.x)) + margin) / corridor.spatialCellSize);
  const minY = Math.floor((Math.min(...points.map((point) => point.y)) - margin) / corridor.spatialCellSize);
  const maxY = Math.floor((Math.max(...points.map((point) => point.y)) + margin) / corridor.spatialCellSize);
  const unique = new Set<LineSegment>();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const edge of corridor.spatialIndex.get(`${x}:${y}`) ?? []) unique.add(edge);
    }
  }
  return [...unique];
}

function openEdges(points: Polyline): LineSegment[] {
  const edges: LineSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const edge = { start: points[index - 1], end: points[index] };
    if (distance(edge.start, edge.end) > 1e-8) edges.push(edge);
  }
  return edges;
}

function closedEdges(points: Polyline): LineSegment[] {
  if (points.length < 3) return [];
  return [...openEdges(points), { start: points.at(-1)!, end: points[0] }];
}

function hasSelfIntersection(edges: LineSegment[]): boolean {
  for (let first = 0; first < edges.length; first++) {
    for (let second = first + 1; second < edges.length; second++) {
      // 相邻边共享端点是正常的；首尾两边同样相邻。
      if (Math.abs(first - second) <= 1 || (first === 0 && second === edges.length - 1)) continue;
      if (lineSegmentIntersection(edges[first], edges[second])) return true;
    }
  }
  return false;
}

function segmentToSegmentDistance(first: LineSegment, second: LineSegment): number {
  return Math.min(
    pointToSegmentDistance(first.start, second),
    pointToSegmentDistance(first.end, second),
    pointToSegmentDistance(second.start, first),
    pointToSegmentDistance(second.end, first),
  );
}

function nearestVehiclePoint(corners: VehicleCorners, sideEdges: LineSegment[]): Point2D {
  const points = [corners.frontLeft, corners.frontRight, corners.rearLeft, corners.rearRight];
  let winner = points[0];
  let minimum = Infinity;
  for (const point of points) {
    for (const edge of sideEdges) {
      const current = pointToSegmentDistance(point, edge);
      if (current < minimum) {
        minimum = current;
        winner = point;
      }
    }
  }
  return { ...winner };
}

function addUnique(conflicts: Conflict[], candidate: Conflict): void {
  const exists = conflicts.some((conflict) =>
    Math.abs(conflict.point.x - candidate.point.x) < 0.01 &&
    Math.abs(conflict.point.y - candidate.point.y) < 0.01
  );
  if (!exists) conflicts.push(candidate);
}

function distance(first: Point2D, second: Point2D): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
