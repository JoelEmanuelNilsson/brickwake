import type { MatchPhaseSnapshot, ServerEvent } from "../../protocol/messages.ts"
import type { MatchRules } from "../../sim/rules.ts"
import { tuning } from "../../sim/tuning.ts"
import { shipName } from "./names.ts"
import type { ShipPose } from "./timeline.ts"

const markup = /* html */ `
  <div class="mh-clock">
    <div class="mh-phase" data-mh="phase"></div>
    <div class="mh-time" data-mh="time">0:00</div>
    <div class="mh-standing" data-mh="standing"></div>
  </div>
  <div class="mh-feed" data-mh="feed"></div>
  <div class="mh-banner" data-mh="banner" hidden>
    <div class="mh-banner-title" data-mh="banner-title"></div>
    <div class="mh-banner-sub" data-mh="banner-sub"></div>
  </div>
  <div class="mh-board" data-mh="board" hidden>
    <div class="mh-board-verdict" data-mh="verdict"></div>
    <div class="mh-board-title" data-mh="board-title"></div>
    <table>
      <thead><tr><th></th><th class="mh-name">Ship</th><th>Sinks</th><th>Sunk</th></tr></thead>
      <tbody data-mh="rows"></tbody>
    </table>
    <div class="mh-board-foot" data-mh="board-foot"></div>
  </div>
  <div class="mh-ship hud-panel">
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
  /** The scoreboard when it shows: the verdict at a match's end ("" before) and the number of rows. */
  readonly scoreboard: { readonly verdict: string; readonly rows: number } | null
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
/** Scoreboard rebuilds per second while it shows. */
const boardHz = 4

interface Standing {
  readonly id: string
  readonly kills: number
  readonly deaths: number
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
  readonly #hull: HTMLElement
  readonly #hullValue: HTMLElement
  readonly #port: HTMLElement
  readonly #starboard: HTMLElement
  readonly #shown = { hull: Number.NaN, port: Number.NaN, starboard: Number.NaN }
  #tabHeld = false
  #boardClock = 0
  #standingsKey = ""
  #ownId = ""
  #sunkBy = new Map<string, string | null>()
  #playingSince = Number.NaN
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
      scoreboard: this.#board.hidden ? null : { verdict: this.#verdict.textContent ?? "", rows: this.#rows.childElementCount },
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
  }

  /** Shows a reading. */
  update(reading: MatchReading): void {
    this.#ownId = reading.ownId
    const { phase, renderTime, rules, own } = reading
    if (phase._tag === "playing" && this.#lastPhase === "warmup") this.#playingSince = renderTime
    this.#lastPhase = phase._tag

    switch (phase._tag) {
      case "warmup":
        text(this.#phase, "Warmup")
        text(this.#time, clock(phase.endsAt - renderTime))
        break
      case "playing":
        text(this.#phase, `First to ${rules.scoreLimit}`)
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
    if (own !== undefined && own.life !== "afloat" && phase._tag !== "ended") {
      const respawnAt = own.life === "sinking" ? own.lifeTime + tuning.sinking.seconds + tuning.sinking.respawnSeconds : own.lifeTime
      const by = this.#sunkBy.get(reading.ownId)
      title = own.life === "sinking" ? "Your ship is going down" : "Sunk"
      sub = `${by ? `Sunk by ${shipName(by)} · ` : ""}Back on the water in ${Math.max(0, Math.ceil(respawnAt - renderTime))}`
      tone = "danger"
    } else if (phase._tag === "warmup" && phase.endsAt - renderTime <= 5) {
      title = "Clear for action"
      sub = `Battle begins in ${Math.max(1, Math.ceil(phase.endsAt - renderTime))}`
    } else if (phase._tag === "playing" && renderTime - this.#playingSince < startBannerSeconds) {
      title = "Battle begins"
      sub = `First to ${reading.rules.scoreLimit} sinks`
    }
    this.#banner.hidden = title === ""
    this.#banner.dataset.tone = tone
    text(this.#bannerTitle, title)
    text(this.#bannerSub, sub)
  }

  #updateStandings(reading: MatchReading, showBoard: boolean) {
    const standings: Array<Standing> = []
    for (const [id, entry] of reading.ships) standings.push({ id, kills: entry.view.pose.kills, deaths: entry.view.pose.deaths })
    standings.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.id < b.id ? -1 : 1))
    const place = standings.findIndex((s) => s.id === reading.ownId) + 1
    const mine = standings[place - 1]
    text(
      this.#standing,
      mine === undefined || reading.phase._tag === "warmup" ? "" : `${mine.kills} ${mine.kills === 1 ? "sink" : "sinks"} · ${ordinal(place)} of ${standings.length}`,
    )
    if (!showBoard) return
    const { phase, rules } = reading
    text(this.#boardTitle, `Free for all · first to ${rules.scoreLimit} sinks`)
    if (phase._tag === "ended") {
      const winner = phase.winner?.shipId
      this.#board.dataset.verdict = winner === undefined ? "draw" : winner === reading.ownId ? "victory" : "defeat"
      text(this.#verdict, winner === undefined ? "Draw" : winner === reading.ownId ? "Victory" : "Defeat")
      const top = standings[0]
      text(
        this.#boardFoot,
        `${winner === undefined ? "No captain stands alone" : `${shipName(winner)} rules the waves${top ? ` with ${top.kills} ${top.kills === 1 ? "sink" : "sinks"}` : ""}`} · Next battle in ${Math.max(0, Math.ceil(phase.restartAt - reading.renderTime))}`,
      )
    } else {
      this.#board.dataset.verdict = "none"
      text(this.#verdict, "")
      text(this.#boardFoot, phase._tag === "warmup" ? "Warmup · sinks count once battle begins" : `${clock(phase.endsAt - reading.renderTime)} left`)
    }
    const key = standings.map((s) => `${s.id}:${s.kills}:${s.deaths}`).join("|")
    if (key === this.#standingsKey) return
    this.#standingsKey = key
    this.#rows.replaceChildren(
      ...standings.map((s, index) => {
        const row = document.createElement("tr")
        if (s.id === reading.ownId) row.className = "mh-own"
        for (const [value, name] of [
          [String(index + 1), ""],
          [shipName(s.id), "mh-name"],
          [String(s.kills), ""],
          [String(s.deaths), ""],
        ] as const) {
          const cell = document.createElement("td")
          cell.textContent = value
          if (name !== "") cell.className = name
          row.append(cell)
        }
        return row
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
