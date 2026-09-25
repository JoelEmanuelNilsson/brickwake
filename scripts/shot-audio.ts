import { chromium } from "playwright"

const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop()
  if (port === undefined) throw new Error("probe server has no port")
  return port
}

const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`)
  if (!ok) process.exitCode = 1
}

const port = await freePort()
const vite = Bun.spawn(["bun", "x", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--logLevel", "warn"], {
  stdio: ["ignore", "inherit", "inherit"],
})
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc", "--enable-precise-memory-info"],
})
try {
  const url = `http://127.0.0.1:${port}/sound.html`
  for (let tries = 0; ; tries++) {
    if (await fetch(url).then((r) => r.ok, () => false)) break
    if (tries > 200) throw new Error("vite did not start")
    await Bun.sleep(50)
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
  page.on("pageerror", (error) => console.error("page error:", error.message))
  page.on("console", (message) => {
    if (message.type() === "error") console.error("console:", message.text())
  })
  await page.goto(url)
  await page.waitForFunction(() => window.soundTest !== undefined, undefined, { timeout: 30_000 })
  await page.screenshot({ path: ".shots/audio-sound-test.png" })
  const started = performance.now()
  const report = (await page.evaluate(() => window.soundTest?.analyse())) as Record<string, Record<string, number> & { events?: unknown; stats?: unknown }>
  console.log(`offline renders took ${((performance.now() - started) / 1000).toFixed(1)} s`)
  for (const [name, value] of Object.entries(report)) console.log(name.padEnd(20), JSON.stringify(value))
  await page.evaluate(() => window.soundTest?.prepareBroadside())
  const timed = await page.evaluate(() => window.soundTest?.fireBroadside())
  await page.evaluate(() => window.soundTest?.prepareBroadside())
  // The sampling heap profiler at 32-byte resolution counts every JS allocation the broadside makes, with its stack.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 32 })
  const fired = await page.evaluate(() => window.soundTest?.fireBroadside())
  const { profile } = await cdp.send("HeapProfiler.stopSampling")
  type Node = (typeof profile)["head"]
  const bytesByFrame = new Map<string, number>()
  let audioBytes = 0
  const walk = (node: Node, inAudio: boolean) => {
    const here = inAudio || node.callFrame.url.includes("/audio/game-audio.ts")
    if (here && node.selfSize > 0) {
      audioBytes += node.selfSize
      const key = `${node.callFrame.functionName || "(anonymous)"}`
      bytesByFrame.set(key, (bytesByFrame.get(key) ?? 0) + node.selfSize)
    }
    for (const child of node.children) walk(child, here)
  }
  walk(profile.head, false)
  const allocation = { ...fired, unprofiled: timed, audioHeapBytes: audioBytes, audioHeapByFunction: Object.fromEntries(bytesByFrame) }
  console.log("broadside".padEnd(20), JSON.stringify(allocation))
  await Bun.write(".shots/audio-report.json", JSON.stringify({ report, allocation }, null, 2))

  const r = report as Record<string, Record<string, number>>
  const near = r.cannon20m!
  const far = r.cannon300m!
  check(near.below150! > 0.5 && near.centroidHz! > 150, `near boom has a low body and a crack (${near.below150} of energy < 150 Hz, centroid ${near.centroidHz} Hz)`)
  check(Math.abs(far.onset! - (0.1 + 300 / 343)) < 0.03, `a boom 300 m off arrives by the speed of sound (onset ${far.onset} s, expected ${(0.1 + 300 / 343).toFixed(3)})`)
  check(far.centroidHz! < near.centroidHz! * 0.7, `distance muffles (centroid ${near.centroidHz} Hz at 20 m, ${far.centroidHz} Hz at 300 m)`)
  check(20 * Math.log10(far.peak! / near.peak!) < -12, `distance quietens (peak ${near.peak} at 20 m, ${far.peak} at 300 m)`)
  check(r.cannon30mLeft!.rightDb! < -6, `a boom to the left sits left (${r.cannon30mLeft!.rightDb} dB right of left)`)
  check(r.broadside40m!.attacks! >= near.attacks! + 6, `a broadside ripples (${r.broadside40m!.attacks} attacks, one gun ${near.attacks})`)
  const whistle = r.whistle8m!
  const closest = report.whistleClosestPass as unknown as number
  check(Math.abs(whistle.loudestAt! - closest) < 0.12, `a near miss whistles loudest as it passes (${whistle.loudestAt} s vs closest pass ${closest} s)`)
  for (const name of ["splash60m", "hullHit40m", "ownHullHit6m", "fuse", "sinking80m", "plunge80m", "bell2"]) check(r[name]!.peak! > 0.01, `${name} is heard (peak ${r[name]!.peak})`)
  check(r.ambienceGale!.rmsDb! > r.ambienceCalm!.rmsDb! + 3, `ambience follows wind, sail and speed (calm ${r.ambienceCalm!.rmsDb} dB, gale ${r.ambienceGale!.rmsDb} dB)`)
  const battle = report.battle as unknown as Record<string, number>
  check(battle.peak! <= 0.98 && battle.over0_95! < 1e-4, `a 12-ship battle does not clip (peak ${battle.peak}, ${(battle.over0_95! * 100).toFixed(4)} % of samples over 0.95)`)
  const a = allocation as unknown as { sourcesCreated: number; buffersCreated: number; unprofiled: { fireMs: number; landMs: number } }
  check(a.buffersCreated === 0, `a 12-ship broadside creates no audio buffers (${a.buffersCreated})`)
  check(a.sourcesCreated <= 144 + 144 * 2, `at most one source node per sound played (${a.sourcesCreated})`)
  const cost = a.unprofiled.fireMs + a.unprofiled.landMs
  check(cost < 2, `144 guns and 144 landings in one frame cost ${cost.toFixed(2)} ms of main thread`)
} finally {
  await browser.close()
  vite.kill()
  await vite.exited
}
