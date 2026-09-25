import type { BroadsideSide } from "../../sim/gun-layout.ts"
import { tuning } from "../../sim/tuning.ts"

/**
 * The own ship's reload deadlines on one room's clock: the server's, raised by broadsides ordered but not yet in a
 * snapshot. Each room's clock starts on its own, so a deadline never outlives the welcome it was set under.
 */
export class OwnReloads {
  readonly #ordered = { port: Number.NEGATIVE_INFINITY, starboard: Number.NEGATIVE_INFINITY }

  /** A broadside was ordered on `side` at sim time `time`. */
  ordered(side: BroadsideSide, time: number): void {
    this.#ordered[side] = time + tuning.guns.reload
  }

  /** The server refused the broadside on `side`: it never began reloading. */
  refused(side: BroadsideSide): void {
    this.#ordered[side] = Number.NEGATIVE_INFINITY
  }

  /** A welcome joined a room: its clock is not the one earlier orders were timed on. */
  joined(): void {
    this.#ordered.port = Number.NEGATIVE_INFINITY
    this.#ordered.starboard = Number.NEGATIVE_INFINITY
  }

  /** Sim time `side` may fire again, given the server's deadline `server` from the latest snapshot. */
  reloadedAt(side: BroadsideSide, server: number): number {
    return Math.max(server, this.#ordered[side])
  }
}
