import { gunsOnSide, gunLayout, type BroadsideSide } from "./gun-layout.ts"
import { aimGun, broadsideRefusal } from "./gunnery.ts"
import type { BroadsideOrder, MatchState } from "./match.ts"
import { nextRange, seedRng, type RngState } from "./rng.ts"
import { allies } from "./rules.ts"
import { sailTargetSpeed, shipAttitude, shipForwardSpeed, type RudderCommand, type ShipControls, type ShipId, type ShipState } from "./ship.ts"
import { SIM_DT, tuning } from "./tuning.ts"
import { angleOfDirection, directionFromAngle, vec3, wrapAngle, type Vec3 } from "./vector.ts"
import { angleOffWind } from "./wind.ts"

/** How good one bot captain is; drawn once from the match RNG when the bot joins, so bots differ but replay the same. */
export interface BotSkill {
  /** Range it likes to fight at, metres. */
  readonly standoff: number
  /** Farthest range it opens fire at, metres. */
  readonly fireRange: number
  /** How much of the target's motion it leads: 1 is exact. */
  readonly lead: number
  /** Per-broadside aim error: the aim point lands uniformly within this fraction of the range of the led point. */
  readonly aimError: number
}

/** A bot captain in a match and the enemy it is fighting. */
export interface Bot {
  readonly id: ShipId
  readonly skill: BotSkill
  readonly target: ShipId | undefined
  /** The turn it last chose, signed radians; a big turn under way is not reversed for a marginally better one. */
  readonly turn: number
}

/** One tick's decision for a bot: helm and sail, a broadside order when a shot is on, and the enemy it chose. */
export interface BotDecision {
  readonly controls: ShipControls
  readonly order: BroadsideOrder | undefined
  readonly target: ShipId | undefined
  readonly turn: number
}

/** Draws a bot's skill from the match RNG. */
export const drawBotSkill = (rng: RngState): { readonly skill: BotSkill; readonly rng: RngState } => {
  const s = tuning.bots.skill
  const [standoff, r1] = nextRange(rng, s.standoff.min, s.standoff.max)
  const [fireRange, r2] = nextRange(r1, s.fireRange.min, s.fireRange.max)
  const [lead, r3] = nextRange(r2, s.lead.min, s.lead.max)
  const [aimError, r4] = nextRange(r3, s.aimError.min, s.aimError.max)
  return { skill: { standoff, fireRange, lead, aimError }, rng: r4 }
}

const portGuns = gunsOnSide(gunLayout, "port")
const starboardGuns = gunsOnSide(gunLayout, "starboard")
const middleGun = { port: portGuns[portGuns.length >> 1]!, starboard: starboardGuns[starboardGuns.length >> 1]! }
const meanRipple = portGuns.reduce((sum, gun) => sum + gun.rippleDelay, 0) / portGuns.length
const headingSteps = 48

const isAfloat = (ship: ShipState) => ship.life._tag === "afloat"
const distance = (a: ShipState, b: ShipState) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)

const hashId = (id: string) => {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return hash >>> 0
}

/** The enemy to fight, never an ally: the nearest, kept while not much worse, and passed over when other bots already fight it. */
const chooseTarget = (state: MatchState, self: ShipState, bot: Bot): ShipState | undefined => {
  const b = tuning.bots
  let best: ShipState | undefined
  let bestCost = Infinity
  for (const ship of state.ships) {
    if (ship.id === self.id || !isAfloat(ship) || allies(self, ship)) continue
    const hunters = state.bots.filter((other) => other.id !== bot.id && other.target === ship.id).length
    const cost = distance(self, ship) + b.crowdingPenalty * hunters - (ship.id === bot.target ? b.targetLoyalty : 0)
    if (cost < bestCost) {
      bestCost = cost
      best = ship
    }
  }
  return best
}

/** Which side of `ship` a world point lies on. */
const sideOf = (ship: ShipState, heading: number, point: Vec3): BroadsideSide => {
  const bearing = wrapAngle(angleOfDirection(point.x - ship.position.x, point.z - ship.position.z) - heading)
  // Positive yaw angles turn toward −z, which is port.
  return bearing > 0 ? "port" : "starboard"
}

