import { BunRuntime } from "@effect/platform-bun"
import { Effect, Schedule } from "effect"
import { HttpServer } from "effect/unstable/http"
import { chromium, type Browser, type Page } from "playwright"
import type { BrickwakeDebug } from "../src/client/game/debug-hook.ts"
import * as Server from "../src/server/server.ts"


const degrees = 180 / Math.PI

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`check failed: ${message}`)
}

const hook = <A>(page: Page, read: (hook: BrickwakeDebug) => A): Promise<A> =>
  page.evaluate(`(${read.toString()})(window.brickwake)`) as Promise<A> // The page returns what `read` returns; Playwright serializes it.

const ownShip = async (page: Page) => {
  const ship = await hook(page, (h) => h.ownShip())
  if (ship === null) throw new Error("the client draws no own ship")
  return ship
}

/** Plays C1 in the browser: one click to sail, W/D change the heading, the ship rides a beam sea while the camera stays level. */
const sail = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${url}?scenario=beam-sea`)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ownShip() !== null, undefined, { timeout: 15_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: ".shots/c1-title.png" })

  await page.mouse.click(640, 360)
  check(await hook(page, (h) => h.sailing), "one click from page load starts sailing")

  const heels: Array<number> = []
  const rolls: Array<number> = []
  const gaps: Array<number> = []
  for (let i = 0; i < 60; i++) {
    const ship = await ownShip(page)
    const camera = await hook(page, (h) => h.camera())
    heels.push(ship.heel)
    rolls.push(camera?.roll ?? Number.NaN)
    gaps.push(ship.position[1] - ship.waterHeight)
    await page.waitForTimeout(100)
  }
  const heelRange = (Math.max(...heels) - Math.min(...heels)) * degrees
  const cameraRoll = Math.max(...rolls.map(Math.abs)) * degrees
  const worstGap = Math.max(...gaps.map(Math.abs))
  check(heelRange > 8, `the ship rolls in a beam sea (heel range ${heelRange.toFixed(1)}°)`)
  check(cameraRoll < 0.01, `the camera does not roll with the ship (${cameraRoll.toFixed(3)}°)`)
  check(worstGap < 1, `the ship sits in the drawn water (origin ${worstGap.toFixed(2)} m from the surface)`)
  await page.screenshot({ path: ".shots/c1-beam-sea.png" })
  const side = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await side.goto(`${url}?scenario=beam-sea&orbit=80`)
  await side.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ownShip() !== null, undefined, { timeout: 15_000 })
  await side.mouse.click(640, 360)
  await side.mouse.wheel(0, -200)
  await side.waitForTimeout(3000)
  await side.screenshot({ path: ".shots/c1-waterline.png" })
  await side.close()

  const before = await ownShip(page)
  await page.keyboard.press("KeyW")
  await page.keyboard.press("KeyW")
  await page.waitForTimeout(3000)
  await page.keyboard.down("KeyD")
  await page.waitForTimeout(5000)
  const turning = await ownShip(page)
  await page.screenshot({ path: ".shots/c1-turning.png" })
  await page.keyboard.up("KeyD")
  const turned = Math.abs(Math.atan2(Math.sin(turning.heading - before.heading), Math.cos(turning.heading - before.heading))) * degrees
  check(turning.sail === 2 && turning.rudder === 1, `W W sets full sail and D puts the rudder to starboard (sail ${turning.sail}, rudder ${turning.rudder})`)
  check(turned > 10, `holding D turns the ship (heading changed ${turned.toFixed(1)}°)`)
  check(turning.speed > 2, `the ship makes way under sail (${turning.speed.toFixed(1)} m/s)`)
  const frames = await hook(page, (h) => h.frames())

  // Joel's display: 3456×2234 physical at DPR 2, which the game caps to 1.5.
  const open = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
  await open.goto(url)
  await open.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ownShip() !== null, undefined, { timeout: 15_000 })
  await open.mouse.click(864, 558)
  await open.keyboard.press("KeyW")
  await open.keyboard.press("KeyW")
  await open.waitForTimeout(9000)
  await open.screenshot({ path: ".shots/c1-open-sea.png" })
  const openFrames = await hook(open, (h) => h.frames())

  return [
    `beam sea: heel range ${heelRange.toFixed(1)}°, camera roll ${cameraRoll.toFixed(3)}°, origin within ${worstGap.toFixed(2)} m of the drawn surface`,
    `helm: turned ${turned.toFixed(1)}° in 5 s at ${turning.speed.toFixed(1)} m/s`,
    `frames (beam sea): cpu ${frames.cpuMs.toFixed(2)} ms, gpu ${frames.gpuMs.toFixed(2)} ms, interval ${frames.intervalMs.toFixed(2)} ms`,
    `frames (open sea, 2592×1676): cpu ${openFrames.cpuMs.toFixed(2)} ms, gpu ${openFrames.gpuMs.toFixed(2)} ms, interval ${openFrames.intervalMs.toFixed(2)} ms`,
    "saved .shots/c1-{title,beam-sea,waterline,turning,open-sea}.png",
  ].join("\n")
}

const shipById = async (page: Page, id: string) => {
  const ship = await page.evaluate((id) => window.brickwake?.ships().find((s) => s.id === id) ?? null, id)
  if (ship === null) throw new Error(`the client draws no ship ${id}`)
  return ship
}

/** Yaw angle of the direction from `a` to `b` (see `directionFromAngle`). */
const bearing = (a: readonly [number, number, number], b: readonly [number, number, number]) => Math.atan2(-(b[2] - a[2]), b[0] - a[0])

/** Turns the camera toward `yaw` and searches its pitch until the reticle's aim point is `range` metres from the ship. */
const aimAtRange = async (page: Page, yaw: number, range: number) => {
  let low = -0.08
  let high = 0.6
  for (let i = 0; i < 14; i++) {
    const pitch = (low + high) / 2
    await page.evaluate(([yaw, pitch]) => window.brickwake?.orbit(yaw, pitch), [yaw, pitch] as const)
    await page.waitForTimeout(60)
    const aim = await hook(page, (h) => h.aim())
    // Steeper looks land nearer; no aim means the ray passed over the sea's edge of range.
    if (aim?.aimPoint == null || aim.range > range) low = pitch
    else high = pitch
  }
  const aim = await hook(page, (h) => h.aim())
  if (aim?.aimPoint == null) throw new Error("the reticle found no sea to aim at")
  return aim
}

const waitFor = async (page: Page, read: (h: BrickwakeDebug) => boolean, timeout: number) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await hook(page, read)) return true
    await page.waitForTimeout(40)
  }
  return false
}

/** Plays C2 in the browser: aim at the drifting dummy from the reticle, fire the broadside, see it hit; then splash a broadside into open sea. */
const gunnery = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${url}?scenario=target-dummy`)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length === 2, undefined, { timeout: 15_000 })
  await page.mouse.click(640, 360)
  await page.waitForTimeout(500)
  const own = await ownShip(page)
  const dummy = await shipById(page, "dummy")
  const distance = Math.hypot(dummy.position[0] - own.position[0], dummy.position[2] - own.position[2])
  const aim = await aimAtRange(page, bearing(own.position, dummy.position), distance)
  check(aim.side === "starboard" && aim.state === "ready", `the reticle faces the dummy ready to fire (${aim.side}, ${aim.state})`)
  await page.screenshot({ path: ".shots/c2-aim.png" })

  const outcome = await hook(page, (h) => h.fire())
  check(outcome === "fired", `the broadside fires at the reticle (${outcome})`)
  const reloading = await hook(page, (h) => h.aim())
  check(reloading?.state === "reloading", `the reticle shows the reload right after firing (${reloading?.state})`)
  // From off the starboard bow the battery fires across the view and its smoke rolls out toward the dummy.
  await page.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.2, 48), own.heading + Math.PI - 1.2)
  check(await waitFor(page, (h) => h.effects().ballsInFlight > 0, 3000), "the fire events render balls")
  const burst = await hook(page, (h) => h.effects())
  for (const [i, wait] of [80, 150, 300, 900].entries()) {
    await page.screenshot({ path: `.shots/c2-broadside-${i + 1}.png` })
    await page.waitForTimeout(wait)
  }
  check(burst.particles.fire > 0 && burst.particles.smoke > 20 && burst.shake > 0, `flash, smoke and shake play on firing (${JSON.stringify(burst)})`)
  check(await waitFor(page, (h) => (h.ships().find((s) => s.id === "dummy")?.hp ?? 100) < 100, 6000), "a hit lowers the dummy's HP")
  // Looking past the bow keeps the own hull out of the way of the dummy.
  await page.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.1, 30), bearing(own.position, dummy.position) + 0.45)
  await waitFor(page, (h) => h.effects().particles.chips > 0, 1000)
  await page.waitForTimeout(120)
  const impact = await hook(page, (h) => h.effects())
  await page.screenshot({ path: ".shots/c2-impact.png" })
  const hit = await shipById(page, "dummy")
  const hits = await hook(page, (h) => h.events().filter((e) => e._tag === "ballHit").length)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: ".shots/c2-smoke.png" })
  const frames = await hook(page, (h) => h.frames())

  // Out of reach and then, reloaded, into open sea to port.
  const heading = (await ownShip(page)).heading
  await aimAtRange(page, heading + Math.PI / 2, 250)
  await page.waitForFunction(() => (window.brickwake?.aim()?.reloadLeft ?? 1) === 0, undefined, { timeout: 8000 })
  const far = await page.evaluate(() => {
    const own = window.brickwake?.ownShip()
    return own ? window.brickwake?.fireAt([own.position[0] + 20, 0, own.position[2] - 900]) : undefined
  })
  check(far === "out-of-range", `a point 900 m off is refused as out of range (${far})`)
  const port = await aimAtRange(page, heading + Math.PI / 2, 120)
  check(port.side === "port", `turning the view to port faces the port battery (${port.side})`)
  const lastBall = await hook(page, (h) => Math.max(-1, ...h.events().flatMap((e) => (e._tag === "cannonFired" ? [e.ballId] : []))))
  check((await hook(page, (h) => h.fire())) === "fired", "the port broadside fires")
  // The guns converge on the aim point, so the splashes group there; from high over the starboard side the
  // line of sight to them passes over the smoke bank.
  await page.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.3, 60), heading + Math.PI / 2 - 0.5)
  const splashed = await page.waitForFunction(
    (last) => window.brickwake?.events().some((e) => e._tag === "ballSplash" && e.ballId > last) === true,
    lastBall,
    { timeout: 6000 },
  )
  check(splashed !== null, "the port broadside splashes")
  await page.waitForTimeout(600)
  await page.screenshot({ path: ".shots/c2-splashes.png" })
  const splashes = await hook(page, (h) => h.events().filter((e) => e._tag === "ballSplash").length)
  await page.close()

  // Joel's display, camera inside the smoke bank of a broadside: the heaviest overdraw firing makes.
  const big = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
  await big.goto(`${url}?scenario=target-dummy`)
  await big.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length === 2, undefined, { timeout: 15_000 })
  await big.mouse.click(864, 558)
  await big.waitForTimeout(500)
  const bigOwn = await ownShip(big)
  check((await big.evaluate(([x, z]) => window.brickwake?.fireAt([x, 0, z + 150]), [bigOwn.position[0], bigOwn.position[2]] as const)) === "fired", "the big-screen broadside fires")
  await big.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.15, 30), bigOwn.heading + Math.PI - 1.3)
  await big.waitForTimeout(2600)
  const smokeFrames = await hook(big, (h) => h.frames())
  await big.screenshot({ path: ".shots/c2-smoke-bank.png" })
  await big.close()

  return [
    `dummy at ${distance.toFixed(0)} m: HP ${hit.hp} after ${hits} hits; reticle aim ${aim.range.toFixed(1)} m`,
    `effects at impact: ${JSON.stringify(impact)}`,
    `port broadside into open sea: ${splashes} splash events`,
    `frames (effects): cpu ${frames.cpuMs.toFixed(2)} ms, gpu ${frames.gpuMs.toFixed(2)} ms, interval ${frames.intervalMs.toFixed(2)} ms`,
    `frames (in the smoke bank, 2592×1676): cpu ${smokeFrames.cpuMs.toFixed(2)} ms, gpu ${smokeFrames.gpuMs.toFixed(2)} ms, interval ${smokeFrames.intervalMs.toFixed(2)} ms`,
    "saved .shots/c2-{aim,broadside-1..4,impact,smoke,splashes,smoke-bank}.png",
  ].join("\n")
}

