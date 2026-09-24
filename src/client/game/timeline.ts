import type { ShipSnapshot } from "../../protocol/messages.ts"

/** How far behind the estimated server time the world is drawn, seconds (spec: Networking). */
export const interpolationDelay = 0.1

/** A ship's interpolated state at the render time. Mutable and reused so the render loop allocates nothing. */
export class ShipPose {
  x = 0
  y = 0
  z = 0
  qx = 0
  qy = 0
  qz = 0
  qw = 1
  vx = 0
  vy = 0
  vz = 0
  rudderAngle = 0
  sailSet = 0
  rudder: ShipSnapshot["rudder"] = 0
  sail: ShipSnapshot["sail"] = 0
}

interface Entry {
  readonly tick: number
  readonly ships: ReadonlyArray<ShipSnapshot>
  readonly byId: ReadonlyMap<string, ShipSnapshot>
}

const capacity = 64
const noShips: ReadonlyArray<ShipSnapshot> = []
/** A render clock further than this from its target jumps instead of easing. */
const snapSeconds = 0.25
/** Per-second rate at which the render clock eases toward its target. */
const clockGain = 1.5
/** Per-snapshot rate at which the offset estimate rises after latency grows; falls to any faster sample at once. */
const offsetCreep = 0.002

/**
 * Received snapshots and the render clock. The clock trails the estimated server time by
 * `interpolationDelay`, estimated from the earliest-arriving snapshots so jitter only adds buffer.
 */
export class SnapshotTimeline {
  readonly #simHz: number
  readonly #entries: Array<Entry | undefined> = Array.from({ length: capacity }, () => undefined)
  #count = 0
  #head = 0
  #offset = Number.NaN
  #renderTime = Number.NaN
  #bracket = 0

  constructor(simHz: number) {
    this.#simHz = simHz
  }

  /** Sim ticks per second. */
  get simHz(): number {
    return this.#simHz
  }

  /** Newest received tick, or −1 before the first snapshot. */
  get latestTick(): number {
    return this.#count === 0 ? -1 : this.#at(this.#count - 1).tick
  }

  /** Sim time the world is drawn at, seconds; NaN until the first snapshot. */
  get renderTime(): number {
    return this.#renderTime
  }

  /** Records a snapshot that arrived at `arrivalSeconds` on the local clock. Out-of-order or repeated ticks are dropped. */
  push(tick: number, ships: ReadonlyArray<ShipSnapshot>, arrivalSeconds: number): void {
    if (tick <= this.latestTick) return
    const byId = new Map<string, ShipSnapshot>()
    for (const ship of ships) byId.set(ship.id, ship)
    const slot = (this.#head + this.#count) % capacity
    this.#entries[slot] = { tick, ships, byId }
    if (this.#count === capacity) this.#head = (this.#head + 1) % capacity
    else this.#count++
    const sample = arrivalSeconds - tick / this.#simHz
    if (Number.isNaN(this.#offset) || sample < this.#offset) this.#offset = sample
    else this.#offset += (sample - this.#offset) * offsetCreep
  }

  /** Moves the render clock to local time `nowSeconds`, `dt` seconds after the last call; returns the render time. */
  advance(nowSeconds: number, dt: number): number {
    if (this.#count === 0) return this.#renderTime
    const target = nowSeconds - this.#offset - interpolationDelay
    if (Number.isNaN(this.#renderTime) || Math.abs(target - this.#renderTime) > snapSeconds) this.#renderTime = target
    else this.#renderTime += dt + (target - this.#renderTime) * Math.min(1, dt * clockGain)
    const renderTick = this.#renderTime * this.#simHz
    let bracket = 0
    while (bracket + 1 < this.#count && this.#at(bracket + 1).tick <= renderTick) bracket++
    this.#bracket = bracket
    return this.#renderTime
  }

  /** Ships present at the render time. */
  ships(): ReadonlyArray<ShipSnapshot> {
    return this.#count === 0 ? noShips : this.#at(this.#bracket).ships
  }

  /** Writes ship `id` at the render time into `out`; false when the ship is not in the world then. */
  sample(id: string, out: ShipPose): boolean {
    if (this.#count === 0) return false
    const a = this.#at(this.#bracket).byId.get(id)
    if (a === undefined) return false
    const next = this.#bracket + 1 < this.#count ? this.#at(this.#bracket + 1) : undefined
    const b = next?.byId.get(id)
    if (next === undefined || b === undefined) {
      write(out, a, a, 0)
      return true
    }
    const from = this.#at(this.#bracket).tick
    const u = Math.min(1, Math.max(0, (this.#renderTime * this.#simHz - from) / (next.tick - from)))
    write(out, a, b, u)
    return true
  }

  #at(index: number): Entry {
    const entry = this.#entries[(this.#head + index) % capacity]
    if (entry === undefined) throw new Error(`timeline slot ${index} is empty`)
    return entry
  }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

const write = (out: ShipPose, a: ShipSnapshot, b: ShipSnapshot, u: number) => {
  out.x = lerp(a.position[0], b.position[0], u)
  out.y = lerp(a.position[1], b.position[1], u)
  out.z = lerp(a.position[2], b.position[2], u)
  out.vx = lerp(a.velocity[0], b.velocity[0], u)
  out.vy = lerp(a.velocity[1], b.velocity[1], u)
  out.vz = lerp(a.velocity[2], b.velocity[2], u)
  out.rudderAngle = lerp(a.rudderAngle, b.rudderAngle, u)
  out.sailSet = lerp(a.sailSet, b.sailSet, u)
  out.rudder = b.rudder
  out.sail = b.sail
  // Normalized lerp on the shorter arc: ticks are 33 ms apart, where it matches slerp to well under a pixel.
  const [ax, ay, az, aw] = a.orientation
  const [bx0, by0, bz0, bw0] = b.orientation
  const sign = ax * bx0 + ay * by0 + az * bz0 + aw * bw0 < 0 ? -1 : 1
  const x = lerp(ax, bx0 * sign, u)
  const y = lerp(ay, by0 * sign, u)
  const z = lerp(az, bz0 * sign, u)
  const w = lerp(aw, bw0 * sign, u)
  const n = 1 / Math.hypot(x, y, z, w)
  out.qx = x * n
  out.qy = y * n
  out.qz = z * n
  out.qw = w * n
}

/** Server events waiting for the render clock to reach their tick. */
export class EventQueue<E extends { readonly tick: number }> {
  readonly #pending: Array<E> = []

  /** Queues events; they arrive in tick order per snapshot. */
  push(events: ReadonlyArray<E>): void {
    for (const event of events) this.#pending.push(event)
  }

  /** Hands every event due at or before `renderTick` to `apply`, in arrival order. */
  drain(renderTick: number, apply: (event: E) => void): void {
    while (this.#pending.length > 0) {
      const event = this.#pending[0]
      if (event === undefined || event.tick > renderTick) return
      this.#pending.shift()
      apply(event)
    }
  }
}
