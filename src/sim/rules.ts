import type { ShipId, ShipState } from "./ship.ts"
import { tuning } from "./tuning.ts"

/** A game mode. Each mode decides who scores for a sink and who wins; the match lifecycle is shared. */
export type MatchMode = "ffa"

/** How a match is paced and won. Times are sim seconds. */
export interface MatchRules {
  readonly mode: MatchMode
  /** The match ends as soon as a side has this many sinks. */
  readonly scoreLimit: number
  /** Seconds of play before the match ends on time. */
  readonly timeLimit: number
  /** Seconds of warmup before play; sinks do not score in warmup. 0 starts in play. */
  readonly warmupSeconds: number
  /** Seconds the results show before the next match's warmup. */
  readonly endedSeconds: number
}

/** Free-for-all quick play. */
export const ffaRules: MatchRules = { mode: "ffa", ...tuning.match.ffa }

/** Who won a match. TDM adds a team winner. */
export type MatchWinner = { readonly _tag: "ship"; readonly shipId: ShipId }

/** Where a match is in its lifecycle: warmup → playing → ended → warmup of the next match. Times are sim seconds. */
export type MatchPhase =
  | { readonly _tag: "warmup"; readonly endsAt: number }
  | { readonly _tag: "playing"; readonly endsAt: number }
  /** `winner` is undefined for a draw. */
  | { readonly _tag: "ended"; readonly restartAt: number; readonly winner: MatchWinner | undefined }

/** The phase a match starts in at `time`. */
export const openingPhase = (rules: MatchRules, time: number): MatchPhase =>
  rules.warmupSeconds > 0 ? { _tag: "warmup", endsAt: time + rules.warmupSeconds } : { _tag: "playing", endsAt: time + rules.timeLimit }

const rank = (a: ShipState, b: ShipState) => b.kills - a.kills || a.deaths - b.deaths || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Ships best first: most sinks, then fewest deaths, then id. */
export const standings = (ships: ReadonlyArray<ShipState>): ReadonlyArray<ShipState> => ships.toSorted(rank)

/** Credits a sink of `victim` by `by` (undefined when no ship caused it). Returns the ships with scores updated. */
export const scoreSink = (
  rules: MatchRules,
  ships: ReadonlyArray<ShipState>,
  victim: ShipId,
  by: ShipId | undefined,
): ReadonlyArray<ShipState> => {
  switch (rules.mode) {
    case "ffa":
      return ships.map((ship) =>
        ship.id === victim ? { ...ship, deaths: ship.deaths + 1 } : ship.id === by ? { ...ship, kills: ship.kills + 1 } : ship,
      )
  }
}

/** True once a side has reached the score limit. */
export const scoreLimitReached = (rules: MatchRules, ships: ReadonlyArray<ShipState>): boolean => {
  switch (rules.mode) {
    case "ffa":
      return ships.some((ship) => ship.kills >= rules.scoreLimit)
  }
}

/** The winner as the ships stand: the one ranked strictly first by sinks, then fewest deaths; undefined on a tie. */
export const winnerOf = (rules: MatchRules, ships: ReadonlyArray<ShipState>): MatchWinner | undefined => {
  switch (rules.mode) {
    case "ffa": {
      const [first, second] = standings(ships)
      if (first === undefined) return undefined
      if (second !== undefined && second.kills === first.kills && second.deaths === first.deaths) return undefined
      return { _tag: "ship", shipId: first.id }
    }
  }
}