/**
 * How far to turn, signed radians (positive to port). Each candidate is scored by where it puts the ship `lookahead`
 * seconds after the turn: at the standoff range with the target abeam, never in irons, clear of the edge and other hulls.
 */
const chooseTurn = (state: MatchState, self: ShipState, heading: number, target: ShipState | undefined, bot: Bot) => {
  const skill = bot.skill
  const b = tuning.bots
  const tau = b.lookahead
  const range = target ? distance(self, target) : 0
  const engaged = target ? Math.max(0, Math.min(1, (skill.standoff + b.engageBand - range) / b.engageBand)) : 0
  const speedNow = Math.max(2, Math.hypot(self.velocity.x, self.velocity.z))
  const leeward = directionFromAngle(state.wind.toward)
  const radius = Math.hypot(self.position.x, self.position.z)
  const margin = radius - b.edgeRadius + (b.downwindMargin * Math.max(0, self.position.x * leeward.x + self.position.z * leeward.z)) / Math.max(1, radius)
  const upwind = wrapAngle(state.wind.toward + Math.PI - heading)
  const upwindToPort = upwind < 0 ? upwind + 2 * Math.PI : upwind
  const inIrons = angleOffWind(heading, state.wind) < b.headToWind
  let bestTurn = 0
  let bestCost = Infinity
  for (let step = 1 - headingSteps; step < headingSteps; step++) {
    const turn = (2 * Math.PI * step) / headingSteps
    const candidate = heading + turn
    // In irons, or tacking through the wind, the ship stalls with no water past the rudder: bots bear away and wear round instead.
    // A bot already head to wind may bear away to either side, else the side allowed flips as the bow swings across the wind.
    if (!inIrons && (turn > 0 ? upwindToPort <= turn : upwindToPort - 2 * Math.PI >= turn)) continue
    const off = angleOffWind(candidate, state.wind)
    if (off < b.ironsAngle) continue
    const speed = sailTargetSpeed(1, off, state.wind)
    const dir = directionFromAngle(candidate)
    // The ship swings round at about the bot turn rate, then holds the new heading for the lookahead: judging where a
    // whole manoeuvre ends keeps a bot wearing round from giving up halfway.
    const turning = Math.abs(turn) / b.turnRate
    const ahead = turning + tau
    const along = (t: number) => {
      const swept = Math.sign(turn) * b.turnRate * Math.min(t, turning)
      const chord = 2 * (speedNow / b.turnRate) * Math.sin(Math.abs(swept) / 2)
      const mid = directionFromAngle(heading + swept / 2)
      const run = speed * Math.max(0, t - turning)
      return { x: self.position.x + mid.x * chord + dir.x * run, z: self.position.z + mid.z * chord + dir.z * run }
    }
    const { x, z } = along(ahead)
    let cost = b.weights.turn * Math.abs(turn)
    // Checking a swing already under way wastes it; without this a bot dithers between turning either way round.
    if (turn * self.angularVelocity.y < 0) cost += b.weights.reverse * Math.min(1, Math.abs(self.angularVelocity.y) / b.turnRate)
    // Wearing round from dead downwind is as good either way; without keeping to the side chosen, the bot flips between them and runs on out.
    if (turn * bot.turn < 0) cost += b.weights.reverse * Math.min(1, Math.abs(bot.turn) / b.commitTurn)
    cost += b.weights.wind * (1 - speed / tuning.sail.maxSpeed)
    const r = Math.hypot(x, z)
    // Beating back from the downwind edge is slow and the boundary push can pin a ship there, so bots keep off it sooner.
    const downwind = r === 0 ? 0 : Math.max(0, (x * leeward.x + z * leeward.z) / r)
    const edge = r - b.edgeRadius + b.downwindMargin * downwind
    if (edge > 0) cost += b.weights.edge * (edge / 100) ** 2
    // Already near the edge, any heading with an outward component costs, however the lookahead ends.
    const outward = (dir.x * self.position.x + dir.z * self.position.z) / Math.max(1, radius)
    if (margin > 0 && outward > 0) cost += b.weights.edge * outward * (margin / 100)
    if (target) {
      const tx = target.position.x + target.velocity.x * ahead
      const tz = target.position.z + target.velocity.z * ahead
      const d = Math.hypot(tx - x, tz - z)
      const gap = (d - skill.standoff) / skill.standoff
      cost += (gap < 0 ? b.weights.tooClose : b.weights.range) * gap ** 2
      // The target should bear abeam both once the turn is made and at the end of the lookahead.
      const soon = angleOfDirection(target.position.x - self.position.x, target.position.z - self.position.z) - candidate
      const later = angleOfDirection(tx - x, tz - z) - candidate
      cost += b.weights.beam * engaged * (2 - Math.abs(Math.sin(soon)) - Math.abs(Math.sin(later))) / 2
    } else {
      cost += b.weights.range * Math.max(0, (Math.hypot(x, z) - tuning.match.spawnRing.radius) / tuning.match.spawnRing.radius) ** 2
    }
    for (const ship of state.ships) {
      if (ship.id === self.id || ship.life._tag === "sunk") continue
      for (const t of b.clearanceChecks) {
        const at = along(t)
        const gap = b.clearance - Math.hypot(at.x - ship.position.x - ship.velocity.x * t, at.z - ship.position.z - ship.velocity.z * t)
        if (gap > 0) cost += b.weights.clearance * (gap / b.clearance) ** 2
      }
    }
    if (cost < bestCost) {
      bestCost = cost
      bestTurn = turn
    }
  }
  return bestTurn
}

