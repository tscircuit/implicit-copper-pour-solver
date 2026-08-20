import type { GraphicsObject } from "graphics-debug"
import type { ImplicitCopperPourSolverOutput, PreparedProblem } from "./types"

const BOARD_STROKE = "#555a66"
const TOP_COPPER = "red"
const BOTTOM_COPPER = "blue"
const TOP_OBSTACLE_FILL = "rgba(255, 0, 0, 0.5)"
const BOTTOM_OBSTACLE_FILL = "rgba(0, 0, 255, 0.5)"
const POUR_OPACITY = 0.35

const NET_COLORS = [
  "#ed9148",
  "#d93bd0",
  "#b6df38",
  "#438bd9",
  "#e5485f",
  "#43d16d",
  "#8b48df",
  "#e6b93f",
  "#43ced2",
  "#cf3d99",
]

const colorWithOpacity = (hexColor: string, opacity: number): string => {
  const red = Number.parseInt(hexColor.slice(1, 3), 16)
  const green = Number.parseInt(hexColor.slice(3, 5), 16)
  const blue = Number.parseInt(hexColor.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

const getGraphicsLayer = (layers: string[]): string => {
  const zLayers = layers
    .map((layer) => (layer === "top" ? 0 : layer === "bottom" ? 1 : null))
    .filter((layer): layer is 0 | 1 => layer !== null)
  return `z${Array.from(new Set(zLayers)).join(",")}`
}

const getPrimitiveColor = (layers: string[]): string =>
  layers.includes("top") ? TOP_COPPER : BOTTOM_COPPER

const getObstacleFill = (layers: string[]): string =>
  layers.includes("top") ? TOP_OBSTACLE_FILL : BOTTOM_OBSTACLE_FILL

const getPrimitiveLabel = (
  problem: PreparedProblem,
  netIndex: number,
  kind: string,
): string => {
  const net = problem.nets[netIndex]?.sourceNet
  return `${net?.name ?? net?.source_net_id ?? "unknown net"} ${kind}`
}

export const visualizePreparedProblem = (
  problem: PreparedProblem,
): GraphicsObject => {
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: "Circuit JSON copper obstacles",
    points: [],
    rects: [],
    circles: [],
    lines: [
      {
        points: [...problem.boardOutline, problem.boardOutline[0]!],
        strokeColor: BOARD_STROKE,
        strokeWidth: 0.08,
        label: "PCB outline",
      },
    ],
    polygons: [],
    texts: [],
  }

  for (const primitive of problem.primitives) {
    const color = getPrimitiveColor(primitive.layers)
    const obstacleFill = getObstacleFill(primitive.layers)
    const layer = getGraphicsLayer(primitive.layers)
    const label = getPrimitiveLabel(problem, primitive.netIndex, primitive.kind)

    if (primitive.kind === "rect") {
      graphics.rects!.push({
        center: { x: primitive.x, y: primitive.y },
        width: primitive.halfWidth * 2,
        height: primitive.halfHeight * 2,
        ccwRotationDegrees: primitive.rotation,
        fill: obstacleFill,
        layer,
        label,
      })
      continue
    }

    if (primitive.kind === "segment") {
      const isTopLayer = primitive.layers.includes("top")
      graphics.lines!.push({
        points: [
          { x: primitive.x1, y: primitive.y1 },
          { x: primitive.x2, y: primitive.y2 },
        ],
        strokeColor: isTopLayer ? color : "rgba(0, 0, 255, 0.5)",
        strokeWidth: primitive.halfWidth * 2,
        ...(isTopLayer ? {} : { strokeDash: [0.2, 0.2] }),
        layer,
        label,
      })
      continue
    }

    if (primitive.kind === "polygon") {
      graphics.polygons!.push({
        points: primitive.points,
        fill: obstacleFill,
        stroke: color,
        strokeWidth: 0.04,
        layer,
        label,
      })
      continue
    }

    const isThroughHole =
      primitive.layers.includes("top") && primitive.layers.includes("bottom")
    graphics.circles!.push({
      center: { x: primitive.x, y: primitive.y },
      radius: primitive.radius,
      fill: isThroughHole ? BOTTOM_COPPER : obstacleFill,
      stroke: "none",
      layer,
      label,
    })
  }

  return graphics
}

export const visualizePowerPours = (
  problem: PreparedProblem,
  pours: ImplicitCopperPourSolverOutput,
): GraphicsObject => ({
  coordinateSystem: "cartesian",
  title: "Power-net copper pour polygons",
  points: [],
  rects: [],
  circles: [],
  lines: [],
  polygons: pours.flatMap((pour) => {
    if (pour.shape !== "polygon") return []
    const netIndex = problem.nets.findIndex(
      ({ sourceNet }) => sourceNet.source_net_id === pour.source_net_id,
    )
    const color = NET_COLORS[Math.max(0, netIndex) % NET_COLORS.length]!
    const sourceNet = problem.nets[netIndex]?.sourceNet
    return [
      {
        points: pour.points,
        fill: colorWithOpacity(color, POUR_OPACITY),
        stroke: color,
        strokeWidth: 0.06,
        layer: getGraphicsLayer([pour.layer]),
        label: `${sourceNet?.name ?? pour.source_net_id ?? "power net"} ${pour.layer} pour`,
      },
    ]
  }),
  texts: [],
})

export const mergeSolverGraphics = (
  source: GraphicsObject,
  overlay: GraphicsObject,
): GraphicsObject => {
  return {
    coordinateSystem: "cartesian",
    title: overlay.polygons?.length ? overlay.title : source.title,
    polygons: [...(overlay.polygons ?? []), ...(source.polygons ?? [])],
    rects: [...(source.rects ?? []), ...(overlay.rects ?? [])],
    lines: [...(source.lines ?? []), ...(overlay.lines ?? [])],
    circles: [...(source.circles ?? []), ...(overlay.circles ?? [])],
    points: [...(source.points ?? []), ...(overlay.points ?? [])],
    texts: [...(source.texts ?? []), ...(overlay.texts ?? [])],
  }
}
