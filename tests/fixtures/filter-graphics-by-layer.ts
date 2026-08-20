import type { GraphicsObject } from "graphics-debug"

type LayeredGraphic = { layer?: string }

const isOnLayer = (graphic: LayeredGraphic, layerIndex: 0 | 1): boolean => {
  if (!graphic.layer) return true
  const layerList = graphic.layer.replace(/^z/, "").split(",")
  return layerList.includes(String(layerIndex))
}

export const filterGraphicsByLayer = (
  graphics: GraphicsObject,
  layerIndex: 0 | 1,
): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.filter((graphic) => isOnLayer(graphic, layerIndex)),
  lines: graphics.lines?.filter((graphic) => isOnLayer(graphic, layerIndex)),
  infiniteLines: graphics.infiniteLines?.filter((graphic) =>
    isOnLayer(graphic, layerIndex),
  ),
  rects: graphics.rects?.filter((graphic) => isOnLayer(graphic, layerIndex)),
  circles: graphics.circles?.filter((graphic) =>
    isOnLayer(graphic, layerIndex),
  ),
  polygons: graphics.polygons?.filter((graphic) =>
    isOnLayer(graphic, layerIndex),
  ),
  texts: graphics.texts?.filter((graphic) => isOnLayer(graphic, layerIndex)),
})
