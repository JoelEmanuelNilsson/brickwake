import { describe, expect, test } from "bun:test"
import { createMatch, stepMatch, type MatchState } from "./match.ts"
import { sampleOcean, seas } from "./ocean.ts"
import { scenarios, scenarioShipId, type ScenarioName } from "./scenarios.ts"
import { shipAttitude, shipForwardSpeed, type ShipControls, type ShipState } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { quatFromAxisAngle, vec3, wrapAngle } from "./vector.ts"
import { makeWind } from "./wind.ts"

const deg = Math.PI / 180
const id = scenarioShipId
/** Scenario wind blows toward +z, so heading π/2 − θ sails θ off the wind. */
const windToward = -Math.PI / 2

const ship = (state: MatchState): ShipState => {
  const found = state.ships[0]
  if (found === undefined) throw new Error("scenario has no ship")
  return found
}

const sail = (state: MatchState, controls: ShipControls, seconds: number, each?: (state: MatchState, t: number) => void) => {
  const inputs = new Map([[id, controls]])
  for (let i = 1; i <= seconds * SIM_HZ; i++) {
    state = stepMatch(state, inputs).state
    each?.(state, i / SIM_HZ)
  }
  return state
}

const calmAt = (angleOffWind: number, wind = makeWind({ toward: windToward, speed: 14, gustiness: 0 })) =>
  createMatch({ seed: 1, weather: "clear", sea: seas.calm, wind, ships: [{ id, x: 0, z: 0, heading: Math.PI / 2 - angleOffWind }] })

const withShip = (state: MatchState, change: Partial<ShipState>): MatchState => ({ ...state, ships: [{ ...ship(state), ...change }] })

const zeroCrossings = (series: ReadonlyArray<number>, level: number) =>
  series.flatMap((v, i) => (i > 0 && ((series[i - 1] ?? v) - level) * (v - level) < 0 ? [i / SIM_HZ] : []))

describe("sailing speed", () => {
  const cases = [
    { name: "close-hauled", angle: 40 * deg, drive: 0.2 },
    { name: "beam reach", angle: 90 * deg, drive: 1 },
    { name: "running", angle: 180 * deg, drive: 0.8 },
  ]
  for (const { name, angle, drive } of cases) {
    for (const [level, share] of [[1, 0.6], [2, 1]] as const) {
      test(`${name} at sail ${level} settles at ${(12 * drive * share).toFixed(1)} m/s`, () => {
        const end = sail(calmAt(angle), { rudder: 0, sail: level }, 45)
        expect(shipForwardSpeed(ship(end))).toBeCloseTo(12 * drive * share, 0)
        expect(Math.abs(shipForwardSpeed(ship(end)) / (12 * drive * share) - 1)).toBeLessThan(0.03)
        expect(Math.abs(wrapAngle(shipAttitude(ship(end)).heading - (Math.PI / 2 - angle)))).toBeLessThan(2 * deg)
      })
    }
  }

  for (const { name, angle, cruise } of [
    { name: "a close reach", angle: 60 * deg, cruise: 4.8 },
    { name: "a beam reach", angle: 90 * deg, cruise: 12 },
    { name: "a broad reach", angle: 135 * deg, cruise: 11.4 },
    { name: "a run", angle: 180 * deg, cruise: 9.6 },
  ]) {
    test(`from rest, setting full sail on ${name} reaches 80 % of cruise speed within 4 s`, () => {
      let reached = Infinity
      sail(calmAt(angle), { rudder: 0, sail: 2 }, 10, (s, t) => {
        if (reached === Infinity && shipForwardSpeed(ship(s)) >= 0.8 * cruise) reached = t
      })
      expect(reached).toBeGreaterThan(1.5)
      expect(reached).toBeLessThan(4)
    })
  }

  test("furling the sails lets a heavy ship coast down over seconds, not stop dead", () => {
    const running = sail(calmAt(90 * deg), { rudder: 0, sail: 2 }, 40)
    const speeds: Array<number> = []
    sail(running, { rudder: 0, sail: 0 }, 6, (s) => speeds.push(shipForwardSpeed(ship(s))))
    expect(speeds[SIM_HZ * 2 - 1]).toBeGreaterThan(7)
    expect(speeds.at(-1)).toBeLessThan(5)
  })
})

