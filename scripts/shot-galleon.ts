import { chromium } from "playwright"

const cameras = ["ref-01", "ref-02", "side", "bow", "stern", "top", "guns", "rig", "rig-bow"] as const
// Sail levels and liveries: the rig animates to a new level in about two seconds.
const rigShots = [["rig", "sail=1", "sail-1"], ["rig", "sail=0", "sail-0"], ["rig-bow", "livery=navy-lion", "navy-lion"], ["rig-bow", "livery=navy-fleur", "navy-fleur"], ["rig-bow", "livery=ffa-1", "ffa"]] as const
const lodShots = [["lod-mid", "near"], ["lod-mid", "mid"], ["lod-far", "mid"], ["lod-far", "far"]] as const

const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop()
  if (port === undefined) throw new Error("probe server has no port")
  return port
}

const only = process.argv[2]
const port = await freePort()
const vite = Bun.spawn(["bun", "x", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--logLevel", "warn"], {
  stdio: ["ignore", "inherit", "inherit"],
})
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
try {
  const url = `http://127.0.0.1:${port}/lab.html`
  for (let tries = 0; ; tries++) {
    const ok = await fetch(url).then((r) => r.ok, () => false)
    if (ok) break
    if (tries > 200) throw new Error("vite did not start")
    await Bun.sleep(50)
  }
  const ready = { timeout: 60_000 }
  if (only !== "fleet") {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    page.on("pageerror", (error) => console.error("page error:", error.message))
    page.on("console", (message) => {
      if (message.type() === "error") throw new Error(`lab console error: ${message.text().slice(0, 400)}`)
    })
    await page.goto(`${url}?ship=galleon&camera=ref-01`)
    await page.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
    const stats = await page.evaluate(() => (["near", "mid", "far"] as const).map((detail) => ({ detail, ...window.brickLab?.stats(detail), rig: window.brickLab?.rigStats(detail) })))
    console.log(JSON.stringify({ stats, buildMs: await page.evaluate(() => window.brickLab?.buildMs) }))
    for (const camera of cameras) {
      await page.evaluate((name) => window.brickLab?.setCamera(name), camera)
      await page.waitForTimeout(400)
      await page.screenshot({ path: `.shots/galleon-${camera}.png` })
      console.log(`saved .shots/galleon-${camera}.png`)
    }
    await page.close()
    for (const [camera, query, name] of rigShots) {
      const shot = await browser.newPage({ viewport: { width: 1600, height: 900 } })
      await shot.goto(`${url}?ship=galleon&camera=${camera}&${query}`)
      await shot.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
      await shot.waitForTimeout(2500)
      await shot.screenshot({ path: `.shots/galleon-${name}.png` })
      console.log(`saved .shots/galleon-${name}.png`)
      await shot.close()
    }
    for (const [camera, detail] of lodShots) {
      const lod = await browser.newPage({ viewport: { width: 1600, height: 900 } })
      await lod.goto(`${url}?ship=galleon&camera=${camera}&detail=${detail}`)
      await lod.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
      await lod.waitForTimeout(400)
      await lod.screenshot({ path: `.shots/galleon-${camera}-${detail}.png` })
      console.log(`saved .shots/galleon-${camera}-${detail}.png`)
      await lod.close()
    }
  }
  // Joel's MacBook: 1728×1117 CSS px at DPR 2; the renderer caps itself at DPR 1.5.
  for (const variant of only === "shots" ? [] : ["fleet=12", "fleet=12&detail=near", "fleet=12&shadows=0", "fleet=1"]) {
    const fleet = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
    fleet.on("pageerror", (error) => console.error("page error:", error.message))
    await fleet.goto(`${url}?ship=galleon&camera=fleet&dpr=1.5&${variant}`)
    await fleet.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
    await fleet.waitForTimeout(1000)
    if (variant === "fleet=12") {
      await fleet.screenshot({ path: ".shots/galleon-fleet.png" })
      console.log("saved .shots/galleon-fleet.png")
      const ships = await fleet.evaluate(() => window.brickLab?.fleet() ?? [])
      console.log(JSON.stringify(ships.map((s) => `${Math.round(s.distance)}m ${s.detail} ${(s.triangles / 1000).toFixed(0)}k/${s.draws}`)))
      console.log(JSON.stringify({ triangles: ships.reduce((n, s) => n + s.triangles, 0), draws: ships.reduce((n, s) => n + s.draws, 0) }))
    }
    await fleet.evaluate(() => window.brickLab?.measure(30))
    const timing = await fleet.evaluate(() => window.brickLab?.measure(120))
    console.log(JSON.stringify({ variant, dpr: 1.5, ...timing }))
    await fleet.close()
  }
} finally {
  await browser.close()
  vite.kill()
  await vite.exited
}
