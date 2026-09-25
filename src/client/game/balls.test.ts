import { expect, test } from "bun:test"
import { Scene } from "three"
import type { ServerEvent } from "../../protocol/messages.ts"
import { shipId } from "../../sim/ship.ts"
import { Cannonballs, type BallEnd } from "./balls.ts"

const fired = (ballId: number, firedAt: number): ServerEvent => ({
  _tag: "cannonFired",
  tick: Math.floor(firedAt * 30),
  ballId,
  shooter: shipId("player"),
  gun: 0,
  origin: [0, 3, 4],
  velocity: [0, 5, 90],
  firedAt,
})

const record = () => {
  const log: Array<string> = []
  const balls = new Cannonballs(new Scene(), {
    fired: (ball) => log.push(`fired ${ball.id}`),
    flying: () => undefined,
    ended: (end: BallEnd, ball) => log.push(`${end._tag} ${end.ballId}${ball === undefined ? " unseen" : ""}`),
  })
  return { balls, log }
}

test("a ball appears at its fire time and ends at its impact time, not when the events arrive", () => {
  const { balls, log } = record()
  balls.onEvent(fired(1, 1.05))
  balls.onEvent({ _tag: "ballSplash", tick: 60, time: 2.2, ballId: 1, point: [0, 0, 100] })
  balls.update(1.0)
  expect(log).toEqual([])
  expect(balls.mesh.count).toBe(0)
  balls.update(1.06)
  expect(log).toEqual(["fired 1"])
  expect(balls.mesh.count).toBe(1)
  expect(balls.inFlight).toBe(1)
  balls.update(2.19)
  expect(log).toEqual(["fired 1"])
  balls.update(2.21)
  expect(log).toEqual(["fired 1", "ballSplash 1"])
  expect(balls.mesh.count).toBe(0)
  expect(balls.inFlight).toBe(0)
})

test("a ripple broadside fires gun by gun and each ball ends on its own", () => {
  const { balls, log } = record()
  for (let i = 0; i < 3; i++) balls.onEvent(fired(10 + i, 1 + i * 0.05))
  balls.onEvent({ _tag: "ballHit", tick: 50, time: 1.6, ballId: 11, shooter: shipId("player"), target: shipId("dummy"), point: [0, 1, 50], localPoint: [0, 1, 4], zone: "hull", removed: [], damage: 5, hp: 95 })
  balls.update(1.07)
  expect(log).toEqual(["fired 10", "fired 11"])
  balls.update(1.7)
  expect(log.toSorted()).toEqual(["ballHit 11", "fired 10", "fired 11", "fired 12"])
  expect(balls.inFlight).toBe(2)
})

test("an impact of a ball never seen fired still plays", () => {
  const { balls, log } = record()
  balls.onEvent({ _tag: "ballSplash", tick: 3, time: 0.1, ballId: 99, point: [0, 0, 0] })
  expect(log).toEqual(["ballSplash 99 unseen"])
})
