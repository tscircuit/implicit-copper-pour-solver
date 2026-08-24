import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  assignGridCells,
  buildPowerPourPolygons,
  getLayerColor,
} from "./grid-solver"
import { prepareCircuitJson } from "./prepare-circuit-json"
import { simplifyPolygonSetEdges } from "./simplify-polygon-edges"
import type {
  ImplicitCopperPourSolverInput,
  ImplicitCopperPourSolverOutput,
  LabeledProblem,
  PreparedProblem,
} from "./types"
import {
  mergeSolverGraphics,
  visualizePowerPours,
  visualizePreparedProblem,
} from "./visualize"

class PrepareCircuitJsonSolver extends BaseSolver {
  private output?: PreparedProblem

  constructor(private input: ImplicitCopperPourSolverInput) {
    super()
  }

  override _step() {
    this.output = prepareCircuitJson(this.input)
    this.solved = true
  }

  override getOutput(): PreparedProblem {
    if (!this.output) throw new Error("Circuit JSON has not been prepared")
    return this.output
  }
}

class AssignGridCellsSolver extends BaseSolver {
  private output?: LabeledProblem

  constructor(private input: PreparedProblem) {
    super()
  }

  override _step() {
    this.output = assignGridCells(this.input)
    this.stats = {
      layers: this.output.labeledLayers.length,
      samples: this.output.labeledLayers.reduce(
        (sum, layer) => sum + layer.nx * layer.ny,
        0,
      ),
    }
    this.solved = true
  }

  override getOutput(): LabeledProblem {
    if (!this.output) throw new Error("Grid cells have not been assigned")
    return this.output
  }
}

class TracePowerPolygonsSolver extends BaseSolver {
  private output?: ImplicitCopperPourSolverOutput

  constructor(private input: LabeledProblem) {
    super()
  }

  override _step() {
    this.output = buildPowerPourPolygons(this.input)
    this.stats = { polygons: this.output.length }
    this.solved = true
  }

  override getOutput(): ImplicitCopperPourSolverOutput {
    if (!this.output) throw new Error("Power polygons have not been traced")
    return this.output
  }

  override visualize(): GraphicsObject {
    return {
      points: [],
      rects: [],
      circles: [],
      texts: [],
      lines: (this.output ?? []).flatMap((pour) => {
        if (pour.shape !== "polygon") return []
        return [
          {
            points: [...pour.points, pour.points[0]!],
            strokeColor: getLayerColor(pour.layer),
            strokeWidth: 0.08,
            label: pour.source_net_id,
          },
        ]
      }),
    }
  }
}

class SimplifyPolygonEdgesSolver extends BaseSolver {
  private output?: ImplicitCopperPourSolverOutput

  constructor(
    private input: {
      pours: ImplicitCopperPourSolverOutput
      tolerance: number
    },
  ) {
    super()
  }

  override _step() {
    let inputPoints = 0
    let outputPoints = 0
    const output = [...this.input.pours]
    const polygonIndicesByLayer = new Map<string, number[]>()

    for (const [pourIndex, pour] of this.input.pours.entries()) {
      if (pour.shape !== "polygon") continue
      inputPoints += pour.points.length
      const indices = polygonIndicesByLayer.get(pour.layer) ?? []
      indices.push(pourIndex)
      polygonIndicesByLayer.set(pour.layer, indices)
    }

    for (const polygonIndices of polygonIndicesByLayer.values()) {
      const simplifiedPolygons = simplifyPolygonSetEdges(
        polygonIndices.map((pourIndex) => {
          const pour = this.input.pours[pourIndex]!
          if (pour.shape !== "polygon") return []
          return pour.points
        }),
        this.input.tolerance,
      )
      for (const [layerPolygonIndex, points] of simplifiedPolygons.entries()) {
        const pourIndex = polygonIndices[layerPolygonIndex]!
        const pour = this.input.pours[pourIndex]!
        if (pour.shape !== "polygon") continue
        output[pourIndex] = { ...pour, points }
        outputPoints += points.length
      }
    }
    this.output = output
    this.stats = {
      polygons: this.output.length,
      inputPoints,
      outputPoints,
      pointsRemoved: inputPoints - outputPoints,
    }
    this.solved = true
  }

  override getOutput(): ImplicitCopperPourSolverOutput {
    if (!this.output) throw new Error("Polygon edges have not been simplified")
    return this.output
  }

  override visualize(): GraphicsObject {
    return {
      points: [],
      rects: [],
      circles: [],
      texts: [],
      lines: (this.output ?? []).flatMap((pour) => {
        if (pour.shape !== "polygon") return []
        return [
          {
            points: [...pour.points, pour.points[0]!],
            strokeColor: getLayerColor(pour.layer),
            strokeWidth: 0.08,
            label: pour.source_net_id,
          },
        ]
      }),
    }
  }
}

export class ImplicitCopperPourPipelineSolver extends BasePipelineSolver<ImplicitCopperPourSolverInput> {
  private initialPreparedProblem?: PreparedProblem

  pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "prepareCircuitJson",
      PrepareCircuitJsonSolver,
      (instance: ImplicitCopperPourPipelineSolver) => [instance.inputProblem],
    ),
    definePipelineStep(
      "assignGridCells",
      AssignGridCellsSolver,
      (instance: ImplicitCopperPourPipelineSolver) => [
        instance.getStageOutput<PreparedProblem>("prepareCircuitJson")!,
      ],
    ),
    definePipelineStep(
      "tracePowerPolygons",
      TracePowerPolygonsSolver,
      (instance: ImplicitCopperPourPipelineSolver) => [
        instance.getStageOutput<LabeledProblem>("assignGridCells")!,
      ],
    ),
    definePipelineStep(
      "simplifyPolygonEdges",
      SimplifyPolygonEdgesSolver,
      (instance: ImplicitCopperPourPipelineSolver) => {
        const preparedProblem =
          instance.getStageOutput<PreparedProblem>("prepareCircuitJson")!
        return [
          {
            pours:
              instance.getStageOutput<ImplicitCopperPourSolverOutput>(
                "tracePowerPolygons",
              )!,
            tolerance:
              instance.inputProblem.edgeSimplificationTolerance ??
              preparedProblem.gridPitch,
          },
        ]
      },
    ),
  ]

  override getSolverName(): string {
    return "ImplicitCopperPourPipelineSolver"
  }

  override getConstructorParams() {
    return [this.inputProblem]
  }

  override getOutput(): ImplicitCopperPourSolverOutput {
    return (
      this.getStageOutput<ImplicitCopperPourSolverOutput>(
        "simplifyPolygonEdges",
      ) ?? []
    )
  }

  override visualize(): GraphicsObject {
    const preparedProblem =
      this.getStageOutput<PreparedProblem>("prepareCircuitJson") ??
      (this.initialPreparedProblem ??= prepareCircuitJson(this.inputProblem))
    const sourceGraphics = visualizePreparedProblem(preparedProblem)
    const pours =
      this.getStageOutput<ImplicitCopperPourSolverOutput>(
        "simplifyPolygonEdges",
      ) ??
      this.getStageOutput<ImplicitCopperPourSolverOutput>(
        "tracePowerPolygons",
      ) ??
      []

    return mergeSolverGraphics(
      sourceGraphics,
      visualizePowerPours(preparedProblem, pours),
    )
  }
}
