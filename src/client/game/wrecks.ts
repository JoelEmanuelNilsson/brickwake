import type { ServerEvent, ServerMessage } from "../../protocol/messages.ts"
import { ShipDamage, type DamageGraph } from "../../sim/ship/damage.ts"

/** One ship's damage as this client knows it. A new ship life gets a new `Wreck`, so views can tell a repair by identity. */
export interface Wreck {
  readonly damage: ShipDamage
  /** Parts knocked out or fallen off, in the order they went. Only ever grows. */
  readonly gone: Array<number>
}

type WelcomeWrecks = Extract<ServerMessage, { readonly _tag: "welcome" }>["wrecks"]

/**
 * Every ship's damage, replayed from the server: the welcome's removed lists, then each `ballHit.removed` in tick
 * order. The same damage graph as the server's gives the same parts falling off, so only removed parts travel.
 */
export class Wrecks {
  readonly #graph: DamageGraph
  readonly #byShip = new Map<string, Wreck>()

  constructor(graph: DamageGraph) {
    this.#graph = graph
  }

  /** Start over from a welcome. */
  load(wrecks: WelcomeWrecks): void {
    this.#byShip.clear()
    for (const { shipId, removed } of wrecks) this.#strike(shipId, removed)
  }

  /** Apply one event at its tick. */
  onEvent(event: ServerEvent): void {
    switch (event._tag) {
      case "ballHit":
        if (event.removed.length > 0) this.#strike(event.target, event.removed)
        return
      case "shipRespawned":
      case "shipRepaired":
      case "shipLeft":
        this.#byShip.delete(event.shipId)
        return
    }
  }

  /** The ship's damage, or undefined while it is whole. */
  of(shipId: string): Wreck | undefined {
    return this.#byShip.get(shipId)
  }

  #strike(shipId: string, removed: ReadonlyArray<number>) {
    let wreck = this.#byShip.get(shipId)
    if (wreck === undefined) {
      wreck = { damage: new ShipDamage(this.#graph), gone: [] }
      this.#byShip.set(shipId, wreck)
    }
    const detached = wreck.damage.apply(removed)
    wreck.gone.push(...removed, ...detached)
  }
}
