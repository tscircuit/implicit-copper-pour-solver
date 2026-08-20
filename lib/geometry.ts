import type { Point } from "circuit-json"
import type { CopperPrimitive } from "./types"

const distanceToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const vx = x2 - x1
  const vy = y2 - y1
  const lengthSquared = vx * vx + vy * vy
  const unclampedT =
    lengthSquared > 0 ? ((px - x1) * vx + (py - y1) * vy) / lengthSquared : 0
  const t = Math.max(0, Math.min(1, unclampedT))
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy))
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
