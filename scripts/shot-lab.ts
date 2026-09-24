import { chromium } from "playwright"

const cameras = ["sampler", "parts", "details", "ref-01", "ref-02"] as const

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on("pageerror", (error) => console.error("page error:", error.message))
  await page.goto(`${url}?camera=sampler&${process.argv[2] ?? ""}`)
  await page.waitForFunction(() => window.brickLab?.ready === true, undefined, { timeout: 60_000 })
  for (const camera of cameras) {
    await page.evaluate((name) => window.brickLab?.setCamera(name), camera)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `.shots/lab-${camera}.png` })
    console.log(`saved .shots/lab-${camera}.png`)
  }

  // Swap-remove check: removing parts must shrink the counts while every InstancedMesh stays the same object.
  const check = await page.evaluate(() => {
    const lab = window.brickLab
    if (lab === undefined) throw new Error("no window.brickLab")
    const before = { stats: lab.stats(), meshes: lab.meshIds() }
    const indices = Array.from({ length: before.stats.parts }, (_, i) => i).filter((i) => (i * 7919) % 5 === 0)
    const result = lab.remove(indices)
    const again = lab.remove(indices)
    const after = { stats: lab.stats(), meshes: lab.meshIds() }
    return { shapes: lab.shapeCount, buildMs: lab.buildMs, before: before.stats, after: after.stats, removed: result.removed, removeMs: result.ms, removedTwice: again.removed, sameMeshes: JSON.stringify(before.meshes) === JSON.stringify(after.meshes) }
  })
  console.log(JSON.stringify(check))
  await page.evaluate(() => window.brickLab?.setCamera("sampler"))
  await page.waitForTimeout(400)
  await page.screenshot({ path: ".shots/lab-removed.png" })
  console.log("saved .shots/lab-removed.png")
  const ok = check.sameMeshes && check.removedTwice === 0 && check.after.parts === check.before.parts - check.removed && check.after.triangles < check.before.triangles
  if (!ok) throw new Error("swap-remove check failed")
  console.log("swap-remove check passed")
} finally {
  await browser.close()
  vite.kill()
  await vite.exited
}
