import { describe, expect, test } from "bun:test"
import type { ShipSnapshot } from "../../protocol/messages.ts"
import { EventQueue, interpolationDelay, ShipPose, SnapshotTimeline } from "./timeline.ts"

const hz = 30
const yawQuat = (angle: number): ShipSnapshot["orientation"] => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]

const ship = (x: number, yaw: number): ShipSnapshot => ({
  id: "player" as ShipSnapshot["id"],
  position: [x, 0, 0],
  orientation: yawQuat(yaw),
  velocity: [3, 0, 0],
  rudder: 1,
  sail: 2,
  rudderAngle: 0,
  sailSet: 1,
  hp: 100,
  reloadedAt: [0, 0],
})

describe("SnapshotTimeline", () => {
  test("draws the world interpolationDelay behind the server, between the bracketing ticks", () => {
    const timeline = new SnapshotTimeline(hz)
    const latency = 0.05
    for (let tick = 0; tick <= 30; tick++) timeline.push(tick, [ship(tick, 0)], tick / hz + latency)
    const now = 30 / hz + latency
    const renderTime = timeline.advance(now, 1 / 60)
    expect(renderTime).toBeCloseTo(30 / hz - interpolationDelay, 6)
    const pose = new ShipPose()
    expect(timeline.sample("player", pose)).toBe(true)
    expect(pose.x).toBeCloseTo(30 - interpolationDelay * hz, 6)
  })

  test("jitter adds buffer instead of pulling the clock ahead", () => {
    const timeline = new SnapshotTimeline(hz)
    const delays = [0.05, 0.09, 0.05, 0.12, 0.07]
    for (let tick = 0; tick < 30; tick++) timeline.push(tick, [ship(tick, 0)], tick / hz + (delays[tick % delays.length] ?? 0))
    expect(timeline.advance(29 / hz + 0.12, 0)).toBeCloseTo(29 / hz + 0.07 - interpolationDelay, 3)
  })

  test("the render clock eases toward its target instead of jumping", () => {
    const timeline = new SnapshotTimeline(hz)
    timeline.push(0, [ship(0, 0)], 0)
    let previous = timeline.advance(0, 0)
    for (let frame = 1; frame < 240; frame++) {
      if (frame % 4 === 0) timeline.push(frame / 4, [ship(frame / 4, 0)], frame / 120 - 0.02)
      const t = timeline.advance(frame / 120, 1 / 120)
      const step = t - previous
      expect(step).toBeGreaterThan(0)
      expect(step).toBeLessThan((1 / 120) * 1.1)
      previous = t
    }
  })

  test("orientation takes the short arc between ticks", () => {
    const timeline = new SnapshotTimeline(hz)
    const a = ship(0, 0.2)
    const q = yawQuat(0.4)
    const flipped: ShipSnapshot["orientation"] = [-q[0], -q[1], -q[2], -q[3]]
    timeline.push(0, [a], 0)
    timeline.push(1, [{ ...a, orientation: flipped }], 1 / hz)
    timeline.advance(0.5 / hz + interpolationDelay, 0)
    const pose = new ShipPose()
    timeline.sample("player", pose)
    expect(Math.abs(2 * Math.atan2(pose.qy, pose.qw))).toBeCloseTo(0.3, 3)
  })

  test("a ship absent at the render time is not sampled; stale ticks are dropped", () => {
    const timeline = new SnapshotTimeline(hz)
    timeline.push(5, [ship(0, 0)], 0)
    timeline.push(4, [], 0)
    expect(timeline.latestTick).toBe(5)
    timeline.advance(1, 0)
    expect(timeline.sample("someone-else", new ShipPose())).toBe(false)
  })
})

describe("EventQueue", () => {
  test("applies events once the render clock reaches their tick", () => {
    const queue = new EventQueue<{ tick: number; name: string }>()
    queue.push([{ tick: 3, name: "a" }, { tick: 5, name: "b" }])
    const applied: Array<string> = []
    queue.drain(4.5, (event) => applied.push(event.name))
    expect(applied).toEqual(["a"])
    queue.drain(5, (event) => applied.push(event.name))
    expect(applied).toEqual(["a", "b"])
  })
})
