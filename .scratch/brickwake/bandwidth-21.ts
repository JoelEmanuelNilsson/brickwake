import { Schema } from "effect"
import { ServerMessageJson, phaseSnapshot, serverEvent, shipSnapshot, windSnapshot } from "../../src/protocol/messages.ts"
import { stepMatch } from "../../src/sim/match.ts"
import { scenarios } from "../../src/sim/scenarios.ts"
import { deflateRawSync, constants } from "node:zlib"
const encode = Schema.encodeSync(ServerMessageJson)
let state = scenarios.armada
let raw = 0, perMessage = 0, n = 0, t0 = 0
for (let i = 0; i < 60 * 30; i++) {
  const step = stepMatch(state, new Map())
  state = step.state
  const text = encode({ _tag: "snapshot", tick: state.tick, phase: phaseSnapshot(state.phase), teamSinks: state.teamSinks, wind: windSnapshot(state), ships: state.ships.map(shipSnapshot), events: step.events.map(serverEvent) } as never)
  if (i < 30 * 30) continue
  const bytes = Buffer.from(text)
  raw += bytes.length
  const s = performance.now()
  perMessage += deflateRawSync(bytes, { level: 1, windowBits: 15 }).length
  t0 += performance.now() - s
  n++
}
console.log(`12 ships: raw ${(raw / n).toFixed(0)} B/snapshot = ${(raw / n * 30 / 1024).toFixed(1)} KB/s; deflate (no context) ${(perMessage / n).toFixed(0)} B = ${(perMessage / n * 30 / 1024).toFixed(1)} KB/s; ${(t0 / n * 1000).toFixed(0)} µs/snapshot`)
