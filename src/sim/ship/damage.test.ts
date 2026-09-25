import { expect, test } from "bun:test"
import { nextRange, seedRng } from "../rng.ts"
import { tuning } from "../tuning.ts"
import type { Vec3 } from "../vector.ts"
import { ShipAir } from "./air.ts"
import { buildDamageGraph, hitDamage, type ShipHit, ShipDamage } from "./damage.ts"
import { generateShip } from "./generate.ts"
import { rigParts } from "./rig.ts"
import { galleonSpec } from "./spec.ts"

const ship = generateShip(galleonSpec)
const graph = buildDamageGraph(galleonSpec, ship)

/** Fire from 30 m off the port beam at (x, y) on the side; undefined when the ball meets no part. */
const fire = (damage: ShipDamage, x: number, y: number): ShipHit | undefined => {
  const direction: Vec3 = { x: 0, y: 0, z: 1 }
  const distance = damage.firstPartAlong({ x, y, z: -30 }, direction, 60)
  return distance === undefined ? undefined : damage.hit({ x, y, z: -30 + distance }, direction)
}

test("the graph has every stud edge both ways and the keel as anchors", () => {
  expect(graph.count).toBe(ship.parts.length)
  expect(graph.neighbours.length).toBe(ship.edges.length * 2)
  expect([...graph.anchors]).toEqual([...ship.keel])
})

test("a hull hit knocks out at most the hull cap, nearest the impact first, and costs full HP", () => {
  const damage = new ShipDamage(graph)
  const hit = fire(damage, 0, 0.4)
  expect(hit?.zone).toBe("hull")
  expect(hit?.removed.length).toBe(tuning.damage.bricks.hullCap)
  expect(hitDamage("hull")).toBe(tuning.damage.perBall)
  const first = hit?.removed[0] ?? -1
  expect(graph.boxes[first * 6 + 2]).toBeLessThan(-3)
})

test("upper-works hits take fewer bricks for less HP, and a ball that meets no brick only holes the sails", () => {
  const damage = new ShipDamage(graph)
  const upper = fire(damage, -12, 5.4)
  expect(upper?.zone).toBe("upperWorks")
  expect(upper?.removed.length).toBeLessThanOrEqual(tuning.damage.bricks.upperWorksCap)
  expect(hitDamage("upperWorks")).toBeLessThan(hitDamage("hull"))
  expect(damage.hit({ x: 0.4, y: 8, z: 3 }, { x: 0, y: 0, z: 1 })).toEqual({ zone: "sails", removed: [], detached: [] })
})

test("a sub-assembly falls whole when the part it stands on goes, with no special case", () => {
  const damage = new ShipDamage(graph)
  const base = ship.parts.findIndex((p, i) => p.part === "3062b" && p.color === "pearlGold" && ship.edges.some(([below, above]) => below === i && ship.parts[above]?.part === "3062b" && ship.parts[above]?.color === "black"))
  const post = [base]
  for (let i = 0; i < post.length; i++) for (const [below, above] of ship.edges) if (below === post[i]) post.push(above)
  const supports = ship.edges.filter(([, above]) => above === base).map(([below]) => below)
  expect(post.length).toBe(4)
  expect(supports.length).toBeGreaterThan(0)
  const detached = damage.apply(supports)
  expect(post.every((i) => detached.includes(i))).toBe(true)
})

