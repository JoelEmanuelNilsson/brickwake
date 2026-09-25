import { expect, test } from "bun:test"
import { gunLayout } from "./gun-layout.ts"
import {
  aimGun,
  ballId,
  ballPositionAt,
  broadsideRefusal,
  segmentBoxEntry,
  solveLaunch,
  type Cannonball,
} from "./gunnery.ts"
import { stepMatch, type BroadsideOrder, type MatchEvent, type MatchState } from "./match.ts"
import { dummyShipId, scenarios, scenarioShipId } from "./scenarios.ts"
import { hitDamage } from "./ship/damage.ts"
import { shipAttitude, shipId, type ShipState } from "./ship.ts"
import { SIM_DT, SIM_HZ, tuning } from "./tuning.ts"
import { add, length, quatFromAxisAngle, rotate, rotateInverse, scale, sub, vec3, type Vec3 } from "./vector.ts"
import { shipWreck } from "./wreck.ts"

const degrees = Math.PI / 180

const run = (start: MatchState, seconds: number, orders: ReadonlyArray<readonly [tick: number, BroadsideOrder]> = []) => {
  let state = start
  const events: Array<MatchEvent> = []
  const heels: Array<number> = []
  for (let tick = 0; tick < seconds * SIM_HZ; tick++) {
    const order = orders.find(([at]) => at === tick)
    const step = stepMatch(state, new Map(), order ? new Map([[scenarioShipId, order[1]]]) : new Map())
    state = step.state
    events.push(...step.events)
    heels.push(shipAttitude(state.ships[0]!).heel)
  }
  return { state, events, heels }
}

const eventsOf = <K extends MatchEvent["_tag"]>(events: ReadonlyArray<MatchEvent>, tag: K) =>
  events.filter((event): event is Extract<MatchEvent, { readonly _tag: K }> => event._tag === tag)

test("ballPositionAt is the exact solution of drag-damped flight", () => {
  const ball: Cannonball = {
    id: ballId(1),
    shooter: shipId("a"),
    gun: 0,
    origin: vec3(3, 2, -1),
    velocity: vec3(80, 18, 30),
    firedAt: 7.25,
  }
  let p = ball.origin
  let v = ball.velocity
  const h = 1e-4
  for (let t = 0; t < 3; t += h) {
    const a = add(scale(v, -tuning.guns.airDrag), vec3(0, -tuning.physics.gravity, 0))
    const mid = add(v, scale(a, h / 2))
    p = add(p, scale(mid, h))
    v = add(v, scale(a, h))
  }
  expect(length(sub(ballPositionAt(ball, 10.25), p))).toBeLessThan(0.01)
  expect(ballPositionAt(ball, 7.25)).toEqual(ball.origin)
})

test("a laid gun's ball passes through the aim point, from a moving, heeled ship", () => {
  const base = scenarios.calm.ships[0]!
  const ship: ShipState = {
    ...base,
    velocity: vec3(12, 0.3, -1),
    angularVelocity: vec3(0.02, 0.05, -0.01),
    orientation: quatFromAxisAngle(vec3(1, 0, 0), 4 * degrees),
  }
  for (const gun of gunLayout.filter((mount) => mount.side === "starboard")) {
    for (const aimPoint of [vec3(40, 0, 120), vec3(-20, 0, 160), vec3(60, 0, 140), vec3(0, 0, 60)]) {
      const aim = aimGun(ship, gun, aimPoint)
      expect(aim.clamped).toBe(false)
      const ball: Cannonball = {
        id: ballId(1),
        shooter: ship.id,
        gun: 0,
        origin: aim.muzzle,
        velocity: add(aim.muzzleVelocity, scale(aim.barrel, tuning.guns.muzzleSpeed)),
        firedAt: 0,
      }
      expect(length(sub(ballPositionAt(ball, aim.flightTime!), aimPoint))).toBeLessThan(0.001)
    }
  }
})

