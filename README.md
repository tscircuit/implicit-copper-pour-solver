# @tscircuit/implicit-copper-pour-solver

Generate coarse implicit `pcb_copper_pour` region elements for power nets in
Circuit JSON. The emitted polygons are inputs to the downstream copper-pour
solver, which computes the final manufacturable copper geometry and clearances.

The solver follows the power-trace-expansion algorithm from the supplied
[JSX artifact](https://claude.ai/public/artifacts/e5ef6abf-7d47-478f-b76a-3d0d1ff3d55d):

1. Sample a regular grid on each selected copper layer.
2. Assign every in-board sample to its nearest power-net-owned pad, trace, or
   via. Copper belonging to signal and other non-power nets is deliberately not
   treated as an obstacle at this phase.
3. Group four-connected cells with the same nearest net.
4. Optionally discard regions below an explicitly configured minimum area.
5. Trace each surviving grid region into one or more non-overlapping polygons.
6. Simplify the traced edges to smooth grid-generated stair steps.
7. Emit coarse region polygons for `source_net` elements with `is_power`,
   `is_ground`, or `is_positive_voltage_source` set. Except for the board
   outline, exact copper exclusions are deferred to the downstream solver.

## Usage

```ts
import { ImplicitCopperPourPipelineSolver } from "@tscircuit/implicit-copper-pour-solver"

const solver = new ImplicitCopperPourPipelineSolver({
  circuitJson,
  gridPitch: 0.25,
  edgeSimplificationTolerance: 0.25,
  layers: ["top", "bottom"],
})

solver.solve()
const implicitRegions = solver.getOutput()
// Feed each region's points to the downstream copper-pour solver as its outline.
```

The class extends `BasePipelineSolver` from `@tscircuit/solver-utils` and uses
four debugger-visible stages: Circuit JSON preparation, nearest-net grid
assignment, power polygon tracing, and edge simplification. The simplification
tolerance defaults to `gridPitch`; set `edgeSimplificationTolerance` to `0` to
keep the traced grid edges unchanged. Shared boundaries are simplified as a
single topological arc and reused by both regions, preventing smoothing from
creating overlaps or gaps between adjacent pours.
`minRegionArea` defaults to zero so eligible power nets partition the complete
board area. Setting it above zero deliberately allows small regions to be
omitted.

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
