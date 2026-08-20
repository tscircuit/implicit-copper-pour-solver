import type { AnyCircuitElement } from "circuit-json"

export const simplePowerBoard = [
  {
    type: "pcb_board",
    pcb_board_id: "pcb_board_0",
    center: { x: 0, y: 0 },
    width: 10,
    height: 6,
    thickness: 1.4,
    num_layers: 2,
    material: "fr4",
  },
  {
    type: "source_net",
    source_net_id: "source_net_gnd",
    name: "GND",
    member_source_group_ids: [],
    is_ground: true,
  },
  {
    type: "source_net",
    source_net_id: "source_net_signal",
    name: "SIGNAL",
    member_source_group_ids: [],
    is_digital_signal: true,
  },
  {
    type: "pcb_via",
    pcb_via_id: "pcb_via_gnd",
    x: -3,
    y: 0,
    outer_diameter: 0.6,
    hole_diameter: 0.3,
    layers: ["top", "bottom"],
    source_net_id: "source_net_gnd",
  },
  {
    type: "pcb_via",
    pcb_via_id: "pcb_via_signal",
    x: 3,
    y: 0,
    outer_diameter: 0.6,
    hole_diameter: 0.3,
    layers: ["top", "bottom"],
    source_net_id: "source_net_signal",
  },
] as AnyCircuitElement[]
