import { describe, expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ImplicitCopperPourPipelineSolver } from "../lib"
import { simplePowerBoard } from "./fixtures/simple-power-board"

describe("ImplicitCopperPourPipelineSolver", () => {
  test("emits polygon pours only for power nets", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      gridPitch: 1,
      minRegionArea: 1,
    })

    solver.solve()
    const output = solver.getOutput()

    expect(solver.solved).toBe(true)
    expect(output.length).toBe(2)
    expect(output.every((pour) => pour.shape === "polygon")).toBe(true)
    expect(
      output.every((pour) => pour.source_net_id === "source_net_gnd"),
    ).toBe(true)
    expect(new Set(output.map((pour) => pour.layer))).toEqual(
      new Set(["top", "bottom"]),
    )
    expect(
      output.every(
        (pour) => pour.shape === "polygon" && pour.points.length >= 4,
      ),
    ).toBe(true)
  })

  test("supports explicit layer selection", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      gridPitch: 1,
      minRegionArea: 1,
      layers: ["top"],
    })

    solver.solve()

    expect(solver.getOutput()).toHaveLength(1)
    expect(solver.getOutput()[0]?.layer).toBe("top")
  })

  test("resolves routed copper through Circuit JSON connectivity", () => {
    const routedBoard = [
      simplePowerBoard[0],
      simplePowerBoard[1],
      simplePowerBoard[2],
      {
        type: "source_trace",
        source_trace_id: "source_trace_gnd",
        connected_source_port_ids: [],
        connected_source_net_ids: ["source_net_gnd"],
      },
      {
        type: "source_trace",
        source_trace_id: "source_trace_signal",
        connected_source_port_ids: [],
        connected_source_net_ids: ["source_net_signal"],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_gnd",
        source_trace_id: "source_trace_gnd",
        route: [
          { route_type: "wire", x: -4, y: 0, width: 0.2, layer: "top" },
          { route_type: "wire", x: -2, y: 0, width: 0.2, layer: "top" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_signal",
        source_trace_id: "source_trace_signal",
        route: [
          { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top" },
          { route_type: "wire", x: 4, y: 0, width: 0.2, layer: "top" },
        ],
      },
    ] as AnyCircuitElement[]
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: routedBoard,
      gridPitch: 1,
      minRegionArea: 1,
      layers: ["top"],
    })

    solver.solve()

    expect(solver.getOutput()).toHaveLength(1)
    expect(solver.getOutput()[0]?.source_net_id).toBe("source_net_gnd")
  })

  test("rejects invalid grid settings", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      gridPitch: 0,
    })

    expect(() => solver.solve()).toThrow("gridPitch must be greater than zero")
  })
})