test("a broadside lands on the aim point within the per-gun spread", () => {
  const aimPoint = vec3(40, 0, 220)
  const { events } = run(scenarios.calm, 6, [[0, { side: "starboard", aimPoint }]])
  const fired = eventsOf(events, "cannonFired")
  const splashes = eventsOf(events, "ballSplash")
  expect(fired).toHaveLength(12)
  expect(splashes).toHaveLength(12)
  const range = Math.hypot(aimPoint.x, aimPoint.z)
  const along = scale(aimPoint, 1 / range)
  // A shallow arc turns a small elevation error into a long range error: measure that gain from the solve itself.
  const ship = scenarios.calm.ships[0]!
  const gun = gunLayout.find((mount) => mount.side === "starboard")!
  const elevationAt = (distance: number) => aimGun(ship, gun, scale(along, distance)).lay.elevation
  const metresPerRadian = 2 / (elevationAt(range + 1) - elevationAt(range - 1))
  const misses = splashes.map((splash) => sub(vec3(splash.point.x, 0, splash.point.z), aimPoint))
  for (const miss of misses) {
    const alongMiss = miss.x * along.x + miss.z * along.z
    const acrossMiss = miss.x * along.z - miss.z * along.x
    expect(Math.abs(alongMiss)).toBeLessThan(metresPerRadian * tuning.guns.spread.elevation * 1.1)
    expect(Math.abs(acrossMiss)).toBeLessThan(range * Math.tan(tuning.guns.spread.traverse) * 1.05)
  }
  // The reticle promise: the balls land in a round patch about the aim point, not a long streak.
  const widest = (pick: (miss: { x: number; z: number }) => number) => Math.max(...misses.map((miss) => Math.abs(pick(miss))))
  console.log(`spread at ${range.toFixed(0)} m: ±${widest((m) => m.x * along.x + m.z * along.z).toFixed(1)} m along, ±${widest((m) => m.x * along.z - m.z * along.x).toFixed(1)} m across; ${metresPerRadian.toFixed(0)} m/rad`)
  expect(metresPerRadian * tuning.guns.spread.elevation).toBeLessThan(1.5 * range * Math.tan(tuning.guns.spread.traverse))
  expect(new Set(misses.map((miss) => miss.x)).size).toBe(12)
  const firedAt = fired.map((event) => event.ball.firedAt)
  expect(firedAt[1]! - firedAt[0]!).toBeCloseTo(tuning.guns.rippleInterval, 9)
  expect(firedAt.at(-1)! - firedAt[0]!).toBeCloseTo(11 * tuning.guns.rippleInterval, 9)
})

test("no tunnelling: every tick-long sweep at muzzle speed finds a plank far thinner than one step", () => {
  const step = tuning.guns.muzzleSpeed * SIM_DT
  expect(step).toBeGreaterThan(2.9)
  const plank = { min: vec3(-10, -2, -0.05), max: vec3(10, 5, 0.05) }
  for (let phase = 0; phase < 100; phase++) {
    const ball: Cannonball = {
      id: ballId(1),
      shooter: shipId("a"),
      gun: 0,
      origin: vec3(phase * 0.013 - 0.6, 1, -40),
      velocity: vec3(8, 3, tuning.guns.muzzleSpeed),
      firedAt: phase * 0.0017,
    }
    let found = false
    for (let tick = 0; tick < 30 && !found; tick++) {
      const a = ballPositionAt(ball, tick * SIM_DT)
      const b = ballPositionAt(ball, (tick + 1) * SIM_DT)
      found = segmentBoxEntry(a, b, plank.min, plank.max) !== undefined
    }
    expect(found).toBe(true)
  }
})

test("a broadside at the drifting dummy hits it and each hit takes HP", () => {
  const start = scenarios["target-dummy"]
  const dummy = start.ships.find((ship) => ship.id === dummyShipId)!
  const { state, events } = run(start, 5, [[0, { side: "starboard", aimPoint: vec3(dummy.position.x, 0, dummy.position.z) }]])
  const hits = eventsOf(events, "ballHit")
  expect(hits.length).toBeGreaterThanOrEqual(6)
  for (const hit of hits) {
    expect(hit.target).toBe(dummyShipId)
    expect(hit.shooter).toBe(scenarioShipId)
    expect(Math.abs(hit.localPoint.z)).toBeLessThan(4.8)
    expect(hit.removed.length).toBeGreaterThan(0)
  }
  // Most strike the facing port side's planking; a ball through a gunport or a fresh hole may strike the far side inside.
  expect(hits.filter((hit) => hit.localPoint.z < -2).length).toBeGreaterThan(hits.length / 2)
  const taken = hits.reduce((sum, hit) => sum + hitDamage(hit.zone), 0)
  expect(hits.at(-1)!.hp).toBe(tuning.damage.hullHp - taken)
  const dummy1 = state.ships.find((ship) => ship.id === dummyShipId)!
  expect(dummy1.hp).toBe(hits.at(-1)!.hp)
  expect(dummy1.removedParts).toEqual(hits.flatMap((hit) => hit.removed))
  expect(state.balls).toHaveLength(0)
})

test("a ball never hits its own ship, even on a path straight through it", () => {
  const start = scenarios["target-dummy"]
  const through = (shooter: ShipState["id"]): Cannonball => ({
    id: ballId(99),
    shooter,
    gun: 0,
    origin: vec3(0, 2, -30),
    velocity: vec3(0, 3, tuning.guns.muzzleSpeed),
    firedAt: 0,
  })
  const own = run({ ...start, balls: [through(scenarioShipId)] }, 2)
  expect(eventsOf(own.events, "ballHit")).toHaveLength(0)
  expect(eventsOf(own.events, "ballSplash")).toHaveLength(1)
  const other = run({ ...start, balls: [through(dummyShipId)] }, 2)
  expect(eventsOf(other.events, "ballHit").map((hit) => hit.target)).toEqual([scenarioShipId])
})

