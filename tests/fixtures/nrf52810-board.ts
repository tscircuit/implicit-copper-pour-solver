import type { AnyCircuitElement } from "circuit-json"
import nrf52810CircuitJson from "./nrf52810.json"

/** Full nRF52810 coin-cell tracker Circuit JSON fixture. */
export const nrf52810Board =
  nrf52810CircuitJson as unknown as AnyCircuitElement[]
