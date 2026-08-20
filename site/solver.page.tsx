import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { ImplicitCopperPourPipelineSolver } from "lib"
import { nrf52810Board } from "tests/fixtures/nrf52810-board"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new ImplicitCopperPourPipelineSolver({
        circuitJson: nrf52810Board,
        gridPitch: 0.25,
        minRegionArea: 2,
      })
    }
  />
)
