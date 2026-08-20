import { describe, expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ImplicitCopperPourPipelineSolver } from "../lib"
import { prepareCircuitJson } from "../lib/prepare-circuit-json"
import { nrf52810Board } from "./fixtures/nrf52810-board"
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

  test("solves the nRF52810 Circuit JSON fixture", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: nrf52810Board,
      gridPitch: 0.5,
      minRegionArea: 2,
    })

    const initialGraphics = solver.visualize()
    expect(initialGraphics.rects?.length).toBeGreaterThan(0)
    expect(initialGraphics.lines?.length).toBeGreaterThan(0)
    expect(initialGraphics.circles?.length).toBeGreaterThan(0)
    expect(initialGraphics.polygons).toHaveLength(0)
    expect(
      initialGraphics.rects?.every((rect) => rect.fill?.startsWith("rgba(")),
    ).toBe(true)

    solver.solve()

    const output = solver.getOutput()
    expect(output.length).toBeGreaterThan(0)
    expect(
      output.every((pour) =>
        ["source_net_0", "source_net_1"].includes(pour.source_net_id ?? ""),
      ),
    ).toBe(true)
    expect(new Set(output.map((pour) => pour.source_net_id))).toEqual(
      new Set(["source_net_0", "source_net_1"]),
    )

    const solvedGraphics = solver.visualize()
    const pourGraphics =
      solvedGraphics.polygons?.filter((polygon) =>
        polygon.fill?.startsWith("rgba("),
      ) ?? []
    expect(pourGraphics.length).toBe(output.length)
    expect(
      pourGraphics.every((polygon) => polygon.fill?.startsWith("rgba(")),
    ).toBe(true)
    expect(new Set(pourGraphics.map((polygon) => polygon.stroke)).size).toBe(2)
    expect(solvedGraphics.circles?.length).toBe(initialGraphics.circles?.length)
  })

  test("includes every nRF52810 SMT pad but no existing copper pours", () => {
    const prepared = prepareCircuitJson({ circuitJson: nrf52810Board })
    const withoutSmtPads = prepareCircuitJson({
      circuitJson: nrf52810Board.filter(
        (element) => element.type !== "pcb_smtpad",
      ),
    })
    const withoutCopperPours = prepareCircuitJson({
      circuitJson: nrf52810Board.filter(
        (element) => element.type !== "pcb_copper_pour",
      ),
    })
    const smtPadCount = nrf52810Board.filter(
      (element) => element.type === "pcb_smtpad",
    ).length

    expect(prepared.primitives.length - withoutSmtPads.primitives.length).toBe(
      smtPadCount,
    )
    expect(smtPadCount).toBe(112)
    expect(prepared.primitives.length).toBe(
      withoutCopperPours.primitives.length,
    )
  })

  test("includes unconnected plated holes as non-power obstacles", () => {
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "pcb_board_plated_hole_test",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "pcb_plated_hole",
        shape: "circle",
        pcb_plated_hole_id: "pcb_plated_hole_unconnected",
        x: 0,
        y: 0,
        outer_diameter: 1,
        hole_diameter: 0.5,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_copper_pour",
        pcb_copper_pour_id: "pcb_copper_pour_existing",
        shape: "polygon",
        layer: "top",
        source_net_id: "source_net_existing",
        covered_with_solder_mask: true,
        points: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
      },
    ] as AnyCircuitElement[]

    const prepared = prepareCircuitJson({ circuitJson })

    expect(prepared.primitives).toHaveLength(1)
    expect(prepared.primitives[0]?.kind).toBe("circle")
    expect(prepared.nets).toHaveLength(1)
    expect(prepared.nets[0]?.isPower).toBe(false)
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