test("out-of-arc, out-of-range and reloading orders are refused with their reason", () => {
  const ship = scenarios.calm.ships[0]!
  expect(broadsideRefusal(ship, "starboard", vec3(0, 0, 200), 0)).toBeUndefined()
  expect(broadsideRefusal(ship, "starboard", vec3(200, 0, 40), 0)).toBe("out-of-arc")
  expect(broadsideRefusal(ship, "port", vec3(0, 0, 200), 0)).toBe("out-of-arc")
  expect(broadsideRefusal(ship, "starboard", vec3(0, 0, 1000), 0)).toBe("out-of-range")
  expect(broadsideRefusal({ ...ship, reloadedAt: { port: 0, starboard: 3 } }, "starboard", vec3(0, 0, 200), 2)).toBe("reloading")

  const order = (aimPoint: Vec3): BroadsideOrder => ({ side: "starboard", aimPoint })
  const { events } = run(scenarios.calm, 7, [
    [0, order(vec3(200, 0, 40))],
    [1, order(vec3(0, 0, 1000))],
    [2, order(vec3(0, 0, 200))],
    [3 * SIM_HZ, order(vec3(0, 0, 200))],
    [6 * SIM_HZ + 3, order(vec3(0, 0, 200))],
  ])
  expect(eventsOf(events, "broadsideRefused").map((event) => [event.tick, event.reason])).toEqual([
    [0, "out-of-arc"],
    [1, "out-of-range"],
    [3 * SIM_HZ, "reloading"],
  ])
  expect(eventsOf(events, "cannonFired")).toHaveLength(24)
})

test("the longest shot inside the elevation limit reaches about 300 m", () => {
  const ship = scenarios.calm.ships[0]!
  const gun = gunLayout.find((mount) => mount.side === "starboard" && mount.deck === "lower")!
  let range = 100
  while (!aimGun(ship, gun, vec3(gun.position.x, 0, range + 1)).clamped) range += 1
  expect(range).toBeGreaterThan(260)
  expect(range).toBeLessThan(340)
  expect(solveLaunch(vec3(0, 0, 0), vec3(0, 0, 0), vec3(0, 0, 5000))).toBeUndefined()
})

test("a broadside rocks the ship: recoil heels it away from the target", () => {
  const quiet = run(scenarios.calm, 6)
  const fired = run(scenarios.calm, 6, [[0, { side: "starboard", aimPoint: vec3(0, 0, 200) }]])
  expect(Math.max(...quiet.heels.map(Math.abs))).toBeLessThan(0.01 * degrees)
  const rock = Math.min(...fired.heels)
  expect(rock).toBeLessThan(-0.6 * degrees)
  expect(rock).toBeGreaterThan(-3 * degrees)
  expect(Math.max(...fired.heels)).toBeGreaterThan(0.1 * degrees)
})

test("a broadside aimed at a point on a hull strikes the hull about that point", () => {
  const start = scenarios["target-dummy"]
  const dummy = start.ships.find((ship) => ship.id === dummyShipId)!
  const own = start.ships.find((ship) => ship.id === scenarioShipId)!
  // The client's reticle meets the hull where the eye's ray first strikes a part: do the same from above our deck.
  const eye = add(own.position, vec3(0, 8, 0))
  const toward = sub(add(dummy.position, vec3(0, 3, 0)), eye)
  const local = (world: Vec3) => rotateInverse(dummy.orientation, sub(world, dummy.position))
  const direction = rotateInverse(dummy.orientation, scale(toward, 1 / length(toward)))
  const along = shipWreck([]).firstPartAlong(local(eye), direction, length(toward) * 2)!
  const aimLocal = add(local(eye), scale(direction, along))
  const aimPoint = add(dummy.position, rotate(dummy.orientation, aimLocal))
  expect(aimPoint.y).toBeGreaterThan(1.5)
  const { events } = run(start, 5, [[0, { side: "starboard", aimPoint }]])
  const hits = eventsOf(events, "ballHit")
  expect(hits.length).toBeGreaterThanOrEqual(10)
  const meanHeight = hits.reduce((sum, hit) => sum + hit.localPoint.y, 0) / hits.length
  const meanAlong = hits.reduce((sum, hit) => sum + hit.localPoint.x, 0) / hits.length
  expect(Math.abs(meanHeight - aimLocal.y)).toBeLessThan(1)
  expect(Math.abs(meanAlong - aimLocal.x)).toBeLessThan(3)
})
