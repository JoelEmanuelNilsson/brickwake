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

/** Opens a page in the named duel room and sets sail; the first page takes the first duel ship. */
const joinDuel = async (browser: Browser, url: string, room: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${url}?scenario=duel&room=${room}`)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ownShip() !== null, undefined, { timeout: 15_000 })
  await page.mouse.click(640, 360)
  return page
}

/** Plays C6's damage half: A holes the dummy, a late joiner crews the dummy and draws both ships with the same parts gone, before and after a new hit. */
const wreck = async (browser: Browser, url: string) => {
  const room = `c6-${Date.now()}`
  const join = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`${url}?scenario=target-dummy&room=${room}`)
    await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length === 2, undefined, { timeout: 15_000 })
    await page.mouse.click(640, 360)
    return page
  }
  const volley = async (page: Page) => {
    await page.waitForFunction(() => window.brickwake?.aim()?.reloadLeft === 0, undefined, { timeout: 8000 })
    const dummy = await shipById(page, "dummy")
    const outcome = await page.evaluate((p) => window.brickwake?.fireAt(p), [dummy.position[0], 0, dummy.position[2]] as const)
    check(outcome === "fired", `A fires at the dummy (${outcome})`)
    await page.waitForTimeout(3500)
  }
  const ids = ["player", "dummy"] as const
  const wrecksOf = (page: Page) => page.evaluate((ids) => ids.map((id) => window.brickwake?.wreck(id) ?? null), [...ids])

  const a = await join()
  check((await hook(a, (h) => h.shipId)) === "player", "A crews the player ship")
  const own = await ownShip(a)
  await volley(a)
  const holed = await wrecksOf(a)
  const dummyHp = (await shipById(a, "dummy")).hp
  check((holed[1]?.gone.length ?? 0) > 20, `A draws the dummy holed (${holed[1]?.gone.length} parts gone, HP ${dummyHp})`)

  const late = await join()
  check((await hook(late, (h) => h.shipId)) === "dummy", "the late joiner crews the dummy")
  await late.waitForTimeout(800)
  const joined = await wrecksOf(late)
  check(JSON.stringify(joined) === JSON.stringify(await wrecksOf(a)), `the late joiner draws the same parts gone on both ships (${joined.map((w) => w?.gone.length).join(", ")})`)
  const lateView = await ownShip(late)
  await late.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.22, 26), bearing(own.position, lateView.position) + 0.35)
  await late.waitForTimeout(1200)
  await late.screenshot({ path: ".shots/c6-late-joiner.png" })

  await volley(a)
  const [afterA, afterLate] = [await wrecksOf(a), await wrecksOf(late)]
  check((afterA[1]?.gone.length ?? 0) > (holed[1]?.gone.length ?? 0), `A's next volley breaks more (${afterA[1]?.gone.length} parts gone)`)
  check(JSON.stringify(afterA) === JSON.stringify(afterLate), "both clients still agree after a hit the late joiner saw live")
  // Let the splashes and smoke of the hit clear so the holes show.
  await late.waitForTimeout(3000)
  await late.screenshot({ path: ".shots/c6-late-joiner-after.png" })
  const drawn = afterA.map((w) => w?.drawnParts)
  await Promise.all([a.close(), late.close()])
  return [
    `dummy: ${holed[1]?.gone.length} parts gone after 1 volley (HP ${dummyHp}), ${afterA[1]?.gone.length} after 2; parts left on the meshes ${drawn.join(", ")}`,
    "late joiner agrees on both ships at join and after a live hit",
    "saved .shots/c6-{late-joiner,late-joiner-after}.png",
  ].join("\n")
}

const matchOf = async (page: Page) => {
  const match = await hook(page, (h) => h.match())
  if (match === null) throw new Error("the client shows no match")
  return match
}