/** A broadside at the target when one side has a loaded, in-arc, in-range shot, led by the shared aim solve. */
const chooseShot = (state: MatchState, self: ShipState, heading: number, target: ShipState, skill: BotSkill): BroadsideOrder | undefined => {
  if (state.phase._tag !== "playing") return undefined
  const range = distance(self, target)
  if (range > skill.fireRange) return undefined
  const side = sideOf(self, heading, target.position)
  const time = state.tick * SIM_DT
  if (time < self.reloadedAt[side]) return undefined
  const aimHeight = tuning.bots.aimHeight
  let aim = vec3(target.position.x, aimHeight, target.position.z)
  for (let pass = 0; pass < 3; pass++) {
    const flight = aimGun(self, middleGun[side], aim).flightTime
    if (flight === undefined) return undefined
    const lead = (flight + meanRipple) * skill.lead
    aim = vec3(target.position.x + target.velocity.x * lead, aimHeight, target.position.z + target.velocity.z * lead)
  }
  // Each broadside misses the lead by its own error, from the match RNG mixed with the bot's id so bots in one tick differ.
  const [angle, r1] = nextRange(seedRng(state.rng ^ hashId(self.id)), -Math.PI, Math.PI)
  const [share] = nextRange(r1, 0, 1)
  const miss = skill.aimError * range * Math.sqrt(share)
  aim = vec3(aim.x + Math.cos(angle) * miss, aimHeight, aim.z + Math.sin(angle) * miss)
  return broadsideRefusal(self, side, aim, time) === undefined ? { side, aimPoint: aim } : undefined
}

/**
 * What bot `shipId` does this tick: steer for a broadside position on its target under full sail, and fire a led
 * broadside when a loaded side bears in range. Pure; undefined when the ship is not a bot or not afloat.
 */
export const decideBotControls = (state: MatchState, shipId: ShipId): BotDecision | undefined => {
  const bot = state.bots.find((candidate) => candidate.id === shipId)
  const self = state.ships.find((ship) => ship.id === shipId)
  if (!bot || !self || !isAfloat(self)) return undefined
  const target = chooseTarget(state, self, bot)
  const { heading } = shipAttitude(self)
  // Steer on the heading the ship will have once the rudder catches up, so it eases off instead of overshooting.
  const turn = chooseTurn(state, self, heading, target, bot)
  const error = turn - self.angularVelocity.y * tuning.bots.helmLead
  const dead = tuning.bots.helmDeadband
  // Making sternway, the rudder acts the other way round.
  const astern = shipForwardSpeed(self) < 0 ? -1 : 1
  const rudder: RudderCommand = error > dead ? (astern > 0 ? -1 : 1) : error < -dead ? (astern > 0 ? 1 : -1) : 0
  return {
    controls: { rudder, sail: 2 },
    order: target ? chooseShot(state, self, heading, target, bot.skill) : undefined,
    target: target?.id,
    turn,
  }
}
