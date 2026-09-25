import type { MatchPhaseSnapshot, ServerEvent, ShipSnapshot } from "../../protocol/messages.ts"
import type { MatchRules } from "../../sim/rules.ts"
import { SIM_DT, tuning } from "../../sim/tuning.ts"
import { shipName } from "./names.ts"
import type { ShipPose } from "./timeline.ts"

const markup = /* html */ `
  <div class="mh-clock">
    <div class="mh-phase" data-mh="phase"></div>
    <div class="mh-time" data-mh="time">0:00</div>
    <div class="mh-standing" data-mh="standing"></div>
    <div class="mh-teams" data-mh="teams" hidden>
      <span data-team="pirates"><i>☠</i> Pirates <b data-mh="pirates">0</b></span>
      <span data-team="navy"><b data-mh="navy">0</b> Navy <i>⚓</i></span>
    </div>
  </div>
  <div class="mh-feed" data-mh="feed"></div>
  <div class="mh-banner" data-mh="banner" hidden>
    <div class="mh-banner-title" data-mh="banner-title"></div>
    <div class="mh-banner-sub" data-mh="banner-sub"></div>
  </div>
  <div class="mh-board" data-mh="board" hidden>
    <div class="mh-board-verdict" data-mh="verdict"></div>
    <div class="mh-board-title" data-mh="board-title"></div>
    <div class="mh-board-score" data-mh="board-score" hidden>
      <span data-team="pirates"><i>☠</i> Pirates <b data-mh="board-pirates">0</b></span>
      <span class="mh-board-dash">–</span>
      <span data-team="navy"><b data-mh="board-navy">0</b> Navy <i>⚓</i></span>
    </div>
    <table>
      <thead><tr><th></th><th class="mh-name">Ship</th><th>Sinks</th><th>Sunk</th><th>Hits</th><th>Aim</th><th>Damage</th></tr></thead>
      <tbody data-mh="rows"></tbody>
    </table>
    <div class="mh-board-foot" data-mh="board-foot"></div>
  </div>
  <div class="mh-ship hud-panel" data-mh="ship">
    <div class="hud-label">Hull</div>
    <div class="mh-hull-value" data-mh="hull-value">100</div>
    <div class="mh-hull"><div class="mh-hull-fill" data-mh="hull"></div></div>
    <div class="hud-label mh-guns-label">Guns</div>
    <div class="mh-gun"><span>Port</span><div class="mh-gun-bar"><div class="mh-gun-fill" data-mh="port"></div></div></div>
    <div class="mh-gun"><span>Stbd</span><div class="mh-gun-bar"><div class="mh-gun-fill" data-mh="starboard"></div></div></div>
  </div>
`

/** What the match HUD reads each frame. One object, rewritten each frame. */
export interface MatchReading {
  /** Seconds since the last frame. */
  dt: number
  /** Sim time the world is drawn at. */
  renderTime: number
  rules: MatchRules
  phase: MatchPhaseSnapshot
  /** Sinks each TDM side has scored. */
  teamSinks: { readonly pirates: number; readonly navy: number }
  ownId: string
  own: ShipPose | undefined
  /** Every ship's id and pose at the render time. */
  ships: ReadonlyMap<string, { readonly view: { readonly pose: ShipPose } }>
}

/** The text the match HUD shows. */
export interface MatchHudText {
  readonly phase: string
  readonly clock: string
  readonly standing: string
  /** Title · subtitle of the centre banner, or "" when none shows. */
  readonly banner: string
  /** The scoreboard when it shows: the verdict at a match's end ("" before), title, footer and the number of ship rows. */
  readonly scoreboard: { readonly verdict: string; readonly title: string; readonly foot: string; readonly rows: number } | null
  /** TDM side scores under the clock as "pirates–navy"; "" in FFA. */
  readonly teams: string
  /** Kill-feed lines, newest first. */
  readonly feed: ReadonlyArray<string>
}