/** Plays C3 in two browsers: A sinks B, B founders by bow or stern and respawns, the short match ends with results and restarts. */
const match = async (browser: Browser, url: string) => {
  const room = `c3-${Date.now()}`
  const a = await joinDuel(browser, url, room)
  const b = await joinDuel(browser, url, room)
  const [idA, idB] = [await hook(a, (h) => h.shipId), await hook(b, (h) => h.shipId)]
  check(idA === "duel-a" && idB === "duel-b", `the two browsers share one duel room (${idA}, ${idB})`)
  check(await waitFor(a, (h) => h.ships().length === 2, 3000), "A sees both ships")
  const opening = await matchOf(a)
  check(opening.phase._tag === "playing" && opening.hud.clock !== "", `the match is on with a clock (${opening.phase._tag} ${opening.hud.clock})`)
  await a.screenshot({ path: ".shots/c3-hud.png" })

  const ownA = await ownShip(a)
  const target = await shipById(a, "duel-b")
  const range = Math.hypot(target.position[0] - ownA.position[0], target.position[2] - ownA.position[2])
  let volleys = 0
  let sank = false
  let hitShot = false
  while (!sank && volleys < 4) {
    await a.waitForFunction(() => (window.brickwake?.aim()?.reloadLeft ?? 1) === 0 || window.brickwake?.aim()?.state === "ready", undefined, { timeout: 8000 })
    await aimAtRange(a, bearing(ownA.position, target.position), range)
    check((await hook(a, (h) => h.fire())) === "fired", `A's broadside ${volleys + 1} fires`)
    volleys++
    // B looks away from A so the hit-direction arc has to point behind the view.
    await b.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.15), bearing(target.position, ownA.position) + 2.2)
    const hpBefore = (await ownShip(b)).hp
    const hit = await b.waitForFunction((before) => (window.brickwake?.ownShip()?.hp ?? 100) < before, hpBefore, { timeout: 4000 }).then(
      () => true,
      () => false,
    )
    if (hit) {
      if (!hitShot) {
        await b.waitForTimeout(150)
        await b.screenshot({ path: ".shots/c3-hit-direction.png" })
        hitShot = true
      }
    }
    sank = await waitFor(b, (h) => h.ownShip()?.life !== "afloat", 2500)
  }
  check(sank, `A sinks B (${volleys} broadsides)`)
  const sunkEvent = await hook(a, (h) => h.events().find((e) => e._tag === "shipSunk"))
  check(sunkEvent?._tag === "shipSunk" && sunkEvent.shipId === "duel-b" && sunkEvent.by === "duel-a", `the sink is B's, by A (${JSON.stringify(sunkEvent)})`)

  // B's captain watches from off the beam as the chase camera holds at the surface; A sees it go from 150 m.
  const wreck = await ownShip(b)
  await b.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.1, 42), wreck.heading + Math.PI / 2 + 0.25)
  await a.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.05, 30), bearing(ownA.position, wreck.position) + 0.3)
  const pitches: Array<number> = []
  for (const [i, wait] of [300, 900, 900, 900].entries()) {
    await b.waitForTimeout(wait)
    const ship = await shipOrNull(b, "duel-b")
    if (ship !== null) pitches.push(ship.pitch)
    await b.screenshot({ path: `.shots/c3-sinking-${i + 1}.png` })
    if (i === 2) await a.screenshot({ path: ".shots/c3-sinking-far.png" })
  }
  const settle = Math.max(...pitches.map(Math.abs)) * degrees
  check(settle > 12, `B settles by the bow or stern as it sinks (${settle.toFixed(1)}°)`)
  const bView = await matchOf(b)
  await b.screenshot({ path: ".shots/c3-sunk-b.png" })
  check(bView.hud.banner.includes("Back on the water in"), `B sees its respawn countdown ("${bView.hud.banner}")`)
  const aView = await matchOf(a)
  check(aView.hud.feed.some((line) => line.includes("☠")), `A's kill feed shows the sink (${JSON.stringify(aView.hud.feed)})`)
  check((await ownShip(a)).kills === 1 && aView.hud.standing.startsWith("1 sink"), `A scores the sink ("${aView.hud.standing}")`)
  await a.screenshot({ path: ".shots/c3-kill-feed.png" })

  check(await waitFor(b, (h) => h.ownShip()?.life === "afloat" && (h.ownShip()?.spawn ?? 0) >= 2, 12_000), "B respawns")
  const reborn = await ownShip(b)
  check(reborn.hp === 100 && Math.abs(Math.hypot(reborn.position[0], reborn.position[2]) - 260) < 5, `B is back at full HP on the spawn ring (${reborn.hp} HP)`)
  await b.screenshot({ path: ".shots/c3-respawn-b.png" })

  await a.keyboard.down("Tab")
  await a.waitForTimeout(300)
  const board = await matchOf(a)
  await a.screenshot({ path: ".shots/c3-scoreboard.png" })
  await a.keyboard.up("Tab")
  check(board.hud.scoreboard?.rows === 2, `Tab shows the scoreboard (${JSON.stringify(board.hud.scoreboard)})`)

  const endsIn = opening.phase._tag === "playing" ? opening.phase.endsAt - opening.renderTime : 30
  check(await waitFor(a, (h) => h.match()?.phase._tag === "ended", (endsIn + 5) * 1000), "the short-timer match ends")
  await a.waitForTimeout(600)
  const [endA, endB] = [await matchOf(a), await matchOf(b)]
  check(endA.hud.scoreboard?.verdict === "Victory" && endB.hud.scoreboard?.verdict === "Defeat", `results: A ${endA.hud.scoreboard?.verdict}, B ${endB.hud.scoreboard?.verdict}`)
  await a.screenshot({ path: ".shots/c3-results-a.png" })
  await b.screenshot({ path: ".shots/c3-results-b.png" })
  const reload = await hook(a, (h) => h.fire())
  check(reload !== "fired", `the guns are silent after the match (${reload})`)

  check(await waitFor(a, (h) => h.match()?.phase._tag === "playing", 10_000), "the match restarts")
  await a.waitForTimeout(400)
  const [restartA, restartB] = [await ownShip(a), await ownShip(b)]
  const restarted = await matchOf(a)
  check(restartA.kills === 0 && restartB.deaths === 0 && restartA.spawn >= 2, `scores reset and ships respawn at the restart (A spawn ${restartA.spawn})`)
  check(restarted.hud.scoreboard === null, "the results close when the next match begins")
  await a.screenshot({ path: ".shots/c3-restart.png" })
  const frames = await hook(a, (h) => h.frames())
  await Promise.all([a.close(), b.close()])

  // Quick play opens in warmup.
  const quick = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await quick.goto(url)
  await quick.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ownShip() !== null, undefined, { timeout: 15_000 })
  await quick.mouse.click(640, 360)
  await quick.waitForTimeout(500)
  const warmup = await matchOf(quick)
  check(warmup.phase._tag === "warmup" && warmup.hud.phase === "Warmup", `quick play starts in warmup (${warmup.phase._tag})`)
  await quick.screenshot({ path: ".shots/c3-warmup.png" })
  await quick.close()

  return [
    `A sank B with ${volleys} broadside(s); B settled ${settle.toFixed(1)}° by the ${sunkEvent?._tag === "shipSunk" ? "struck end" : "?"}`,
    `results: A ${endA.hud.scoreboard?.verdict}, B ${endB.hud.scoreboard?.verdict}; restart A spawn ${restartA.spawn}`,
    `frames (duel): cpu ${frames.cpuMs.toFixed(2)} ms, gpu ${frames.gpuMs.toFixed(2)} ms, interval ${frames.intervalMs.toFixed(2)} ms`,
    "saved .shots/c3-{hud,hit-direction,sinking-1..4,sinking-far,sunk-b,kill-feed,respawn-b,scoreboard,results-a,results-b,restart,warmup}.png",
  ].join("\n")
}

