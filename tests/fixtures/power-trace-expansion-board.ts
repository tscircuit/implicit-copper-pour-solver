import type { AnyCircuitElement, LayerRef } from "circuit-json"
import artifactBoardData from "./power-trace-expansion-board-data.json"

type ArtifactObstacle = {
  t: "r" | "o"
  x: number
  y: number
  w: number
  h: number
  z: number[]
  n: string
}

type ArtifactSegment = [
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  layer: number,
]

type ArtifactVia = [x: number, y: number, outerDiameter: number]

type ArtifactTrace = {
  n: string
  s: ArtifactSegment[]
  v: ArtifactVia[]
}

type ArtifactBoardData = {
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  obstacles: ArtifactObstacle[]
  traces: ArtifactTrace[]
}

const boardData = artifactBoardData as ArtifactBoardData

const toLayer = (layer: number): LayerRef => (layer === 0 ? "top" : "bottom")

const sourceNetIds = Array.from(
  new Set([
    ...boardData.obstacles.map((obstacle) => obstacle.n),
    ...boardData.traces.map((trace) => trace.n),
  ]),
).sort((a, b) => Number(a.split("_").at(-1)) - Number(b.split("_").at(-1)))

const portIdsByNet = new Map<string, string[]>()
const obstacleElements: Record<string, unknown>[] = []

for (const [obstacleIndex, obstacle] of boardData.obstacles.entries()) {
  const sourcePortId = `source_port_artifact_${obstacleIndex}`
  const pcbPortId = `pcb_port_artifact_${obstacleIndex}`
  const layers = obstacle.z.map(toLayer)
  const portIds = portIdsByNet.get(obstacle.n) ?? []
  portIds.push(sourcePortId)
  portIdsByNet.set(obstacle.n, portIds)

  obstacleElements.push({
    type: "pcb_port",
    pcb_port_id: pcbPortId,
    source_port_id: sourcePortId,
    x: obstacle.x,
    y: obstacle.y,
    layers,
  })

  if (obstacle.t === "o") {
    const outerDiameter = Math.min(obstacle.w, obstacle.h)
    obstacleElements.push({
      type: "pcb_plated_hole",
      shape: "circle",
      pcb_plated_hole_id: `pcb_plated_hole_artifact_${obstacleIndex}`,
      pcb_port_id: pcbPortId,
      x: obstacle.x,
      y: obstacle.y,
      outer_diameter: outerDiameter,
      hole_diameter: outerDiameter * 0.55,
      layers,
    })
    continue
  }

  for (const layer of layers) {
    obstacleElements.push({
      type: "pcb_smtpad",
      shape: "rect",
      pcb_smtpad_id: `pcb_smtpad_artifact_${obstacleIndex}_${layer}`,
      pcb_port_id: pcbPortId,
      x: obstacle.x,
      y: obstacle.y,
      width: obstacle.w,
      height: obstacle.h,
      layer,
    })
  }
}

const traceElements: Record<string, unknown>[] = []
let segmentIndex = 0
let viaIndex = 0

for (const trace of boardData.traces) {
  for (const [x1, y1, x2, y2, width, layerIndex] of trace.s) {
    const layer = toLayer(layerIndex)
    traceElements.push({
      type: "pcb_trace",
      pcb_trace_id: `pcb_trace_artifact_${segmentIndex++}`,
      source_trace_id: `source_trace_artifact_${trace.n}`,
      route: [
        { route_type: "wire", x: x1, y: y1, width, layer },
        { route_type: "wire", x: x2, y: y2, width, layer },
      ],
    })
  }

  for (const [x, y, outerDiameter] of trace.v) {
    traceElements.push({
      type: "pcb_via",
      pcb_via_id: `pcb_via_artifact_${viaIndex++}`,
      source_net_id: trace.n,
      x,
      y,
      outer_diameter: outerDiameter,
      hole_diameter: outerDiameter / 2,
      layers: ["top", "bottom"],
    })
  }
}

/** Circuit JSON recreation of the board from the Power Trace Expansion artifact. */
export const powerTraceExpansionBoard = [
  {
    type: "pcb_board",
    pcb_board_id: "pcb_board_power_trace_expansion",
    center: {
      x: (boardData.bounds.minX + boardData.bounds.maxX) / 2,
      y: (boardData.bounds.minY + boardData.bounds.maxY) / 2,
    },
    width: boardData.bounds.maxX - boardData.bounds.minX,
    height: boardData.bounds.maxY - boardData.bounds.minY,
    thickness: 1.4,
    num_layers: 2,
    material: "fr4",
  },
  ...sourceNetIds.map((sourceNetId) => ({
    type: "source_net",
    source_net_id: sourceNetId,
    name:
      sourceNetId === "source_net_3"
        ? "GND"
        : sourceNetId === "source_net_15"
          ? "VCC"
          : `SIGNAL_${sourceNetId.split("_").at(-1)}`,
    member_source_group_ids: [],
    ...(sourceNetId === "source_net_3"
      ? { is_ground: true, is_power: true }
      : sourceNetId === "source_net_15"
        ? { is_power: true, is_positive_voltage_source: true }
        : { is_digital_signal: true }),
  })),
  ...sourceNetIds.map((sourceNetId) => ({
    type: "source_trace",
    source_trace_id: `source_trace_artifact_${sourceNetId}`,
    connected_source_port_ids: portIdsByNet.get(sourceNetId) ?? [],
    connected_source_net_ids: [sourceNetId],
  })),
  ...obstacleElements,
  ...traceElements,
] as unknown as AnyCircuitElement[]
