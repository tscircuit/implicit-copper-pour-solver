# @tscircuit/implicit-copper-pour-solver

Generate implicit `pcb_copper_pour` polygon elements for power nets in Circuit
JSON.

The solver follows the power-trace-expansion algorithm from the supplied
[JSX artifact](https://claude.ai/public/artifacts/e5ef6abf-7d47-478f-b76a-3d0d1ff3d55d):

1. Sample a regular grid on each selected copper layer.
2. Assign every in-board sample to its nearest net-owned pad, trace, or via.
3. Group four-connected cells with the same nearest net.
4. Discard regions below the configured minimum area.
5. Trace each surviving grid region into a rectilinear polygon.
6. Emit polygons only when the owning `source_net` has `is_power`, `is_ground`,
   or `is_positive_voltage_source` set.

## Usage

```ts
import { ImplicitCopperPourPipelineSolver } from "@tscircuit/implicit-copper-pour-solver"

const solver = new ImplicitCopperPourPipelineSolver({
  circuitJson,
  gridPitch: 0.25,
  minRegionArea: 2,
  layers: ["top", "bottom"],
})

solver.solve()
const copperPourElements = solver.getOutput()
const circuitJsonWithPours = [...circuitJson, ...copperPourElements]
```

The class extends `BasePipelineSolver` from `@tscircuit/solver-utils` and uses
three debugger-visible stages: Circuit JSON preparation, nearest-net grid
assignment, and power polygon tracing.

## Development

```sh
bun install
bun test
bun run typecheck
bun run format:check
bun run start
```
