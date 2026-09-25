import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import type { Socket } from "effect/unstable/socket"
import { ClientMessage, ClientMessageJson, ServerMessageJson } from "../protocol/messages.ts"
import { vec3 } from "../sim/vector.ts"
import { makeLink, noLag, type NetworkLag } from "./lag.ts"
import * as Rooms from "./rooms.ts"

const encode = Schema.encodeSync(ServerMessageJson)
const decode = Schema.decodeUnknownEffect(ClientMessageJson)

/** Longest reason text sent back for a rejected message. */
const maxReasonLength = 300

/** One client connection: decodes its frames, keeps its seat, and leaves the room when the socket closes. */
const connection = (socket: Socket.Socket, lag: NetworkLag) =>
  Effect.gen(function* () {
    const rooms = yield* Rooms.Service
    const writer = yield* socket.writer
    const send = yield* makeLink(lag, (text: string) => writer.write(text))
    const reject = (reason: string) => send(encode({ _tag: "rejected", reason: reason.slice(0, maxReasonLength) }))

    let seat: Rooms.Seat | undefined
    yield* Effect.addFinalizer(() => Effect.suspend(() => seat?.leave ?? Effect.void))

    const act = (message: ClientMessage) =>
      ClientMessage.match(message, {
        join: ({ _tag, ...request }) =>
          seat
            ? reject("already in a room; leave first")
            : rooms.join(request, send).pipe(
                Effect.tap((joined) => Effect.sync(() => (seat = joined))),
                Effect.uninterruptible,
              ),
        leave: () =>
          seat
            ? seat.leave.pipe(
                Effect.tap(() => Effect.sync(() => (seat = undefined))),
                Effect.uninterruptible,
              )
            : reject("not in a room"),
        setHelm: ({ rudder }) => (seat ? seat.command({ rudder }) : reject("join a room first")),
        setSail: ({ level }) => (seat ? seat.command({ sail: level }) : reject("join a room first")),
        fireBroadside: ({ side, aimPoint }) => (seat ? seat.fire({ side, aimPoint: vec3(...aimPoint) }) : reject("join a room first")),
      })

    const receive = yield* makeLink(lag, (frame: string | Uint8Array) =>
      typeof frame === "string"
        ? decode(frame).pipe(
            Effect.flatMap(act),
            Effect.catchTag("SchemaError", (error) => reject(`invalid message: ${error.message}`)),
          )
        : reject("binary frames are not accepted; send JSON text"),
    )

    const reader = yield* socket.reader
    while (true) {
      for (const frame of yield* reader.pull) yield* receive(frame)
    }
  })

const gameRoute = (lag: NetworkLag) =>
  HttpRouter.add(
    "GET",
    "/ws",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const socket = yield* request.upgrade
      yield* connection(socket, lag).pipe(
        Effect.scoped,
        Effect.catchTag("SocketError", () => Effect.void),
      )
      return HttpServerResponse.empty()
    }),
  )

/** Largest client frame Bun accepts before closing the connection; real client messages are under 100 bytes. */
const maxClientFrameBytes = 16 * 1024

/**
 * The game server on 127.0.0.1:`port` (0 picks a free port); exposes `HttpServer` for its address.
 * `lag` delays every message each way, to feel the game over a slow network.
 */
export const layer = (options: { readonly port: number; readonly lag?: NetworkLag }) =>
  // The request logger reports every normal WebSocket close as an interrupted request.
  HttpRouter.serve(gameRoute(options.lag ?? noLag), { disableLogger: true }).pipe(
    Layer.provide(Rooms.layer),
    // A graceful stop waits on open WebSocket handlers until the timeout, so Ctrl-C would hang; there is no HTTP work to drain.
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname: "127.0.0.1",
        port: options.port,
        gracefulShutdownTimeout: 0,
        websocket: { maxPayloadLength: maxClientFrameBytes },
      }),
    ),
  )
