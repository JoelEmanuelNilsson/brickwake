import { type Browser, chromium } from "playwright"

// Lab damage proof: the galleon at 100, 60 and 20 % HP from a seeded broadside spread, per-hit costs, and frame times with hits.
const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop()
  if (port === undefined) throw new Error("probe server has no port")
  return port
}

const seed = 7
const allViews = [["damage", ""], ["lod-far", "&detail=far"]] as const
const only = process.argv[2]
const views = allViews.filter(([camera]) => only === undefined || only === camera)
const port = await freePort()
const vite = Bun.spawn(["bun", "x", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--logLevel", "warn"], { stdio: ["ignore", "inherit", "inherit"] })
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
try {
  const url = `http://127.0.0.1:${port}/lab.html`
  for (let tries = 0; !(await fetch(url).then((r) => r.ok, () => false)); tries++) {
    if (tries > 200) throw new Error("vite did not start")
    await Bun.sleep(50)
  }
  for (const [camera, extra] of views) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    page.on("pageerror", (error) => console.error("page error:", error.message))
    await page.goto(`${url}?ship=galleon&camera=${camera}${extra}`)
    await page.waitForFunction(() => window.brickLab?.ready === true, undefined, { timeout: 60_000 })
    for (const hp of [100, 60, 20]) {
      const volley = await page.evaluate(([to, s]) => window.brickLab?.volley(to, s), [hp, seed + hp] as const)
      const stats = await page.evaluate(() => window.brickLab?.stats())
      if (camera === "damage") console.log(JSON.stringify({ hp: await page.evaluate(() => window.brickLab?.hp), volley, stats }))
      // Let the debris fall clear so the shot shows the holes.
      await page.waitForTimeout(hp === 100 ? 400 : 4500)
      const path = `.shots/damage-${camera}-hp${hp}.png`
      await page.screenshot({ path })
      console.log(`saved ${path}`)
    }
    await page.close()
  }
  // Frame times at DPR 1.5 on an intact ship, and of the frame each fresh hit lands in against a quiet one.
  if (only === undefined) await measureHits(browser, url)
} finally {
  await browser.close()
  vite.kill()
  await vite.exited
}

async function measureHits(browser: Browser, url: string) {
  const timing = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
  await timing.goto(`${url}?ship=galleon&camera=damage&dpr=1.5`)
  await timing.waitForFunction(() => window.brickLab?.ready === true, undefined, { timeout: 60_000 })
  await timing.evaluate(() => window.brickLab?.measure(30))
  const intact = await timing.evaluate(() => window.brickLab?.measure(60))
  // One frame waited on after the live loop, with and without a hit landing first: the difference is the hit's cost.
  const frameAfter = (fire: boolean, s: number) =>
    timing.evaluate(([f, seed]) => {
      const lab = window.brickLab
      if (lab === undefined) return 0
      const start = performance.now()
      if (f === 1) lab.volley(lab.hp - 0.5, seed)
      return performance.now() - start + lab.measure(1).median
    }, [fire ? 1 : 0, s] as const)
  const quiet: Array<number> = []
  const hit: Array<number> = []
  for (let i = 0; i < 20; i++) {
    quiet.push(await frameAfter(false, 0))
    hit.push(await frameAfter(true, 100 + i))
  }
  const damaged = await timing.evaluate(() => window.brickLab?.measure(60))
  const summary = (values: Array<number>) => {
    const sorted = values.toSorted((a, b) => a - b)
    return { median: sorted[sorted.length >> 1], max: sorted[sorted.length - 1] }
  }
  console.log(JSON.stringify({ intact, damaged, quietFrame: summary(quiet), hitFrame: summary(hit) }))
}
