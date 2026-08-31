import type { Point } from "circuit-json"
import {
  distance,
  doSegmentsIntersect,
  onSegment,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"

const pointsEqual = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

const simplifyRdpPath = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 2) return [...points]

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const ranges: Array<[number, number]> = [[0, points.length - 1]]

  while (ranges.length > 0) {
    const [firstIndex, lastIndex] = ranges.pop()!
    const first = points[firstIndex]!
    const last = points[lastIndex]!
    let furthestIndex = -1
    let furthestDistance = tolerance

    for (let index = firstIndex + 1; index < lastIndex; index++) {
      const segmentDistance = pointToSegmentDistance(
        points[index]!,
        first,
        last,
      )
      if (segmentDistance > furthestDistance) {
        furthestDistance = segmentDistance
        furthestIndex = index
      }
    }

    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1
      ranges.push([firstIndex, furthestIndex], [furthestIndex, lastIndex])
    }
  }

  return points.filter((_, index) => keep[index] === 1)
}

const getSignedArea = (points: Point[]): number => {
  let twiceArea = 0
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    const next = points[(index + 1) % points.length]!
    twiceArea += point.x * next.y - next.x * point.y
  }
  return twiceArea / 2
}

const crossProduct = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const simplifyOpenPath = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 2) return [...points]

  const turnSigns = points.map((_, index) => {
    if (index === 0 || index === points.length - 1) return 0
    return Math.sign(
      crossProduct(points[index - 1]!, points[index]!, points[index + 1]!),
    )
  })
  const anchorIndices = [0]
  for (let index = 1; index < points.length - 1; index++) {
    const turnSign = turnSigns[index]!
    if (turnSign === 0) continue
    const repeatsTurnDirection =
      turnSign === turnSigns[index - 1] || turnSign === turnSigns[index + 1]
    const previous = points[index - 1]!
    const point = points[index]!
    const next = points[index + 1]!
    const shortestLeg = Math.min(
      distance(point, previous),
      distance(next, point),
    )
    // Grid staircases alternate left/right turns with one grid-sized leg.
    // Repeated turns and larger isolated corners describe the real silhouette.
    if (repeatsTurnDirection || shortestLeg > tolerance) {
      anchorIndices.push(index)
    }
  }
  anchorIndices.push(points.length - 1)

  const simplified: Point[] = []
  for (let index = 0; index < anchorIndices.length - 1; index++) {
    const startIndex = anchorIndices[index]!
    const endIndex = anchorIndices[index + 1]!
    const section = simplifyRdpPath(
      points.slice(startIndex, endIndex + 1),
      tolerance,
    )
    simplified.push(...(index === 0 ? section : section.slice(1)))
  }
  return simplified
}

const isSimplePolygon = (points: Point[]): boolean => {
  for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
    const firstEndIndex = (firstIndex + 1) % points.length
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < points.length;
      secondIndex++
    ) {
      const secondEndIndex = (secondIndex + 1) % points.length
      const sharesEndpoint =
        firstIndex === secondIndex ||
        firstIndex === secondEndIndex ||
        firstEndIndex === secondIndex ||
        firstEndIndex === secondEndIndex
      if (sharesEndpoint) continue

      if (
        doSegmentsIntersect(
          points[firstIndex]!,
          points[firstEndIndex]!,
          points[secondIndex]!,
          points[secondEndIndex]!,
        )
      ) {
        return false
      }
    }
  }
  return true
}

const normalizePolygon = (polygon: Point[]): Point[] => {
  const points = polygon.filter(
    (point, index) => index === 0 || !pointsEqual(point, polygon[index - 1]!),
  )
  if (
    points.length > 1 &&
    pointsEqual(points[0]!, points[points.length - 1]!)
  ) {
    points.pop()
  }
  return points
}

const isPointStrictlyInsideSegment = (
  point: Point,
  start: Point,
  end: Point,
): boolean => {
  if (pointsEqual(point, start) || pointsEqual(point, end)) return false
  const cross = crossProduct(start, end, point)
  if (Math.abs(cross) > 1e-9) return false
  return onSegment(start, point, end)
}

const splitEdgesAtVertices = (
  polygon: Point[],
  allVertices: Point[],
): Point[] => {
  const result: Point[] = []
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const verticesOnEdge = allVertices
      .filter((point) => isPointStrictlyInsideSegment(point, start, end))
      .map((point) => ({
        point,
        position:
          Math.abs(dx) >= Math.abs(dy)
            ? (point.x - start.x) / dx
            : (point.y - start.y) / dy,
      }))
      .sort((a, b) => a.position - b.position)

    result.push(start)
    for (const { point } of verticesOnEdge) {
      if (!pointsEqual(result[result.length - 1]!, point)) result.push(point)
    }
  }
  return result
}

