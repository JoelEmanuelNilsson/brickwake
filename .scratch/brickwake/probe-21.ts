import { balanceBots, createMatch, stepMatch, type MatchEvent, type MatchState } from "../../src/sim/match.ts"
import { seas } from "../../src/sim/ocean.ts"
import { ffaRules } from "../../src/sim/rules.ts"
import { shipAttitude, shipForwardSpeed } from "../../src/sim/ship.ts"
import { rotate, vec3 } from "../../src/sim/vector.ts"
import { SIM_HZ, tuning } from "../../src/sim/tuning.ts"
import { angleOffWind, makeWind } from "../../src/sim/wind.ts"

const seeds = Number(process.argv[2] ?? 12)
const fullRules = process.argv[3] === "full"
const rows: Array<string> = []
let totals = { fired: 0, hits: 0, sinks: 0, seconds: 0, maxR: 0, broadsides: 0 }
for (let seed = 1; seed <= seeds; seed++) {
  const toward = (seed * 2.399963) % (2 * Math.PI)
  let state: MatchState = balanceBots(
    createMatch({
      seed,
      rules: { ...ffaRules, warmupSeconds: 0, ...(fullRules ? {} : { scoreLimit: 1000 }) },
      sea: seas.open,
      wind: makeWind({ toward, speed: 14, gustiness: 1 }),
      ships: [],
    }),
  )
  const events: Array<MatchEvent> = []
  let maxR = 0; let outside = 0; let afloatSamples = 0; let capsized = 0; let irons = 0; const flipped = new Set<string>()
  let worst = ""
  while (state.phase._tag !== "ended" && state.tick < ffaRules.timeLimit * SIM_HZ) {
    const step = stepMatch(state, new Map())
    state = step.state
    for (const e of step.events) if (e._tag !== "broadsideRefused") events.push(e)
    for (const ship of state.ships) {
      if (ship.life._tag !== "afloat") continue
      const r = Math.hypot(ship.position.x, ship.position.z); afloatSamples++; if (angleOffWind(shipAttitude(ship).heading, state.wind) < Math.PI / 4) irons++; if (rotate(ship.orientation, vec3(0, 1, 0)).y < 0.5) { capsized++; flipped.add(`${ship.id}:${ship.spawn}`) } if (r > tuning.arena.softRadius) outside++
      if (r > maxR) {
        maxR = r
        const h = shipAttitude(ship).heading; const bt = state.bots.find((b) => b.id === ship.id)
        const outward = (Math.cos(h) * ship.position.x - Math.sin(h) * ship.position.z) / r
        worst = `hp=${ship.hp} y=${ship.position.y.toFixed(1)} turn=${((bt?.turn ?? 0) * 57.3).toFixed(0)} ${ship.id} t=${(state.tick / SIM_HZ).toFixed(0)} off=${((angleOffWind(h, state.wind) * 180) / Math.PI).toFixed(0)} v=${shipForwardSpeed(ship).toFixed(1)} out=${outward.toFixed(2)} downwind=${((ship.position.x * Math.cos(state.wind.toward) - ship.position.z * Math.sin(state.wind.toward)) / r).toFixed(2)}`
      }
    }
  }
  const fired = events.filter((e) => e._tag === "cannonFired").length
  const hits = events.filter((e) => e._tag === "ballHit")
  const sinks = events.filter((e) => e._tag === "shipSunk").length
  const broadsides = new Set(events.filter((e) => e._tag === "cannonFired").map((e) => `${e.tick}:${e._tag === "cannonFired" ? e.ball.shooter : ""}`)).size
  const secs = state.tick / SIM_HZ; const top = Math.max(...state.ships.map((s) => s.kills)); rows.push(`  top kills ${top}, deaths ${state.ships.map((s) => s.deaths).join(",")}, foundered ${events.filter((e) => e._tag === "shipSunk" && e.by === undefined).length}`)
  totals = { fired: totals.fired + fired, hits: totals.hits + hits.length, sinks: totals.sinks + sinks, seconds: totals.seconds + secs, maxR: Math.max(totals.maxR, maxR), broadsides: totals.broadsides + broadsides }
  rows.push(`seed ${seed} wind ${((toward * 180) / Math.PI).toFixed(0)}° ${secs.toFixed(0)} s maxR ${maxR.toFixed(0)} hit ${((100 * hits.length) / Math.max(1, fired)).toFixed(0)}% sinks ${sinks} out ${((100 * outside) / afloatSamples).toFixed(2)}% irons ${((100 * irons) / afloatSamples).toFixed(1)}% capsized ${flipped.size} (${((100 * capsized) / afloatSamples).toFixed(1)}%) | ${worst}`)
}
console.log(rows.join("\n"))
console.log(
  `total: maxR ${totals.maxR.toFixed(0)}, hit ${((100 * totals.hits) / totals.fired).toFixed(1)}%, hits/sink ${(totals.hits / Math.max(1, totals.sinks)).toFixed(1)}, sinks/min ${((60 * totals.sinks) / totals.seconds).toFixed(2)}, broadsides/bot/min ${((60 * totals.broadsides) / totals.seconds / 6).toFixed(2)}, mean match ${(totals.seconds / seeds).toFixed(0)} s (soft ${tuning.arena.softRadius})`,
)
