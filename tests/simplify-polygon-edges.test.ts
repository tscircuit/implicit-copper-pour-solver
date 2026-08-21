import { describe, expect, test } from "bun:test"
import { simplifyPolygonEdges } from "../lib/simplify-polygon-edges"

describe("simplifyPolygonEdges", () => {
  test("smooths grid stair steps while preserving polygon orientation", () => {
    const stairStepPolygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ]

    const simplified = simplifyPolygonEdges(stairStepPolygon, 1)
    const containsSmoothedDiagonal = simplified.some((point, index) => {
      const next = simplified[(index + 1) % simplified.length]!
      return point.x !== next.x && point.y !== next.y
    })

    expect(simplified.length).toBeLessThan(stairStepPolygon.length)
    expect(containsSmoothedDiagonal).toBe(true)
    expect(simplified).toContainEqual({ x: 0, y: 0 })
    expect(simplified).toContainEqual({ x: 0, y: 3 })
  })

  test("leaves the polygon unchanged when simplification is disabled", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]

    expect(simplifyPolygonEdges(polygon, 0)).toEqual(polygon)
  })

  test("falls back when the tolerance would collapse a small polygon", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]

    expect(simplifyPolygonEdges(polygon, 10)).toEqual(polygon)
  })
})