describe("steering", () => {
  const yawRates = (state: MatchState, controls: ShipControls, seconds: number) => {
    const rates: Array<number> = []
    let heading = shipAttitude(ship(state)).heading
    const end = sail(state, controls, seconds, (s) => {
      const next = shipAttitude(ship(s)).heading
      rates.push(wrapAngle(next - heading) * SIM_HZ)
      heading = next
    })
    return { rates, end }
  }

  test("full rudder at full speed turns about 12°/s, toward the helm", () => {
    const atSpeed = sail(calmAt(90 * deg), { rudder: 0, sail: 2 }, 40)
    const starboard = yawRates(atSpeed, { rudder: 1, sail: 2 }, 5).rates
    const port = yawRates(atSpeed, { rudder: -1, sail: 2 }, 5).rates
    expect(-Math.min(...starboard) / deg).toBeGreaterThan(10.5)
    expect(-Math.min(...starboard) / deg).toBeLessThan(13.5)
    expect(Math.max(...port) / deg).toBeGreaterThan(10.5)
    expect(Math.max(...port) / deg).toBeLessThan(13.5)
  })

  test("a stopped ship barely turns", () => {
    const { rates } = yawRates(calmAt(90 * deg), { rudder: 1, sail: 0 }, 10)
    expect(Math.max(...rates.map(Math.abs)) / deg).toBeLessThan(0.5)
  })

  test("a turn heels the ship outward", () => {
    const still = makeWind({ toward: 0, speed: 0, gustiness: 0 })
    const coasting = withShip(calmAt(90 * deg, still), { velocity: vec3(12, 0, 0) })
    for (const rudder of [1, -1] as const) {
      const heels: Array<number> = []
      sail(coasting, { rudder, sail: 0 }, 5, (s) => heels.push(shipAttitude(ship(s)).heel))
      const outward = -rudder * Math.max(...heels.map((h) => -rudder * h))
      expect(Math.abs(outward) / deg).toBeGreaterThan(3)
      expect(Math.sign(outward)).toBe(-rudder)
    }
  })
})

describe("heel under sail", () => {
  const steadyHeel = (angle: number) => shipAttitude(ship(sail(calmAt(angle), { rudder: 0, sail: 2 }, 40))).heel

  test("the wind heels the ship to leeward, most when close-hauled and not at all running", () => {
    const beam = steadyHeel(90 * deg)
    const closeHauled = steadyHeel(50 * deg)
    expect(beam / deg).toBeGreaterThan(5)
    expect(beam / deg).toBeLessThan(11)
    expect(closeHauled).toBeGreaterThan(beam)
    expect(Math.abs(steadyHeel(180 * deg)) / deg).toBeLessThan(0.5)
  })

  test("half sail heels less than full sail", () => {
    const half = shipAttitude(ship(sail(calmAt(90 * deg), { rudder: 0, sail: 1 }, 40))).heel
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(steadyHeel(90 * deg))
  })
})

