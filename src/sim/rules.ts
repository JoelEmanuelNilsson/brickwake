import type { ShipId, ShipState, Team } from "./ship.ts"
import { tuning } from "./tuning.ts"

/** A game mode. Each mode decides sides, who scores for a sink and who wins; the match lifecycle is shared. */
export type MatchMode = "ffa" | "tdm"

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

/** Team deathmatch quick play: Pirates vs Navy. */
export const tdmRules: MatchRules = { mode: "tdm", ...tuning.match.tdm }

/** Both TDM sides, pirates first. */
export const teams: ReadonlyArray<Team> = ["pirates", "navy"]

/** Sinks each TDM side has scored this match. Held apart from the ships so a side keeps its score when a ship leaves. */
export interface TeamSinks {
  readonly pirates: number
  readonly navy: number
}

/** No sinks on either side. */
export const noTeamSinks: TeamSinks = { pirates: 0, navy: 0 }

/** Who won a match: a captain in FFA, a side in TDM. */
export type MatchWinner = { readonly _tag: "ship"; readonly shipId: ShipId } | { readonly _tag: "team"; readonly team: Team }

/** Where a match is in its lifecycle: warmup → playing → ended → warmup of the next match. Times are sim seconds. */
export type MatchPhase =
  | { readonly _tag: "warmup"; readonly endsAt: number }
  | { readonly _tag: "playing"; readonly endsAt: number }
  /** `winner` is undefined for a draw. */
  | { readonly _tag: "ended"; readonly restartAt: number; readonly winner: MatchWinner | undefined }

/** The phase a match starts in at `time`. */
export const openingPhase = (rules: MatchRules, time: number): MatchPhase =>
  rules.warmupSeconds > 0 ? { _tag: "warmup", endsAt: time + rules.warmupSeconds } : { _tag: "playing", endsAt: time + rules.timeLimit }

/**
 * The side a joining ship takes: none in FFA; in TDM the side with fewer ships, on a tie the side with fewer captains
 * (`isBot` false), since its bots make room for the next one; then pirates.
 */
export const teamFor = (rules: MatchRules, ships: ReadonlyArray<ShipState>, isBot: (id: ShipId) => boolean): Team | undefined => {
  switch (rules.mode) {
    case "ffa":
      return undefined
    case "tdm": {
      const [pirates, navy] = teams.map((team) => ships.filter((ship) => ship.team === team))
      const captains = (side: ReadonlyArray<ShipState>) => side.filter((ship) => !isBot(ship.id)).length
      const lean = pirates!.length - navy!.length || captains(pirates!) - captains(navy!)
      return lean <= 0 ? "pirates" : "navy"
    }
  }
}

/** True when two ships fight on the same side; never in FFA. Allies' balls strike each other for no damage. */
export const allies = (a: ShipState, b: ShipState): boolean => a.team !== undefined && a.team === b.team

const rank = (a: ShipState, b: ShipState) => b.kills - a.kills || a.deaths - b.deaths || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Ships best first: most sinks, then fewest deaths, then id. */
export const standings = (ships: ReadonlyArray<ShipState>): ReadonlyArray<ShipState> => ships.toSorted(rank)

/** The match score: every ship's own tally and each side's sinks. */
export interface MatchScore {
  readonly ships: ReadonlyArray<ShipState>
  readonly teamSinks: TeamSinks
}

/** Credits a sink of `victim` by `by` (undefined when no ship caused it), naming the ship `credited`. An ally's sink credits nobody. */
export const scoreSink = (
  rules: MatchRules,
  score: MatchScore,
  victim: ShipId,
  by: ShipId | undefined,
): MatchScore & { readonly credited: ShipId | undefined } => {
  const victimShip = score.ships.find((ship) => ship.id === victim)
  const byShip = score.ships.find((ship) => ship.id === by)
  const credited = byShip !== undefined && victimShip !== undefined && !allies(byShip, victimShip) ? byShip : undefined
  const ships = score.ships.map((ship) =>
    ship.id === victim ? { ...ship, deaths: ship.deaths + 1 } : ship.id === credited?.id ? { ...ship, kills: ship.kills + 1 } : ship,
  )
  switch (rules.mode) {
    case "ffa":
      return { ships, teamSinks: score.teamSinks, credited: credited?.id }
    case "tdm": {
      const team = credited?.team
      const teamSinks = team === undefined ? score.teamSinks : { ...score.teamSinks, [team]: score.teamSinks[team] + 1 }
      return { ships, teamSinks, credited: credited?.id }
    }
  }
}

/** True once a side has reached the score limit. */
export const scoreLimitReached = (rules: MatchRules, score: MatchScore): boolean => {
  switch (rules.mode) {
    case "ffa":
      return score.ships.some((ship) => ship.kills >= rules.scoreLimit)
    case "tdm":
      return teams.some((team) => score.teamSinks[team] >= rules.scoreLimit)
  }
}

/** The winner as the score stands: the captain or side strictly ahead (FFA breaks sink ties on fewest deaths); undefined on a tie. */
export const winnerOf = (rules: MatchRules, score: MatchScore): MatchWinner | undefined => {
  switch (rules.mode) {
    case "ffa": {
      const [first, second] = standings(score.ships)
      if (first === undefined) return undefined
      if (second !== undefined && second.kills === first.kills && second.deaths === first.deaths) return undefined
      return { _tag: "ship", shipId: first.id }
    }
    case "tdm": {
      const { pirates, navy } = score.teamSinks
      return pirates === navy ? undefined : { _tag: "team", team: pirates > navy ? "pirates" : "navy" }
    }
  }
}