const isValidSimplification = (
  original: Point[],
  simplified: Point[],
): boolean => {
  if (simplified.length < 3) return false

  const originalArea = getSignedArea(original)
  const simplifiedArea = getSignedArea(simplified)
  const preservesOrientation =
    originalArea !== 0 &&
    simplifiedArea !== 0 &&
    Math.sign(originalArea) === Math.sign(simplifiedArea)

  return preservesOrientation && isSimplePolygon(simplified)
}

/**
 * Simplify a closed polygon with a Ramer-Douglas-Peucker pass.
 *
 * Polygon points are not expected to repeat the first point at the end. Invalid
 * simplifications fall back to the original polygon so this stage cannot emit a
 * degenerate, orientation-flipped, or self-intersecting result.
 */
export const simplifyPolygonEdges = (
  polygon: Point[],
  tolerance: number,
): Point[] => {
  const points = normalizePolygon(polygon)
  if (points.length < 4 || tolerance <= 0) return points

  const closedPath = [...points, points[0]!]
  const simplified = simplifyOpenPath(closedPath, tolerance)
  if (pointsEqual(simplified[0]!, simplified[simplified.length - 1]!)) {
    simplified.pop()
  }

  if (!isValidSimplification(points, simplified)) return points

  return simplified
}

const getPointKey = (point: Point): string => `${point.x},${point.y}`

