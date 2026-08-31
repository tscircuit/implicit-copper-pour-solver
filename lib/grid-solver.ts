import type { LayerRef, PcbCopperPour, Point } from "circuit-json"
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

export const assignGridCells = (problem: PreparedProblem): LabeledProblem => {
  const { bounds, boardOutline, gridPitch } = problem
  const nx = Math.max(1, Math.round((bounds.maxX - bounds.minX) / gridPitch))
  const ny = Math.max(1, Math.round((bounds.maxY - bounds.minY) / gridPitch))
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

    for (let j = 0; j < ny; j++) {
      const y = bounds.minY + (j + 0.5) * gridPitch
      for (let i = 0; i < nx; i++) {
        const x = bounds.minX + (i + 0.5) * gridPitch
        if (!isPointInsidePolygon({ x, y }, boardOutline)) continue

        const point = { x, y }
        const candidates = powerPrimitives
          .map((primitive) => ({
            primitive,
            distance: distanceToPrimitive(primitive, x, y),
          }))
          .sort((a, b) => a.distance - b.distance)
        let bestNetIndex = candidates[0]?.primitive.netIndex ?? -1

        for (const candidate of candidates) {
          if (candidate.distance === 0) {
            bestNetIndex = candidate.primitive.netIndex
            break
          }
          const closestPoint = getClosestPointOnPrimitive(
            candidate.primitive,
            point,
          )
          const isBlocked = traceBarriers.some(
            (trace) =>
              trace.netIndex !== candidate.primitive.netIndex &&
              doesSegmentCrossTrace(point, closestPoint, trace),
          )
          if (!isBlocked) {
            bestNetIndex = candidate.primitive.netIndex
            break
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
