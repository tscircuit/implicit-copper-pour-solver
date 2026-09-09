import { fileURLToPath } from "node:url"
import { Circuit } from "@tscircuit/core"
import CompactBeacon from "../examples/compact-beacon"
import LedController from "../examples/led-controller"
import SensorBreakout from "../examples/sensor-breakout"
import AnalogInput from "../examples/analog-input"

const examples = {
  "compact-beacon": CompactBeacon,
  "led-controller": LedController,
  "sensor-breakout": SensorBreakout,
  "analog-input": AnalogInput,
}
if (process.argv[2] && !(process.argv[2] in examples)) {
  throw new Error(`Unknown example: ${process.argv[2]}`)
}
for (const [name, Component] of Object.entries(examples)) {
  if (process.argv[2] && process.argv[2] !== name) continue
  console.log(`Rendering ${name}`)
  const circuit = new Circuit()
  circuit.add(<Component />)
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  const errors = circuitJson.filter(
    (e) => e.type.startsWith("pcb_") && e.type.endsWith("_error"),
  )
  if (errors.length) throw new Error(`${name}: ${JSON.stringify(errors)}`)
  await Bun.write(
    new URL(`../tests/fixtures/${name}.json`, import.meta.url),
    JSON.stringify(circuitJson, null, 2) + "\n",
  )
  const formatted = Bun.spawnSync([
    fileURLToPath(new URL("../node_modules/.bin/biome", import.meta.url)),
    "format",
    fileURLToPath(new URL(`../tests/fixtures/${name}.json`, import.meta.url)),
    "--write",
  ])
  if (formatted.exitCode !== 0) throw new Error(formatted.stderr.toString())
  console.log(
    `${name}: ${circuitJson.filter((e) => e.type === "pcb_trace").length} routed traces`,
  )
}
