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
        "tracePowerPolygons",
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
        "tracePowerPolygons",
      ) ?? []

    return mergeSolverGraphics(
      sourceGraphics,
      visualizePowerPours(preparedProblem, pours),
    )
  }
}