const getEdgeKey = (start: Point, end: Point): string => {
  const startKey = getPointKey(start)
  const endKey = getPointKey(end)
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`
}

const getPathKey = (points: Point[]): string =>
  points.map(getPointKey).join("|")

const canonicalizeOpenPath = (
  points: Point[],
): { points: Point[]; reversed: boolean; key: string } => {
  const forwardKey = getPathKey(points)
  const reversedPoints = [...points].reverse()
  const reverseKey = getPathKey(reversedPoints)
  return forwardKey <= reverseKey
    ? { points: [...points], reversed: false, key: forwardKey }
    : { points: reversedPoints, reversed: true, key: reverseKey }
}

interface EdgeReference {
  polygonIndex: number
  edgeIndex: number
}

interface Arc {
  original: Point[]
  simplified: Point[]
  disabled: boolean
}

interface ChainReference {
  arcKey: string
  reversed: boolean
}

type PolygonTopology =
  | { original: Point[]; mode: "fixed" }
  | { original: Point[]; mode: "standalone"; simplified: Point[] }
  | { original: Point[]; mode: "chains"; chains: ChainReference[] }

const getBoundaryLabels = (polygons: Point[][]): string[][] => {
  const referencesByEdge = new Map<string, EdgeReference[]>()

  for (const [polygonIndex, points] of polygons.entries()) {
    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex++) {
      const key = getEdgeKey(
        points[edgeIndex]!,
        points[(edgeIndex + 1) % points.length]!,
      )
      const references = referencesByEdge.get(key) ?? []
      references.push({ polygonIndex, edgeIndex })
      referencesByEdge.set(key, references)
    }
  }

  const labels = polygons.map((points, polygonIndex) =>
    points.map(() => `outer:${polygonIndex}`),
  )

  for (const references of referencesByEdge.values()) {
    if (
      references.length !== 2 ||
      references[0]!.polygonIndex === references[1]!.polygonIndex
    ) {
      continue
    }
    const firstPolygon = references[0]!.polygonIndex
    const secondPolygon = references[1]!.polygonIndex
    const pair =
      firstPolygon < secondPolygon
        ? `${firstPolygon}:${secondPolygon}`
        : `${secondPolygon}:${firstPolygon}`
    for (const reference of references) {
      labels[reference.polygonIndex]![reference.edgeIndex] = `shared:${pair}`
    }
  }

  return labels
}

const getChainPoints = (
  polygon: Point[],
  startVertex: number,
  endVertex: number,
): Point[] => {
  const points = [polygon[startVertex]!]
  let edgeIndex = startVertex
  while (edgeIndex !== endVertex) {
    points.push(polygon[(edgeIndex + 1) % polygon.length]!)
    edgeIndex = (edgeIndex + 1) % polygon.length
  }
  return points
}

const buildPolygonFromChains = (
  topology: Extract<PolygonTopology, { mode: "chains" }>,
  arcs: Map<string, Arc>,
): Point[] => {
  const points: Point[] = []

  for (const chain of topology.chains) {
    const arc = arcs.get(chain.arcKey)!
    const selectedPoints = arc.disabled ? arc.original : arc.simplified
    const path = chain.reversed ? [...selectedPoints].reverse() : selectedPoints

    if (points.length === 0) {
      points.push(...path)
    } else if (pointsEqual(points[points.length - 1]!, path[0]!)) {
      points.push(...path.slice(1))
    } else {
      return []
    }
  }

  if (
    points.length > 1 &&
    pointsEqual(points[0]!, points[points.length - 1]!)
  ) {
    points.pop()
  }
  return points
}

/**
 * Simplify a set of polygons while preserving their shared boundary topology.
 *
 * Polygons in the set must belong to the same surface (for example, the same
 * copper layer). Shared rectilinear chains are simplified once and reused in
 * reverse by the adjacent polygon, preventing overlaps and gaps. Junctions
 * between shared and exposed boundaries are retained as fixed anchors.
 */
export const simplifyPolygonSetEdges = (
  polygons: Point[][],
  tolerance: number,
): Point[][] => {
  const initiallyNormalizedPolygons = polygons.map(normalizePolygon)
  const allVertices = initiallyNormalizedPolygons.flat()
  const normalizedPolygons = initiallyNormalizedPolygons.map((polygon) =>
    splitEdgesAtVertices(polygon, allVertices),
  )
  if (tolerance <= 0 || normalizedPolygons.length === 0) {
    return normalizedPolygons
  }

  const labels = getBoundaryLabels(normalizedPolygons)
  const arcs = new Map<string, Arc>()
  const topologies: PolygonTopology[] = []

  for (const [polygonIndex, polygon] of normalizedPolygons.entries()) {
    if (polygon.length < 4) {
      topologies.push({ original: polygon, mode: "fixed" })
      continue
    }

    const polygonLabels = labels[polygonIndex]!
    // Label transitions are topology junctions. They split the ring into arcs
    // whose endpoints must not move during simplification.
    const transitionVertices = polygonLabels.flatMap((label, vertexIndex) =>
      polygonLabels[(vertexIndex + polygon.length - 1) % polygon.length] ===
      label
        ? []
        : [vertexIndex],
    )

    if (transitionVertices.length === 0) {
      if (polygonLabels[0]?.startsWith("shared:")) {
        topologies.push({ original: polygon, mode: "fixed" })
      } else {
        topologies.push({
          original: polygon,
          mode: "standalone",
          simplified: simplifyPolygonEdges(polygon, tolerance),
        })
      }
      continue
    }

    const chains: ChainReference[] = []
    for (
      let chainIndex = 0;
      chainIndex < transitionVertices.length;
      chainIndex++
    ) {
      const startVertex = transitionVertices[chainIndex]!
      const endVertex =
        transitionVertices[(chainIndex + 1) % transitionVertices.length]!
      const chainPoints = getChainPoints(polygon, startVertex, endVertex)
      const label = polygonLabels[startVertex]!

      if (label.startsWith("shared:")) {
        const canonical = canonicalizeOpenPath(chainPoints)
        const arcKey = `${label}:${canonical.key}`
        if (!arcs.has(arcKey)) {
          arcs.set(arcKey, {
            original: canonical.points,
            simplified: simplifyOpenPath(canonical.points, tolerance),
            disabled: false,
          })
        }
        chains.push({ arcKey, reversed: canonical.reversed })
      } else {
        const arcKey = `outer:${polygonIndex}:${chainIndex}`
        arcs.set(arcKey, {
          original: chainPoints,
          simplified: simplifyOpenPath(chainPoints, tolerance),
          disabled: false,
        })
        chains.push({ arcKey, reversed: false })
      }
    }
    topologies.push({ original: polygon, mode: "chains", chains })
  }

  // Validate whole polygons after composing their arcs. If an arc creates an
  // invalid polygon, disable it globally so its neighboring polygon also uses
  // the original shared geometry instead of reopening a crack.
  let candidates = normalizedPolygons
  for (let pass = 0; pass <= arcs.size; pass++) {
    candidates = topologies.map((topology) => {
      if (topology.mode === "fixed") return topology.original
      if (topology.mode === "standalone") return topology.simplified
      return buildPolygonFromChains(topology, arcs)
    })

    const invalidPolygonIndices = candidates.flatMap((candidate, index) =>
      isValidSimplification(topologies[index]!.original, candidate)
        ? []
        : [index],
    )
    if (invalidPolygonIndices.length === 0) return candidates

    let disabledAnArc = false
    for (const polygonIndex of invalidPolygonIndices) {
      const topology = topologies[polygonIndex]!
      if (topology.mode !== "chains") continue
      for (const chain of topology.chains) {
        const arc = arcs.get(chain.arcKey)!
        if (!arc.disabled) {
          arc.disabled = true
          disabledAnArc = true
        }
      }
    }
    if (!disabledAnArc) {
      return candidates.map((candidate, index) =>
        invalidPolygonIndices.includes(index)
          ? topologies[index]!.original
          : candidate,
      )
    }
  }

  return normalizedPolygons
}
