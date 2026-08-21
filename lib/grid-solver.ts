import type { LayerRef, PcbCopperPour, Point } from "circuit-json"
import {
  getSegmentIntersection,
  isPointInsidePolygon,
} from "@tscircuit/math-utils"
import {
  distanceToExistingCopperRegion,
  distanceToPrimitive,
  doesRectIntersectExistingCopperRegion,
  traceLoops,
} from "./geometry"
import type { LabeledLayer, LabeledProblem, PreparedProblem } from "./types"

const BLOCKED_BY_CONFLICTING_EXISTING_COPPER = -2

export const assignGridCells = (problem: PreparedProblem): LabeledProblem => {
  const { bounds, boardOutline, gridPitch } = problem
  const nx = Math.max(1, Math.round((bounds.maxX - bounds.minX) / gridPitch))
  const ny = Math.max(1, Math.round((bounds.maxY - bounds.minY) / gridPitch))
  const labeledLayers: LabeledLayer[] = []

  for (const layer of problem.layers) {
    const primitives = problem.primitives.filter((primitive) =>
      primitive.layers.includes(layer),
    )
    const existingCopperRegions = problem.existingCopperRegions.filter(
      (region) => region.layer === layer,
    )
    const labels = new Int32Array(nx * ny).fill(-1)

    for (let j = 0; j < ny; j++) {
      const y = bounds.minY + (j + 0.5) * gridPitch
      for (let i = 0; i < nx; i++) {
        const x = bounds.minX + (i + 0.5) * gridPitch
        if (!isPointInsidePolygon({ x, y }, boardOutline)) continue

        const halfPitch = gridPitch / 2
        const existingCopperNetIndexes = new Set(
          existingCopperRegions
            .filter((region) =>
              doesRectIntersectExistingCopperRegion(
                region,
                x - halfPitch,
                y - halfPitch,
                x + halfPitch,
                y + halfPitch,
              ),
            )
            .map((region) => region.netIndex),
        )
        if (existingCopperNetIndexes.size === 1) {
          labels[j * nx + i] = existingCopperNetIndexes.values().next().value!
          continue
        }
        if (existingCopperNetIndexes.size > 1) {
          labels[j * nx + i] = BLOCKED_BY_CONFLICTING_EXISTING_COPPER
          continue
        }

        let bestDistance = Number.POSITIVE_INFINITY
        let bestNetIndex = -1
        for (const region of existingCopperRegions) {
          const distance = distanceToExistingCopperRegion({ x, y }, region)
          if (distance < bestDistance) {
            bestDistance = distance
            bestNetIndex = region.netIndex
          }
        }
        for (const primitive of primitives) {
          const distance = distanceToPrimitive(primitive, x, y)
          if (distance < bestDistance) {
            bestDistance = distance
            bestNetIndex = primitive.netIndex
            if (distance === 0) break
          }
        }
        labels[j * nx + i] = bestNetIndex
      }
    }
    labeledLayers.push({ layer, labels, nx, ny })
  }

  return { ...problem, labeledLayers }
}

const getConnectedRegions = (labeledLayer: LabeledLayer) => {
  const { labels, nx, ny } = labeledLayer
  const component = new Int32Array(nx * ny).fill(-1)
  const regions: Array<{ netIndex: number; cells: number[] }> = []
  const stack: number[] = []

  for (let start = 0; start < nx * ny; start++) {
    if (component[start] !== -1 || labels[start]! < 0) continue
    const netIndex = labels[start]!
    const cells: number[] = []
    component[start] = regions.length
    stack.push(start)

    while (stack.length > 0) {
      const cell = stack.pop()!
      cells.push(cell)
      const i = cell % nx
      const j = Math.floor(cell / nx)
      const neighbors: number[] = []
      if (i > 0) neighbors.push(cell - 1)
      if (i < nx - 1) neighbors.push(cell + 1)
      if (j > 0) neighbors.push(cell - nx)
      if (j < ny - 1) neighbors.push(cell + nx)

      for (const neighbor of neighbors) {
        if (component[neighbor] === -1 && labels[neighbor] === netIndex) {
          component[neighbor] = regions.length
          stack.push(neighbor)
        }
      }
    }
    regions.push({ netIndex, cells })
  }

  return regions
}

const sanitizeIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_]+/g, "_")

type GridPoint = [number, number]

