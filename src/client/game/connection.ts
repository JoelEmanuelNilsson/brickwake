import { Result, Schema } from "effect"
import { ClientMessageJson, ServerMessageJson, type ClientMessage, type ServerMessage } from "../../protocol/messages.ts"

const decode = Schema.decodeUnknownResult(ServerMessageJson)
const encode = Schema.encodeSync(ClientMessageJson)

/** Lifecycle of the game socket. */
export type ConnectionState = "connecting" | "open" | "closed"

/** The game's WebSocket to `/ws`: every frame is schema-decoded before `onMessage` sees it. */
export interface Connection {
  readonly state: () => ConnectionState
  readonly send: (message: ClientMessage) => void
}

/** Opens `/ws` on the page's host. Frames that fail to decode are logged and dropped. */
export const connect = (handlers: {
  readonly onOpen: () => void
  readonly onMessage: (message: ServerMessage, arrivalSeconds: number) => void
  readonly onClose: () => void
}): Connection => {
  let state: ConnectionState = "connecting"
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
  socket.addEventListener("open", () => {
    state = "open"
    handlers.onOpen()
  })
  socket.addEventListener("message", (event) => {
    const arrivalSeconds = performance.now() / 1000
    const result = decode(event.data)
    if (Result.isFailure(result)) {
      console.error("dropped a server frame that failed to decode", result.failure)
      return
    }
    handlers.onMessage(result.success, arrivalSeconds)
  })
  socket.addEventListener("close", () => {
    state = "closed"
    handlers.onClose()
  })
  return {
    state: () => state,
    send: (message) => {
      if (state === "open") socket.send(encode(message))
    },
  }
}
