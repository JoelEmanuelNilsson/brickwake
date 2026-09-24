import { chromium } from "playwright"

const cameras = ["ref-01", "ref-02", "side", "bow", "top"] as const

const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop()
  if (port === undefined) throw new Error("probe server has no port")
  return port
}

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on("pageerror", (error) => console.error("page error:", error.message))
  await page.goto(`${url}?ship=galleon&camera=ref-01`)
  await page.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
  console.log(JSON.stringify({ ship: await page.evaluate(() => window.brickLab?.stats()), buildMs: await page.evaluate(() => window.brickLab?.buildMs) }))
  for (const camera of cameras) {
    await page.evaluate((name) => window.brickLab?.setCamera(name), camera)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `.shots/hull-${camera}.png` })
    console.log(`saved .shots/hull-${camera}.png`)
  }
  await page.close()

  // Joel's MacBook: 1728×1117 CSS px at DPR 2; the renderer caps itself at DPR 1.5.
  for (const variant of ["fleet=12", "fleet=12&bloom=0", "fleet=12&shadows=0", "fleet=1"]) {
    const fleet = await browser.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })
    fleet.on("pageerror", (error) => console.error("page error:", error.message))
    await fleet.goto(`${url}?ship=galleon&camera=fleet&dpr=1.5&${variant}`)
    await fleet.waitForFunction(() => window.brickLab?.ready === true, undefined, ready)
    await fleet.waitForTimeout(1000)
    if (variant === "fleet=12") {
      await fleet.screenshot({ path: ".shots/hull-fleet.png" })
      console.log("saved .shots/hull-fleet.png")
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
