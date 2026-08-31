import type { Point } from "circuit-json"
import type { CopperPrimitive } from "./types"

const getClosestPointOnSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Point => {
  const vx = x2 - x1
  const vy = y2 - y1
  const lengthSquared = vx * vx + vy * vy
  const unclampedT =
    lengthSquared > 0 ? ((px - x1) * vx + (py - y1) * vy) / lengthSquared : 0
  const t = Math.max(0, Math.min(1, unclampedT))
  return { x: x1 + t * vx, y: y1 + t * vy }
}

const distanceToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const closestPoint = getClosestPointOnSegment(px, py, x1, y1, x2, y2)
  return Math.hypot(px - closestPoint.x, py - closestPoint.y)
}

export const isPointInsidePolygon = (
  point: Point,
  polygon: Point[],
): boolean => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

const distanceToPolygon = (point: Point, polygon: Point[]): number => {
  if (isPointInsidePolygon(point, polygon)) return 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    best = Math.min(
      best,
      distanceToSegment(point.x, point.y, start.x, start.y, end.x, end.y),
    )
  }
  return best
}

export const distanceToPrimitive = (
  primitive: CopperPrimitive,
  px: number,
  py: number,
): number => {
  if (primitive.kind === "circle") {
    return Math.max(
      Math.hypot(px - primitive.x, py - primitive.y) - primitive.radius,
      0,
    )
  }

  if (primitive.kind === "segment") {
    return Math.max(
      distanceToSegment(
        px,
        py,
        primitive.x1,
        primitive.y1,
        primitive.x2,
        primitive.y2,
      ) - primitive.halfWidth,
      0,
    )
  }

  if (primitive.kind === "polygon") {
    return distanceToPolygon({ x: px, y: py }, primitive.points)
  }

  const angle = (-primitive.rotation * Math.PI) / 180
  const dx = px - primitive.x
  const dy = py - primitive.y
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  const outsideX = Math.max(Math.abs(localX) - primitive.halfWidth, 0)
  const outsideY = Math.max(Math.abs(localY) - primitive.halfHeight, 0)
  return Math.hypot(outsideX, outsideY)
}

export const getClosestPointOnPrimitive = (
  primitive: CopperPrimitive,
  point: Point,
): Point => {
  if (distanceToPrimitive(primitive, point.x, point.y) === 0) return point

  if (primitive.kind === "circle") {
    const dx = point.x - primitive.x
    const dy = point.y - primitive.y
    const distance = Math.hypot(dx, dy)
    return {
      x: primitive.x + (dx / distance) * primitive.radius,
      y: primitive.y + (dy / distance) * primitive.radius,
    }
  }

  if (primitive.kind === "segment") {
    const centerlinePoint = getClosestPointOnSegment(
      point.x,
      point.y,
      primitive.x1,
      primitive.y1,
      primitive.x2,
      primitive.y2,
    )
    const dx = point.x - centerlinePoint.x
    const dy = point.y - centerlinePoint.y
    const distance = Math.hypot(dx, dy)
    return {
      x: centerlinePoint.x + (dx / distance) * primitive.halfWidth,
      y: centerlinePoint.y + (dy / distance) * primitive.halfWidth,
    }
  }

  if (primitive.kind === "polygon") {
    let closestPoint = primitive.points[0]!
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < primitive.points.length; index++) {
      const start = primitive.points[index]!
      const end = primitive.points[(index + 1) % primitive.points.length]!
      const candidate = getClosestPointOnSegment(
        point.x,
        point.y,
        start.x,
        start.y,
        end.x,
        end.y,
      )
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
      if (distance < bestDistance) {
        bestDistance = distance
        closestPoint = candidate
      }
    }
    return closestPoint
  }

  const angle = (-primitive.rotation * Math.PI) / 180
  const dx = point.x - primitive.x
  const dy = point.y - primitive.y
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  const closestLocalX = Math.max(
    -primitive.halfWidth,
    Math.min(primitive.halfWidth, localX),
  )
  const closestLocalY = Math.max(
    -primitive.halfHeight,
    Math.min(primitive.halfHeight, localY),
  )
  const inverseAngle = -angle
  return {
    x:
      primitive.x +
      closestLocalX * Math.cos(inverseAngle) -
      closestLocalY * Math.sin(inverseAngle),
    y:
      primitive.y +
      closestLocalX * Math.sin(inverseAngle) +
      closestLocalY * Math.cos(inverseAngle),
  }
}

const getOrientation = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const isPointOnSegment = (point: Point, start: Point, end: Point): boolean =>
  point.x >= Math.min(start.x, end.x) &&
  point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) &&
  point.y <= Math.max(start.y, end.y)

