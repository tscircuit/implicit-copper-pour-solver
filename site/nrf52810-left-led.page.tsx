import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { ImplicitCopperPourPipelineSolver } from "lib"
import { nrf52810LeftLedBoard } from "tests/fixtures/nrf52810-variants"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new ImplicitCopperPourPipelineSolver({
        circuitJson: nrf52810LeftLedBoard,
        gridPitch: 0.25,
        minRegionArea: 2,
      })
    }
  />
)
