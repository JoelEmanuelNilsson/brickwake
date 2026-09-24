import type { BroadsideSide } from "../../sim/gun-layout.ts"
import type { BroadsideRefusal } from "../../sim/gunnery.ts"

/** What the reticle can say about firing now. */
export type ReticleState = "ready" | BroadsideRefusal | "no-aim"

/** The reticle's reading for one frame. */
export interface ReticleReading {
  side: BroadsideSide
  state: ReticleState
  /** Horizontal distance from the ship to the aim point, metres. */
  range: number
  /** Seconds until the facing side is loaded. */
  reloadLeft: number
  /** Loaded fraction of the facing side, 0…1. */
  loaded: number
}

const ringLength = 2 * Math.PI * 22

const markup = /* html */ `
  <svg class="reticle-ring" viewBox="-32 -32 64 64" aria-hidden="true">
    <circle class="reticle-track" r="22" />
    <circle class="reticle-load" r="22" stroke-dasharray="${ringLength} ${ringLength}" transform="rotate(-90)" data-reticle="load" />
    <path class="reticle-ticks" d="M -30 0 H -25 M 25 0 H 30 M 0 -30 V -25 M 0 25 V 30" />
    <circle class="reticle-dot" r="1.6" />
  </svg>
  <svg class="reticle-hit" viewBox="-32 -32 64 64" aria-hidden="true" data-reticle="hit">
    <path d="M -15 -15 L -7 -7 M 15 -15 L 7 -7 M -15 15 L -7 7 M 15 15 L 7 7" />
  </svg>
  <div class="reticle-side" data-reticle="side"></div>
  <div class="reticle-status" data-reticle="status"></div>
`

const reasonText: Record<ReticleState, string> = {
  ready: "",
  reloading: "Reloading",
  "out-of-arc": "Out of arc",
  "out-of-range": "Out of range",
  "no-aim": "No target",
}

/** The screen-centre reticle: facing side, reload ring, range or why it can't fire, and the hit marker. Writes the DOM only on change. */
export class Reticle {
  readonly #root: HTMLElement
  readonly #load: SVGCircleElement
  readonly #hit: SVGElement
  readonly #side: HTMLElement
  readonly #status: HTMLElement
  #lastState = ""
  #lastSide = ""
  #lastFigure = Number.NaN
  #lastLoad = -1

  constructor(root: HTMLElement) {
    this.#root = root
    root.innerHTML = markup
    const find = <E extends Element>(name: string) => {
      const element = root.querySelector<E>(`[data-reticle="${name}"]`)
      if (element === null) throw new Error(`reticle markup is missing ${name}`)
      return element
    }
    this.#load = find<SVGCircleElement>("load")
    this.#hit = find<SVGElement>("hit")
    this.#side = find<HTMLElement>("side")
    this.#status = find<HTMLElement>("status")
    this.#hit.addEventListener("animationend", () => this.#hit.classList.remove("show"))
    root.addEventListener("animationend", (event) => {
      if (event.target === root) root.classList.remove("denied")
    })
  }

  /** Shows or hides the reticle. */
  set visible(visible: boolean) {
    this.#root.hidden = !visible
  }

  /** Refreshes from this frame's reading. */
  update(reading: ReticleReading): void {
    // The number the status line shows: metres when ready, tenths of a second when reloading.
    const figure = reading.state === "ready" ? Math.round(reading.range) : reading.state === "reloading" ? Math.ceil(reading.reloadLeft * 10) : 0
    if (reading.state !== this.#lastState || figure !== this.#lastFigure) {
      this.#root.dataset.state = reading.state
      this.#status.textContent =
        reading.state === "ready"
          ? `${figure} m`
          : reading.state === "reloading"
            ? `${reasonText.reloading} ${(figure / 10).toFixed(1)} s`
            : reasonText[reading.state]
      this.#lastState = reading.state
      this.#lastFigure = figure
    }
    if (reading.side !== this.#lastSide) {
      this.#lastSide = reading.side
      this.#side.textContent = reading.side === "port" ? "Port" : "Starboard"
    }
    const load = Math.round(reading.loaded * 200) / 200
    if (load !== this.#lastLoad) {
      this.#lastLoad = load
      this.#load.style.strokeDashoffset = String(ringLength * (1 - load))
    }
  }

  /** Flashes the hit marker: one of your balls struck a hull. */
  hit(): void {
    this.#hit.classList.remove("show")
    // Reading layout restarts the CSS animation when hits come faster than it runs.
    void this.#hit.getBoundingClientRect()
    this.#hit.classList.add("show")
  }

  /** Shakes the reticle: a click that could not fire. */
  deny(): void {
    this.#root.classList.remove("denied")
    void this.#root.getBoundingClientRect()
    this.#root.classList.add("denied")
  }
}
