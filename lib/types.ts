import type {
  AnyCircuitElement,
  LayerRef,
  PcbCopperPour,
  Point,
  SourceNet,
} from "circuit-json"

export interface ImplicitCopperPourSolverInput {
  circuitJson: AnyCircuitElement[]
  /** Grid spacing in millimetres. Matches the artifact's 0.25 mm default. */
  gridPitch?: number
  /**
   * Maximum edge deviation in millimetres when smoothing traced grid polygons.
   * Defaults to gridPitch. Set to zero to disable edge simplification.
   */
  edgeSimplificationTolerance?: number
  /**
   * Four-connected regions smaller than this area are discarded. Defaults to
   * zero so the board remains completely partitioned between power nets.
   */
  minRegionArea?: number
  /** Copper layers to solve. Defaults to top and bottom. */
  layers?: LayerRef[]
  /** Whether emitted pours are covered by solder mask. Defaults to true. */
  coveredWithSolderMask?: boolean
}

/** Coarse region outlines; these are not final manufacturable copper geometry. */
export type ImplicitCopperPourSolverOutput = PcbCopperPour[]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PreparedNet {
  sourceNet: SourceNet
  isPower: boolean
}

export type CopperPrimitive =
  | {
      kind: "circle"
      layers: LayerRef[]
      netIndex: number
      x: number
      y: number
      radius: number
    }
  | {
      kind: "rect"
      layers: LayerRef[]
      netIndex: number
      x: number
      y: number
      halfWidth: number
      halfHeight: number
      rotation: number
    }
  | {
      kind: "segment"
      layers: LayerRef[]
      netIndex: number
      x1: number
      y1: number
      x2: number
      y2: number
      halfWidth: number
    }
  | {
      kind: "polygon"
      layers: LayerRef[]
      netIndex: number
      points: Point[]
    }

export interface PreparedProblem {
  bounds: Bounds
  boardOutline: Point[]
  layers: LayerRef[]
  nets: PreparedNet[]
  primitives: CopperPrimitive[]
  gridPitch: number
  minRegionArea: number
  coveredWithSolderMask: boolean
}

export interface LabeledLayer {
  layer: LayerRef
  labels: Int32Array
  nx: number
  ny: number
}

export interface LabeledProblem extends PreparedProblem {
  labeledLayers: LabeledLayer[]
}
