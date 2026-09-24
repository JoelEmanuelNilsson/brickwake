import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const helloRoute = HttpRouter.add(
  "GET",
  "/ws",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade
    yield* Effect.gen(function* () {
      const writer = yield* socket.writer
      yield* writer.write("hello")
      const { pull } = yield* socket.reader
      // Hold the connection open until the client closes it; client frames are ignored for now.
      while (true) yield* pull
    }).pipe(
      Effect.scoped,
      Effect.catchTag("SocketError", () => Effect.void),
    )
    return HttpServerResponse.empty()
  }),
)

/** The game server on 127.0.0.1:`port` (0 picks a free port); exposes `HttpServer` for its address. */
export const layer = (options: { readonly port: number }) =>
  // The request logger reports every normal WebSocket close as an interrupted request.
  HttpRouter.serve(helloRoute, { disableLogger: true }).pipe(
    // A graceful stop waits on open WebSocket handlers until the timeout, so Ctrl-C would hang; there is no HTTP work to drain.
    Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: options.port, gracefulShutdownTimeout: 0 })),
  )
