import type { Point } from "circuit-json"
import {
  clamp,
  distance,
  doBoundsOverlap,
  getBoundsFromPoints,
  getUnitVectorFromPointAToB,
  isPointInsidePolygon,
  pointToBoxDistance,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import {
  applyToPoint,
  compose,
  rotateDEG,
  translate,
  type Matrix,
} from "transformation-matrix"
import type { CopperPrimitive } from "./types"

type RectPrimitive = Extract<CopperPrimitive, { kind: "rect" }>

const rectTransforms = new WeakMap<
  RectPrimitive,
  { toLocal: Matrix; toWorld: Matrix }
>()

const getRectTransforms = (primitive: RectPrimitive) => {
  const cached = rectTransforms.get(primitive)
  if (cached) return cached

  const transforms = {
    // compose applies the rightmost operation first: move the world point to
    // the rectangle origin, then undo its counter-clockwise rotation.
    toLocal: compose(
      rotateDEG(-primitive.rotation),
      translate(-primitive.x, -primitive.y),
    ),
    // Rotate a rectangle-local point before translating it into board space.
    toWorld: compose(
      translate(primitive.x, primitive.y),
      rotateDEG(primitive.rotation),
    ),
  }
  rectTransforms.set(primitive, transforms)
  return transforms
}

export { isPointInsidePolygon }

const distanceToPolygon = (point: Point, polygon: Point[]): number => {
  if (isPointInsidePolygon(point, polygon)) return 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    best = Math.min(best, pointToSegmentDistance(point, start, end))
  }
  return best
}

export const distanceToPrimitive = (
  primitive: CopperPrimitive,
  px: number,
  py: number,
): number => {
  const point = { x: px, y: py }
  if (primitive.kind === "circle") {
    return Math.max(distance(point, primitive) - primitive.radius, 0)
  }

  if (primitive.kind === "segment") {
    return Math.max(
      pointToSegmentDistance(
        point,
        { x: primitive.x1, y: primitive.y1 },
        { x: primitive.x2, y: primitive.y2 },
      ) - primitive.halfWidth,
      0,
    )
  }

  if (primitive.kind === "polygon") {
    return distanceToPolygon(point, primitive.points)
  }

  const { toLocal } = getRectTransforms(primitive)
  return pointToBoxDistance(applyToPoint(toLocal, point), {
    center: { x: 0, y: 0 },
    width: primitive.halfWidth * 2,
    height: primitive.halfHeight * 2,
  })
}

export const getClosestPointOnPrimitive = (
  primitive: CopperPrimitive,
  point: Point,
): Point => {
  if (distanceToPrimitive(primitive, point.x, point.y) === 0) return point

  if (primitive.kind === "circle") {
    const center = { x: primitive.x, y: primitive.y }
    const direction = getUnitVectorFromPointAToB(center, point)
    return {
      x: primitive.x + direction.x * primitive.radius,
      y: primitive.y + direction.y * primitive.radius,
    }
  }

  if (primitive.kind === "segment") {
    const centerlinePoint = pointToSegmentClosestPoint(
      point,
      { x: primitive.x1, y: primitive.y1 },
      { x: primitive.x2, y: primitive.y2 },
    )
    const direction = getUnitVectorFromPointAToB(centerlinePoint, point)
    return {
      x: centerlinePoint.x + direction.x * primitive.halfWidth,
      y: centerlinePoint.y + direction.y * primitive.halfWidth,
    }
  }

  if (primitive.kind === "polygon") {
    let closestPoint = primitive.points[0]!
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < primitive.points.length; index++) {
      const start = primitive.points[index]!
      const end = primitive.points[(index + 1) % primitive.points.length]!
      const candidate = pointToSegmentClosestPoint(point, start, end)
      const candidateDistance = distance(point, candidate)
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        closestPoint = candidate
      }
    }
    return closestPoint
  }

  const { toLocal, toWorld } = getRectTransforms(primitive)
  const localPoint = applyToPoint(toLocal, point)
  return applyToPoint(toWorld, {
    x: clamp(localPoint.x, -primitive.halfWidth, primitive.halfWidth),
    y: clamp(localPoint.y, -primitive.halfHeight, primitive.halfHeight),
  })
}

export const doesSegmentCrossTrace = ({
  start,
  end,
  trace,
  clearance = 0,
}: {
  start: Point
  end: Point
  trace: Extract<CopperPrimitive, { kind: "segment" }>
  clearance?: number
}): boolean => {
  const blockingRadius = trace.halfWidth + clearance
  const pathBounds = getBoundsFromPoints([start, end])!
  const expandedPathBounds = {
    minX: pathBounds.minX - blockingRadius,
    minY: pathBounds.minY - blockingRadius,
    maxX: pathBounds.maxX + blockingRadius,
    maxY: pathBounds.maxY + blockingRadius,
  }
  const traceStart = { x: trace.x1, y: trace.y1 }
  const traceEnd = { x: trace.x2, y: trace.y2 }
  const traceBounds = getBoundsFromPoints([traceStart, traceEnd])!
  if (!doBoundsOverlap(traceBounds, expandedPathBounds)) {
    return false
  }

  return (
    segmentToSegmentMinDistance(start, end, traceStart, traceEnd) <=
    blockingRadius
  )
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