const find = (root: HTMLElement, name: string) => {
  const element = root.querySelector<HTMLElement>(`[data-mh="${name}"]`)
  if (element === null) throw new Error(`match HUD markup lacks ${name}`)
  return element
}

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`

const text = (element: HTMLElement, value: string) => {
  if (element.textContent !== value) element.textContent = value
}

/** Seconds a kill-feed line stays; how many lines show at once. */
const feedSeconds = 7
const feedLines = 5
/** Seconds the "battle begins" banner holds after warmup. */
const startBannerSeconds = 2.2
/** Seconds the banner tells a captain a sink repaired their ship. */
const healBannerSeconds = 2.5
/** Seconds the banner tells a captain the sides were evened and they changed sides. */
const sideBannerSeconds = 4
/** Scoreboard rebuilds per second while it shows. */
const boardHz = 4

type Team = NonNullable<ShipSnapshot["team"]>

const teamNames: Readonly<Record<Team, string>> = { pirates: "Pirates", navy: "Navy" }

interface Standing {
  readonly id: string
  readonly team: Team | null
  readonly kills: number
  readonly deaths: number
  readonly shots: number
  readonly hits: number
  readonly damage: number
}

/**
 * The match layer of the HUD: clock and phase, own standing, kill feed, hull and per-side reload, the sinking and
 * respawn banner, the scoreboard on Tab, and the results when a match ends. DOM writes happen on change only.
 */
export class MatchHud {
  readonly #root: HTMLElement
  readonly #phase: HTMLElement
  readonly #time: HTMLElement
  readonly #standing: HTMLElement
  readonly #feed: HTMLElement
  readonly #banner: HTMLElement
  readonly #bannerTitle: HTMLElement
  readonly #bannerSub: HTMLElement
  readonly #board: HTMLElement
  readonly #verdict: HTMLElement
  readonly #boardTitle: HTMLElement
  readonly #rows: HTMLElement
  readonly #boardFoot: HTMLElement
  readonly #teams: HTMLElement
  readonly #pirates: HTMLElement
  readonly #navy: HTMLElement
  readonly #boardScore: HTMLElement
  readonly #boardPirates: HTMLElement
  readonly #boardNavy: HTMLElement
  readonly #ship: HTMLElement
  readonly #hull: HTMLElement
  readonly #hullValue: HTMLElement
  readonly #port: HTMLElement
  readonly #starboard: HTMLElement
  readonly #shown = { hull: Number.NaN, port: Number.NaN, starboard: Number.NaN }
  #tabHeld = false
  #boardClock = 0
  #standingsKey = ""
  #ownId = ""
  /** Each ship's TDM side as last drawn, for kill-feed colours. */
  readonly #teamOf = new Map<string, Team | null>()
  #sunkBy = new Map<string, string | null>()
  #playingSince = Number.NaN
  #ownTeam: ShipPose["team"] | undefined
  #sideChangedAt = Number.NaN
  #healedAt = Number.NaN
  #healed = 0
  #lastPhase: MatchPhaseSnapshot["_tag"] | undefined

  constructor(root: HTMLElement) {
    this.#root = root
    root.innerHTML = markup
    this.#phase = find(root, "phase")
    this.#time = find(root, "time")
    this.#standing = find(root, "standing")
    this.#feed = find(root, "feed")
    this.#banner = find(root, "banner")
    this.#bannerTitle = find(root, "banner-title")
    this.#bannerSub = find(root, "banner-sub")
    this.#board = find(root, "board")
    this.#verdict = find(root, "verdict")
    this.#boardTitle = find(root, "board-title")
    this.#rows = find(root, "rows")
    this.#boardFoot = find(root, "board-foot")
    this.#teams = find(root, "teams")
    this.#pirates = find(root, "pirates")
    this.#navy = find(root, "navy")
    this.#boardScore = find(root, "board-score")
    this.#boardPirates = find(root, "board-pirates")
    this.#boardNavy = find(root, "board-navy")
    this.#ship = find(root, "ship")
    this.#hull = find(root, "hull")
    this.#hullValue = find(root, "hull-value")
    this.#port = find(root, "port")
    this.#starboard = find(root, "starboard")
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Tab") return
      event.preventDefault()
      this.#tabHeld = true
    })
    window.addEventListener("keyup", (event) => {
      if (event.code === "Tab") this.#tabHeld = false
    })
    window.addEventListener("blur", () => (this.#tabHeld = false))
  }

  /** The text the HUD shows, for the debug hook. */
  shown(): MatchHudText {
    return {
      phase: this.#phase.textContent ?? "",
      clock: this.#time.textContent ?? "",
      standing: this.#standing.textContent ?? "",
      banner: this.#banner.hidden ? "" : `${this.#bannerTitle.textContent} · ${this.#bannerSub.textContent}`,
      scoreboard: this.#board.hidden
        ? null
        : {
            verdict: this.#verdict.textContent ?? "",
            title: this.#boardTitle.textContent ?? "",
            foot: this.#boardFoot.textContent ?? "",
            rows: this.#rows.querySelectorAll("tr.mh-row").length,
          },
      teams: this.#teams.hidden ? "" : `${this.#pirates.textContent}–${this.#navy.textContent}`,
      feed: [...this.#feed.children].map((line) => line.textContent ?? ""),
    }
  }

  /** Shows the HUD once sailing. */
  set visible(visible: boolean) {
    this.#root.hidden = !visible
  }

  /** Adds kill-feed lines for the match events among the server events. */
  onEvent(event: ServerEvent): void {
    if (event._tag === "shipSunk") {
      this.#sunkBy.set(event.shipId, event.by)
      this.#feedLine(event.shipId, event.by)
    }
    if (event._tag === "shipHealed" && event.shipId === this.#ownId) {
      this.#healedAt = event.tick * SIM_DT
      this.#healed = Math.round(event.healed)
      this.#ship.animate(
        [{ boxShadow: "0 0 0 2px #8fd694, 0 0 28px rgba(143, 214, 148, 0.75)" }, { boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)" }],
        { duration: 1400, easing: "ease-out" },
      )
    }
  }

  /** Shows a reading. */
  update(reading: MatchReading): void {
    this.#ownId = reading.ownId
    const { phase, renderTime, rules, own } = reading
    const tdm = rules.mode === "tdm"
    if (this.#teams.hidden === tdm) this.#teams.hidden = !tdm
    if (tdm) {
      text(this.#pirates, String(reading.teamSinks.pirates))
      text(this.#navy, String(reading.teamSinks.navy))
    }
    if (phase._tag === "playing" && this.#lastPhase === "warmup") this.#playingSince = renderTime
    this.#lastPhase = phase._tag

    switch (phase._tag) {
      case "warmup":
        text(this.#phase, "Warmup")
        text(this.#time, clock(phase.endsAt - renderTime))
        break
      case "playing":
        text(this.#phase, tdm ? `First side to ${rules.scoreLimit}` : `First to ${rules.scoreLimit}`)
        text(this.#time, clock(phase.endsAt - renderTime))
        break
      case "ended":
        text(this.#phase, "Battle over")
        text(this.#time, clock(phase.restartAt - renderTime))
        break
    }
    this.#root.dataset.phase = phase._tag
    const low = phase._tag === "playing" && phase.endsAt - renderTime <= 30
    if ((this.#time.dataset.low === "true") !== low) this.#time.dataset.low = String(low)

    this.#updateShip(own, renderTime)
    this.#updateBanner(reading)

    const showBoard = this.#tabHeld || phase._tag === "ended"
    this.#boardClock -= reading.dt
    if (showBoard === this.#board.hidden || this.#boardClock <= 0) {
      this.#boardClock = 1 / boardHz
      this.#updateStandings(reading, showBoard)
    }
    this.#board.hidden = !showBoard
  }

  #updateShip(own: ShipPose | undefined, renderTime: number) {
    const shown = this.#shown
    const hp = own === undefined ? 0 : Math.round(own.hp)
    if (hp !== shown.hull) {
      const share = hp / tuning.damage.hullHp
      this.#hull.style.transform = `scaleX(${share})`
      this.#hull.dataset.level = share <= 0.3 ? "critical" : share <= 0.6 ? "hurt" : "sound"
      text(this.#hullValue, String(hp))
      shown.hull = hp
    }
    for (const side of ["port", "starboard"] as const) {
      const reloadedAt = own === undefined ? 0 : side === "port" ? own.reloadPort : own.reloadStarboard
      const loaded = Math.round((1 - Math.min(1, Math.max(0, reloadedAt - renderTime) / tuning.guns.reload)) * 100) / 100
      if (loaded === shown[side]) continue
      const fill = side === "port" ? this.#port : this.#starboard
      fill.style.transform = `scaleX(${loaded})`
      fill.dataset.ready = String(loaded >= 1)
      shown[side] = loaded
    }
  }

  #updateBanner(reading: MatchReading) {
    const { own, renderTime, phase } = reading
    let title = ""
    let sub = ""
    let tone = "info"
    const team = own?.team
    if (team !== undefined && team !== this.#ownTeam) {
      if (this.#ownTeam !== undefined && this.#ownTeam !== null && team !== null) this.#sideChangedAt = renderTime
      this.#ownTeam = team
    }
    if (own !== undefined && own.life !== "afloat" && phase._tag !== "ended") {
      const by = this.#sunkBy.get(reading.ownId)
      title = "Your ship is going down"
      sub = `${by ? `Sunk by ${shipName(by)} · ` : ""}Back on the water in ${Math.max(0, Math.ceil(own.lifeTime + tuning.sinking.respawnSeconds - renderTime))}`
      tone = "danger"
    } else if (renderTime - this.#healedAt < healBannerSeconds) {
      title = "Hull repaired"
      sub = `+${this.#healed} HP for the sink`
      tone = "heal"
    } else if (team && renderTime - this.#sideChangedAt < sideBannerSeconds) {
      title = "Sides evened"
      sub = `You now sail with the ${teamNames[team]}`
    } else if (phase._tag === "warmup" && phase.endsAt - renderTime <= 5) {
      title = "Clear for action"
      sub = `Battle begins in ${Math.max(1, Math.ceil(phase.endsAt - renderTime))}`
    } else if (phase._tag === "playing" && renderTime - this.#playingSince < startBannerSeconds) {
      title = "Battle begins"
      sub = team ? `Sail with the ${teamNames[team]} · first side to ${reading.rules.scoreLimit} sinks` : `First to ${reading.rules.scoreLimit} sinks`
    }
    this.#banner.hidden = title === ""
    this.#banner.dataset.tone = tone
    text(this.#bannerTitle, title)
    text(this.#bannerSub, sub)
  }

  #updateStandings(reading: MatchReading, showBoard: boolean) {
    const standings: Array<Standing> = []
    for (const [id, entry] of reading.ships) {
      const { team, kills, deaths, shots, hits, damage } = entry.view.pose
      standings.push({ id, team, kills, deaths, shots, hits, damage })
      this.#teamOf.set(id, team)
    }
    standings.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || (a.id < b.id ? -1 : 1))
    const mine = standings.find((s) => s.id === reading.ownId)
    const { phase, rules, teamSinks } = reading
    const tdm = rules.mode === "tdm"
    const side = mine?.team ?? null
    const mates = side === null ? standings : standings.filter((s) => s.team === side)
    const place = mates.findIndex((s) => s.id === reading.ownId) + 1
    text(
      this.#standing,
      mine === undefined
        ? ""
        : phase._tag === "warmup"
          ? side === null ? "" : `You sail with the ${teamNames[side]}`
          : `${side === null ? "" : `${teamNames[side]} · `}${mine.kills} ${mine.kills === 1 ? "sink" : "sinks"} · ${ordinal(place)} of ${mates.length}`,
    )
    if (!showBoard) return
    text(this.#boardTitle, tdm ? `Pirates vs Navy · first side to ${rules.scoreLimit} sinks` : `Free for all · first to ${rules.scoreLimit} sinks`)
    this.#boardScore.hidden = !tdm
    text(this.#boardPirates, String(teamSinks.pirates))
    text(this.#boardNavy, String(teamSinks.navy))
    this.#board.dataset.mode = rules.mode
    if (phase._tag === "ended") {
      const winner = phase.winner
      const won = winner === null ? undefined : winner._tag === "ship" ? winner.shipId === reading.ownId : winner.team === side
      this.#board.dataset.verdict = won === undefined ? "draw" : won ? "victory" : "defeat"
      text(this.#verdict, won === undefined ? "Draw" : won ? "Victory" : "Defeat")
      const top = standings[0]
      const next = `Next battle in ${Math.max(0, Math.ceil(phase.restartAt - reading.renderTime))}`
      const tally = (kills: number) => `${kills} ${kills === 1 ? "sink" : "sinks"}`
      const story =
        winner === null
          ? tdm ? "Neither flag yields" : "No captain stands alone"
          : winner._tag === "team"
            ? `The ${teamNames[winner.team]} rule the waves${top ? ` · best captain ${shipName(top.id)}, ${tally(top.kills)}` : ""}`
            : `${shipName(winner.shipId)} rules the waves${top ? ` with ${tally(top.kills)}` : ""}`
      text(this.#boardFoot, `${story} · ${next}`)
    } else {
      this.#board.dataset.verdict = "none"
      text(this.#verdict, "")
      text(this.#boardFoot, phase._tag === "warmup" ? "Warmup · sinks count once battle begins" : `${clock(phase.endsAt - reading.renderTime)} left`)
    }
    const key = `${reading.ownId}/${standings.map((s) => `${s.id}:${s.team}:${s.kills}:${s.deaths}:${s.shots}:${s.hits}:${s.damage}`).join("|")}`
    if (key === this.#standingsKey) return
    this.#standingsKey = key
    const row = (s: Standing, index: number) => {
      const tr = document.createElement("tr")
      tr.className = s.id === reading.ownId ? "mh-row mh-own" : "mh-row"
      if (s.team !== null) tr.dataset.team = s.team
      for (const [value, name] of [
        [String(index + 1), ""],
        [shipName(s.id), "mh-name"],
        [String(s.kills), ""],
        [String(s.deaths), ""],
        [String(s.hits), ""],
        [s.shots === 0 ? "–" : `${Math.round((100 * s.hits) / s.shots)}%`, ""],
        [String(Math.round(s.damage)), ""],
      ] as const) {
        const cell = document.createElement("td")
        cell.textContent = value
        if (name !== "") cell.className = name
        tr.append(cell)
      }
      return tr
    }
    if (!tdm) {
      this.#rows.replaceChildren(...standings.map(row))
      return
    }
    this.#rows.replaceChildren(
      ...(["pirates", "navy"] as const).flatMap((team) => {
        const head = document.createElement("tr")
        head.className = "mh-team-row"
        head.dataset.team = team
        const cell = document.createElement("td")
        cell.colSpan = 7
        cell.textContent = `${team === "pirates" ? "☠" : "⚓"} ${teamNames[team]} · ${teamSinks[team]} ${teamSinks[team] === 1 ? "sink" : "sinks"}`
        head.append(cell)
        return [head, ...standings.filter((s) => s.team === team).map(row)]
      }),
    )
  }

  #feedLine(victim: string, by: string | null) {
    const line = document.createElement("div")
    line.className = "mh-feed-line"
    const name = (id: string) => {
      const span = document.createElement("span")
      span.textContent = shipName(id)
      span.className = id === this.#ownId ? "mh-you" : "mh-ship-name"
      const team = this.#teamOf.get(id)
      if (team) span.dataset.team = team
      return span
    }
    const mark = document.createElement("span")
    mark.className = "mh-skull"
    mark.textContent = "☠"
    if (by === null) {
      const verb = document.createElement("span")
      verb.textContent = "foundered"
      line.append(name(victim), mark, verb)
    } else line.append(name(by), mark, name(victim))
    if (victim === this.#ownId || by === this.#ownId) line.dataset.own = victim === this.#ownId ? "lost" : "won"
    line.style.animationDuration = `${feedSeconds}s`
    line.addEventListener("animationend", () => line.remove())
    this.#feed.prepend(line)
    while (this.#feed.childElementCount > feedLines) this.#feed.lastElementChild?.remove()
  }
}