describe("floating", () => {
  test("in calm water a ship at rest stays at rest: no jitter, no drift", () => {
    const end = sail(scenarios.calm, { rudder: 0, sail: 0 }, 60)
    const s = ship(end)
    expect(Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)).toBeLessThan(1e-6)
    expect(Math.hypot(s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z)).toBeLessThan(1e-6)
    expect(Math.hypot(s.position.x, s.position.y, s.position.z)).toBeLessThan(1e-3)
  })

  test("it heaves slowly and settles without bobbing", () => {
    const dropped = withShip(scenarios.calm, { position: vec3(0, 0.6, 0) })
    const heights: Array<number> = []
    sail(dropped, { rudder: 0, sail: 0 }, 20, (s) => heights.push(ship(s).position.y))
    const [first = 0] = zeroCrossings(heights, 0)
    expect(first).toBeGreaterThan(1.2)
    expect(-Math.min(...heights)).toBeLessThan(0.1)
    expect(Math.abs(heights.at(-1) ?? 1)).toBeLessThan(0.005)
  })

  test("it rolls with a slow period of about 8 s and the roll dies away", () => {
    const heeled = withShip(scenarios.calm, { orientation: quatFromAxisAngle(vec3(1, 0, 0), 10 * deg) })
    const heels: Array<number> = []
    sail(heeled, { rudder: 0, sail: 0 }, 30, (s) => heels.push(shipAttitude(ship(s)).heel))
    const crossings = zeroCrossings(heels, 0)
    const period = 2 * ((crossings[2] ?? 0) - (crossings[1] ?? 0))
    expect(period).toBeGreaterThan(7)
    expect(period).toBeLessThan(10)
    expect(Math.min(...heels) / deg).toBeGreaterThan(-4)
    expect(Math.max(...heels.slice(-SIM_HZ * 5).map(Math.abs)) / deg).toBeLessThan(0.3)
  })

  const motion = (name: ScenarioName, sailLevel: 0 | 2) => {
    const heels: Array<number> = []
    const pitches: Array<number> = []
    const clearance: Array<number> = []
    const accelerations: Array<number> = []
    let lastRise = 0
    sail(scenarios[name], { rudder: 0, sail: sailLevel }, 45, (s, t) => {
      const current = ship(s)
      const { heel, pitch } = shipAttitude(current)
      accelerations.push((current.velocity.y - lastRise) * SIM_HZ)
      lastRise = current.velocity.y
      if (t < 10) return
      heels.push(heel)
      pitches.push(pitch)
      clearance.push(current.position.y - sampleOcean(s.sea, current.position.x, current.position.z, t).height)
    })
    const secondDifferences = accelerations.slice(2).map((a, i) => a - 2 * (accelerations[i + 1] ?? 0) + (accelerations[i] ?? 0))
    const half = Math.floor(heels.length / 2)
    const peak = (values: ReadonlyArray<number>) => Math.max(...values.map(Math.abs))
    return {
      roll: peak(heels) / deg,
      pitch: peak(pitches) / deg,
      rollGrowth: peak(heels.slice(half)) / Math.max(peak(heels.slice(0, half)), 1 * deg),
      clearance: peak(clearance),
      jitter: peak(secondDifferences),
      finite: [...heels, ...pitches, ...clearance].every(Number.isFinite),
    }
  }

  for (const name of ["beam-sea", "head-sea", "open-sea"] as const) {
    for (const sailLevel of [0, 2] as const) {
      test(`${name}, sail ${sailLevel}: rides the swell smoothly and stays upright`, () => {
        const m = motion(name, sailLevel)
        expect(m.finite).toBe(true)
        expect(m.roll).toBeLessThan(24)
        expect(m.pitch).toBeLessThan(12)
        expect(m.clearance).toBeLessThan(sailLevel === 0 ? 1 : 2.2)
        expect(m.rollGrowth).toBeLessThan(1.4)
        expect(m.jitter).toBeLessThan(0.6)
      })
    }
  }

  test("a beam sea rolls the ship; a head sea pitches it", () => {
    const beam = motion("beam-sea", 0)
    const head = motion("head-sea", 0)
    expect(beam.roll).toBeGreaterThan(8)
    expect(beam.roll).toBeGreaterThan(3 * head.roll)
    expect(head.pitch).toBeGreaterThan(5)
    expect(head.pitch).toBeGreaterThan(3 * beam.pitch)
  })
})

describe("arena boundary", () => {
  const radius = (s: MatchState) => Math.hypot(ship(s).position.x, ship(s).position.z)

  test("a ship sailing straight out at full sail is held inside the arena", () => {
    const outward = createMatch({
      seed: 1,
      weather: "clear",
      sea: seas.calm,
      wind: makeWind({ toward: windToward, speed: 14, gustiness: 0 }),
      ships: [{ id, x: 0, z: 450, heading: windToward }],
    })
    let furthest = 0
    sail(outward, { rudder: 0, sail: 2 }, 90, (s) => (furthest = Math.max(furthest, radius(s))))
    expect(furthest).toBeGreaterThan(tuning.arena.softRadius)
    expect(furthest).toBeLessThan(tuning.arena.radius)
  })

  test("a ship held at the edge keeps steerage and turns back in", () => {
    const outward = createMatch({
      seed: 1,
      weather: "clear",
      sea: seas.calm,
      wind: makeWind({ toward: windToward, speed: 14, gustiness: 0 }),
      ships: [{ id, x: 0, z: 450, heading: windToward }],
    })
    const held = sail(outward, { rudder: 0, sail: 2 }, 60)
    expect(Math.abs(shipForwardSpeed(ship(held)))).toBeLessThan(1.5)
    const turned = sail(held, { rudder: 1, sail: 2 }, 30)
    const home = sail(turned, { rudder: 0, sail: 2 }, 30)
    expect(radius(home)).toBeLessThan(tuning.arena.softRadius - 100)
  })

  test("a drifting ship outside the arena is pushed back in", () => {
    const outside = createMatch({
      seed: 1,
      weather: "clear",
      sea: seas.calm,
      wind: makeWind({ toward: windToward, speed: 14, gustiness: 0 }),
      ships: [{ id, x: 740, z: 0, heading: 0 }],
    })
    expect(radius(sail(outside, { rudder: 0, sail: 0 }, 15))).toBeLessThan(tuning.arena.radius)
  })
})
