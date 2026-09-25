import { afterAll, beforeAll, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { ballFromWire, ServerMessageJson, type ServerMessage } from "../protocol/messages.ts"
import { ballPositionAt } from "../sim/gunnery.ts"
import { seas, swell } from "../sim/ocean.ts"
import { hitDamage } from "../sim/ship/damage.ts"
import { dummyShipId, duelShipIds, scenarioShipId } from "../sim/scenarios.ts"
import { SIM_HZ, tuning } from "../sim/tuning.ts"
import { scaleSea, weatherEffects } from "../sim/weather.ts"
import type { NetworkLag } from "./lag.ts"
import * as Server from "./server.ts"

const decode = Schema.decodeUnknownSync(ServerMessageJson)

type Snapshot = Extract<ServerMessage, { readonly _tag: "snapshot" }>
type Welcome = Extract<ServerMessage, { readonly _tag: "welcome" }>

const startServer = async (lag?: NetworkLag) => {
  const runtime = ManagedRuntime.make(Server.layer(lag ? { port: 0, lag } : { port: 0 }).pipe(Layer.orDie))
  const { address } = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* HttpServer.HttpServer
    }),
  )
  if (address._tag === "UnixPathAddress") throw new Error("expected an IP address")
  return {
    url: `ws://127.0.0.1:${address.port}/ws`,
    dispose: async () => {
      // Closing interrupts WebSocket handlers still open, and the platform reports that as an interrupted exit.
      const exit = await Effect.runPromiseExit(runtime.disposeEffect)
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) throw Cause.squash(exit.cause)
    },
  }
}

