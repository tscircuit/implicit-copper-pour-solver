# @tscircuit/implicit-copper-pour-solver

Generate coarse implicit `pcb_copper_pour` region elements for power nets in
Circuit JSON. The emitted polygons are inputs to the downstream copper-pour
solver, which computes the final manufacturable copper geometry and clearances.

The solver follows the power-trace-expansion algorithm from the supplied
[JSX artifact](https://claude.ai/public/artifacts/e5ef6abf-7d47-478f-b76a-3d0d1ff3d55d):

1. Sample a regular grid on each selected copper layer.
2. Sort power-net-owned pads, traces, and vias by distance from each sample.
3. Prefer the nearest candidate whose decision ray does not cross a trace from
   another net, including the configured downstream trace clearance.
4. When every candidate is blocked, locally normalize narrow fallback bulges
   toward the clearly closer reachable power territory. Cells sampled directly
   on a trace retain their nearest-net fallback because downstream clearance
   removes that copper.
5. Check connectivity across cell boundaries after expanding foreign traces by
   their clearance. Reassign clearance-separated regions to an adjacent,
   reachable power net when possible and omit regions that would otherwise
   become isolated copper islands.
6. Merge small unanchored connected regions into their dominant larger
   neighbor, then group four-connected cells with the same net.
7. Optionally discard regions below an explicitly configured minimum area.
8. Trace each surviving grid region into one or more non-overlapping polygons.
9. Simplify the traced edges to smooth grid-generated stair steps.
10. Emit coarse region polygons for `source_net` elements with `is_power`,
   `is_ground`, or `is_positive_voltage_source` set. Except for the board
   outline, exact copper exclusions are deferred to the downstream solver.

## Usage

```ts
import { ImplicitCopperPourPipelineSolver } from "@tscircuit/implicit-copper-pour-solver"

const solver = new ImplicitCopperPourPipelineSolver({
  circuitJson,
  gridPitch: 0.25,
  traceClearance: 0.2,
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
`traceClearance` defaults to 0.2 mm to match the downstream copper-pour solver;
set it to `0` to disable clearance-aware island removal. `minRegionArea`
defaults to zero. Setting it above zero deliberately allows additional small
regions to be omitted.

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

### nRF52810 example layouts

Run `bun run start` and select one of these pages in Cosmos:

| Page | Change from the original tracker |
| --- | --- |
| `solver` | Original nRF52810 board |
| `nrf52810-left-led` | LED1 and its three resistors shifted 3 mm left |
| `nrf52810-lower-debug` | Five debug test pads shifted 3 mm toward the lower edge |
| `nrf52810-top-decoupling` | Three extra 100 nF capacitors along the left side on top |
| `nrf52810-bottom-bulk` | 10 µF, 1 µF and 100 nF capacitors along the lower edge on bottom |

The variants are defined in `tests/fixtures/nrf52810-variants.ts`. They clone the
original Circuit JSON, retain its source connectivity and PCB geometry, and
remove existing pours and stale diagnostics. Moved parts carry their pads,
ports, graphics and attached trace endpoints with them. Added capacitors connect
to VBAT and GND with explicit source traces, pad-to-via stubs and through vias.
These are copper-region solver examples; the moved traces are stretched rather
than autorouted, and the layouts have not been validated for fabrication.
Each variant has a solved-board SVG snapshot in `tests/__snapshots__`.
