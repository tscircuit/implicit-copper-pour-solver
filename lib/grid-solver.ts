import type { LayerRef, PcbCopperPour, Point } from "circuit-json"
import {
  distanceToPrimitive,
  isPointInsidePolygon,
  traceLoops,
} from "./geometry"
import type { LabeledLayer, LabeledProblem, PreparedProblem } from "./types"

export const assignGridCells = (problem: PreparedProblem): LabeledProblem => {
  const { bounds, boardOutline, gridPitch } = problem
  const nx = Math.max(1, Math.round((bounds.maxX - bounds.minX) / gridPitch))
  const ny = Math.max(1, Math.round((bounds.maxY - bounds.minY) / gridPitch))
  const labeledLayers: LabeledLayer[] = []

  for (const layer of problem.layers) {
    const primitives = problem.primitives.filter((primitive) =>
      primitive.layers.includes(layer),
    )
    const labels = new Int32Array(nx * ny).fill(-1)

    for (let j = 0; j < ny; j++) {
      const y = bounds.minY + (j + 0.5) * gridPitch
      for (let i = 0; i < nx; i++) {
        const x = bounds.minX + (i + 0.5) * gridPitch
        if (!isPointInsidePolygon({ x, y }, boardOutline)) continue

        let bestDistance = Number.POSITIVE_INFINITY
        let bestNetIndex = -1
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
      const loops = traceLoops(region.cells, labeledLayer.nx)

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