/** A real WebSocket client that decodes every server message the way the game client must. */
const connect = async (url: string) => {
  const socket = new WebSocket(url)
  const received: Array<{ readonly at: number; readonly message: ServerMessage }> = []
  let waiters: Array<() => void> = []
  socket.addEventListener("message", (event) => {
    received.push({ at: performance.now(), message: decode(event.data) })
    const woken = waiters
    waiters = []
    for (const wake of woken) wake()
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve)
    socket.addEventListener("error", reject)
  })
  const next = <T extends ServerMessage>(match: (message: ServerMessage) => message is T, from = 0): Promise<T> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("no matching message within 2 s")), 2000)
      const check = () => {
        const found = received.slice(from).find((entry) => match(entry.message))
        if (found) {
          clearTimeout(timeout)
          resolve(found.message as T)
        } else waiters.push(check)
      }
      check()
    })
  return {
    socket,
    received,
    send: (message: unknown) => socket.send(typeof message === "string" ? message : JSON.stringify(message)),
    next,
    /** The first message of a tag after the `from`-th received message. */
    nextOf: <K extends ServerMessage["_tag"]>(tag: K, from = received.length) =>
      next((message): message is Extract<ServerMessage, { readonly _tag: K }> => message._tag === tag, from),
    snapshots: () => received.flatMap((entry) => (entry.message._tag === "snapshot" ? [{ at: entry.at, snapshot: entry.message }] : [])),
    close: async () => {
      socket.close()
      if (socket.readyState !== WebSocket.CLOSED) await new Promise((resolve) => socket.addEventListener("close", resolve))
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ownShip = (snapshot: Snapshot, welcome: Welcome) => snapshot.ships.find((ship) => ship.id === welcome.shipId)

let server: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.dispose())

test("a joining client gets a welcome with the match sea, then a full snapshot every tick at 30 Hz", async () => {
  const client = await connect(server.url)
  client.send({ _tag: "join", mode: "ffa" })
  const welcome = await client.nextOf("welcome", 0)
  expect(welcome.simHz).toBe(SIM_HZ)
  expect(client.socket.extensions).toContain("permessage-deflate")
  expect(welcome.sea).toEqual(scaleSea(seas.open, weatherEffects[welcome.weather].waveHeight))
  expect(welcome.ships.map((ship) => ship.id)).toContain(welcome.shipId)

  const first = await client.nextOf("snapshot")
  expect(first.events).toContainEqual({ _tag: "shipJoined", tick: welcome.tick, shipId: welcome.shipId })
  await sleep(2000)
  const snapshots = client.snapshots()
  const ticks = snapshots.map(({ snapshot }) => snapshot.tick)
  expect(ticks).toEqual(ticks.map((_, index) => (ticks[0] ?? 0) + index))
  const window = snapshots.filter(({ at }) => at >= (snapshots[0]?.at ?? 0) + 500)
  const rate = (window.length - 1) / (((window.at(-1)?.at ?? 0) - (window[0]?.at ?? 0)) / 1000)
  expect(rate).toBeGreaterThan(29)
  expect(rate).toBeLessThan(31)
  const last = snapshots.at(-1)!.snapshot
  const bytes = JSON.stringify(last).length
  expect(last.ships).toHaveLength(tuning.bots.fillTo)
  expect(bytes / last.ships.length).toBeLessThan(400)
  console.log(`snapshots at ${rate.toFixed(2)} Hz, ${bytes} B with ${last.ships.length} ships (one human, the rest bots)`)
  await client.close()
})

test("helm and sail commands steer the client's ship", async () => {
  const client = await connect(server.url)
  client.send({ _tag: "join", mode: "ffa" })
  const welcome = await client.nextOf("welcome", 0)
  const start = welcome.ships.find((ship) => ship.id === welcome.shipId)
  client.send({ _tag: "setSail", level: 2 })
  client.send({ _tag: "setHelm", rudder: 1 })
  await sleep(1500)
  const later = ownShip(client.snapshots().at(-1)!.snapshot, welcome)
  expect(later).toMatchObject({ sail: 2, rudder: 1 })
  expect(later!.rudderAngle).toBeGreaterThan(0.1)
  expect(later!.sailSet).toBeGreaterThan(0.3)
  expect(Math.hypot(...later!.velocity)).toBeGreaterThan(0.2)
  expect(later!.position).not.toEqual(start!.position)

  const from = client.received.length
  client.send({ _tag: "setHelm", rudder: 0 })
  client.send({ _tag: "setSail", level: 0 })
  const centred = await client.next(
    (message): message is Snapshot => message._tag === "snapshot" && ownShip(message, welcome)?.rudder === 0,
    from,
  )
  expect(ownShip(centred, welcome)?.sail).toBe(0)
  await client.close()
})

test("invalid messages are rejected, the connection stays usable and the room keeps ticking", async () => {
  const bystander = await connect(server.url)
  bystander.send({ _tag: "join", mode: "ffa" })
  await bystander.nextOf("welcome", 0)

  const client = await connect(server.url)
  const invalid: ReadonlyArray<unknown> = [
    "not json",
    "{}",
    { _tag: "fly" },
    { _tag: "join", mode: "tdm-royale" },
    { _tag: "join", mode: "ffa", scenario: "nowhere" },
    { _tag: "setHelm", rudder: 1 },
    JSON.stringify({ _tag: "setSail", level: "x".repeat(10_000) }),
  ]
  for (const message of invalid) {
    const from = client.received.length
    client.send(message)
    expect((await client.nextOf("rejected", from)).reason.length).toBeGreaterThan(0)
  }
  let from = client.received.length
  client.socket.send(new Uint8Array([1, 2, 3]))
  expect((await client.nextOf("rejected", from)).reason).toContain("binary")

  client.send({ _tag: "join", mode: "ffa" })
  const welcome = await client.nextOf("welcome", 0)
  for (const message of [
    { _tag: "setHelm", rudder: 5 },
    { _tag: "setSail", level: 1.5 },
    { _tag: "setHelm", rudder: Number.NaN },
    { _tag: "join", mode: "ffa" },
  ]) {
    from = client.received.length
    client.send(message)
    await client.nextOf("rejected", from)
  }
  const snapshot = await client.nextOf("snapshot")
  expect(ownShip(snapshot, welcome)).toMatchObject({ rudder: 0, sail: 0 })

  const ticksBefore = bystander.snapshots().length
  await sleep(300)
  expect(bystander.snapshots().length - ticksBefore).toBeGreaterThanOrEqual(8)
  await Promise.all([client.close(), bystander.close()])
})

test("quick play puts clients in one room with bots filling it to six; a leaver's ship goes and a bot takes its place", async () => {
  const a = await connect(server.url)
  const b = await connect(server.url)
  a.send({ _tag: "join", mode: "ffa" })
  const welcomeA = await a.nextOf("welcome", 0)
  b.send({ _tag: "join", mode: "ffa" })
  const welcomeB = await b.nextOf("welcome", 0)
  const isBot = (id: string) => id.startsWith("bot-")
  expect(welcomeA.ships.map((ship) => ship.id).filter(isBot)).toHaveLength(tuning.bots.fillTo - 1)
  expect(welcomeB.ships).toHaveLength(tuning.bots.fillTo)
  expect(welcomeB.ships.map((ship) => ship.id).filter((id) => !isBot(id))).toEqual([welcomeA.shipId, welcomeB.shipId])
  const shipA = welcomeB.ships.find((ship) => ship.id === welcomeA.shipId)
  const shipB = welcomeB.ships.find((ship) => ship.id === welcomeB.shipId)
  expect(Math.hypot(shipA!.position[0] - shipB!.position[0], shipA!.position[2] - shipB!.position[2])).toBeGreaterThan(100)

  const from = a.received.length
  await b.close()
  const left = await a.next(
    (message): message is Snapshot => message._tag === "snapshot" && message.events.some((event) => event._tag === "shipLeft"),
    from,
  )
  expect(left.events).toContainEqual({ _tag: "shipLeft", tick: expect.any(Number), shipId: welcomeB.shipId })
  expect(left.ships.map((ship) => ship.id).filter((id) => !isBot(id))).toEqual([welcomeA.shipId])
  expect(left.ships).toHaveLength(tuning.bots.fillTo)

  a.send({ _tag: "leave" })
  await sleep(100)
  const quiet = a.received.length
  await sleep(200)
  expect(a.received.length).toBe(quiet)
  a.send({ _tag: "join", mode: "ffa" })
  const fresh = await a.nextOf("welcome")
  expect(fresh.ships.map((ship) => ship.id).filter((id) => !isBot(id))).toEqual([fresh.shipId])
  await a.close()
})

test("a scenario join starts a private room from that scenario", async () => {
  const client = await connect(server.url)
  client.send({ _tag: "join", mode: "ffa", scenario: "beam-sea" })
  const welcome = await client.nextOf("welcome", 0)
  expect(welcome.shipId).toBe(scenarioShipId)
  expect(welcome.tick).toBe(0)
  expect(welcome.sea).toEqual(swell(-Math.PI / 2))
  expect(welcome.weather).toBe("clear")
  const stormy = await connect(server.url)
  stormy.send({ _tag: "join", mode: "ffa", scenario: "beam-sea", weather: "storm" })
  const storm = await stormy.nextOf("welcome", 0)
  expect(storm.weather).toBe("storm")
  expect(storm.sea).toEqual(scaleSea(swell(-Math.PI / 2), weatherEffects.storm.waveHeight))
  await stormy.close()
  const other = await connect(server.url)
  other.send({ _tag: "join", mode: "ffa" })
  expect((await other.nextOf("welcome", 0)).ships.map((ship) => ship.id)).not.toContain(scenarioShipId)
  await Promise.all([client.close(), other.close()])
})

test("injected latency delays both directions", async () => {
  const lagged = await startServer({ latencyMs: 120, jitterMs: 30 })
  try {
    const client = await connect(lagged.url)
    const sent = performance.now()
    client.send({ _tag: "join", mode: "ffa" })
    const welcome = await client.nextOf("welcome", 0)
    const roundTrip = client.received[0]!.at - sent
    expect(roundTrip).toBeGreaterThanOrEqual(240)
    expect(roundTrip).toBeLessThan(400)

    await sleep(500)
    const ticks = client.snapshots().map(({ snapshot }) => snapshot.tick)
    expect(ticks).toEqual(ticks.map((_, index) => (ticks[0] ?? 0) + index))
    const from = client.received.length
    const commanded = performance.now()
    client.send({ _tag: "setSail", level: 2 })
    await client.next(
      (message): message is Snapshot => message._tag === "snapshot" && ownShip(message, welcome)?.sail === 2,
      from,
    )
    expect(performance.now() - commanded).toBeGreaterThanOrEqual(240)
    await client.close()
  } finally {
    await lagged.dispose()
  }
})

test("a broadside at the target dummy fires, hits, breaks bricks and lowers its HP; refusals say why; a late joiner gets the wreck", async () => {
  const client = await connect(server.url)
  client.send({ _tag: "join", mode: "ffa", scenario: "target-dummy", room: "wreck-test" })
  const welcome = await client.nextOf("welcome", 0)
  const dummy = welcome.ships.find((ship) => ship.id === dummyShipId)!
  expect(dummy.hp).toBe(tuning.damage.hullHp)
  client.send({ _tag: "fireBroadside", side: "port", aimPoint: [0, 0, 150] })
  await client.next(
    (message): message is Snapshot => message._tag === "snapshot" && message.events.some((event) => event._tag === "broadsideRefused"),
  )
  client.send({ _tag: "fireBroadside", side: "starboard", aimPoint: [dummy.position[0], 0, dummy.position[2]] })
  await sleep(2500)
  const events = client.snapshots().flatMap(({ snapshot }) => snapshot.events)
  expect(events.filter((event) => event._tag === "broadsideRefused")).toMatchObject([{ side: "port", reason: "out-of-arc" }])
  const fired = events.flatMap((event) => (event._tag === "cannonFired" ? [ballFromWire(event)] : []))
  expect(fired).toHaveLength(12)
  const hits = events.flatMap((event) => (event._tag === "ballHit" ? [event] : []))
  expect(hits.length).toBeGreaterThan(0)
  for (const hit of hits) {
    const ball = fired.find((candidate) => candidate.id === hit.ballId)!
    const at = ballPositionAt(ball, hit.time)
    expect(Math.hypot(at.x - hit.point[0], at.y - hit.point[1], at.z - hit.point[2])).toBeLessThan(0.01)
  }
  const last = client.snapshots().at(-1)!.snapshot.ships.find((ship) => ship.id === dummyShipId)!
  expect(last.hp).toBe(tuning.damage.hullHp - hits.reduce((sum, hit) => sum + hitDamage(hit.zone), 0))
  const removed = hits.flatMap((hit) => hit.removed)
  expect(removed.length).toBeGreaterThan(0)

  const late = await connect(server.url)
  late.send({ _tag: "join", mode: "ffa", scenario: "target-dummy", room: "wreck-test" })
  const lateWelcome = await late.nextOf("welcome", 0)
  expect(lateWelcome.shipId).toBe(dummyShipId)
  expect(lateWelcome.wrecks).toEqual([{ shipId: dummyShipId, removed }])
  console.log(`ballHit ${Math.round(JSON.stringify(hits[0]).length)} B; late welcome ${JSON.stringify(lateWelcome).length} B with ${removed.length} removed parts`)
  await Promise.all([client.close(), late.close()])
})

test("two clients naming one duel room share it; A sinks B and the wire carries the sink, the score and the phase", async () => {
  const first = await connect(server.url)
  const second = await connect(server.url)
  const stranger = await connect(server.url)
  first.send({ _tag: "join", mode: "ffa", scenario: "duel", room: "wire-test" })
  const welcomeA = await first.nextOf("welcome", 0)
  second.send({ _tag: "join", mode: "ffa", scenario: "duel", room: "wire-test" })
  const welcomeB = await second.nextOf("welcome", 0)
  stranger.send({ _tag: "join", mode: "ffa", scenario: "duel", room: "other" })
  expect((await stranger.nextOf("welcome", 0)).shipId).toBe(duelShipIds[0])
  expect([welcomeA.shipId, welcomeB.shipId]).toEqual([...duelShipIds])
  expect(welcomeA.rules).toMatchObject({ mode: "ffa", timeLimit: 30 })
  expect(welcomeA.phase).toMatchObject({ _tag: "playing" })
  const target = welcomeB.ships.find((ship) => ship.id === duelShipIds[1])!
  const sunk = second.next(
    (message): message is Snapshot => message._tag === "snapshot" && message.events.some((event) => event._tag === "shipSunk"),
  )
  for (let volley = 0; volley < 3; volley++) {
    first.send({ _tag: "fireBroadside", side: "starboard", aimPoint: [target.position[0], 0, target.position[2]] })
    const done = await Promise.race([sunk.then(() => true), sleep(6100).then(() => false)])
    if (done) break
  }
  const snapshot = await sunk
  expect(snapshot.events.find((event) => event._tag === "shipSunk")).toMatchObject({ shipId: duelShipIds[1], by: duelShipIds[0] })
  const ships = new Map(snapshot.ships.map((ship) => [ship.id, ship]))
  expect(ships.get(duelShipIds[0])).toMatchObject({ kills: 1 })
  expect(ships.get(duelShipIds[1])).toMatchObject({ deaths: 1, hp: 0, life: { _tag: "sinking" } })
  await Promise.all([first.close(), second.close(), stranger.close()])
})