const getSignedLoopArea = (loop: GridPoint[]): number =>
  loop.reduce((area, point, index) => {
    const next = loop[(index + 1) % loop.length]!
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2

const getRightmostVertexIndex = (loop: GridPoint[]): number => {
  let rightmostIndex = 0
  for (let index = 1; index < loop.length; index++) {
    const point = loop[index]!
    const rightmost = loop[rightmostIndex]!
    if (
      point[0] > rightmost[0] ||
      (point[0] === rightmost[0] && point[1] < rightmost[1])
    ) {
      rightmostIndex = index
    }
  }
  return rightmostIndex
}

const bridgeHoleIntoContour = (
  contour: GridPoint[],
  hole: GridPoint[],
): GridPoint[] => {
  const holeVertexIndex = getRightmostVertexIndex(hole)
  const holeVertex = hole[holeVertexIndex]!
  let bridgeEdgeIndex = -1
  let bridgePoint: GridPoint | undefined
  const rayEndX = Math.max(...contour.map(([x]) => x)) + 1

  for (let edgeIndex = 0; edgeIndex < contour.length; edgeIndex++) {
    const start = contour[edgeIndex]!
    const end = contour[(edgeIndex + 1) % contour.length]!
    const intersection = getSegmentIntersection(
      { x: holeVertex[0], y: holeVertex[1] },
      { x: rayEndX, y: holeVertex[1] },
      { x: start[0], y: start[1] },
      { x: end[0], y: end[1] },
    )
    if (!intersection) continue
    if (!bridgePoint || intersection.x < bridgePoint[0]) {
      bridgeEdgeIndex = edgeIndex
      bridgePoint = [intersection.x, intersection.y]
    }
  }

  if (!bridgePoint) {
    throw new Error("Unable to connect a copper-pour cutout to its contour")
  }

  const holeFromBridge = Array.from(
    { length: hole.length },
    (_, offset) => hole[(holeVertexIndex + offset) % hole.length]!,
  )
  const contourAfterBridge: GridPoint[] = []
  let contourIndex = (bridgeEdgeIndex + 1) % contour.length
  while (true) {
    const point = contour[contourIndex]!
    if (point[0] !== bridgePoint[0] || point[1] !== bridgePoint[1]) {
      contourAfterBridge.push(point)
    }
    if (contourIndex === bridgeEdgeIndex) break
    contourIndex = (contourIndex + 1) % contour.length
  }

  // Circuit JSON polygon pours do not have inner rings. Walking to each hole,
  // around it in the opposite direction, and back along the same zero-width
  // bridge preserves one contour polygon while leaving the hole unfilled.
  return [
    bridgePoint,
    ...holeFromBridge,
    holeVertex,
    bridgePoint,
    ...contourAfterBridge,
  ]
}

const combineTracedLoops = (loops: GridPoint[][]): GridPoint[][] => {
  if (loops.length <= 1) return loops

  const outerLoopIndex = loops.reduce(
    (largestIndex, loop, index) =>
      Math.abs(getSignedLoopArea(loop)) >
      Math.abs(getSignedLoopArea(loops[largestIndex]!))
        ? index
        : largestIndex,
    0,
  )
  let contour =
    getSignedLoopArea(loops[outerLoopIndex]!) > 0
      ? [...loops[outerLoopIndex]!]
      : [...loops[outerLoopIndex]!].reverse()
  const holes = loops
    .filter((_, index) => index !== outerLoopIndex)
    .map((loop) =>
      getSignedLoopArea(loop) < 0 ? [...loop] : [...loop].reverse(),
    )
    .sort(
      (a, b) =>
        b[getRightmostVertexIndex(b)]![0] - a[getRightmostVertexIndex(a)]![0],
    )

  for (const hole of holes) {
    contour = bridgeHoleIntoContour(contour, hole)
  }
  return [contour]
}

export const buildPowerPourPolygons = (
  problem: LabeledProblem,
): PcbCopperPour[] => {
  const output: PcbCopperPour[] = []
  const minCells = Math.max(
    1,
    Math.round(problem.minRegionArea / problem.gridPitch ** 2),
  )

  for (const labeledLayer of problem.labeledLayers) {
    const regions = getConnectedRegions(labeledLayer)
    for (const [regionIndex, region] of regions.entries()) {
      const net = problem.nets[region.netIndex]
      if (!net?.isPower || region.cells.length < minCells) continue
      const loops = combineTracedLoops(
        traceLoops(region.cells, labeledLayer.nx),
      )

      for (const [loopIndex, loop] of loops.entries()) {
        const points: Point[] = loop.map(([i, j]) => ({
          x: Math.min(
            problem.bounds.maxX,
            problem.bounds.minX + i * problem.gridPitch,
          ),
          y: Math.min(
            problem.bounds.maxY,
            problem.bounds.minY + j * problem.gridPitch,
          ),
        }))
        output.push({
          type: "pcb_copper_pour",
          pcb_copper_pour_id: `pcb_copper_pour_${sanitizeIdPart(labeledLayer.layer)}_${sanitizeIdPart(net.sourceNet.source_net_id)}_${regionIndex}_${loopIndex}`,
          shape: "polygon",
          layer: labeledLayer.layer,
          source_net_id: net.sourceNet.source_net_id,
          covered_with_solder_mask: problem.coveredWithSolderMask,
          subcircuit_id: net.sourceNet.subcircuit_id,
          points,
        })
      }
    }
  }

  return output
}

export const getLayerColor = (layer: LayerRef): string =>
  layer === "top" ? "#c2453a" : layer === "bottom" ? "#5b7fd8" : "#c58b43"
