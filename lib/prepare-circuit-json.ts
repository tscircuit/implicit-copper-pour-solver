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
import { getElementId } from "@tscircuit/circuit-json-util"
import {
  ConnectivityMap,
  findConnectedNetworks,
  getSourcePortConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
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

  const sourcePortConnectivityMap = getSourcePortConnectivityMapFromCircuitJson(
    input.circuitJson,
  )
  const structuralConnections: string[][] = Object.values(
    sourcePortConnectivityMap.netMap,
  )

  for (const element of input.circuitJson) {
    if (element.type === "source_trace") {
      structuralConnections.push([
        element.source_trace_id,
        ...element.connected_source_port_ids,
        ...element.connected_source_net_ids,
      ])
      continue
    }

    if (element.type === "pcb_port") {
      structuralConnections.push([element.pcb_port_id, element.source_port_id])
      continue
    }

    if (element.type === "pcb_smtpad" && element.pcb_port_id) {
      structuralConnections.push([element.pcb_smtpad_id, element.pcb_port_id])
      continue
    }

    if (element.type === "pcb_plated_hole" && element.pcb_port_id) {
      structuralConnections.push([
        element.pcb_plated_hole_id,
        element.pcb_port_id,
      ])
      continue
    }

    if (element.type === "pcb_trace") {
      const endpointPortIds = Array.from(
        new Set(
          element.route.flatMap((routePoint) =>
            routePoint.route_type === "wire"
              ? [
                  routePoint.start_pcb_port_id,
                  routePoint.end_pcb_port_id,
                ].filter((portId): portId is string => Boolean(portId))
              : [],
          ),
        ),
      )
      const directSourceNetId = (element as { source_net_id?: string })
        .source_net_id
      const connectedIds = [
        ...(directSourceNetId ? [directSourceNetId] : []),
        ...(endpointPortIds.length > 0
          ? endpointPortIds
          : element.source_trace_id
            ? [element.source_trace_id]
            : []),
      ]
      if (connectedIds.length > 0) {
        structuralConnections.push([element.pcb_trace_id, ...connectedIds])
      }
      continue
    }

    if (element.type === "pcb_via") {
      const via = element as PcbVia & {
        pcb_trace_id?: string
        source_trace_id?: string
      }
      const connectedId =
        via.source_net_id ?? via.pcb_trace_id ?? via.source_trace_id
      if (connectedId) {
        structuralConnections.push([via.pcb_via_id, connectedId])
      }
    }
  }

  const connectivityMap = new ConnectivityMap(
    findConnectedNetworks(structuralConnections),
  )
  const netIndexByConnectivityNetwork = new Map<string, number>()

  const getConnectivityNetIndex = (
    element: AnyCircuitElement,
  ): number | undefined => {
    const elementId = getElementId(element)
    const connectivityNetworkId = connectivityMap.getNetConnectedToId(elementId)

    if (connectivityNetworkId) {
      const connectedSourceNetIndexes = sourceNets.flatMap(
        (sourceNet, netIndex) =>
          connectivityMap.areIdsConnected(elementId, sourceNet.source_net_id)
            ? [netIndex]
            : [],
      )
      if (connectedSourceNetIndexes.length > 1) {
        const connectedSourceNetIds = connectedSourceNetIndexes.map(
          (netIndex) => sourceNets[netIndex]!.source_net_id,
        )
        throw new Error(
          `Circuit JSON connectivity assigns ${elementId} to multiple source nets: ${connectedSourceNetIds.join(", ")}`,
        )
      }
      if (connectedSourceNetIndexes[0] !== undefined) {
        netIndexByConnectivityNetwork.set(
          connectivityNetworkId,
          connectedSourceNetIndexes[0],
        )
        return connectedSourceNetIndexes[0]
      }

      const existingIndex = netIndexByConnectivityNetwork.get(
        connectivityNetworkId,
      )
      if (existingIndex !== undefined) return existingIndex

      const netIndex =
        getOrCreateConnectivityKeyNetIndex(element) ??
        getOrCreateImplicitNetIndex(
          `connectivity-network:${connectivityNetworkId}`,
          connectivityNetworkId,
        )
      netIndexByConnectivityNetwork.set(connectivityNetworkId, netIndex)
      return netIndex
    }

    return getOrCreateConnectivityKeyNetIndex(element)
  }

  const getNetIndex = (element: AnyCircuitElement): number | undefined => {
    const sourceNetId = (element as { source_net_id?: string }).source_net_id
    if (sourceNetId) {
      return (
        netIndexBySourceNetId.get(sourceNetId) ??
        getOrCreateImplicitNetIndex(`source-net-id:${sourceNetId}`, sourceNetId)
      )
    }
    const connectivityNetIndex = getConnectivityNetIndex(element)
    if (connectivityNetIndex !== undefined) return connectivityNetIndex

    const elementId = getElementId(element)
    return getOrCreateImplicitNetIndex(
      `${element.type}:${elementId}`,
      elementId,
    )
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
