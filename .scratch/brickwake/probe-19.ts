// Server cost at 12 ships: the armada scenario (12 bots in open sea) stepped for 120 s of play.
import { stepMatch } from "../../src/sim/match.ts"
import { scenarios } from "../../src/sim/scenarios.ts"
import { SIM_HZ } from "../../src/sim/tuning.ts"
import { galleonClass } from "../../src/sim/wreck.ts"

// The server builds the galleon at startup; the probe does too, so no tick pays for it.
galleonClass()

let state = scenarios.armada
const times: Array<number> = []
let hits = 0
let fired = 0
for (let i = 0; i < 120 * SIM_HZ; i++) {
  const start = performance.now()
  const step = stepMatch(state, new Map())
  times.push(performance.now() - start)
  if (times.at(-1)! > 15) console.log(`tick ${i}: ${times.at(-1)!.toFixed(1)} ms, events ${step.events.map((e) => e._tag).join(",")}`)
  state = step.state
  for (const event of step.events) {
    if (event._tag === "ballHit") hits++
    if (event._tag === "cannonFired") fired++
  }
}
times.sort((a, b) => a - b)
const at = (q: number) => times[Math.floor(times.length * q)]!.toFixed(2)
console.log(`${state.ships.length} ships, ${fired} balls fired, ${hits} hits in 120 s; tick median ${at(0.5)} ms, p99 ${at(0.99)} ms, worst ${times.at(-1)!.toFixed(2)} ms (budget ${(1000 / SIM_HZ).toFixed(1)} ms)`)
