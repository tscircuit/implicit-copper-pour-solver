import { describe, expect, test } from "bun:test"
import {
  simplifyPolygonEdges,
  simplifyPolygonSetEdges,
} from "../lib/simplify-polygon-edges"

const getPolygonArea = (points: Array<{ x: number; y: number }>): number => {
  let twiceArea = 0
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    const next = points[(index + 1) % points.length]!
    twiceArea += point.x * next.y - next.x * point.y
  }
  return Math.abs(twiceArea / 2)
}

const getEdges = (points: Array<{ x: number; y: number }>) =>
  points.map((start, index) => ({
    start,
    end: points[(index + 1) % points.length]!,
    key: [
      `${start.x},${start.y}`,
      `${points[(index + 1) % points.length]!.x},${points[(index + 1) % points.length]!.y}`,
    ]
      .sort()
      .join("|"),
  }))

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

  test("keeps adjacent smoothed grid regions watertight", () => {
    const leftRegion = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ]
    const rightRegion = [
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ]

    const [left, right] = simplifyPolygonSetEdges([leftRegion, rightRegion], 1)
    const rightEdgeKeys = new Set(getEdges(right!).map((edge) => edge.key))
    const sharedEdges = getEdges(left!).filter((edge) =>
      rightEdgeKeys.has(edge.key),
    )

    expect(sharedEdges.length).toBeGreaterThan(0)
    expect(
      sharedEdges.some(
        ({ start, end }) => start.x !== end.x && start.y !== end.y,
      ),
    ).toBe(true)
    expect(getPolygonArea(left!) + getPolygonArea(right!)).toBe(16)
  })
})
