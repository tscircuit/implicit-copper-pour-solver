import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { ImplicitCopperPourPipelineSolver } from "../lib"
import compactBeacon from "./fixtures/compact-beacon.json"
import ledController from "./fixtures/led-controller.json"
import sensorBreakout from "./fixtures/sensor-breakout.json"
import analogInput from "./fixtures/analog-input.json"
import { filterGraphicsByLayer } from "./fixtures/filter-graphics-by-layer"

const examples = [
  ["compact-beacon", compactBeacon, 28, 28],
  ["led-controller", ledController, 48, 24],
  ["sensor-breakout", sensorBreakout, 30, 46],
  ["analog-input", analogInput, 44, 34],
] as const

for (const [name, json, width, height] of examples) {
  test(`${name} has routed copper and snapshots for both layers`, async () => {
    const circuitJson = json as AnyCircuitElement[]
    const board = circuitJson.find((e) => e.type === "pcb_board")!
    expect(board.type === "pcb_board" && board.width).toBe(width)
    expect(board.type === "pcb_board" && board.height).toBe(height)
    expect(circuitJson.filter((e) => e.type.endsWith("_error"))).toEqual([])
    expect(
      circuitJson.filter((e) => e.type === "pcb_trace").length,
    ).toBeGreaterThan(20)
    expect(circuitJson.filter((e) => e.type === "pcb_copper_pour")).toEqual([])
    const powerNetIds = new Set(
      circuitJson.flatMap((e) =>
        e.type === "source_net" && (e.is_power || e.is_ground)
          ? [e.source_net_id]
          : [],
      ),
    )
    expect(powerNetIds.size).toBe(2)
    const solver = new ImplicitCopperPourPipelineSolver({
      circuitJson,
      gridPitch: 0.25,
      minRegionArea: 2,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const output = solver.getOutput()
    const graphics = solver.visualize()
    await expect(
      getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path, `${name}-both`)
    for (const [layer, index] of [
      ["top", 0],
      ["bottom", 1],
    ] as const) {
      const pours = output.filter((pour) => pour.layer === layer)
      expect(new Set(pours.map((pour) => pour.source_net_id))).toEqual(
        powerNetIds,
      )
      const layerGraphics = filterGraphicsByLayer(graphics, index)
      expect(layerGraphics.polygons).toHaveLength(pours.length)
      await expect(
        getSvgFromGraphicsObject(layerGraphics, { backgroundColor: "white" }),
      ).toMatchSvgSnapshot(import.meta.path, `${name}-${layer}`)
    }
  }, 30_000)
}
