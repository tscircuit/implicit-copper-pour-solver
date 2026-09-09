import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { ImplicitCopperPourPipelineSolver } from "../lib"
import { filterGraphicsByLayer } from "./fixtures/filter-graphics-by-layer"
import { nrf52810Board } from "./fixtures/nrf52810-board"
import {
  nrf52810BottomBulkBoard,
  nrf52810LeftLedBoard,
  nrf52810LowerDebugBoard,
  nrf52810TopDecouplingBoard,
} from "./fixtures/nrf52810-variants"

const examples = [
  ["left-led", nrf52810LeftLedBoard, 0],
  ["lower-debug", nrf52810LowerDebugBoard, 0],
  ["top-decoupling", nrf52810TopDecouplingBoard, 3],
  ["bottom-bulk", nrf52810BottomBulkBoard, 3],
] as const

for (const [name, circuitJson, addedComponents] of examples) {
  test(`nRF52810 ${name} solves on both layers`, async () => {
    expect(circuitJson.filter((e) => e.type === "pcb_component").length).toBe(
      nrf52810Board.filter((e) => e.type === "pcb_component").length +
        addedComponents,
    )
    expect(circuitJson.some((e) => e.type === "pcb_copper_pour")).toBe(false)
    // A moved footprint must retain its electrical attachment to routed copper.
    const ports = new Map(
      circuitJson.flatMap((e) =>
        e.type === "pcb_port" ? [[e.pcb_port_id, e] as const] : [],
      ),
    )
    for (const trace of circuitJson) {
      if (trace.type !== "pcb_trace") continue
      for (const point of trace.route) {
        if (point.route_type !== "wire") continue
        const id = point.start_pcb_port_id ?? point.end_pcb_port_id
        if (!id) continue
        const port = ports.get(id)!
        expect(port).toBeDefined()
        expect(point.x).toBeCloseTo(port.x, 5)
        expect(point.y).toBeCloseTo(port.y, 5)
      }
    }
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 0.25,
      minRegionArea: 2,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const output = solver.getOutput()
    for (const layer of ["top", "bottom"]) {
      expect(
        new Set(
          output.filter((p) => p.layer === layer).map((p) => p.source_net_id),
        ),
      ).toEqual(new Set(["source_net_0", "source_net_1"]))
    }
    const graphics = solver.visualize()
    await expect(
      getSvgFromGraphicsObject(graphics, {
        backgroundColor: "white",
      }),
    ).toMatchSvgSnapshot(import.meta.path, name)
    for (const [layer, index] of [
      ["top", 0],
      ["bottom", 1],
    ] as const) {
      const layerGraphics = filterGraphicsByLayer(graphics, index)
      expect(layerGraphics.polygons).toHaveLength(
        output.filter((pour) => pour.layer === layer).length,
      )
      await expect(
        getSvgFromGraphicsObject(layerGraphics, { backgroundColor: "white" }),
      ).toMatchSvgSnapshot(import.meta.path, `${name}-${layer}`)
    }
  })
}

test("variants leave the original board intact and do not share elements", () => {
  expect(nrf52810Board.some((e) => e.type === "pcb_copper_pour")).toBe(true)
  const original = nrf52810Board.find(
    (e) =>
      e.type === "pcb_component" &&
      e.source_component_id === "source_component_17",
  )!
  expect(original.type === "pcb_component" && original.center.x).toBe(-1.4)
  for (const [, board] of examples) {
    expect(board[0]).not.toBe(
      nrf52810Board.find((e) => e.type === board[0]!.type),
    )
  }
})
