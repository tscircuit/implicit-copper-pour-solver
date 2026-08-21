# @tscircuit/implicit-copper-pour-solver

Generate implicit `pcb_copper_pour` polygon elements for power nets in Circuit
JSON.

The solver follows the power-trace-expansion algorithm from the supplied
[JSX artifact](https://claude.ai/public/artifacts/e5ef6abf-7d47-478f-b76a-3d0d1ff3d55d):

1. Sample a regular grid on each selected copper layer.
2. Assign cells touched by an existing rectangular, polygon, or BRep
   `pcb_copper_pour` to that pour's net on its declared layer, blocking cells
   where existing pours from different nets conflict.
3. Assign every remaining in-board sample to its nearest net-owned pad, trace,
   via, or existing copper region.
4. Group four-connected cells with the same nearest net.
5. Discard regions below the configured minimum area.
6. Trace each surviving grid region into one or more non-overlapping
   rectilinear polygons.
7. Emit polygons only when the owning `source_net` has `is_power`, `is_ground`,
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

### Visual snapshot tests

The nRF52810 fixture is rendered as a full board before and after solving. The
solved result is also rendered separately for every copper layer. These images
are compared with committed SVG snapshots in `tests/__snapshots__`. Snapshot
mismatches generate `.diff.png` files, which CI uploads as artifacts.

Update approved snapshots with:

```sh
bun run test:update-snapshots
```
