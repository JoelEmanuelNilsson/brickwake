import { BunRuntime } from "@effect/platform-bun"
import { Effect, Schedule } from "effect"
import { HttpServer } from "effect/unstable/http"
import { chromium, type Browser, type Page } from "playwright"
import type { BrickwakeDebug } from "../src/client/game/debug-hook.ts"
import * as Server from "../src/server/server.ts"


const degrees = 180 / Math.PI

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`C1 check failed: ${message}`)
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
  const report = yield* Effect.promise(() => sail(browser, url))
  yield* Effect.log(report)
}).pipe(Effect.scoped, Effect.provide(Server.layer({ port: 0 })), BunRuntime.runMain)
