import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { prepareCircuitJson } from "../lib/prepare-circuit-json"

const board = {
  type: "pcb_board",
  pcb_board_id: "board",
  center: { x: 0, y: 0 },
  width: 20,
  height: 20,
  thickness: 1.6,
  num_layers: 2,
  material: "fr4",
} as const

test("places hole_with_polygon_pad outlines at the hole center", () => {
  const circuitJson = [
    board,
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "poly_pad",
      shape: "hole_with_polygon_pad",
      hole_shape: "circle",
      hole_diameter: 0.6,
      hole_offset_x: 0.2,
      hole_offset_y: 0,
      x: 2,
      y: -1,
      layers: ["top", "bottom"],
      pad_outline: [
        { x: -1, y: -0.5 },
        { x: 1, y: -0.5 },
        { x: 1, y: 0.5 },
        { x: -1, y: 0.5 },
      ],
    },
  ] as AnyCircuitElement[]

  const prepared = prepareCircuitJson({ circuitJson })
  const polygon = prepared.primitives.find(
    (primitive) => primitive.kind === "polygon",
  )
  expect(polygon).toMatchObject({
    kind: "polygon",
    layers: ["top", "bottom"],
    points: [
      { x: 1, y: -1.5 },
      { x: 3, y: -1.5 },
      { x: 3, y: -0.5 },
      { x: 1, y: -0.5 },
    ],
  })
})

test("rotates hole_with_polygon_pad outlines by ccw_rotation", () => {
  const circuitJson = [
    board,
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "poly_pad",
      shape: "hole_with_polygon_pad",
      hole_shape: "circle",
      hole_diameter: 0.6,
      x: 2,
      y: -1,
      ccw_rotation: 90,
      layers: ["top", "bottom"],
      pad_outline: [
        { x: -1, y: -0.5 },
        { x: 1, y: -0.5 },
        { x: 1, y: 0.5 },
        { x: -1, y: 0.5 },
      ],
    },
  ] as AnyCircuitElement[]

  const prepared = prepareCircuitJson({ circuitJson })
  const polygon = prepared.primitives.find(
    (primitive) => primitive.kind === "polygon",
  )
  expect(polygon?.kind).toBe("polygon")
  if (polygon?.kind !== "polygon") return
  const expected = [
    { x: 2.5, y: -2 },
    { x: 2.5, y: 0 },
    { x: 1.5, y: 0 },
    { x: 1.5, y: -2 },
  ]
  expect(polygon.points).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(polygon.points[i]!.x).toBeCloseTo(expected[i]!.x, 6)
    expect(polygon.points[i]!.y).toBeCloseTo(expected[i]!.y, 6)
  }
})
