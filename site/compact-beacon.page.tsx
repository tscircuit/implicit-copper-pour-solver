import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import type { AnyCircuitElement } from "circuit-json"
import { ImplicitCopperPourPipelineSolver } from "lib"
import circuitJson from "tests/fixtures/compact-beacon.json"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new ImplicitCopperPourPipelineSolver({
        circuitJson: circuitJson as AnyCircuitElement[],
        gridPitch: 0.25,
        minRegionArea: 2,
      })
    }
  />
)
