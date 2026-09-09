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

### TSX example circuits

Run `bun run start` and select one of these Cosmos pages. The original nRF52810
tracker remains available as `solver`.

| Page / TSX source in `examples/` | Board | Layout and components |
| --- | --- | --- |
| `compact-beacon` | 28 × 28 mm | Centered MCU, status LED, reset pull-up/test pad, power and SWD headers |
| `led-controller` | 48 × 24 mm | MCU at the left rotated 90°, six LED/resistor channels spread across the right |
| `sensor-breakout` | 30 × 46 mm | MCU at the bottom rotated 180°, two I²C headers at the top, pull-ups and local decoupling |
| `analog-input` | 44 × 34 mm | MCU at the right rotated 270°, four input headers and RC filters at the left, bottom-side filter capacitors |

The examples share the original tracker's nRF52810 footprint and a small supply
and decoupling circuit. They are simplified solver exercises, not complete BLE
reference designs: RF matching and external clocks are omitted.

Regenerate their committed Circuit JSON directly from TSX using `@tscircuit/core`
and its local autorouter:

```sh
bun run generate:examples
# Or regenerate one circuit:
bun run generate:examples analog-input
bun run test:update-snapshots
```

The generator disables automatic copper pours so these fixtures exercise this
repository's solver. It writes the renderer's Circuit JSON without moving pads
or editing routes afterward, and rejects builds with PCB errors. Dependencies
required by core's published runtime are listed explicitly in `devDependencies`.
The debugger and tests consume the committed JSON, so normal tests do not rerun
the autorouter. Each example has combined, top-only, and bottom-only solved SVG
snapshots in `tests/__snapshots__`.
