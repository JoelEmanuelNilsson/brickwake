// Duels: a "competent human" proxy (bot captaincy, exact lead, small aim error) against a bot with drawn skill.
import { balanceBots, createMatch, stepMatch, type MatchState } from "../../src/sim/match.ts"
import { seas } from "../../src/sim/ocean.ts"
import { ffaRules } from "../../src/sim/rules.ts"
import { SIM_HZ } from "../../src/sim/tuning.ts"
import { makeWind } from "../../src/sim/wind.ts"

const duels = Number(process.argv[2] ?? 40)
const humanError = Number(process.argv[3] ?? 0.03)
const botRange = process.argv[4] ? [Number(process.argv[4]), Number(process.argv[5])] as const : undefined
let humanWins = 0
let botWins = 0
let draws = 0
const ttk: Array<number> = []
const shots = { human: 0, humanHits: 0, bot: 0, botHits: 0 }
for (let seed = 1; seed <= duels; seed++) {
  const toward = (seed * 2.399963) % (2 * Math.PI)
  let state: MatchState = balanceBots(
    createMatch({ seed, rules: { ...ffaRules, warmupSeconds: 0, scoreLimit: 1, timeLimit: 300 }, sea: seas.open, wind: makeWind({ toward, speed: 14, gustiness: 1 }), ships: [] }),
    2,
  )
  const [human, bot] = state.bots
  state = { ...state, bots: [{ ...human!, skill: { standoff: 150, fireRange: 260, lead: 1, aimError: humanError } }, botRange ? { ...bot!, skill: { ...bot!.skill, aimError: botRange[0] + ((seed * 0.618) % 1) * (botRange[1] - botRange[0]) } } : bot!] }
  let fired = 0
  while (state.phase._tag === "playing") {
    const step = stepMatch(state, new Map())
    state = step.state
    for (const e of step.events) {
      if (e._tag === "cannonFired") {
        fired++
        if (e.ball.shooter === human!.id) shots.human++
        else shots.bot++
      }
      if (e._tag === "ballHit" || e._tag === "sailHit") {
        if (e.shooter === human!.id) shots.humanHits++
        else shots.botHits++
      }
    }
  }
  const winner = state.phase._tag === "ended" ? state.phase.winner : undefined
  if (winner && "shipId" in winner && winner.shipId === human!.id) humanWins++
  else if (winner && "shipId" in winner) botWins++
  else draws++
  if (fired > 0) ttk.push(state.tick / SIM_HZ)
}
ttk.sort((a, b) => a - b)
console.log(
  `bot ${botRange ?? 'drawn'} human aimError ${humanError}: human wins ${humanWins}/${duels}, bot ${botWins}, draws ${draws}; duel length median ${ttk[ttk.length >> 1]?.toFixed(0)} s; hit rate human ${((100 * shots.humanHits) / shots.human).toFixed(0)}%, bot ${((100 * shots.botHits) / shots.bot).toFixed(0)}%`,
)
