import type { AnyCircuitElement } from "circuit-json"
import { nrf52810Board } from "./nrf52810-board"

// These are solver inputs, not fabrication layouts. Drop previously generated
// pours and diagnostics, and keep source connectivity plus PCB geometry.
const createBoard = (): AnyCircuitElement[] =>
  structuredClone(nrf52810Board).filter(
    (element) =>
      (element.type.startsWith("source_") || element.type.startsWith("pcb_")) &&
      element.type !== "pcb_copper_pour" &&
      !element.type.endsWith("_error") &&
      !element.type.endsWith("_warning"),
  )

const translateGeometry = (value: unknown, dx: number, dy: number): void => {
  if (!value || typeof value !== "object") return
  const object = value as Record<string, unknown>
  if (typeof object.x === "number" && typeof object.y === "number") {
    object.x += dx
    object.y += dy
  }
  for (const child of Object.values(object)) {
    translateGeometry(child, dx, dy)
  }
}

/** Move the footprint, its graphics and the attached trace endpoints together. */
const moveComponent = (
  board: AnyCircuitElement[],
  name: string,
  dx: number,
  dy: number,
): void => {
  const source = board.find(
    (e) => e.type === "source_component" && e.name === name,
  )
  if (source?.type !== "source_component") throw new Error(`Missing ${name}`)
  const component = board.find(
    (e) =>
      e.type === "pcb_component" &&
      e.source_component_id === source.source_component_id,
  )
  if (component?.type !== "pcb_component")
    throw new Error(`Missing PCB ${name}`)
  const ports = new Set(
    board.flatMap((e) =>
      e.type === "pcb_port" && e.pcb_component_id === component.pcb_component_id
        ? [e.pcb_port_id]
        : [],
    ),
  )
  for (const element of board) {
    if (
      element.type.startsWith("pcb_") &&
      "pcb_component_id" in element &&
      element.pcb_component_id === component.pcb_component_id
    ) {
      translateGeometry(element, dx, dy)
    }
    if (element.type === "pcb_trace") {
      for (const point of element.route) {
        if (
          point.route_type === "wire" &&
          ((point.start_pcb_port_id && ports.has(point.start_pcb_port_id)) ||
            (point.end_pcb_port_id && ports.has(point.end_pcb_port_id)))
        ) {
          point.x += dx
          point.y += dy
        }
      }
      // The old routed length no longer describes this example.
      delete element.trace_length
    }
  }
  if (component.display_offset_x !== undefined) component.display_offset_x += dx
  if (component.display_offset_y !== undefined) component.display_offset_y += dy
}

/** A 0603 capacitor with explicit VBAT/GND connectivity and local vias. */
const addCapacitor = (
  board: AnyCircuitElement[],
  name: string,
  x: number,
  y: number,
  layer: "top" | "bottom",
  capacitance = 100e-9,
): void => {
  const sourceId = `source_component_${name}`
  const pcbId = `pcb_component_${name}`
  board.push(
    {
      type: "source_component",
      source_component_id: sourceId,
      name,
      ftype: "simple_capacitor",
      capacitance,
    },
    {
      type: "pcb_component",
      pcb_component_id: pcbId,
      source_component_id: sourceId,
      center: { x, y },
      width: 1.56,
      height: 0.64,
      rotation: 0,
      obstructs_within_bounds: true,
      layer,
    },
  )
  for (const [index, netName] of ["VBAT", "GND"].entries()) {
    const net = board.find((e) => e.type === "source_net" && e.name === netName)
    if (net?.type !== "source_net") throw new Error(`Missing ${netName}`)
    const id = `${name}_${index + 1}`
    const padX = x + (index === 0 ? -0.51 : 0.51)
    const viaY = y + (index === 0 ? -0.9 : 0.9)
    board.push(
      {
        type: "source_port",
        source_port_id: `source_port_${id}`,
        source_component_id: sourceId,
        name: `pin${index + 1}`,
        pin_number: index + 1,
      },
      {
        type: "source_trace",
        source_trace_id: `source_trace_${id}`,
        connected_source_port_ids: [`source_port_${id}`],
        connected_source_net_ids: [net.source_net_id],
      },
      {
        type: "pcb_port",
        pcb_port_id: `pcb_port_${id}`,
        source_port_id: `source_port_${id}`,
        pcb_component_id: pcbId,
        x: padX,
        y,
        layers: [layer],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: `pcb_smtpad_${id}`,
        pcb_component_id: pcbId,
        pcb_port_id: `pcb_port_${id}`,
        shape: "rect",
        x: padX,
        y,
        width: 0.54,
        height: 0.64,
        layer,
      },
      {
        type: "pcb_via",
        pcb_via_id: `pcb_via_${id}`,
        x: padX,
        y: viaY,
        outer_diameter: 0.6,
        hole_diameter: 0.3,
        layers: ["top", "bottom"],
        source_net_id: net.source_net_id,
      },
      {
        type: "pcb_trace",
        pcb_trace_id: `pcb_trace_${id}`,
        source_trace_id: `source_trace_${id}`,
        route: [
          {
            route_type: "wire",
            x: padX,
            y,
            width: 0.2,
            layer,
            start_pcb_port_id: `pcb_port_${id}`,
          },
          { route_type: "wire", x: padX, y: viaY, width: 0.2, layer },
        ],
      },
    )
  }
}

export const nrf52810LeftLedBoard = createBoard()
for (const name of ["LED1", "R_LED_R", "R_LED_G", "R_LED_B"]) {
  moveComponent(nrf52810LeftLedBoard, name, -3, 0)
}

export const nrf52810LowerDebugBoard = createBoard()
for (const name of ["TP_VDD", "TP_GND", "TP_SWDIO", "TP_SWDCLK", "TP_RESET"]) {
  moveComponent(nrf52810LowerDebugBoard, name, 0, -3)
}

export const nrf52810TopDecouplingBoard = createBoard()
addCapacitor(nrf52810TopDecouplingBoard, "C15", -5.5, 0, "top")
addCapacitor(nrf52810TopDecouplingBoard, "C16", -5.5, 3, "top")
addCapacitor(nrf52810TopDecouplingBoard, "C17", -5.5, 10, "top")

export const nrf52810BottomBulkBoard = createBoard()
addCapacitor(nrf52810BottomBulkBoard, "C15", -5.5, -11, "bottom", 10e-6)
addCapacitor(nrf52810BottomBulkBoard, "C16", 5, -12.5, "bottom", 1e-6)
addCapacitor(nrf52810BottomBulkBoard, "C17", 11, -11, "bottom")
