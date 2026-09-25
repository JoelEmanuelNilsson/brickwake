import { expect, test } from "bun:test"
import { ballId, type Cannonball } from "./gunnery.ts"
import { createMatch, stepMatch, type MatchEvent, type MatchState } from "./match.ts"
import { seas } from "./ocean.ts"
import { ffaRules } from "./rules.ts"
import { dummyShipId, scenarios, scenarioShipId } from "./scenarios.ts"
import { ShipDamage } from "./ship/damage.ts"
import { shipAttitude, shipId, shipPointToWorld, type ShipState } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { add, scale, sub, vec3, type Vec3 } from "./vector.ts"
import { makeWind } from "./wind.ts"
import { galleonClass, shipFlooding, shipWreck, strikeWreck } from "./wreck.ts"

const degrees = Math.PI / 180

const eventsOf = <K extends MatchEvent["_tag"]>(events: ReadonlyArray<MatchEvent>, tag: K) =>
  events.filter((event): event is Extract<MatchEvent, { readonly _tag: K }> => event._tag === tag)

const volleys = (start: MatchState) => {
  let state = start
  const events: Array<MatchEvent> = []
  const dummy = start.ships.find((ship) => ship.id === dummyShipId)!
  const aim = vec3(dummy.position.x, 0, dummy.position.z)
  for (let tick = 0; tick < 20 * SIM_HZ; tick++) {
    const fire = tick % (7 * SIM_HZ) === 0
    const step = stepMatch(state, new Map(), fire ? new Map([[scenarioShipId, { side: "starboard", aimPoint: aim }]]) : new Map())
    state = step.state
    events.push(...step.events)
  }
  return { state, events, dummy: state.ships.find((ship) => ship.id === dummyShipId)! }
}

const presentParts = (damage: ShipDamage) => Array.from({ length: damage.graph.count }, (_, i) => (damage.isPresent(i) ? 1 : 0)).join("")

test("the same hits give the same removed parts, and a client replaying ballHit.removed in order has the same ship", () => {
  const first = volleys(scenarios["target-dummy"])
  const second = volleys(scenarios["target-dummy"])
  const hits = eventsOf(first.events, "ballHit")
  expect(hits.length).toBeGreaterThan(8)
  expect(first.dummy.removedParts.length).toBeGreaterThan(50)
  expect(second.dummy.removedParts).toEqual(first.dummy.removedParts)
  expect(first.dummy.removedParts).toEqual(hits.flatMap((hit) => hit.removed))

  const client = new ShipDamage(galleonClass().graph)
  let fell = 0
  for (const hit of hits) fell += client.apply(hit.removed).length
  expect(presentParts(client)).toBe(presentParts(shipWreck(first.dummy.removedParts)))
  const late = new ShipDamage(galleonClass().graph)
  late.apply(first.dummy.removedParts)
  expect(presentParts(late)).toBe(presentParts(client))
  expect(fell).toBeGreaterThanOrEqual(0)
})

test("holes at the waterline flood the nearest hull: a ship holed on its port side lists to port", () => {
  const { dummy } = volleys(scenarios["target-dummy"])
  const settle = (removedParts: ReadonlyArray<number>) => {
    let state: MatchState = { ...scenarios.calm, ships: scenarios.calm.ships.map((ship) => ({ ...ship, removedParts })) }
    for (let tick = 0; tick < 10 * SIM_HZ; tick++) state = stepMatch(state, new Map()).state
    return shipAttitude(state.ships[0]!).heel / degrees
  }
  expect(shipFlooding(dummy.removedParts).some((share) => share > 0)).toBe(true)
  expect(Math.abs(settle([]))).toBeLessThan(0.01)
  expect(settle(dummy.removedParts)).toBeLessThan(-0.5)
})

/** A ball from a ship not in the match, flying from `from` along `velocity` (world). */
const ballFrom = (id: number, from: Vec3, velocity: Vec3, firedAt = 0): Cannonball => ({ id: ballId(id), shooter: shipId("nobody"), gun: 0, origin: from, velocity, firedAt })

