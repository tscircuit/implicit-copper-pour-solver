import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { ImplicitCopperPourPipelineSolver } from "lib"
import { powerTraceExpansionBoard } from "tests/fixtures/power-trace-expansion-board"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new ImplicitCopperPourPipelineSolver({
        circuitJson: powerTraceExpansionBoard,
        gridPitch: 0.25,
        minRegionArea: 2,
      })
    }
  />
)
