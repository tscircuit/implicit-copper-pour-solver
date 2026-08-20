import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { ImplicitCopperPourPipelineSolver } from "lib"
import { simplePowerBoard } from "tests/fixtures/simple-power-board"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new ImplicitCopperPourPipelineSolver({
        circuitJson: simplePowerBoard,
        gridPitch: 0.25,
        minRegionArea: 2,
      })
    }
  />
)
