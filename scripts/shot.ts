import { BunRuntime } from "@effect/platform-bun"
import { Effect, Schedule } from "effect"
import { HttpServer } from "effect/unstable/http"
import { chromium } from "playwright"
import * as Server from "../src/server/server.ts"

const shotPath = ".shots/c0.png"

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
    Effect.promise(() => chromium.launch()),
    (browser) => Effect.promise(() => browser.close()),
  )
  yield* Effect.promise(async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(url)
    await page.waitForSelector('#status[data-ws="hello"]', { timeout: 10_000 })
    await page.screenshot({ path: shotPath })
  })
  yield* Effect.log(`saved ${shotPath}`)
}).pipe(Effect.scoped, Effect.provide(Server.layer({ port: 0 })), BunRuntime.runMain)
