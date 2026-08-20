import type {
  AnyCircuitElement,
  LayerRef,
  PcbBoard,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
  Point,
  SourceNet,
} from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import type {
  CopperPrimitive,
  ImplicitCopperPourSolverInput,
  PreparedProblem,
} from "./types"

const DEFAULT_GRID_PITCH = 0.25
const DEFAULT_MIN_REGION_AREA = 2

const getBoardOutline = (board: PcbBoard): Point[] => {
  if (board.outline && board.outline.length >= 3) return board.outline
  if (board.width === undefined || board.height === undefined) {
    throw new Error("pcb_board must provide an outline or width and height")
  }
  const halfWidth = board.width / 2
  const halfHeight = board.height / 2
  return [
    { x: board.center.x - halfWidth, y: board.center.y - halfHeight },
    { x: board.center.x + halfWidth, y: board.center.y - halfHeight },
    { x: board.center.x + halfWidth, y: board.center.y + halfHeight },
    { x: board.center.x - halfWidth, y: board.center.y + halfHeight },
  ]
}

const getElementId = (element: AnyCircuitElement): string | undefined => {
  if (element.type === "source_net") return element.source_net_id
  if (element.type === "pcb_smtpad") return element.pcb_smtpad_id
  if (element.type === "pcb_plated_hole") return element.pcb_plated_hole_id
  if (element.type === "pcb_trace") return element.pcb_trace_id
  if (element.type === "pcb_via") return element.pcb_via_id
  return undefined
}

const addPillPrimitive = (
  primitives: CopperPrimitive[],
  params: {
    layers: LayerRef[]
    netIndex: number
    x: number
    y: number
    width: number
    height: number
    rotation: number
  },
) => {
  const { layers, netIndex, x, y, width, height, rotation } = params
  const radius = Math.min(width, height) / 2
  const axisLength = Math.max(width, height) - radius * 2
  const axisAngle = ((rotation + (height > width ? 90 : 0)) * Math.PI) / 180
  const halfAxis = axisLength / 2
  primitives.push({
    kind: "segment",
    layers,
    netIndex,
    x1: x - Math.cos(axisAngle) * halfAxis,
    y1: y - Math.sin(axisAngle) * halfAxis,
    x2: x + Math.cos(axisAngle) * halfAxis,
    y2: y + Math.sin(axisAngle) * halfAxis,
    halfWidth: radius,
  })
}

const addSmtPad = (
  primitives: CopperPrimitive[],
  pad: PcbSmtPad,
  netIndex: number,
) => {
  const layers = [pad.layer]
  if (pad.shape === "circle") {
    primitives.push({
      kind: "circle",
      layers,
      netIndex,
      x: pad.x,
      y: pad.y,
      radius: pad.radius,
    })
  } else if (pad.shape === "rect" || pad.shape === "rotated_rect") {
    primitives.push({
      kind: "rect",
      layers,
      netIndex,
      x: pad.x,
      y: pad.y,
      halfWidth: pad.width / 2,
      halfHeight: pad.height / 2,
      rotation: pad.shape === "rotated_rect" ? pad.ccw_rotation : 0,
    })
  } else if (pad.shape === "polygon") {
    primitives.push({
      kind: "polygon",
      layers,
      netIndex,
      points: pad.points,
    })
  } else {
    addPillPrimitive(primitives, {
      layers,
      netIndex,
      x: pad.x,
      y: pad.y,
      width: pad.width,
      height: pad.height,
      rotation: pad.shape === "rotated_pill" ? pad.ccw_rotation : 0,
    })
  }
}

const addPlatedHole = (
  primitives: CopperPrimitive[],
  hole: PcbPlatedHole,
  netIndex: number,
) => {
  const layers = hole.layers
  if (hole.shape === "circle") {
    primitives.push({
      kind: "circle",
      layers,
      netIndex,
      x: hole.x,
      y: hole.y,
      radius: hole.outer_diameter / 2,
    })
  } else if (hole.shape === "oval" || hole.shape === "pill") {
    addPillPrimitive(primitives, {
      layers,
      netIndex,
      x: hole.x,
      y: hole.y,
      width: hole.outer_width,
      height: hole.outer_height,
      rotation: hole.ccw_rotation,
    })
  } else if (hole.shape === "hole_with_polygon_pad") {
    primitives.push({
      kind: "polygon",
      layers,
      netIndex,
      points: hole.pad_outline,
    })
  } else if ("rect_pad_width" in hole && "rect_pad_height" in hole) {
    const rotation =
      hole.shape === "circular_hole_with_rect_pad"
        ? (hole.rect_ccw_rotation ?? 0)
        : hole.shape === "rotated_pill_hole_with_rect_pad"
          ? hole.rect_ccw_rotation
          : 0
    primitives.push({
      kind: "rect",
      layers,
      netIndex,
      x: hole.x,
      y: hole.y,
      halfWidth: hole.rect_pad_width / 2,
      halfHeight: hole.rect_pad_height / 2,
      rotation,
    })
  }
}

