declare const rngStateBrand: unique symbol

/** Seeded RNG state (mulberry32), stored in match state so a match replays from its seed. */
export type RngState = number & { readonly [rngStateBrand]: true }

/** Starts an RNG stream from any integer seed. */
export const seedRng = (seed: number): RngState =>
  // SAFETY: any uint32 is a valid mulberry32 state; `>>> 0` makes it one.
  (seed >>> 0) as RngState

/** Draws a float in [0, 1) and returns it with the next state. */
export const nextRandom = (state: RngState): readonly [number, RngState] => {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = Math.imul(next ^ (next >>> 15), next | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  // SAFETY: `next` is a uint32, the only invariant of RngState.
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next as RngState]
}

/** Draws a float in [min, max) and returns it with the next state. */
export const nextRange = (state: RngState, min: number, max: number): readonly [number, RngState] => {
  const [u, next] = nextRandom(state)
  return [min + (max - min) * u, next]
}
