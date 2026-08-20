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
import type {
  CopperPrimitive,
  ImplicitCopperPourSolverInput,
  PreparedNet,
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
  const nets: PreparedNet[] = sourceNets.map((sourceNet) => ({
    sourceNet,
    isPower: Boolean(
      sourceNet.is_power ||
        sourceNet.is_ground ||
        sourceNet.is_positive_voltage_source,
    ),
  }))
  const netIndexBySourceNetId = new Map<string, number>()
  const netIndexByConnectivityKey = new Map<string, number>()
  for (const [netIndex, sourceNet] of sourceNets.entries()) {
    netIndexBySourceNetId.set(sourceNet.source_net_id, netIndex)
    if (sourceNet.subcircuit_connectivity_map_key) {
      netIndexByConnectivityKey.set(
        sourceNet.subcircuit_connectivity_map_key,
        netIndex,
      )
    }
  }

  const implicitNetIndexByReference = new Map<string, number>()
  const getOrCreateImplicitNetIndex = (
    reference: string,
    displayName = reference,
  ): number => {
    const existingIndex = implicitNetIndexByReference.get(reference)
    if (existingIndex !== undefined) return existingIndex

    const baseId = `source_net_implicit_${reference.replace(/[^a-zA-Z0-9_]+/g, "_")}`
    let sourceNetId = baseId
    let suffix = 1
    while (netIndexBySourceNetId.has(sourceNetId)) {
      sourceNetId = `${baseId}_${suffix++}`
    }
    const sourceNet = {
      type: "source_net",
      source_net_id: sourceNetId,
      name: displayName,
      member_source_group_ids: [],
      is_ground: false,
      is_power: false,
      is_positive_voltage_source: false,
    } as SourceNet
    const netIndex = nets.length
    nets.push({ sourceNet, isPower: false })
    netIndexBySourceNetId.set(sourceNetId, netIndex)
    implicitNetIndexByReference.set(reference, netIndex)
    return netIndex
  }

  const getOrCreateConnectivityKeyNetIndex = (
    element: AnyCircuitElement,
  ): number | undefined => {
    const connectivityKey = (
      element as { subcircuit_connectivity_map_key?: string }
    ).subcircuit_connectivity_map_key
    if (!connectivityKey) return undefined
    const existingIndex = netIndexByConnectivityKey.get(connectivityKey)
    if (existingIndex !== undefined) return existingIndex
    const netIndex = getOrCreateImplicitNetIndex(
      `connectivity:${connectivityKey}`,
      connectivityKey,
    )
    netIndexByConnectivityKey.set(connectivityKey, netIndex)
    return netIndex
  }

  const sourceTraceNetIndex = new Map<string, number>()
  const sourcePortNetIndex = new Map<string, number>()
  for (const element of input.circuitJson) {
    if (element.type !== "source_port") continue
    const netIndex = getOrCreateConnectivityKeyNetIndex(element)
    if (netIndex !== undefined) {
      sourcePortNetIndex.set(element.source_port_id, netIndex)
    }
  }

  for (const element of input.circuitJson) {
    if (element.type !== "source_trace") continue
    const connectedNetIndex = (element.connected_source_net_ids as string[])
      .map(
        (sourceNetId: string) =>
          netIndexBySourceNetId.get(sourceNetId) ??
          getOrCreateImplicitNetIndex(
            `source-net-id:${sourceNetId}`,
            sourceNetId,
          ),
      )
      .find((netIndex: number | undefined) => netIndex !== undefined)
    const connectedPortNetIndex = element.connected_source_port_ids
      .map((sourcePortId: string) => sourcePortNetIndex.get(sourcePortId))
      .find((netIndex: number | undefined) => netIndex !== undefined)
    const netIndex =
      connectedNetIndex ??
      getOrCreateConnectivityKeyNetIndex(element) ??
      connectedPortNetIndex ??
      getOrCreateImplicitNetIndex(
        `source-trace:${element.source_trace_id}`,
        element.display_name ?? element.source_trace_id,
      )
    sourceTraceNetIndex.set(element.source_trace_id, netIndex)
    for (const sourcePortId of element.connected_source_port_ids) {
      sourcePortNetIndex.set(sourcePortId, netIndex)
    }
  }

  for (const element of input.circuitJson) {
    if (
      element.type === "source_port" &&
      !sourcePortNetIndex.has(element.source_port_id)
    ) {
      sourcePortNetIndex.set(
        element.source_port_id,
        getOrCreateImplicitNetIndex(
          `source-port:${element.source_port_id}`,
          element.name ?? element.source_port_id,
        ),
      )
    }
  }

  const pcbPortNetIndex = new Map<string, number>()
  for (const element of input.circuitJson) {
    if (element.type !== "pcb_port") continue
    const netIndex =
      sourcePortNetIndex.get(element.source_port_id) ??
      getOrCreateConnectivityKeyNetIndex(element) ??
      getOrCreateImplicitNetIndex(
        `source-port:${element.source_port_id}`,
        element.source_port_id,
      )
    pcbPortNetIndex.set(element.pcb_port_id, netIndex)
  }

  const pcbTraceNetIndex = new Map<string, number>()
  for (const element of input.circuitJson) {
    if (element.type !== "pcb_trace") continue
    const directSourceNetId = (element as { source_net_id?: string })
      .source_net_id
    const routePortNetIndex = (element.route as PcbTrace["route"])
      .flatMap((routePoint) => {
        const point = routePoint as {
          start_pcb_port_id?: string
          end_pcb_port_id?: string
        }
        return [point.start_pcb_port_id, point.end_pcb_port_id]
      })
      .filter((pcbPortId): pcbPortId is string => Boolean(pcbPortId))
      .map((pcbPortId: string) => pcbPortNetIndex.get(pcbPortId))
      .find((netIndex: number | undefined) => netIndex !== undefined)
    const netIndex =
      (directSourceNetId
        ? (netIndexBySourceNetId.get(directSourceNetId) ??
          getOrCreateImplicitNetIndex(
            `source-net-id:${directSourceNetId}`,
            directSourceNetId,
          ))
        : undefined) ??
      sourceTraceNetIndex.get(element.source_trace_id) ??
      getOrCreateConnectivityKeyNetIndex(element) ??
      routePortNetIndex ??
      getOrCreateImplicitNetIndex(
        `pcb-trace:${element.pcb_trace_id}`,
        element.pcb_trace_id,
      )
    pcbTraceNetIndex.set(element.pcb_trace_id, netIndex)
  }

  const getNetIndex = (element: AnyCircuitElement): number | undefined => {
    const sourceNetId = (element as { source_net_id?: string }).source_net_id
    if (sourceNetId) {
      return (
        netIndexBySourceNetId.get(sourceNetId) ??
        getOrCreateImplicitNetIndex(`source-net-id:${sourceNetId}`, sourceNetId)
      )
    }
    const connectivityKeyNetIndex = getOrCreateConnectivityKeyNetIndex(element)
    if (connectivityKeyNetIndex !== undefined) return connectivityKeyNetIndex
    if (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole") {
      if (element.pcb_port_id) {
        const pcbPortIndex = pcbPortNetIndex.get(element.pcb_port_id)
        if (pcbPortIndex !== undefined) return pcbPortIndex
      }
      const elementId =
        element.type === "pcb_smtpad"
          ? element.pcb_smtpad_id
          : element.pcb_plated_hole_id
      return getOrCreateImplicitNetIndex(
        `${element.type}:${elementId}`,
        elementId,
      )
    }
    if (element.type === "pcb_trace") {
      return pcbTraceNetIndex.get(element.pcb_trace_id)
    }
    if (element.type === "pcb_via") {
      const via = element as PcbVia & {
        pcb_trace_id?: string
        source_trace_id?: string
      }
      if (via.source_trace_id) {
        const sourceTraceIndex = sourceTraceNetIndex.get(via.source_trace_id)
        if (sourceTraceIndex !== undefined) return sourceTraceIndex
      }
      if (via.pcb_trace_id) {
        const pcbTraceIndex = pcbTraceNetIndex.get(via.pcb_trace_id)
        if (pcbTraceIndex !== undefined) return pcbTraceIndex
      }
      return getOrCreateImplicitNetIndex(
        `pcb-via:${via.pcb_via_id}`,
        via.pcb_via_id,
      )
    }
    return undefined
  }

  const primitives: CopperPrimitive[] = []
  for (const element of input.circuitJson) {
    if (
      element.type !== "pcb_smtpad" &&
      element.type !== "pcb_plated_hole" &&
      element.type !== "pcb_via" &&
      element.type !== "pcb_trace"
    ) {
      continue
    }
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
