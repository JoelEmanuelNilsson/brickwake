import { BunRuntime } from "@effect/platform-bun"
import { Config, Effect, Layer, Schema } from "effect"
import * as Server from "./server.ts"

const delayMs = (name: string) => Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), name).pipe(Config.withDefault(0))

Effect.gen(function* () {
  const port = yield* Config.Port("SERVER_PORT").pipe(Config.withDefault(8787))
  // One-way delay injected each way, e.g. `NET_LATENCY_MS=75 NET_JITTER_MS=20 bun dev`.
  const latencyMs = yield* delayMs("NET_LATENCY_MS")
  const jitterMs = yield* delayMs("NET_JITTER_MS")
  if (latencyMs > 0 || jitterMs > 0) yield* Effect.logInfo(`injecting ${latencyMs} ms + 0…${jitterMs} ms jitter each way`)
  return Server.layer({ port, lag: { latencyMs, jitterMs } })
}).pipe(Layer.unwrap, Layer.launch, BunRuntime.runMain)
