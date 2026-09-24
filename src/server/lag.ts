import { Clock, Effect, Queue, Random, Scope } from "effect"

/** Injected network delay per direction, for testing how play feels over a slow link. */
export interface NetworkLag {
  /** Fixed one-way delay, ms. */
  readonly latencyMs: number
  /** Extra one-way delay drawn uniformly from 0…`jitterMs`, ms. */
  readonly jitterMs: number
}

/** No injected delay. */
export const noLag: NetworkLag = { latencyMs: 0, jitterMs: 0 }

/**
 * A one-way link that hands each pushed item to `deliver` after the lag, in push order like a TCP
 * stream (jitter bunches items up; it never reorders them). Delivery runs in the current scope
 * and stops at the first failure.
 */
export const makeLink = <A, E>(
  lag: NetworkLag,
  deliver: (item: A) => Effect.Effect<void, E>,
): Effect.Effect<(item: A) => Effect.Effect<void>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<{ readonly at: number; readonly item: A }>()
    yield* Effect.gen(function* () {
      while (true) {
        const { at, item } = yield* Queue.take(queue)
        const wait = at - (yield* Clock.currentTimeMillis)
        if (wait > 0) yield* Effect.sleep(wait)
        yield* deliver(item)
      }
    }).pipe(Effect.ignore, Effect.forkScoped)
    let lastAt = 0
    return (item: A): Effect.Effect<void> =>
      Effect.gen(function* () {
        const jitter = lag.jitterMs > 0 ? yield* Random.nextBetween(0, lag.jitterMs) : 0
        lastAt = Math.max(lastAt, (yield* Clock.currentTimeMillis) + lag.latencyMs + jitter)
        yield* Queue.offer(queue, { at: lastAt, item })
      })
  })