/** Plays C4 as a human joining quick play: bots fill the room to six, sail on the wind and fight each other with led broadsides. */
const bots = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(url)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length >= 6, undefined, { timeout: 15_000 })
  await page.mouse.click(640, 360)
  const ownId = await hook(page, (h) => h.shipId)
  const start = (await hook(page, (h) => h.ships())).filter((s) => s.id.startsWith("bot-"))
  check(start.length === 5, `five bots fill the room around one human (${start.map((s) => s.id).join(", ")})`)
  await page.screenshot({ path: ".shots/c4-join.png" })

  check(await waitFor(page, (h) => h.match()?.phase._tag === "playing", 15_000), "warmup gives way to play")
  const shooters = new Set<string>()
  let hits = 0
  let shots = 0
  const seen = new Set<string>()
  const started = Date.now()
  while (Date.now() - started < 45_000 && (shooters.size < 3 || hits < 3)) {
    const events = await hook(page, (h) => h.events())
    for (const event of events) {
      const key = JSON.stringify(event)
      if (seen.has(key)) continue
      seen.add(key)
      if (event._tag === "cannonFired" && event.shooter.startsWith("bot-")) shooters.add(event.shooter)
      if (event._tag === "ballHit" && event.shooter.startsWith("bot-")) hits++
      // Frame the first few bot broadsides from beside the human's ship, looking at the shooter.
      if (event._tag === "cannonFired" && event.gun === 0 && event.shooter.startsWith("bot-") && shots < 3) {
        const own = await ownShip(page)
        const shooter = await shipOrNull(page, event.shooter)
        if (shooter === null) continue
        const range = Math.hypot(shooter.position[0] - own.position[0], shooter.position[2] - own.position[2])
        await page.evaluate(([yaw, distance]) => window.brickwake?.orbit(yaw, 0.12, distance), [bearing(own.position, shooter.position) + Math.PI, Math.min(range * 0.6, 160)] as const)
        await page.waitForTimeout(700)
        await page.screenshot({ path: `.shots/c4-fight-${++shots}.png` })
      }
    }
    await page.waitForTimeout(150)
  }
  check(shooters.size >= 3, `bots fire broadsides (${[...shooters].join(", ")})`)
  check(hits >= 3, `bot broadsides hit (${hits} hits seen)`)

  const now = (await hook(page, (h) => h.ships())).filter((s) => s.id.startsWith("bot-"))
  const moved = now.flatMap((s) => {
    const before = start.find((b) => b.id === s.id)
    return before ? [Math.hypot(s.position[0] - before.position[0], s.position[2] - before.position[2])] : []
  })
  check(moved.filter((m) => m > 100).length >= 4, `bots sail about (moved ${moved.map((m) => m.toFixed(0)).join(", ")} m)`)
  await page.keyboard.down("Tab")
  await page.waitForTimeout(300)
  await page.screenshot({ path: ".shots/c4-scoreboard.png" })
  const board = await matchOf(page)
  await page.keyboard.up("Tab")
  await page.close()
  return [
    `own ship ${ownId}; bots ${start.map((s) => s.id).join(", ")}`,
    `${shooters.size} bots fired, ${hits} bot hits seen; bots moved ${moved.map((m) => m.toFixed(0)).join(", ")} m`,
    `scoreboard ${JSON.stringify(board.hud.scoreboard)}`,
    "saved .shots/c4-{join,fight-1..3,scoreboard}.png",
  ].join("\n")
}

