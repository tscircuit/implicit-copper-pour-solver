import type { Point } from "circuit-json"
import {
  areBoundsCompletelyInsidePolygon,
  areBoundsOverlappingPolygon,
  distance,
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { applyToPoint, rotateDEG } from "transformation-matrix"
import type { CopperPrimitive, ExistingCopperRegion } from "./types"

const distanceToPolygonBoundary = (point: Point, polygon: Point[]): number => {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    best = Math.min(best, pointToSegmentDistance(point, start, end))
  }
  return best
}

export const distanceToPolygon = (point: Point, polygon: Point[]): number => {
  if (isPointInsidePolygon(point, polygon)) return 0
  return distanceToPolygonBoundary(point, polygon)
}

export const distanceToExistingCopperRegion = (
  point: Point,
  region: ExistingCopperRegion,
): number => {
  if (!isPointInsidePolygon(point, region.outerRing)) {
    return distanceToPolygonBoundary(point, region.outerRing)
  }

  const containingHole = region.innerRings.find((ring) =>
    isPointInsidePolygon(point, ring),
  )
  return containingHole ? distanceToPolygonBoundary(point, containingHole) : 0
}

export const doesRectIntersectExistingCopperRegion = (
  region: ExistingCopperRegion,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean => {
  const bounds = { minX, minY, maxX, maxY }
  if (!areBoundsOverlappingPolygon(bounds, region.outerRing)) {
    return false
  }

  const containingHole = region.innerRings.find((ring) =>
    areBoundsCompletelyInsidePolygon(bounds, ring),
  )
  return containingHole === undefined
}

export const distanceToPrimitive = (
  primitive: CopperPrimitive,
  px: number,
  py: number,
): number => {
  if (primitive.kind === "circle") {
    return Math.max(
      distance({ x: px, y: py }, { x: primitive.x, y: primitive.y }) -
        primitive.radius,
      0,
    )
  }

  if (primitive.kind === "segment") {
    return Math.max(
      pointToSegmentDistance(
        { x: px, y: py },
        { x: primitive.x1, y: primitive.y1 },
        { x: primitive.x2, y: primitive.y2 },
      ) - primitive.halfWidth,
      0,
    )
  }

  if (primitive.kind === "polygon") {
    return distanceToPolygon({ x: px, y: py }, primitive.points)
  }

  const localPoint = applyToPoint(
    rotateDEG(-primitive.rotation, primitive.x, primitive.y),
    { x: px, y: py },
  )
  const outsideX = Math.max(
    Math.abs(localPoint.x - primitive.x) - primitive.halfWidth,
    0,
  )
  const outsideY = Math.max(
    Math.abs(localPoint.y - primitive.y) - primitive.halfHeight,
    0,
  )
  return distance({ x: 0, y: 0 }, { x: outsideX, y: outsideY })
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
