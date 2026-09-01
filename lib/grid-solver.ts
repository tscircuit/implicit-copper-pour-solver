import type { LayerRef, PcbCopperPour, Point } from "circuit-json"
import {
  clamp,
  distSq,
  getBoundsFromPoints,
  grid,
  type GridCellPositions,
  midpoint,
  pointToSegmentClosestPoint,
} from "@tscircuit/math-utils"
import { applyToPoint, compose, scale, translate } from "transformation-matrix"
import {
  distanceToPrimitive,
  doesSegmentCrossTrace,
  getClosestPointOnPrimitive,
  isPointInsidePolygon,
  traceLoops,
} from "./geometry"
import type {
  CopperPrimitive,
  LabeledLayer,
  LabeledProblem,
  PreparedProblem,
} from "./types"

const BLOCKED_CELL_LOCAL_REPAIR_RADIUS = 2
// A connection survives downstream clipping only when part of the complete
// shared cell edge remains outside the union of foreign trace clearances.
const CELL_BOUNDARY_SAMPLE_COUNT = 9

interface TraceClearanceBarrier {
  netIndex: number
  start: Point
  end: Point
  radiusSquared: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface ClearanceConnectivityContext {
  labels: Int32Array
  nx: number
  traceBarriers: TraceClearanceBarrier[]
  gridCells: GridCellPositions[]
  gridPitch: number
  canCrossGridEdgeByNetIndex: Map<number, CanCrossGridEdge>
}

type CanCrossGridEdge = (startCell: number, endCell: number) => boolean

const getGridNeighbors = (
  cell: number,
  { nx, ny }: Pick<LabeledLayer, "nx" | "ny">,
): number[] => {
  const i = cell % nx
  const j = Math.floor(cell / nx)
  const neighbors: number[] = []
  if (i > 0) neighbors.push(cell - 1)
  if (i < nx - 1) neighbors.push(cell + 1)
  if (j > 0) neighbors.push(cell - nx)
  if (j < ny - 1) neighbors.push(cell + nx)
  return neighbors
}

const createCanCrossGridEdgeForNet = (
  netIndex: number,
  ctx: ClearanceConnectivityContext,
): CanCrossGridEdge => {
  const crossingCache = new Uint8Array(ctx.labels.length * 2)
  return (startCell, endCell) => {
    const edgeIndex =
      Math.min(startCell, endCell) * 2 +
      (Math.abs(startCell - endCell) === ctx.nx ? 1 : 0)
    const cachedCrossing = crossingCache[edgeIndex]
    if (cachedCrossing !== 0) return cachedCrossing === 1

    const start = ctx.gridCells[startCell]!.center
    const end = ctx.gridCells[endCell]!.center
    const boundaryMidpoint = midpoint(start, end)
    const isHorizontalNeighbor = start.y === end.y
    const boundary = isHorizontalNeighbor
      ? {
          minX: boundaryMidpoint.x,
          minY: boundaryMidpoint.y - ctx.gridPitch / 2,
          maxX: boundaryMidpoint.x,
          maxY: boundaryMidpoint.y + ctx.gridPitch / 2,
        }
      : {
          minX: boundaryMidpoint.x - ctx.gridPitch / 2,
          minY: boundaryMidpoint.y,
          maxX: boundaryMidpoint.x + ctx.gridPitch / 2,
          maxY: boundaryMidpoint.y,
        }
    let blockedSamples = 0
    const allSamplesBlocked = (1 << CELL_BOUNDARY_SAMPLE_COUNT) - 1

    for (const trace of ctx.traceBarriers) {
      if (
        trace.netIndex === netIndex ||
        trace.maxX < boundary.minX ||
        trace.minX > boundary.maxX ||
        trace.maxY < boundary.minY ||
        trace.minY > boundary.maxY
      ) {
        continue
      }

      for (
        let sampleIndex = 0;
        sampleIndex < CELL_BOUNDARY_SAMPLE_COUNT;
        sampleIndex++
      ) {
        const sampleBit = 1 << sampleIndex
        if ((blockedSamples & sampleBit) !== 0) continue
        const offset =
          -ctx.gridPitch / 2 +
          (ctx.gridPitch * sampleIndex) / (CELL_BOUNDARY_SAMPLE_COUNT - 1)
        const point = isHorizontalNeighbor
          ? { x: boundaryMidpoint.x, y: boundaryMidpoint.y + offset }
          : { x: boundaryMidpoint.x + offset, y: boundaryMidpoint.y }
        const closestTracePoint = pointToSegmentClosestPoint(
          point,
          trace.start,
          trace.end,
        )
        if (distSq(point, closestTracePoint) <= trace.radiusSquared) {
          blockedSamples |= sampleBit
        }
      }
      if (blockedSamples === allSamplesBlocked) {
        crossingCache[edgeIndex] = 2
        return false
      }
    }
    crossingCache[edgeIndex] = 1
    return true
  }
}

const getCanCrossGridEdgeForNet = (
  netIndex: number,
  ctx: ClearanceConnectivityContext,
): CanCrossGridEdge => {
  let canCrossGridEdge = ctx.canCrossGridEdgeByNetIndex.get(netIndex)
  if (!canCrossGridEdge) {
    canCrossGridEdge = createCanCrossGridEdgeForNet(netIndex, ctx)
    ctx.canCrossGridEdgeByNetIndex.set(netIndex, canCrossGridEdge)
  }
  return canCrossGridEdge
}

/**
 * Reassign or omit labeled cell components that cannot reach copper belonging
 * to their net once foreign traces are expanded by downstream clearance.
 */
const normalizeClearanceSeparatedRegions = ({
  labeledLayer,
  insideCells,
  connectivitySeedNetIndices,
  traceBarriers,
  gridCells,
  traceClearance,
  gridPitch,
}: {
  labeledLayer: LabeledLayer
  insideCells: Uint8Array
  connectivitySeedNetIndices: Int32Array
  traceBarriers: Array<Extract<CopperPrimitive, { kind: "segment" }>>
  gridCells: GridCellPositions[]
  traceClearance: number
  gridPitch: number
}): void => {
  if (traceClearance === 0) return

  const { labels, nx, ny } = labeledLayer
  const clearanceTraceBarriers: TraceClearanceBarrier[] = traceBarriers.map(
    (trace) => {
      const radius = trace.halfWidth + traceClearance
      const start = { x: trace.x1, y: trace.y1 }
      const end = { x: trace.x2, y: trace.y2 }
      const centerlineBounds = getBoundsFromPoints([start, end])!
      return {
        netIndex: trace.netIndex,
        start,
        end,
        radiusSquared: radius ** 2,
        minX: centerlineBounds.minX - radius,
        minY: centerlineBounds.minY - radius,
        maxX: centerlineBounds.maxX + radius,
        maxY: centerlineBounds.maxY + radius,
      }
    },
  )
  const clearanceConnectivityContext: ClearanceConnectivityContext = {
    labels,
    nx,
    traceBarriers: clearanceTraceBarriers,
    gridCells,
    gridPitch,
    canCrossGridEdgeByNetIndex: new Map<number, CanCrossGridEdge>(),
  }
  const reachableCells = new Uint8Array(labels.length)
  const queue: number[] = []

  for (let cell = 0; cell < labels.length; cell++) {
    if (
      insideCells[cell] !== 1 ||
      connectivitySeedNetIndices[cell] !== labels[cell]
    ) {
      continue
    }
    reachableCells[cell] = 1
    queue.push(cell)
  }

  let queueIndex = 0
  while (queueIndex < queue.length) {
    const cell = queue[queueIndex++]!
    const netIndex = labels[cell]!
    for (const neighbor of getGridNeighbors(cell, labeledLayer)) {
      if (
        insideCells[neighbor] !== 1 ||
        reachableCells[neighbor] === 1 ||
        labels[neighbor] !== netIndex ||
        !getCanCrossGridEdgeForNet(netIndex, clearanceConnectivityContext)(
          cell,
          neighbor,
        )
      ) {
        continue
      }
      reachableCells[neighbor] = 1
      queue.push(neighbor)
    }
  }

  const visitedCells = new Uint8Array(labels.length)
  const relabels: Array<{ cells: number[]; netIndex: number }> = []

  for (let start = 0; start < labels.length; start++) {
    if (
      insideCells[start] !== 1 ||
      labels[start]! < 0 ||
      reachableCells[start] === 1 ||
      visitedCells[start] === 1
    ) {
      continue
    }

    const netIndex = labels[start]!
    const component: number[] = []
    const componentQueue = [start]
    visitedCells[start] = 1

    while (componentQueue.length > 0) {
      const cell = componentQueue.pop()!
      component.push(cell)
      for (const neighbor of getGridNeighbors(cell, labeledLayer)) {
        if (
          insideCells[neighbor] !== 1 ||
          visitedCells[neighbor] === 1 ||
          reachableCells[neighbor] === 1 ||
          labels[neighbor] !== netIndex ||
          !getCanCrossGridEdgeForNet(netIndex, clearanceConnectivityContext)(
            cell,
            neighbor,
          )
        ) {
          continue
        }
        visitedCells[neighbor] = 1
        componentQueue.push(neighbor)
      }
    }

    const sharedEdgesByNetIndex = new Map<number, number>()
    for (const cell of component) {
      for (const neighbor of getGridNeighbors(cell, labeledLayer)) {
        const neighborNetIndex = labels[neighbor]!
        if (
          reachableCells[neighbor] !== 1 ||
          neighborNetIndex < 0 ||
          neighborNetIndex === netIndex ||
          !getCanCrossGridEdgeForNet(
            neighborNetIndex,
            clearanceConnectivityContext,
          )(cell, neighbor)
        ) {
          continue
        }
        sharedEdgesByNetIndex.set(
          neighborNetIndex,
          (sharedEdgesByNetIndex.get(neighborNetIndex) ?? 0) + 1,
        )
      }
    }

    const targetNetIndex = [...sharedEdgesByNetIndex.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0]
    if (targetNetIndex !== undefined) {
      relabels.push({ cells: component, netIndex: targetNetIndex })
    } else {
      relabels.push({ cells: component, netIndex: -1 })
    }
  }

  for (const relabel of relabels) {
    for (const cell of relabel.cells) labels[cell] = relabel.netIndex
  }
}

const normalizeBlockedCellBoundaries = ({
  labeledLayer,
  insideCells,
  visibleCells,
  traceBarriers,
  gridCells,
  traceClearance,
}: {
  labeledLayer: LabeledLayer
  insideCells: Uint8Array
  visibleCells: Uint8Array
  traceBarriers: Array<Extract<CopperPrimitive, { kind: "segment" }>>
  gridCells: GridCellPositions[]
  traceClearance: number
}): void => {
  const { labels, nx, ny } = labeledLayer
  const netIndices = new Set<number>()

  for (let cell = 0; cell < labels.length; cell++) {
    if (visibleCells[cell] === 1 && labels[cell]! >= 0) {
      netIndices.add(labels[cell]!)
    }
  }

  const distancesByNet = new Map<number, Int8Array>()
  for (const netIndex of netIndices) {
    const distances = new Int8Array(labels.length).fill(-1)
    const queue: number[] = []
    for (let cell = 0; cell < labels.length; cell++) {
      if (visibleCells[cell] !== 1 || labels[cell] !== netIndex) continue
      distances[cell] = 0
      queue.push(cell)
    }

    let queueIndex = 0
    while (queueIndex < queue.length) {
      const cell = queue[queueIndex++]!
      // Repair only the shallow fallback band. Deeper blocked territory keeps
      // its nearest-net ownership instead of being globally repartitioned.
      if (distances[cell]! >= BLOCKED_CELL_LOCAL_REPAIR_RADIUS) continue
      const i = cell % nx
      const j = Math.floor(cell / nx)
      const neighbors: number[] = []
      if (i > 0) neighbors.push(cell - 1)
      if (i < nx - 1) neighbors.push(cell + 1)
      if (j > 0) neighbors.push(cell - nx)
      if (j < ny - 1) neighbors.push(cell + nx)
      const start = gridCells[cell]!.center

      for (const neighbor of neighbors) {
        if (
          insideCells[neighbor] !== 1 ||
          distances[neighbor]! >= 0 ||
          (visibleCells[neighbor] === 1 && labels[neighbor] !== netIndex)
        ) {
          continue
        }
        const end = gridCells[neighbor]!.center
        const isBlocked = traceBarriers.some(
          (trace) =>
            trace.netIndex !== netIndex &&
            doesSegmentCrossTrace({
              start,
              end,
              trace,
              clearance: traceClearance,
            }),
        )
        if (isBlocked) continue

        distances[neighbor] = distances[cell]! + 1
        queue.push(neighbor)
      }
    }
    distancesByNet.set(netIndex, distances)
  }

  const relabels: Array<{ cell: number; netIndex: number }> = []
  for (let cell = 0; cell < labels.length; cell++) {
    const currentNetIndex = labels[cell]!
    if (
      insideCells[cell] !== 1 ||
      currentNetIndex < 0 ||
      visibleCells[cell] === 1
    )
      continue

    const currentDistance = distancesByNet.get(currentNetIndex)?.[cell] ?? -1
    const target = Array.from(distancesByNet.entries())
      .map(([netIndex, distances]) => ({
        netIndex,
        distance: distances[cell]!,
      }))
      .filter(
        (candidate) =>
          candidate.netIndex !== currentNetIndex &&
          candidate.distance >= 0 &&
          (currentDistance < 0 || candidate.distance < currentDistance),
      )
      .sort((a, b) => a.distance - b.distance)[0]
    if (target) relabels.push({ cell, netIndex: target.netIndex })
  }

  for (const relabel of relabels) {
    labels[relabel.cell] = relabel.netIndex
  }
}

export const assignGridCells = (problem: PreparedProblem): LabeledProblem => {
  const {
    bounds,
    boardOutline,
    gridPitch,
    regionNormalizationArea,
    traceClearance,
  } = problem
  const nx = Math.max(1, Math.round((bounds.maxX - bounds.minX) / gridPitch))
  const ny = Math.max(1, Math.round((bounds.maxY - bounds.minY) / gridPitch))
  const normalizationMinCells = Math.max(
    1,
    Math.round(regionNormalizationArea / gridPitch ** 2),
  )
  const gridCells = grid({
    rows: ny,
    cols: nx,
    xSpacing: gridPitch,
    ySpacing: gridPitch,
    offsetX: bounds.minX,
    offsetY: bounds.minY,
    yDirection: "up-is-negative",
    centered: false,
  })
  const labeledLayers: LabeledLayer[] = []

  for (const layer of problem.layers) {
    const powerPrimitives = problem.primitives.filter(
      (primitive) =>
        primitive.layers.includes(layer) &&
        problem.nets[primitive.netIndex]?.isPower,
    )
    const traceBarriers = problem.primitives.filter(
      (primitive): primitive is Extract<CopperPrimitive, { kind: "segment" }> =>
        primitive.kind === "segment" &&
        primitive.isTrace === true &&
        primitive.layers.includes(layer),
    )
    const labels = new Int32Array(nx * ny).fill(-1)
    const anchoredCells = new Uint8Array(nx * ny)
    const insideCells = new Uint8Array(nx * ny)
    const visibleCells = new Uint8Array(nx * ny)
    const connectivitySeedNetIndices = new Int32Array(nx * ny).fill(-1)
    // Every power primitive is guaranteed a nearby seed even when the coarse
    // grid has no sample centered directly on its copper.
    const gridCellHalfDiagonal = (gridPitch * Math.SQRT2) / 2

    for (const { index: cell, center: point } of gridCells) {
      if (!isPointInsidePolygon(point, boardOutline)) continue
      insideCells[cell] = 1

      const candidates = powerPrimitives
        .map((primitive) => ({
          primitive,
          distance: distanceToPrimitive(primitive, point.x, point.y),
        }))
        .sort((a, b) => a.distance - b.distance)
      let bestNetIndex = candidates[0]?.primitive.netIndex ?? -1
      let bestDistance = candidates[0]?.distance ?? Number.POSITIVE_INFINITY
      let isAnchored = false
      let hasVisibleCandidate = false

      for (const candidate of candidates) {
        if (candidate.distance === 0) {
          bestNetIndex = candidate.primitive.netIndex
          bestDistance = candidate.distance
          isAnchored = true
          hasVisibleCandidate = true
          break
        }
        const closestPoint = getClosestPointOnPrimitive(
          candidate.primitive,
          point,
        )
        const isBlocked = traceBarriers.some(
          (trace) =>
            trace.netIndex !== candidate.primitive.netIndex &&
            doesSegmentCrossTrace({
              start: point,
              end: closestPoint,
              trace,
              clearance: traceClearance,
            }),
        )
        if (!isBlocked) {
          bestNetIndex = candidate.primitive.netIndex
          bestDistance = candidate.distance
          hasVisibleCandidate = true
          break
        }
      }
      labels[cell] = bestNetIndex
      if (isAnchored) anchoredCells[cell] = 1
      if (hasVisibleCandidate) visibleCells[cell] = 1
      if (hasVisibleCandidate && bestDistance <= gridCellHalfDiagonal) {
        connectivitySeedNetIndices[cell] = bestNetIndex
      }
    }
    const labeledLayer = { layer, labels, nx, ny }
    normalizeBlockedCellBoundaries({
      labeledLayer,
      insideCells,
      visibleCells,
      traceBarriers,
      gridCells,
      traceClearance,
    })
    normalizeClearanceSeparatedRegions({
      labeledLayer,
      insideCells,
      connectivitySeedNetIndices,
      traceBarriers,
      gridCells,
      traceClearance,
      gridPitch,
    })
    normalizeLabeledLayerRegions(
      labeledLayer,
      anchoredCells,
      normalizationMinCells,
    )
    labeledLayers.push(labeledLayer)
  }

  return { ...problem, labeledLayers }
}

const getConnectedRegionMap = (labeledLayer: LabeledLayer) => {
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

  return { component, regions }
}

const getConnectedRegions = (labeledLayer: LabeledLayer) =>
  getConnectedRegionMap(labeledLayer).regions

export const normalizeLabeledLayerRegions = (
  labeledLayer: LabeledLayer,
  anchoredCells: Uint8Array,
  minRegionCells: number,
): void => {
  if (minRegionCells <= 1) return

  while (true) {
    const { component, regions } = getConnectedRegionMap(labeledLayer)
    const relabels: Array<{ cells: number[]; netIndex: number }> = []

    for (const region of regions) {
      if (
        region.cells.length >= minRegionCells ||
        region.cells.some((cell) => anchoredCells[cell] === 1)
      ) {
        continue
      }

      const sharedEdgesByRegionIndex = new Map<number, number>()
      for (const cell of region.cells) {
        const i = cell % labeledLayer.nx
        const j = Math.floor(cell / labeledLayer.nx)
        const neighbors: number[] = []
        if (i > 0) neighbors.push(cell - 1)
        if (i < labeledLayer.nx - 1) neighbors.push(cell + 1)
        if (j > 0) neighbors.push(cell - labeledLayer.nx)
        if (j < labeledLayer.ny - 1) neighbors.push(cell + labeledLayer.nx)

        for (const neighbor of neighbors) {
          const neighborRegionIndex = component[neighbor]!
          if (
            neighborRegionIndex < 0 ||
            regions[neighborRegionIndex] === region
          ) {
            continue
          }
          sharedEdgesByRegionIndex.set(
            neighborRegionIndex,
            (sharedEdgesByRegionIndex.get(neighborRegionIndex) ?? 0) + 1,
          )
        }
      }

      const targetRegion = [...sharedEdgesByRegionIndex.entries()]
        .map(([regionIndex, sharedEdges]) => ({
          region: regions[regionIndex]!,
          sharedEdges,
        }))
        .filter(
          (candidate) => candidate.region.cells.length > region.cells.length,
        )
        .sort(
          (a, b) =>
            b.sharedEdges - a.sharedEdges ||
            b.region.cells.length - a.region.cells.length,
        )[0]?.region

      if (targetRegion) {
        relabels.push({
          cells: region.cells,
          netIndex: targetRegion.netIndex,
        })
      }
    }

    if (relabels.length === 0) return
    for (const relabel of relabels) {
      for (const cell of relabel.cells) {
        labeledLayer.labels[cell] = relabel.netIndex
      }
    }
  }
}

const getConnectedCellGroups = (cells: number[], nx: number): number[][] => {
  const remaining = new Set(cells)
  const groups: number[][] = []
  const stack: number[] = []

  while (remaining.size > 0) {
    const start = remaining.values().next().value!
    const group: number[] = []
    remaining.delete(start)
    stack.push(start)

    while (stack.length > 0) {
      const cell = stack.pop()!
      group.push(cell)
      const i = cell % nx
      const neighbors = [cell - nx, cell + nx]
      if (i > 0) neighbors.push(cell - 1)
      if (i < nx - 1) neighbors.push(cell + 1)

      for (const neighbor of neighbors) {
        if (!remaining.has(neighbor)) continue
        remaining.delete(neighbor)
        stack.push(neighbor)
      }
    }
    groups.push(group)
  }

  return groups
}

const getAbsoluteGridLoopArea = (loop: Array<[number, number]>): number =>
  Math.abs(
    loop.reduce((area, point, index) => {
      const next = loop[(index + 1) % loop.length]!
      return area + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2,
  )

/**
 * A Circuit JSON polygon has one ring, so a connected cell region containing a
 * hole cannot be emitted directly. Cut such regions horizontally through one
 * hole at a time and trace the resulting simply-connected pieces instead.
 * Together the pieces contain exactly the original cells without overlap.
 */
const splitRegionIntoHoleFreeCellGroups = (
  cells: number[],
  nx: number,
): number[][] => {
  const pending = [cells]
  const output: number[][] = []

  while (pending.length > 0) {
    const group = pending.pop()!
    const loops = traceLoops(group, nx)
    if (loops.length <= 1) {
      output.push(group)
      continue
    }

    const outerLoopIndex = loops.reduce(
      (largestIndex, loop, index) =>
        getAbsoluteGridLoopArea(loop) >
        getAbsoluteGridLoopArea(loops[largestIndex]!)
          ? index
          : largestIndex,
      0,
    )
    const hole = loops.find((_, index) => index !== outerLoopIndex)!
    const holeYs = hole.map((point) => point[1])
    const cutY = Math.round((Math.min(...holeYs) + Math.max(...holeYs)) / 2)
    const belowCut = group.filter((cell) => Math.floor(cell / nx) < cutY)
    const aboveCut = group.filter((cell) => Math.floor(cell / nx) >= cutY)
    const splitGroups = [belowCut, aboveCut]
      .filter((part) => part.length > 0)
      .flatMap((part) => getConnectedCellGroups(part, nx))

    if (
      splitGroups.length < 2 ||
      splitGroups.some((part) => part.length === group.length)
    ) {
      throw new Error("Unable to split an implicit copper region around a hole")
    }
    pending.push(...splitGroups)
  }

  return output
}

const sanitizeIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_]+/g, "_")

export const buildPowerPourPolygons = (
  problem: LabeledProblem,
): PcbCopperPour[] => {
  const output: PcbCopperPour[] = []
  const minCells = Math.max(
    1,
    Math.round(problem.minRegionArea / problem.gridPitch ** 2),
  )
  const gridVertexToWorld = compose(
    translate(problem.bounds.minX, problem.bounds.minY),
    scale(problem.gridPitch),
  )

  for (const labeledLayer of problem.labeledLayers) {
    const regions = getConnectedRegions(labeledLayer)
    for (const [regionIndex, region] of regions.entries()) {
      const net = problem.nets[region.netIndex]
      if (!net?.isPower || region.cells.length < minCells) continue
      const regionParts = splitRegionIntoHoleFreeCellGroups(
        region.cells,
        labeledLayer.nx,
      )

      for (const [partIndex, cells] of regionParts.entries()) {
        const loops = traceLoops(cells, labeledLayer.nx)
        if (loops.length !== 1) {
          throw new Error("Implicit copper region part must have one outline")
        }
        const loop = loops[0]!
        const points: Point[] = loop.map(([i, j]) => {
          const point = applyToPoint(gridVertexToWorld, { x: i, y: j })
          return {
            x: clamp(point.x, problem.bounds.minX, problem.bounds.maxX),
            y: clamp(point.y, problem.bounds.minY, problem.bounds.maxY),
          }
        })
        output.push({
          type: "pcb_copper_pour",
          pcb_copper_pour_id: `pcb_copper_pour_${sanitizeIdPart(labeledLayer.layer)}_${sanitizeIdPart(net.sourceNet.source_net_id)}_${regionIndex}_${partIndex}`,
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
