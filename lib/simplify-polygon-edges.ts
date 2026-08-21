import type { Point } from "circuit-json"

const pointsEqual = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

const getSquaredSegmentDistance = (
  point: Point,
  start: Point,
  end: Point,
): number => {
  let x = start.x
  let y = start.y
  const dx = end.x - x
  const dy = end.y - y

  if (dx !== 0 || dy !== 0) {
    const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = end.x
      y = end.y
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }

  const distanceX = point.x - x
  const distanceY = point.y - y
  return distanceX * distanceX + distanceY * distanceY
}

const simplifyOpenPath = (
  points: Point[],
  toleranceSquared: number,
): Point[] => {
  if (points.length <= 2) return [...points]

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const ranges: Array<[number, number]> = [[0, points.length - 1]]

  while (ranges.length > 0) {
    const [firstIndex, lastIndex] = ranges.pop()!
    const first = points[firstIndex]!
    const last = points[lastIndex]!
    let furthestIndex = -1
    let furthestDistance = toleranceSquared

    for (let index = firstIndex + 1; index < lastIndex; index++) {
      const distance = getSquaredSegmentDistance(points[index]!, first, last)
      if (distance > furthestDistance) {
        furthestDistance = distance
        furthestIndex = index
      }
    }

    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1
      ranges.push([firstIndex, furthestIndex], [furthestIndex, lastIndex])
    }
  }

  return points.filter((_, index) => keep[index] === 1)
}

const getSignedArea = (points: Point[]): number => {
  let twiceArea = 0
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    const next = points[(index + 1) % points.length]!
    twiceArea += point.x * next.y - next.x * point.y
  }
  return twiceArea / 2
}

const crossProduct = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const isPointOnSegment = (point: Point, start: Point, end: Point): boolean =>
  point.x >= Math.min(start.x, end.x) &&
  point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) &&
  point.y <= Math.max(start.y, end.y)

const segmentsIntersect = (
  aStart: Point,
  aEnd: Point,
  bStart: Point,
  bEnd: Point,
): boolean => {
  const abStart = crossProduct(aStart, aEnd, bStart)
  const abEnd = crossProduct(aStart, aEnd, bEnd)
  const baStart = crossProduct(bStart, bEnd, aStart)
  const baEnd = crossProduct(bStart, bEnd, aEnd)

  if (
    ((abStart > 0 && abEnd < 0) || (abStart < 0 && abEnd > 0)) &&
    ((baStart > 0 && baEnd < 0) || (baStart < 0 && baEnd > 0))
  ) {
    return true
  }

  return (
    (abStart === 0 && isPointOnSegment(bStart, aStart, aEnd)) ||
    (abEnd === 0 && isPointOnSegment(bEnd, aStart, aEnd)) ||
    (baStart === 0 && isPointOnSegment(aStart, bStart, bEnd)) ||
    (baEnd === 0 && isPointOnSegment(aEnd, bStart, bEnd))
  )
}

const isSimplePolygon = (points: Point[]): boolean => {
  for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
    const firstEndIndex = (firstIndex + 1) % points.length
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < points.length;
      secondIndex++
    ) {
      const secondEndIndex = (secondIndex + 1) % points.length
      const sharesEndpoint =
        firstIndex === secondIndex ||
        firstIndex === secondEndIndex ||
        firstEndIndex === secondIndex ||
        firstEndIndex === secondEndIndex
      if (sharesEndpoint) continue

      if (
        segmentsIntersect(
          points[firstIndex]!,
          points[firstEndIndex]!,
          points[secondIndex]!,
          points[secondEndIndex]!,
        )
      ) {
        return false
      }
    }
  }
  return true
}

/**
 * Simplify a closed polygon with a Ramer-Douglas-Peucker pass.
 *
 * Polygon points are not expected to repeat the first point at the end. Invalid
 * simplifications fall back to the original polygon so this stage cannot emit a
 * degenerate, orientation-flipped, or self-intersecting result.
 */
export const simplifyPolygonEdges = (
  polygon: Point[],
  tolerance: number,
): Point[] => {
  const points = polygon.filter(
    (point, index) => index === 0 || !pointsEqual(point, polygon[index - 1]!),
  )
  if (
    points.length > 1 &&
    pointsEqual(points[0]!, points[points.length - 1]!)
  ) {
    points.pop()
  }
  if (points.length < 4 || tolerance <= 0) return points

  const closedPath = [...points, points[0]!]
  const simplified = simplifyOpenPath(closedPath, tolerance * tolerance)
  if (pointsEqual(simplified[0]!, simplified[simplified.length - 1]!)) {
    simplified.pop()
  }

  const originalArea = getSignedArea(points)
  const simplifiedArea = getSignedArea(simplified)
  const preservesOrientation =
    originalArea !== 0 &&
    simplifiedArea !== 0 &&
    Math.sign(originalArea) === Math.sign(simplifiedArea)

  if (
    simplified.length < 3 ||
    !preservesOrientation ||
    !isSimplePolygon(simplified)
  ) {
    return points
  }

  return simplified
}