test("the rig is upper works, and a ball that shoots a mast's step away drops the mast through the graph", () => {
  const rig = ship.parts.slice(ship.rigFrom)
  expect(rig.length).toBe(rigParts(galleonSpec.rig).length)
  expect(graph.upperWorks.subarray(ship.rigFrom).every((z) => z === 1)).toBe(true)
  for (const mast of galleonSpec.rig.masts) {
    const index = new Map(ship.parts.map((p, i) => [`${p.part}@${p.x},${p.y},${p.z}`, i]))
    const parts = rigParts({ ...galleonSpec.rig, masts: [mast] }).map((p) => index.get(`${p.part}@${p.x},${p.y},${p.z}`) ?? -1)
    const step = parts.slice(0, 4)
    const damage = new ShipDamage(graph)
    const o = (step[0] ?? 0) * 6
    const foot = { x: graph.boxes[o] ?? 0, y: ((graph.boxes[o + 1] ?? 0) + (graph.boxes[o + 4] ?? 0)) / 2, z: 0 }
    const hit = damage.hit(foot, { x: 0, y: 0, z: 1 })
    expect(hit.zone).toBe("upperWorks")
    expect(hit.removed.length).toBeLessThanOrEqual(tuning.damage.bricks.upperWorksCap)
    const gone = new Set([...hit.removed, ...hit.detached, ...damage.apply(step.filter((i) => !hit.removed.includes(i)))])
    expect(parts.every((i) => gone.has(i))).toBe(true)
  }
})

/** Seeded four-ball groups over the port side, each ball within ±2.6 m of its group's aim, until HP reaches `to`. */
const volley = (damage: ShipDamage, seed: number, from: number, to: number) => {
  let rng = seedRng(seed)
  let hp = from
  let aim = { x: 0, y: 0 }
  const hits: Array<ShipHit> = []
  for (let tries = 0; hp > to && tries < 1000; tries++) {
    if (tries % 4 === 0) {
      const [x, afterX] = nextRange(rng, -11, 11)
      const [y, next] = nextRange(afterX, 0.8, 4.5)
      aim = { x, y }
      rng = next
    }
    const [dx, afterDx] = nextRange(rng, -2.6, 2.6)
    const [dy, next] = nextRange(afterDx, -1.3, 1.3)
    rng = next
    const hit = fire(damage, aim.x + dx, aim.y + dy)
    if (hit === undefined) continue
    hits.push(hit)
    hp -= hitDamage(hit.zone)
  }
  return hits
}

test("about fifty balls sink the galleon; every hit stays bounded and 20 % HP has lost hundreds of parts", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const damage = new ShipDamage(graph)
    const toTwenty = volley(damage, seed, tuning.damage.hullHp, tuning.damage.hullHp * 0.2)
    const lost = toTwenty.reduce((n, h) => n + h.removed.length + h.detached.length, 0)
    const rest = volley(damage, seed + 100, tuning.damage.hullHp * 0.2, 0)
    const hits = [...toTwenty, ...rest]
    expect(hits.length).toBeGreaterThanOrEqual(40)
    expect(hits.length).toBeLessThanOrEqual(60)
    expect(lost).toBeGreaterThan(250)
    expect(lost).toBeLessThan(ship.parts.length / 8)
    for (const hit of hits) {
      expect(hit.removed.length).toBeLessThanOrEqual(tuning.damage.bricks.hullCap)
      expect(hit.detached.length).toBeLessThan(60)
    }
  }
})

test("clients replaying the server's removed lists derive the same detached parts", () => {
  const server = new ShipDamage(graph)
  const client = new ShipDamage(graph)
  const hits = volley(server, 9, 100, 0)
  for (const hit of hits) expect(client.apply(hit.removed)).toEqual(hit.detached)
  expect(ship.parts.every((_, i) => client.isPresent(i) === server.isPresent(i))).toBe(true)
})

test("opening removed parts floods the air exactly as a fresh flood of the parts left", () => {
  const damage = new ShipDamage(graph)
  const air = new ShipAir(ship.parts, ship.openings)
  for (const hit of volley(damage, 3, 100, 20)) air.open([...hit.removed, ...hit.detached])
  const left = ship.parts.flatMap((_, i) => (damage.isPresent(i) ? [i] : []))
  const fresh = new ShipAir(ship.parts.filter((_, i) => damage.isPresent(i)), ship.openings)
  const mismatches = left.filter((i, k) => air.partLevel(i) !== fresh.partLevel(k) || air.hiddenStuds(i).join() !== fresh.hiddenStuds(k).join())
  expect(mismatches).toEqual([])
})