const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop()
  if (port === undefined) throw new Error("probe server has no port")
  return port
}

Effect.gen(function* () {
  const { address } = yield* HttpServer.HttpServer
  if (address._tag === "UnixPathAddress") return yield* Effect.die("game server is not on a TCP port")

  const vitePort = yield* Effect.promise(freePort)
  // Vite runs under Node: Bun's node:http never hands WebSocket upgrades to Vite's `/ws` proxy.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(["bun", "x", "vite", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort", "--logLevel", "warn"], {
        env: { ...process.env, SERVER_PORT: String(address.port) },
        stdio: ["ignore", "inherit", "inherit"],
      }),
    ),
    (vite) => Effect.promise(() => (vite.kill(), vite.exited)),
  )
  const url = `http://127.0.0.1:${vitePort}/`
  yield* Effect.tryPromise(() => fetch(url)).pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
    Effect.orDie,
  )

  const browser = yield* Effect.acquireRelease(
    Effect.promise(() => chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })),
    (browser) => Effect.promise(() => browser.close()),
  )
  const checks = { c1: sail, c2: gunnery }
  const wanted = process.argv.slice(2)
  for (const [name, run] of Object.entries(checks)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue
    const report = yield* Effect.promise(() => run(browser, url))
    yield* Effect.log(`${name}\n${report}`)
  }
}).pipe(Effect.scoped, Effect.provide(Server.layer({ port: 0 })), BunRuntime.runMain)
