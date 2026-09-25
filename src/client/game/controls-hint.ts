/** The things a new captain is shown how to do, in the order they are shown. */
export type HintStep = "sail" | "steer" | "fire" | "gunport"

/** What the hint reads each frame to know which steps are done and whether the next one makes sense yet. */
export interface HintReading {
  sailing: boolean
  paused: boolean
  sailLevel: number
  rudder: number
  /** The guns on the facing side could fire at the reticle now. */
  canFire: boolean
  gunport: boolean
}

const steps: ReadonlyArray<{ readonly step: HintStep; readonly keys: ReadonlyArray<string>; readonly text: string }> = [
  { step: "sail", keys: ["W"], text: "raise sail" },
  { step: "steer", keys: ["A", "D"], text: "steer" },
  { step: "fire", keys: ["Click"], text: "fire where the reticle points" },
  { step: "gunport", keys: ["Right"], text: "hold to aim from the gunport" },
]

const hintsKey = "brickwake.hints"
/** Seconds after setting sail before the first hint, between hints, and before an unused gunport hint goes. */
const firstDelay = 1.5
const gapSeconds = 1.2
const gunportSeconds = 9
/** Seconds a done hint lingers before it fades, so the player sees it was the right key. */
const doneLinger = 0.5

/**
 * First-run controls hint: one short key hint at a time over the HUD, each shown when it makes sense (fire only once a
 * broadside can bear) and faded out once the player has done it. Seen once, never again: kept in `localStorage`.
 */
export class ControlsHint {
  readonly #element: HTMLElement
  readonly #done = new Set<HintStep>()
  #enabled: boolean
  #index = 0
  #wait = firstDelay
  #shownFor = 0
  #showing = false

  /** `enabled` false (scenario pages) never shows a hint. */
  constructor(element: HTMLElement, enabled: boolean) {
    this.#element = element
    let seen = false
    try {
      seen = localStorage.getItem(hintsKey) === "seen"
    } catch {
      // Storage can be disabled: show the hints each visit.
    }
    this.#enabled = enabled && !seen
  }

  /** The step on show, or undefined. */
  get showing(): HintStep | undefined {
    return this.#showing ? steps[this.#index]?.step : undefined
  }

  /** Marks a step done (the fire order went out); a step done before its turn is skipped. */
  done(step: HintStep): void {
    this.#done.add(step)
  }

  /** Advances the hint by one frame. */
  update(dt: number, reading: HintReading): void {
    if (!this.#enabled) return
    if (reading.sailLevel > 0) this.#done.add("sail")
    if (reading.rudder !== 0) this.#done.add("steer")
    if (reading.gunport) this.#done.add("gunport")
    const current = steps[this.#index]
    if (current === undefined) return this.#finish()
    if (!reading.sailing || reading.paused) return this.#show(false)
    if (this.#showing) {
      this.#shownFor += dt
      const expired = current.step === "gunport" && this.#shownFor > gunportSeconds
      if (this.#done.has(current.step) || expired) {
        this.#done.add(current.step)
        this.#wait -= dt
        if (this.#wait > gapSeconds - doneLinger) return
        this.#show(false)
        this.#index++
      }
      return
    }
    if (this.#done.has(current.step)) {
      this.#index++
      return
    }
    this.#wait -= dt
    if (this.#wait > 0 || (current.step === "fire" && !reading.canFire)) return
    this.#element.replaceChildren(...this.#markup(current))
    this.#shownFor = 0
    this.#wait = gapSeconds
    this.#show(true)
  }

  #markup(step: (typeof steps)[number]) {
    const keys = document.createElement("span")
    keys.className = "hint-keys"
    for (const key of step.keys) {
      const cap = document.createElement("kbd")
      cap.textContent = key
      keys.append(cap)
    }
    const text = document.createElement("span")
    text.className = "hint-text"
    text.textContent = step.text
    return [keys, text]
  }

  #show(on: boolean) {
    if (on === this.#showing) return
    this.#showing = on
    this.#element.dataset.show = String(on)
  }

  #finish() {
    this.#enabled = false
    this.#show(false)
    try {
      localStorage.setItem(hintsKey, "seen")
    } catch {
      // Storage can be disabled.
    }
  }
}
