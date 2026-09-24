import { BunRuntime } from "@effect/platform-bun"
import { Config, Effect, Layer } from "effect"
import * as Server from "./server.ts"

Effect.gen(function* () {
  const port = yield* Config.Port("SERVER_PORT").pipe(Config.withDefault(8787))
  return Server.layer({ port })
}).pipe(Layer.unwrap, Layer.launch, BunRuntime.runMain)
