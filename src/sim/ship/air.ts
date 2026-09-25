import { heightInPlates, occupiedCells, type ShipPart, studCells } from "./structure.ts"

/** How outside air reaches a cell or a part: not at all, only through `sealed` cells (gunports), or directly. */
export type AirLevel = 0 | 1 | 2

/**
 * The air around and inside a ship's parts on the grid, flooded in from outside. Level 2 is air reached
 * without passing a `sealed` cell, level 1 air reached only through one, 0 enclosed air or a part.
 * Removing parts opens their cells and floods on from there, so a hole reveals what lies behind it.
 */
export class ShipAir {
  readonly #parts: ReadonlyArray<ShipPart>
  readonly #cells: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>
  readonly #origin: readonly [number, number, number]
  readonly #size: readonly [number, number, number]
  readonly #solid: Uint8Array
  readonly #cap: Uint8Array
  readonly #level: Uint8Array
  readonly #owner: Int32Array
  readonly #opened: Uint8Array

  constructor(parts: ReadonlyArray<ShipPart>, sealed: ReadonlyArray<readonly [number, number, number]> = []) {
    this.#parts = parts
    this.#cells = parts.map(occupiedCells)
    const all = this.#cells.flat()
    const lo = [0, 1, 2].map((a) => all.reduce((m, c) => Math.min(m, c[a] ?? 0), Infinity) - 1)
    const hi = [0, 1, 2].map((a) => all.reduce((m, c) => Math.max(m, c[a] ?? 0), -Infinity) + 2)
    this.#origin = [lo[0] ?? 0, lo[1] ?? 0, lo[2] ?? 0]
    this.#size = [(hi[0] ?? 0) - (lo[0] ?? 0), (hi[1] ?? 0) - (lo[1] ?? 0), (hi[2] ?? 0) - (lo[2] ?? 0)]
    const volume = this.#size[0] * this.#size[1] * this.#size[2]
    this.#solid = new Uint8Array(volume)
    this.#cap = new Uint8Array(volume).fill(2)
    this.#level = new Uint8Array(volume)
    this.#owner = new Int32Array(volume).fill(-1)
    this.#opened = new Uint8Array(volume)
    this.#cells.forEach((own, i) => {
      for (const [x, y, z] of own) {
        const c = this.#index(x, y, z)
        this.#solid[c] = 1
        this.#owner[c] = i
      }
    })
    for (const [x, y, z] of sealed) {
      const c = this.#index(x, y, z)
      if (c >= 0) this.#cap[c] = 1
    }
    this.#level[0] = 2
    this.#flood([0])
  }

  /** The best air any face of part `i` touches. */
  partLevel(i: number): AirLevel {
    let best = 0
    for (const [x, y, z] of this.#cells[i] ?? []) {
      best = Math.max(best, this.levelAt(x + 1, y, z), this.levelAt(x - 1, y, z), this.levelAt(x, y + 1, z), this.levelAt(x, y - 1, z), this.levelAt(x, y, z + 1), this.levelAt(x, y, z - 1))
      if (best === 2) return 2
    }
    // SAFETY: levels only ever hold 0, 1 or 2.
    return best as AirLevel
  }

  /** Indices into part `i`'s catalogue `studs` that no air reaches: covered by a part or facing enclosed air. */
  hiddenStuds(i: number): ReadonlyArray<number> {
    const p = this.#parts[i]
    if (p === undefined) return []
    const top = p.y + heightInPlates(p)
    return studCells(p).flatMap(([x, z], s) => (this.levelAt(x, top, z) === 0 ? [s] : []))
  }

  /** Indices into part `i`'s catalogue `studs` whose cover was removed and that now face air: the studs a hole bares. */
  uncoveredStuds(i: number): ReadonlyArray<number> {
    const p = this.#parts[i]
    if (p === undefined) return []
    const top = p.y + heightInPlates(p)
    return studCells(p).flatMap(([x, z], s) => (this.#opened[this.#index(x, top, z)] === 1 && this.levelAt(x, top, z) > 0 ? [s] : []))
  }

  /** Air level of a grid cell; outside the grid is open air. */
  levelAt(x: number, y: number, z: number): AirLevel {
    const c = this.#index(x, y, z)
    // SAFETY: levels only ever hold 0, 1 or 2.
    return c < 0 ? 2 : (this.#level[c] as AirLevel)
  }

  /** Empty the cells of removed parts and flood air into them; returns the other parts whose surrounding air rose. */
  open(removed: ReadonlyArray<number>): ReadonlyArray<number> {
    const seeds: Array<number> = []
    for (const i of removed)
      for (const [x, y, z] of this.#cells[i] ?? []) {
        const c = this.#index(x, y, z)
        if (c < 0 || this.#owner[c] !== i) continue
        this.#solid[c] = 0
        this.#owner[c] = -1
        this.#opened[c] = 1
        seeds.push(c)
      }
    const raised: Array<number> = []
    for (const c of seeds) {
      const level = Math.min(this.#cap[c] ?? 0, this.#neighbourLevel(c))
      if (level > (this.#level[c] ?? 0)) {
        this.#level[c] = level
        raised.push(c)
      }
    }
    const changed = new Set<number>()
    for (const c of this.#flood(raised)) {
      for (const n of this.#neighbours(c)) {
        const owner = n < 0 ? -1 : (this.#owner[n] ?? -1)
        if (owner >= 0) changed.add(owner)
      }
    }
    return [...changed]
  }

  #index(x: number, y: number, z: number): number {
    const [x0, y0, z0] = this.#origin
    const [nx, ny, nz] = this.#size
    if (x < x0 || y < y0 || z < z0 || x >= x0 + nx || y >= y0 + ny || z >= z0 + nz) return -1
    return ((x - x0) * ny + (y - y0)) * nz + (z - z0)
  }

  #neighbours(c: number): readonly [number, number, number, number, number, number] {
    const [nx, ny, nz] = this.#size
    const z = c % nz
    const y = Math.floor(c / nz) % ny
    const x = Math.floor(c / (ny * nz))
    const step = ny * nz
    return [x + 1 < nx ? c + step : -1, x > 0 ? c - step : -1, y + 1 < ny ? c + nz : -1, y > 0 ? c - nz : -1, z + 1 < nz ? c + 1 : -1, z > 0 ? c - 1 : -1]
  }

  #neighbourLevel(c: number): number {
    let best = 0
    for (const n of this.#neighbours(c)) best = Math.max(best, n < 0 ? 2 : (this.#level[n] ?? 0))
    return best
  }

  /** Spread air from `seeds` (cells whose level was just set) and return every cell whose level rose, seeds included. */
  #flood(seeds: ReadonlyArray<number>): ReadonlyArray<number> {
    const stack = [...seeds]
    const raised = [...seeds]
    for (let c = stack.pop(); c !== undefined; c = stack.pop()) {
      const level = this.#level[c] ?? 0
      for (const n of this.#neighbours(c)) {
        if (n < 0 || this.#solid[n] === 1) continue
        const next = Math.min(this.#cap[n] ?? 0, level)
        if (next <= (this.#level[n] ?? 0)) continue
        this.#level[n] = next
        stack.push(n)
        raised.push(n)
      }
    }
    return raised
  }
}