const doSegmentsIntersect = (
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean => {
  const o1 = getOrientation(firstStart, firstEnd, secondStart)
  const o2 = getOrientation(firstStart, firstEnd, secondEnd)
  const o3 = getOrientation(secondStart, secondEnd, firstStart)
  const o4 = getOrientation(secondStart, secondEnd, firstEnd)
  const epsilon = 1e-9

  if (o1 * o2 < 0 && o3 * o4 < 0) return true
  if (
    Math.abs(o1) <= epsilon &&
    isPointOnSegment(secondStart, firstStart, firstEnd)
  )
    return true
  if (
    Math.abs(o2) <= epsilon &&
    isPointOnSegment(secondEnd, firstStart, firstEnd)
  )
    return true
  if (
    Math.abs(o3) <= epsilon &&
    isPointOnSegment(firstStart, secondStart, secondEnd)
  )
    return true
  if (
    Math.abs(o4) <= epsilon &&
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  )
    return true
  return false
}

export const doesSegmentCrossTrace = (
  start: Point,
  end: Point,
  trace: Extract<CopperPrimitive, { kind: "segment" }>,
): boolean => {
  const expandedPathBounds = {
    minX: Math.min(start.x, end.x) - trace.halfWidth,
    minY: Math.min(start.y, end.y) - trace.halfWidth,
    maxX: Math.max(start.x, end.x) + trace.halfWidth,
    maxY: Math.max(start.y, end.y) + trace.halfWidth,
  }
  if (
    Math.max(trace.x1, trace.x2) < expandedPathBounds.minX ||
    Math.min(trace.x1, trace.x2) > expandedPathBounds.maxX ||
    Math.max(trace.y1, trace.y2) < expandedPathBounds.minY ||
    Math.min(trace.y1, trace.y2) > expandedPathBounds.maxY
  ) {
    return false
  }

  const traceStart = { x: trace.x1, y: trace.y1 }
  const traceEnd = { x: trace.x2, y: trace.y2 }
  if (doSegmentsIntersect(start, end, traceStart, traceEnd)) return true

  const distance = Math.min(
    distanceToSegment(start.x, start.y, trace.x1, trace.y1, trace.x2, trace.y2),
    distanceToSegment(end.x, end.y, trace.x1, trace.y1, trace.x2, trace.y2),
    distanceToSegment(trace.x1, trace.y1, start.x, start.y, end.x, end.y),
    distanceToSegment(trace.x2, trace.y2, start.x, start.y, end.x, end.y),
  )
  return distance <= trace.halfWidth
}

export const traceLoops = (
  cells: number[],
  nx: number,
): Array<Array<[number, number]>> => {
  const inSet = new Set(cells)
  const edges = new Map<string, Array<[number, number]>>()
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const key = `${x1},${y1}`
    const destinations = edges.get(key) ?? []
    destinations.push([x2, y2])
    edges.set(key, destinations)
  }

  for (const cell of cells) {
    const i = cell % nx
    const j = Math.floor(cell / nx)
    if (j === 0 || !inSet.has(cell - nx)) addEdge(i, j, i + 1, j)
    if (i === nx - 1 || !inSet.has(cell + 1)) {
      addEdge(i + 1, j, i + 1, j + 1)
    }
    if (!inSet.has(cell + nx)) addEdge(i + 1, j + 1, i, j + 1)
    if (i === 0 || !inSet.has(cell - 1)) addEdge(i, j + 1, i, j)
  }

  const loops: Array<Array<[number, number]>> = []
  for (const [startKey, destinations] of edges) {
    while (destinations.length > 0) {
      const [startX, startY] = startKey.split(",").map(Number) as [
        number,
        number,
      ]
      const loop: Array<[number, number]> = [[startX, startY]]
      let current = destinations.pop()!

      while (current[0] !== startX || current[1] !== startY) {
        loop.push(current)
        const nextDestinations = edges.get(`${current[0]},${current[1]}`)
        if (!nextDestinations || nextDestinations.length === 0) break
        current = nextDestinations.pop()!
      }

      const simplified = loop.filter((point, index) => {
        const previous = loop[(index + loop.length - 1) % loop.length]!
        const next = loop[(index + 1) % loop.length]!
        const isVertical = previous[0] === point[0] && point[0] === next[0]
        const isHorizontal = previous[1] === point[1] && point[1] === next[1]
        return !isVertical && !isHorizontal
      })
      if (simplified.length >= 3) loops.push(simplified)
    }
  }

  return loops
}
