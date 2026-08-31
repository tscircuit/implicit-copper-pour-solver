import { describe, expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  ImplicitCopperPourPipelineSolver,
  type ImplicitCopperPourSolverOutput,
} from "../lib"
import { normalizeLabeledLayerRegions } from "../lib/grid-solver"
import { prepareCircuitJson } from "../lib/prepare-circuit-json"
import type { LabeledLayer, LabeledProblem } from "../lib/types"
import { filterGraphicsByLayer } from "./fixtures/filter-graphics-by-layer"
import { nrf52810Board } from "./fixtures/nrf52810-board"
import { simplePowerBoard } from "./fixtures/simple-power-board"

const getAbsolutePolygonArea = (
  pour: ImplicitCopperPourSolverOutput[number],
): number => {
  if (pour.shape !== "polygon") return 0
  return Math.abs(
    pour.points.reduce((area, point, index) => {
      const next = pour.points[(index + 1) % pour.points.length]!
      return area + point.x * next.y - next.x * point.y
    }, 0) / 2,
  )
}

describe("ImplicitCopperPourPipelineSolver", () => {
  test("fills each layer with implicit regions owned only by power nets", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      gridPitch: 1,
      minRegionArea: 1,
    })

    solver.solve()
    const output = solver.getOutput()

    expect(solver.solved).toBe(true)
    expect(solver.hasStageOutput("simplifyPolygonEdges")).toBe(true)
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
    expect(
      output.every((pour) => getAbsolutePolygonArea(pour) === 10 * 6),
    ).toBe(true)

    const labeledProblem =
      solver.getStageOutput<LabeledProblem>("assignGridCells")!
    const groundNetIndex = labeledProblem.nets.findIndex(
      (net) => net.sourceNet.source_net_id === "source_net_gnd",
    )
    expect(
      labeledProblem.labeledLayers.every((labeledLayer) =>
        labeledLayer.labels.every(
          (netIndex) => netIndex < 0 || netIndex === groundNetIndex,
        ),
      ),
    ).toBe(true)
  })

  test("partitions the complete layer between power nets across signal copper", () => {
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "board",
        center: { x: 0, y: 0 },
        width: 8,
        height: 4,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "source_net",
        source_net_id: "ground",
        name: "GND",
        member_source_group_ids: [],
        is_ground: true,
      },
      {
        type: "source_net",
        source_net_id: "power",
        name: "VCC",
        member_source_group_ids: [],
        is_power: true,
      },
      {
        type: "source_net",
        source_net_id: "signal",
        name: "SIGNAL",
        member_source_group_ids: [],
        is_digital_signal: true,
      },
      {
        type: "pcb_via",
        pcb_via_id: "ground_anchor",
        x: -3,
        y: 0,
        outer_diameter: 0.6,
        hole_diameter: 0.3,
        layers: ["top", "bottom"],
        source_net_id: "ground",
      },
      {
        type: "pcb_via",
        pcb_via_id: "power_anchor",
        x: 3,
        y: 0,
        outer_diameter: 0.6,
        hole_diameter: 0.3,
        layers: ["top", "bottom"],
        source_net_id: "power",
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "signal_trace",
        source_net_id: "signal",
        route: [
          { route_type: "wire", x: 0, y: -2, width: 1, layer: "top" },
          { route_type: "wire", x: 0, y: 2, width: 1, layer: "top" },
        ],
      },
    ] as AnyCircuitElement[]
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 1,
      edgeSimplificationTolerance: 0,
      minRegionArea: 0,
      layers: ["top"],
    })

    solver.solve()

    const output = solver.getOutput()
    expect(output).toHaveLength(2)
    expect(new Set(output.map((pour) => pour.source_net_id))).toEqual(
      new Set(["ground", "power"]),
    )
    expect(
      output.reduce((area, pour) => area + getAbsolutePolygonArea(pour), 0),
    ).toBe(8 * 4)

    const labeledProblem =
      solver.getStageOutput<LabeledProblem>("assignGridCells")!
    const signalNetIndex = labeledProblem.nets.findIndex(
      (net) => net.sourceNet.source_net_id === "signal",
    )
    expect(
      labeledProblem.labeledLayers[0]!.labels.every(
        (netIndex) => netIndex >= 0 && netIndex !== signalNetIndex,
      ),
    ).toBe(true)
  })

  test("does not assign a region through a foreign trace", () => {
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "board",
        center: { x: 0, y: 0 },
        width: 8,
        height: 8,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "source_net",
        source_net_id: "ground",
        name: "GND",
        member_source_group_ids: [],
        is_ground: true,
      },
      {
        type: "source_net",
        source_net_id: "power",
        name: "VBAT",
        member_source_group_ids: [],
        is_power: true,
      },
      {
        type: "source_net",
        source_net_id: "signal",
        name: "SIGNAL",
        member_source_group_ids: [],
        is_digital_signal: true,
      },
      {
        type: "pcb_via",
        pcb_via_id: "ground_anchor",
        x: -3.5,
        y: -3.5,
        outer_diameter: 0.6,
        hole_diameter: 0.3,
        layers: ["top"],
        source_net_id: "ground",
      },
      {
        type: "pcb_via",
        pcb_via_id: "power_anchor",
        x: 0,
        y: 0.5,
        outer_diameter: 0.6,
        hole_diameter: 0.3,
        layers: ["top"],
        source_net_id: "power",
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "signal_barrier",
        source_net_id: "signal",
        route: [
          { route_type: "wire", x: -2, y: -4, width: 0.2, layer: "top" },
          { route_type: "wire", x: -2, y: 4, width: 0.2, layer: "top" },
        ],
      },
    ] as AnyCircuitElement[]
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 1,
      layers: ["top"],
    })

    solver.solve()

    const labeledProblem =
      solver.getStageOutput<LabeledProblem>("assignGridCells")!
    const groundNetIndex = labeledProblem.nets.findIndex(
      (net) => net.sourceNet.source_net_id === "ground",
    )
    const leftCellIndex = 4 * labeledProblem.labeledLayers[0]!.nx

    expect(labeledProblem.labeledLayers[0]!.labels[leftCellIndex]).toBe(
      groundNetIndex,
    )
  })

  test("normalizes small unanchored regions into their larger neighbor", () => {
    const makeLayer = (): LabeledLayer => ({
      layer: "top",
      labels: Int32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]),
      nx: 3,
      ny: 3,
    })
    const normalizedLayer = makeLayer()
    normalizeLabeledLayerRegions(normalizedLayer, new Uint8Array(9), 2)
    expect([...normalizedLayer.labels]).toEqual(Array(9).fill(0))

    const anchoredLayer = makeLayer()
    const anchoredCells = new Uint8Array(9)
    anchoredCells[4] = 1
    normalizeLabeledLayerRegions(anchoredLayer, anchoredCells, 2)
    expect(anchoredLayer.labels[4]).toBe(1)
  })

  test("splits a region around another power net without overlap or gaps", () => {
    const makeVia = (
      pcbViaId: string,
      x: number,
      y: number,
      sourceNetId: string,
    ) => ({
      type: "pcb_via" as const,
      pcb_via_id: pcbViaId,
      x,
      y,
      outer_diameter: 0.5,
      hole_diameter: 0.2,
      layers: ["top"],
      source_net_id: sourceNetId,
    })
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "board",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "source_net",
        source_net_id: "ground",
        name: "GND",
        member_source_group_ids: [],
        is_ground: true,
      },
      {
        type: "source_net",
        source_net_id: "power",
        name: "VCC",
        member_source_group_ids: [],
        is_power: true,
      },
      makeVia("ground_left", -4, 0, "ground"),
      makeVia("ground_right", 4, 0, "ground"),
      makeVia("ground_top", 0, 4, "ground"),
      makeVia("ground_bottom", 0, -4, "ground"),
      makeVia("power_center", 0, 0, "power"),
    ] as AnyCircuitElement[]
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 0.5,
      layers: ["top"],
    })

    solver.solve()

    const output = solver.getOutput()
    expect(
      output.filter((pour) => pour.source_net_id === "ground"),
    ).toHaveLength(2)
    expect(
      output.filter((pour) => pour.source_net_id === "power"),
    ).toHaveLength(1)
    expect(
      output.reduce((area, pour) => area + getAbsolutePolygonArea(pour), 0),
    ).toBe(10 * 10)
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

  test("uses PCB endpoint connectivity when source trace metadata is stale", () => {
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "board",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "source_net",
        source_net_id: "positive-rail",
        name: "POWER",
        member_source_group_ids: [],
        is_power: true,
      },
      {
        type: "source_net",
        source_net_id: "return-rail",
        name: "RETURN",
        member_source_group_ids: [],
        is_ground: true,
      },
      {
        type: "source_port",
        source_port_id: "positive-terminal-a",
        name: "A",
      },
      {
        type: "source_port",
        source_port_id: "positive-terminal-b",
        name: "B",
      },
      {
        type: "source_port",
        source_port_id: "return-terminal",
        name: "C",
      },
      {
        type: "source_trace",
        source_trace_id: "positive-connection",
        connected_source_port_ids: [
          "positive-terminal-a",
          "positive-terminal-b",
        ],
        connected_source_net_ids: ["positive-rail"],
      },
      {
        type: "source_trace",
        source_trace_id: "return-connection",
        connected_source_port_ids: ["return-terminal"],
        connected_source_net_ids: ["return-rail"],
      },
      {
        type: "pcb_port",
        pcb_port_id: "pcb-terminal-a",
        source_port_id: "positive-terminal-a",
        pcb_component_id: "component-a",
        x: -1,
        y: 0,
        layers: ["top"],
      },
      {
        type: "pcb_port",
        pcb_port_id: "pcb-terminal-b",
        source_port_id: "positive-terminal-b",
        pcb_component_id: "component-b",
        x: 1,
        y: 0,
        layers: ["top"],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "routed-connection",
        source_trace_id: "return-connection",
        route: [
          {
            route_type: "wire",
            x: -1,
            y: 0,
            width: 0.2,
            layer: "top",
            start_pcb_port_id: "pcb-terminal-a",
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.2,
            layer: "top",
            end_pcb_port_id: "pcb-terminal-b",
          },
        ],
      },
    ] as unknown as AnyCircuitElement[]

    const prepared = prepareCircuitJson({ circuitJson })
    const tracePrimitive = prepared.primitives.find(
      (primitive) => primitive.kind === "segment",
    )

    expect(tracePrimitive).toBeDefined()
    expect(
      prepared.nets[tracePrimitive!.netIndex]?.sourceNet.source_net_id,
    ).toBe("positive-rail")
  })

  test("uses a connected power SMT pad as a power-region anchor", () => {
    const circuitJson = [
      {
        type: "pcb_board",
        pcb_board_id: "board",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        thickness: 1.4,
        num_layers: 2,
        material: "fr4",
      },
      {
        type: "source_net",
        source_net_id: "ground",
        name: "GND",
        member_source_group_ids: [],
        is_ground: true,
      },
      {
        type: "source_port",
        source_port_id: "ground_source_port",
        name: "GND",
      },
      {
        type: "source_trace",
        source_trace_id: "ground_source_trace",
        connected_source_port_ids: ["ground_source_port"],
        connected_source_net_ids: ["ground"],
      },
      {
        type: "pcb_port",
        pcb_port_id: "ground_pcb_port",
        source_port_id: "ground_source_port",
        pcb_component_id: "component",
        x: 0,
        y: 0,
        layers: ["top"],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "ground_pad",
        pcb_component_id: "component",
        pcb_port_id: "ground_pcb_port",
        shape: "rect",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        layer: "top",
      },
    ] as AnyCircuitElement[]
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 1,
      layers: ["top"],
    })

    solver.solve()

    const output = solver.getOutput()
    expect(output).toHaveLength(1)
    expect(output[0]?.source_net_id).toBe("ground")
    expect(getAbsolutePolygonArea(output[0]!)).toBe(4 * 4)
  })

  test("solves the nRF52810 Circuit JSON fixture", async () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: nrf52810Board,
      gridPitch: 0.25,
      minRegionArea: 0,
    })

    const initialGraphics = solver.visualize()
    expect(initialGraphics.rects?.length).toBeGreaterThan(0)
    expect(initialGraphics.lines?.length).toBeGreaterThan(0)
    expect(initialGraphics.circles?.length).toBeGreaterThan(0)
    expect(initialGraphics.polygons).toHaveLength(0)
    expect(
      initialGraphics.rects?.every((rect) => rect.fill?.startsWith("rgba(")),
    ).toBe(true)
    await expect(
      getSvgFromGraphicsObject(initialGraphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path, "nrf52810-full-board-before-solve")

    solver.solve()

    const output = solver.getOutput()
    const tracedOutput =
      solver.getStageOutput<ImplicitCopperPourSolverOutput>(
        "tracePowerPolygons",
      )!
    const labeledOutput =
      solver.getStageOutput<LabeledProblem>("assignGridCells")!
    const tracedPointCount = tracedOutput.reduce(
      (sum, pour) => sum + (pour.shape === "polygon" ? pour.points.length : 0),
      0,
    )
    const outputPointCount = output.reduce(
      (sum, pour) => sum + (pour.shape === "polygon" ? pour.points.length : 0),
      0,
    )
    expect(output.length).toBeGreaterThan(0)
    expect(outputPointCount).toBeLessThan(tracedPointCount)
    expect(
      output.every((pour) =>
        ["source_net_0", "source_net_1"].includes(pour.source_net_id ?? ""),
      ),
    ).toBe(true)
    expect(new Set(output.map((pour) => pour.source_net_id))).toEqual(
      new Set(["source_net_0", "source_net_1"]),
    )
    for (const labeledLayer of labeledOutput.labeledLayers) {
      const labeledArea =
        labeledLayer.labels.filter((netIndex) => netIndex >= 0).length *
        labeledOutput.gridPitch ** 2
      const tracedArea = tracedOutput
        .filter((pour) => pour.layer === labeledLayer.layer)
        .reduce((area, pour) => area + getAbsolutePolygonArea(pour), 0)
      expect(tracedArea).toBe(labeledArea)
    }

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
    await expect(
      getSvgFromGraphicsObject(solvedGraphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path, "nrf52810-full-board-after-solve")

    const topGraphics = filterGraphicsByLayer(solvedGraphics, 0)
    const bottomGraphics = filterGraphicsByLayer(solvedGraphics, 1)
    expect(topGraphics.polygons).toHaveLength(
      output.filter((pour) => pour.layer === "top").length,
    )
    expect(bottomGraphics.polygons).toHaveLength(
      output.filter((pour) => pour.layer === "bottom").length,
    )
    await expect(
      getSvgFromGraphicsObject(topGraphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path, "nrf52810-top-layer-after-solve")
    await expect(
      getSvgFromGraphicsObject(bottomGraphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path, "nrf52810-bottom-layer-after-solve")
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

  test("prepares unconnected plated holes without treating them as power", () => {
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

  test("rejects invalid edge simplification tolerances", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      edgeSimplificationTolerance: -1,
    })

    expect(() => solver.solve()).toThrow(
      "edgeSimplificationTolerance must be zero or greater",
    )
  })

  test("rejects invalid region normalization areas", () => {
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson: simplePowerBoard,
      regionNormalizationArea: -1,
    })

    expect(() => solver.solve()).toThrow(
      "regionNormalizationArea must be zero or greater",
    )
  })
})