const flyOne = (start: MatchState, ball: Cannonball) => {
  let state: MatchState = { ...start, balls: [ball] }
  const events: Array<MatchEvent> = []
  for (let tick = 0; tick < 3 * SIM_HZ && (tick === 0 || state.balls.length > 0); tick++) {
    const step = stepMatch(state, new Map())
    state = step.state
    events.push(...step.events)
  }
  return { state, events }
}

test("balls break through where earlier balls broke bricks, and one finally flies through the holed hull", () => {
  let start: MatchState = scenarios.calm
  const across = ballFrom(1, vec3(0.2, 0.9, -40), vec3(0, 2, tuning.guns.muzzleSpeed))
  const struck: Array<number> = []
  let through = false
  for (let shot = 0; shot < 30 && !through; shot++) {
    const { state, events } = flyOne(start, across)
    const hit = eventsOf(events, "ballHit")[0]
    if (hit === undefined) {
      through = eventsOf(events, "ballSplash").length === 1
      break
    }
    struck.push(hit.localPoint.z)
    start = { ...scenarios.calm, ships: state.ships.map((ship) => ({ ...scenarios.calm.ships[0]!, hp: 100, removedParts: ship.removedParts })) }
  }
  expect(struck[0]).toBeLessThan(-3.5)
  expect(struck.at(-1)!).toBeGreaterThan(3)
  expect(through).toBe(true)
})

test("a ball through set sails tears each and flies on for 1 HP each; furled sails are not there", () => {
  const ship = scenarios.calm.ships[0]!
  // Near level at 7.6–8.1 m through the three courses, clear of the masts and yards.
  const along = ballFrom(1, shipPointToWorld(ship, vec3(40, 7.6, 2.2)), vec3(-tuning.guns.muzzleSpeed, 3, 0))
  const set = flyOne({ ...scenarios.calm, ships: [{ ...ship, sailSet: 1, controls: { rudder: 0, sail: 2 } }] }, along)
  const sails = eventsOf(set.events, "sailHit")
  expect(sails.map((sail) => Math.round(sail.localPoint.x * 10) / 10)).toEqual([10.8, 0.4, -8.4])
  expect(sails.map((sail) => sail.hp)).toEqual(sails.map((_, i) => tuning.damage.hullHp - (i + 1) * tuning.damage.sailsPerBall))
  expect(eventsOf(set.events, "ballSplash")).toHaveLength(1)
  const furled = flyOne({ ...scenarios.calm, ships: [{ ...ship, sailSet: 0 }] }, along)
  expect(eventsOf(furled.events, "sailHit")).toHaveLength(0)
})

test("play beginning repairs afloat ships' bricks and HP, and a respawned ship is whole", () => {
  const warm = createMatch({ seed: 1, rules: ffaRules, sea: seas.calm, wind: makeWind({ toward: 0, speed: 14, gustiness: 0 }), ships: [{ id: scenarioShipId, x: 0, z: 0, heading: 0 }] })
  let state: MatchState = { ...warm, ships: warm.ships.map((ship) => ({ ...ship, hp: 80, removedParts: [1, 2, 3] })) }
  const events: Array<MatchEvent> = []
  while (state.phase._tag === "warmup") {
    const step = stepMatch(state, new Map())
    state = step.state
    events.push(...step.events)
  }
  expect(eventsOf(events, "shipRepaired").map((event) => event.shipId)).toEqual([scenarioShipId])
  expect(state.ships[0]!.removedParts).toEqual([])
  expect(state.ships[0]!.hp).toBe(tuning.damage.hullHp)

  let sinking: MatchState = { ...scenarios.calm, ships: scenarios.calm.ships.map((ship) => ({ ...ship, hp: 1, removedParts: [5, 6] })) }
  const shot = ballFrom(1, vec3(0.2, 0.9, -40), vec3(0, 2, tuning.guns.muzzleSpeed))
  sinking = { ...sinking, balls: [shot] }
  let respawned: ShipState | undefined
  for (let tick = 0; tick < (tuning.sinking.seconds + tuning.sinking.respawnSeconds + 1) * SIM_HZ && respawned === undefined; tick++) {
    const step = stepMatch(sinking, new Map())
    sinking = step.state
    if (step.events.some((event) => event._tag === "shipRespawned")) respawned = sinking.ships[0]
  }
  expect(respawned?.removedParts).toEqual([])
})