/**
 * Plays C5 at Joel's display size (DPR capped to 1.5): the galleon in a full 12-ship bot match under the sunset sky,
 * screenshots for ref-01, and frame times measured back to back while the bots close in and fight.
 */
const scene = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
  await page.goto(`${url}?scenario=armada&orbit=140`)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length >= 12, undefined, { timeout: 20_000 })
  await page.mouse.click(864, 558)
  await page.keyboard.press("KeyW")
  await page.keyboard.press("KeyW")
  await page.waitForTimeout(6000)
  // ref-01's camera: low off the starboard quarter, looking forward past the stern with the sun ahead to starboard.
  const heading = (await ownShip(page)).heading
  await page.evaluate((heading) => window.brickwake?.orbit(heading + 0.3, 0.07, 30), heading)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: ".shots/c5-ref-01.png" })
  await page.evaluate((heading) => window.brickwake?.orbit(heading - 0.4, 0.32, 75), heading)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: ".shots/c5-wake.png" })

  const measures: Array<Awaited<ReturnType<BrickwakeDebug["measure"]>>> = []
  const started = Date.now()
  let fights = 0
  const seen = new Set<string>()
  while (Date.now() - started < 60_000) {
    const views = [[0.4, 0.12, 40], [2.8, 0.12, 40], [-1.9, 0.2, 60], [1.2, 0.1, 30]] as const
    const [yaw, pitch, distance] = views[measures.length % views.length]!
    await page.evaluate(([yaw, pitch, distance]) => window.brickwake?.orbit(yaw, pitch, distance), [yaw, pitch, distance] as const)
    await page.waitForTimeout(400)
    measures.push(await hook(page, (h) => h.measure(60)))
    for (const event of await hook(page, (h) => h.events())) {
      const key = JSON.stringify(event)
      if (seen.has(key)) continue
      seen.add(key)
      if (event._tag === "cannonFired" && event.gun === 0) fights++
    }
    if (fights >= 3 && measures.length >= 16) break
  }
  const shooting = await hook(page, (h) => h.events().filter((e) => e._tag === "cannonFired").length)
  if (shooting > 0) await page.screenshot({ path: ".shots/c5-battle.png" })
  await page.close()

  const sorted = (values: ReadonlyArray<number>) => [...values].sort((a, b) => a - b)
  const middle = (values: ReadonlyArray<number>) => sorted(values)[Math.floor(values.length / 2)] ?? Number.NaN
  const pipelined = measures.map((m) => m.pipelined)
  const worstPipelined = Math.max(...pipelined)
  const worst = Math.max(...measures.map((m) => m.worst))
  const heavy = measures.reduce((a, b) => (b.pipelined > a.pipelined ? b : a))
  // Pipelined frames overlap CPU and GPU as the browser's loop does: that is the frame rate. A frame waited on alone bounds the slowest one.
  check(worstPipelined <= 1000 / 120, `12 ships render at 120 fps (slowest run ${worstPipelined.toFixed(2)} ms a frame)`)
  check(worst <= 1000 / 60, `no frame drops below 60 fps (worst frame waited on alone ${worst.toFixed(2)} ms)`)
  return [
    `frames at ${heavy.width}×${heavy.height}, ${measures.length} runs of 60 over a 12-ship bot match: pipelined median ${middle(pipelined).toFixed(2)} ms, slowest run ${worstPipelined.toFixed(2)} ms; each frame waited on alone: median ${middle(measures.map((m) => m.median)).toFixed(2)} ms, worst p90 ${Math.max(...measures.map((m) => m.p90)).toFixed(2)} ms, worst ${worst.toFixed(2)} ms`,
    `slowest run: ${heavy.draws} draws, ${(heavy.triangles / 1e6).toFixed(2)}M tris, detail ${JSON.stringify(heavy.detail)}; ${fights} broadsides seen`,
    "saved .shots/c5-{ref-01,wake,battle}.png",
  ].join("\n")
}

