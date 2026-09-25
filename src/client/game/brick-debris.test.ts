import { expect, test } from "bun:test"
import { Matrix4, Quaternion, Scene, Vector3 } from "three"
import { oceanHeight, seas } from "../../sim/ocean.ts"
import { ShipDamage } from "../../sim/ship/damage.ts"
import { BrickDebris, type DebrisSource } from "./brick-debris.ts"
import { deckHeight, loadGalleon } from "./galleon.ts"
import { ShipPose } from "./timeline.ts"

const model = loadGalleon()
const sea = seas.calm

const source = (): DebrisSource & { readonly pose: ShipPose } => {
  const pose = new ShipPose()
  return {
    pose,
    detail: "near",
    partMatrix: (part, out) => {
      out.copy(model.placements[part]?.matrix ?? new Matrix4())
      return out.premultiply(new Matrix4().compose(new Vector3(pose.x, pose.y, pose.z), new Quaternion(pose.qx, pose.qy, pose.qz, pose.qw), new Vector3(1, 1, 1)))
    },
  }
}

/** A seeded uniform draw (mulberry32), so each test replays the same debris. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const recorder = () => {
  const calls = { plops: 0, splashes: 0, dust: 0, crashes: 0 }
  return {
    calls,
    effects: { splash: () => void calls.splashes++, plop: () => void calls.plops++, dust: () => void calls.dust++ },
    audio: { hullHit: () => void calls.crashes++, splash: () => undefined },
  }
}

const run = (debris: BrickDebris, seconds: number, each: (t: number) => void = () => undefined) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    debris.update(1 / 60, t, sea, new Vector3(0, 10, 40), 0, 0)
    each(t)
  }
}

/** A deck-top part of the upper works, not the rig, standing clear of the masts. */
const railPart = () => {
  const { boxes, upperWorks } = model.graph
  for (let i = 0; i < model.rigFrom; i++) {
    const o = i * 6
    const x = (boxes[o]! + boxes[o + 3]!) / 2
    const z = (boxes[o + 2]! + boxes[o + 5]!) / 2
    if (upperWorks[i] === 1 && Math.abs(z) > 2.5 && Math.abs(x) < 4 && Math.abs(deckHeight(model.deck, x, z) - boxes[o + 4]!) < 1e-3) return i
  }
  throw new Error("no rail part")
}

test("a brick shoved off the rail falls into the sea, splashes, floats a while on the surface, then sinks away", () => {
  const { calls, effects, audio } = recorder()
  const debris = new BrickDebris(new Scene(), model, effects, audio, seeded(7))
  const ship = source()
  const part = railPart()
  debris.drop(ship, [part], 0, Math.sign(model.graph.boxes[part * 6 + 2]!), 2)
  expect(debris.bodies()).toHaveLength(1)
  let floating = 0
  let sank = -1
  run(debris, 20, (t) => {
    const body = debris.bodies()[0]
    if (body === undefined) {
      if (sank < 0) sank = t
      return
    }
    const [x, y, z] = body.position
    if (body.wet && Math.abs(y - oceanHeight(sea, x, z, t)) < 0.4) floating += 1 / 60
  })
  expect(calls.plops).toBe(1)
  expect(floating).toBeGreaterThan(1.5)
  expect(sank).toBeGreaterThan(2)
  expect(debris.stats().pieces).toBe(0)
})

test("a loose brick dropped onto the deck bounces and comes to rest on it, riding the ship", () => {
  const { effects, audio } = recorder()
  const debris = new BrickDebris(new Scene(), model, effects, audio, seeded(7))
  const ship = source()
  const part = railPart()
  // Cut loose from a ship standing 3 m higher and 3 m to starboard: it falls onto the open waist deck.
  ship.pose.y = 3
  ship.pose.z = 3
  debris.drop(ship, [part], 0, 0, 0)
  ship.pose.y = 0
  ship.pose.z = 0
  const heights: Array<number> = []
  run(debris, 6, () => heights.push(debris.bodies()[0]?.position[1] ?? Number.NaN))
  const [x, y, z] = debris.bodies()[0]?.position ?? [0, 0, 0]
  const o = part * 6
  const extent = Math.max(...[0, 1, 2].map((a) => model.graph.boxes[o + 3 + a]! - model.graph.boxes[o + a]!)) / 2
  const floor = deckHeight(model.deck, x, z)
  // At rest on the deck under it: centre within its own half-size above, and still for the last half second.
  expect(y - floor).toBeGreaterThan(0)
  expect(y - floor).toBeLessThan(extent + 0.05)
  expect(Math.max(...heights.slice(-30)) - Math.min(...heights.slice(-30))).toBeLessThan(0.02)
  const impact = heights.findIndex((h, i) => i > 0 && h > heights[i - 1]!)
  expect(Math.max(...heights.slice(impact)) - heights[impact - 1]!).toBeGreaterThan(0.1)
})

test("a mast shot through at its foot comes down as one rigid chunk and topples over", () => {
  const { calls, effects, audio } = recorder()
  const debris = new BrickDebris(new Scene(), model, effects, audio, seeded(7))
  const ship = source()
  const mast = model.masts[1]!
  const snap = mast.snapParts[0]!
  const detached = new ShipDamage(model.graph).apply([snap])
  expect(detached).toContain(mast.topPart)
  debris.shatter(ship, [snap], detached, new Vector3(0, 0, 70))
  const chunk = () => debris.bodies().reduce((a, b) => (b.pieces > a.pieces ? b : a))
  expect(chunk().pieces).toBe(detached.length)
  let tilt = 1
  run(debris, 8, () => (tilt = Math.min(tilt, chunk().up)))
  expect(tilt).toBeLessThan(Math.cos(Math.PI / 3))
  expect(calls.splashes).toBeGreaterThan(0)
})

test("six hundred bricks cost well under a frame to step and draw", () => {
  const { effects, audio } = recorder()
  const debris = new BrickDebris(new Scene(), model, effects, audio, seeded(7))
  const ship = source()
  const parts = Array.from({ length: 600 }, (_, i) => (i * 7) % model.rigFrom)
  for (let i = 0; i < parts.length; i += 6) debris.shatter(ship, parts.slice(i, i + 6), [], new Vector3(0, -3, 70))
  expect(debris.stats().bodies).toBe(600)
  run(debris, 2)
  expect(debris.stats().meanMs).toBeLessThan(2)
})