test("12 ships with 144 balls in flight at them stay far inside the 33 ms tick", () => {
  galleonClass()
  const start = scenarios.armada
  const ships = start.ships
  const balls: Array<Cannonball> = []
  ships.forEach((target, t) => {
    const from = ships[(t + 1) % ships.length]!
    const toward = sub(target.position, from.position)
    const flat = Math.hypot(toward.x, toward.z)
    const dir = vec3(toward.x / flat, 0, toward.z / flat)
    // Each ship's broadside ripples as fired ones do, all twelve at once: the worst a real exchange lands.
    for (let g = 0; g < 12; g++) {
      const aim = shipPointToWorld(target, vec3(-11 + 2 * g, 1 + (g % 3), 0))
      const origin = add(aim, add(scale(dir, -120), vec3(0, 2, 0)))
      const flight = 120 / tuning.guns.muzzleSpeed
      const velocity = add(scale(dir, tuning.guns.muzzleSpeed), vec3(0, (tuning.physics.gravity * flight) / 2 - 2 / flight, 0))
      balls.push(ballFrom(balls.length + 1, origin, velocity, g * tuning.guns.rippleInterval))
    }
  })
  let state: MatchState = { ...start, balls, nextBallId: balls.length + 1 }
  const times: Array<number> = []
  const events: Array<MatchEvent> = []
  for (let tick = 0; tick < 2 * SIM_HZ; tick++) {
    const began = Bun.nanoseconds()
    const step = stepMatch(state, new Map())
    times.push((Bun.nanoseconds() - began) / 1e6)
    state = step.state
    events.push(...step.events)
  }
  const hits = eventsOf(events, "ballHit").length
  const busy = times.slice(0, Math.ceil(1.5 * SIM_HZ))
  const mean = busy.reduce((sum, t) => sum + t, 0) / busy.length
  const worst = Math.max(...busy)
  console.log(`12 ships, 144 balls: ${hits} hits, ${mean.toFixed(2)} ms/tick mean, worst ${worst.toFixed(2)} ms`)
  expect(hits).toBeGreaterThan(60)
  expect(mean).toBeLessThan(5)
  expect(worst).toBeLessThan(20)
})

test("one hit costs well under a millisecond, the first hold-flooding ones included", () => {
  const intact = shipWreck([])
  let removed: ReadonlyArray<number> = []
  const costs: Array<number> = []
  for (let i = 0; i < 200; i++) {
    const x = -10 + ((i * 7.3) % 20)
    const y = 0.3 + ((i * 3.1) % 4)
    const along = shipWreck(removed).firstPartAlong(vec3(x, y, -10), vec3(0, 0, 1), 20)
    if (along === undefined || intact.firstPartAlong(vec3(x, y, -10), vec3(0, 0, 1), 20) === undefined) continue
    const began = Bun.nanoseconds()
    removed = strikeWreck(removed, vec3(x, y, -10 + along), vec3(0, 0, 1)).removedParts
    costs.push((Bun.nanoseconds() - began) / 1e6)
  }
  costs.sort((a, b) => a - b)
  const p50 = costs[Math.floor(costs.length / 2)]!
  const p99 = costs[Math.floor(costs.length * 0.99)]!
  console.log(`strike: ${costs.length} hits, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, ${removed.length} parts removed`)
  expect(p50).toBeLessThan(0.5)
  expect(p99).toBeLessThan(3)
})