/**
 * Plays C8: the title screen with its mode choice, one click into Pirates vs Navy quick play with balanced bot sides,
 * team HUD and scoreboard, the three team liveries at ref-01's camera, and a TDM skirmish won to the results screen.
 */
const tdm = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url)
  await page.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length >= 6, undefined, { timeout: 15_000 })
  await page.waitForTimeout(800)
  check(await page.locator("#overlay .menu-mode").count() === 2, "the title screen offers two modes")
  check((await matchOf(page)).rules.mode === "ffa", "the title screen's world is FFA quick play until a mode is chosen")
  await page.screenshot({ path: ".shots/c8-menu.png" })

  await page.locator('#overlay .menu-mode[data-mode="tdm"]').click()
  check(await hook(page, (h) => h.sailing), "one click on Pirates vs Navy sets sail")
  check(
    await waitFor(page, (h) => h.match()?.rules.mode === "tdm" && h.ships().length >= 6 && h.ships().every((s) => s.team !== null && s.livery !== null), 8000),
    "the click moves the captain into a TDM room",
  )
  const ships = await hook(page, (h) => h.ships())
  const own = await ownShip(page)
  const pirates = ships.filter((s) => s.team === "pirates")
  const navy = ships.filter((s) => s.team === "navy")
  check(pirates.length === navy.length, `sides are balanced (${pirates.length} pirates, ${navy.length} navy)`)
  check(pirates.every((s) => s.livery === "pirate") && navy.every((s) => s.livery?.startsWith("navy-")), "pirates fly black, navy the Crown's sails")
  check((await page.evaluate(() => localStorage.getItem("brickwake.mode"))) === "tdm", "the title screen remembers the mode")
  await page.waitForFunction(() => window.brickwake?.match()?.phase._tag === "playing", undefined, { timeout: 15_000 })
  await page.waitForTimeout(2500)
  const hud = (await matchOf(page)).hud
  check(hud.teams !== "" && hud.phase.startsWith("First side to"), `the clock shows side scores (${hud.teams}, ${hud.phase})`)
  await page.evaluate((heading) => window.brickwake?.orbit(heading + 0.3, 0.12, 40), own.heading)
  await page.waitForTimeout(400)
  await page.screenshot({ path: ".shots/c8-tdm-hud.png" })
  await page.keyboard.down("Tab")
  await page.waitForTimeout(400)
  const board = (await matchOf(page)).hud.scoreboard
  check(board !== null && board.rows === ships.length && board.title.startsWith("Pirates vs Navy"), `Tab shows both sides (${JSON.stringify(board)})`)
  await page.screenshot({ path: ".shots/c8-tdm-scoreboard.png" })
  await page.keyboard.up("Tab")
  await page.close()

  // The team liveries at ref-01's camera, in the c5 scene: low off the starboard quarter, looking forward past the stern with the sun ahead to starboard.
  const fleet = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
  await fleet.goto(`${url}?scenario=armada&orbit=140`)
  await fleet.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length >= 12, undefined, { timeout: 20_000 })
  await fleet.mouse.click(864, 558)
  await fleet.keyboard.press("KeyW")
  await fleet.keyboard.press("KeyW")
  await fleet.waitForTimeout(6000)
  const heading = (await ownShip(fleet)).heading
  for (const livery of ["pirate", "navy-lion", "navy-fleur"] as const) {
    await fleet.evaluate((livery) => window.brickwake?.paintOwn(livery), livery)
    await fleet.evaluate((heading) => window.brickwake?.orbit(heading + 0.3, 0.07, 30), heading)
    await fleet.waitForTimeout(1200)
    await fleet.screenshot({ path: `.shots/c8-sails-${livery}.png` })
    await fleet.evaluate((heading) => window.brickwake?.orbit(heading + Math.PI + 0.6, 0.1, 42), heading)
    await fleet.waitForTimeout(1200)
    await fleet.screenshot({ path: `.shots/c8-sails-${livery}-bow.png` })
  }
  await fleet.close()

  const skirmish = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await skirmish.goto(`${url}?scenario=skirmish`)
  await skirmish.waitForFunction(() => window.brickwake?.joined === true && window.brickwake.ships().length >= 6, undefined, { timeout: 15_000 })
  check(await skirmish.locator("#overlay .menu-modes").isHidden(), "scenario pages hide the mode choice")
  await skirmish.mouse.click(720, 450)
  check(await hook(skirmish, (h) => h.sailing), "a click anywhere on the title screen sets sail")

  const player = await ownShip(skirmish)
  const dummy = await shipById(skirmish, "dummy")
  let volleys = 0
  while ((await matchOf(skirmish)).phase._tag !== "ended" && volleys < 4) {
    await skirmish.waitForFunction(() => (window.brickwake?.aim()?.reloadLeft ?? 1) === 0, undefined, { timeout: 8000 })
    const [self, target] = [await ownShip(skirmish), await shipById(skirmish, "dummy")]
    await aimAtRange(skirmish, bearing(self.position, target.position), Math.hypot(target.position[0] - self.position[0], target.position[2] - self.position[2]))
    const outcome = await hook(skirmish, (h) => h.fire())
    check(outcome === "fired", `broadside ${volleys + 1} at the dummy fires (${outcome})`)
    volleys++
    await waitFor(skirmish, (h) => h.match()?.phase._tag === "ended", 4000)
  }
  const ended = await matchOf(skirmish)
  check(ended.phase._tag === "ended" && ended.phase.winner?._tag === "team", `the skirmish ends with a side winning (${JSON.stringify(ended.phase)})`)
  const winner = ended.phase._tag === "ended" && ended.phase.winner?._tag === "team" ? ended.phase.winner.team : null
  await skirmish.waitForTimeout(700)
  const results = (await matchOf(skirmish)).hud.scoreboard
  const expected = winner === player.team ? "Victory" : "Defeat"
  check(results?.verdict === expected, `the results read ${expected} for the ${player.team} (${results?.verdict}; ${results?.foot})`)
  check(ended.teamSinks.pirates + ended.teamSinks.navy === 1, `one sink ends a skirmish to 1 (${JSON.stringify(ended.teamSinks)})`)
  const stats = await ownShip(skirmish)
  await skirmish.evaluate((yaw) => window.brickwake?.orbit(yaw, 0.1, 40), player.heading + 2)
  await skirmish.waitForTimeout(500)
  await skirmish.screenshot({ path: ".shots/c8-results.png" })
  await skirmish.close()
  return [
    `menu → TDM in one click: ${pirates.length} pirates vs ${navy.length} navy; own ${own.team}; HUD ${hud.teams}`,
    `skirmish: ${volleys} broadside(s) at the dummy ${Math.round(Math.hypot(dummy.position[0] - player.position[0], dummy.position[2] - player.position[2]))} m off; ${winner} won; results "${results?.verdict}" · ${results?.foot}`,
    `own stats: ${stats.kills} sinks, ${stats.hits}/${stats.shots} hits, ${stats.damage} damage`,
    "saved .shots/c8-{menu,tdm-hud,tdm-scoreboard,sails-{pirate,navy-lion,navy-fleur}{,-bow},results}.png",
  ].join("\n")
}

const shipOrNull = (page: Page, id: string) => page.evaluate((id) => window.brickwake?.ships().find((s) => s.id === id) ?? null, id)

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
  const checks = { c1: sail, c2: gunnery, c3: match, c4: bots, c5: scene, c6: wreck, c8: tdm }
  const wanted = process.argv.slice(2)
  for (const [name, run] of Object.entries(checks)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue
    const report = yield* Effect.promise(() => run(browser, url))
    yield* Effect.log(`${name}\n${report}`)
  }
}).pipe(Effect.scoped, Effect.provide(Server.layer({ port: 0 })), BunRuntime.runMain)