const addTrace = (
  primitives: CopperPrimitive[],
  trace: PcbTrace,
  netIndex: number,
) => {
  let previousWire: Extract<
    PcbTrace["route"][number],
    { route_type: "wire" }
  > | null = null
  for (const routePoint of trace.route) {
    if (routePoint.route_type !== "wire") {
      previousWire = null
      if (routePoint.route_type === "via") {
        primitives.push({
          kind: "circle",
          layers: [routePoint.from_layer, routePoint.to_layer],
          netIndex,
          x: routePoint.x,
          y: routePoint.y,
          radius: 0.3,
        })
      }
      continue
    }
    if (previousWire && previousWire.layer === routePoint.layer) {
      primitives.push({
        kind: "segment",
        layers: [routePoint.layer],
        netIndex,
        x1: previousWire.x,
        y1: previousWire.y,
        x2: routePoint.x,
        y2: routePoint.y,
        halfWidth: routePoint.width / 2,
      })
    }
    previousWire = routePoint
  }
}

export const prepareCircuitJson = (
  input: ImplicitCopperPourSolverInput,
): PreparedProblem => {
  const gridPitch = input.gridPitch ?? DEFAULT_GRID_PITCH
  const minRegionArea = input.minRegionArea ?? DEFAULT_MIN_REGION_AREA
  if (!(gridPitch > 0)) throw new Error("gridPitch must be greater than zero")
  if (!(minRegionArea >= 0)) {
    throw new Error("minRegionArea must be zero or greater")
  }

  const board = input.circuitJson.find(
    (element): element is PcbBoard => element.type === "pcb_board",
  )
  if (!board) throw new Error("No pcb_board found in Circuit JSON")
  const boardOutline = getBoardOutline(board)
  const xs = boardOutline.map((point) => point.x)
  const ys = boardOutline.map((point) => point.y)
  const bounds = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }

  const sourceNets = input.circuitJson.filter(
    (element): element is SourceNet => element.type === "source_net",
  )
  const nets = sourceNets.map((sourceNet) => ({
    sourceNet,
    isPower: Boolean(
      sourceNet.is_power ||
        sourceNet.is_ground ||
        sourceNet.is_positive_voltage_source,
    ),
  }))
  const connectivityMap = getFullConnectivityMapFromCircuitJson(
    input.circuitJson,
  )
  const netIndexByConnectivityId = new Map<string, number>()
  const netIndexBySourceNetId = new Map<string, number>()
  for (const [netIndex, sourceNet] of sourceNets.entries()) {
    const connectivityId =
      connectivityMap.getNetConnectedToId(sourceNet.source_net_id) ??
      sourceNet.source_net_id
    if (!netIndexByConnectivityId.has(connectivityId)) {
      netIndexByConnectivityId.set(connectivityId, netIndex)
    }
    netIndexBySourceNetId.set(sourceNet.source_net_id, netIndex)
  }

  const getNetIndex = (element: AnyCircuitElement): number | undefined => {
    const id = getElementId(element)
    const connectivityId = id
      ? connectivityMap.getNetConnectedToId(id)
      : undefined
    if (connectivityId) {
      const index = netIndexByConnectivityId.get(connectivityId)
      if (index !== undefined) return index
    }
    const sourceNetId = (element as { source_net_id?: string }).source_net_id
    return sourceNetId ? netIndexBySourceNetId.get(sourceNetId) : undefined
  }

  const primitives: CopperPrimitive[] = []
  for (const element of input.circuitJson) {
    const netIndex = getNetIndex(element)
    if (netIndex === undefined) continue
    if (element.type === "pcb_smtpad") {
      addSmtPad(primitives, element, netIndex)
    } else if (element.type === "pcb_plated_hole") {
      addPlatedHole(primitives, element, netIndex)
    } else if (element.type === "pcb_via") {
      const via = element as PcbVia
      primitives.push({
        kind: "circle",
        layers: via.layers,
        netIndex,
        x: via.x,
        y: via.y,
        radius: via.outer_diameter / 2,
      })
    } else if (element.type === "pcb_trace") {
      addTrace(primitives, element, netIndex)
    }
  }

  return {
    bounds,
    boardOutline,
    layers: input.layers ?? ["top", "bottom"],
    nets,
    primitives,
    gridPitch,
    minRegionArea,
    coveredWithSolderMask: input.coveredWithSolderMask ?? true,
  }
}
