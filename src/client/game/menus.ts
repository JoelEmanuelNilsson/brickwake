import { type GameSettings, type GraphicsQuality, sensitivityRange } from "./settings.ts"

/** What the pause and settings menus show, for the debug hook and browser checks. */
export interface MenusShown {
  readonly paused: boolean
  readonly settings: boolean
}

const qualityNotes: Readonly<Record<GraphicsQuality, string>> = {
  low: "No shadows, bloom or smoothing: for slow machines",
  medium: "Shadows and bloom at one pixel per point",
  high: "The full look: sharper on high-density screens",
}

const find = <E extends Element>(root: ParentNode, selector: string, type: new () => E): E => {
  const element = root.querySelector(selector)
  if (!(element instanceof type)) throw new Error(`menu markup lacks ${selector}`)
  return element
}

/**
 * The pause menu (Esc while sailing) and the settings panel over it or over the title screen. Sliders apply as they
 * move and every change is handed to `apply`, which persists it. `index.html` holds the markup.
 */
export class Menus {
  readonly #pause: HTMLElement
  readonly #settings: HTMLElement
  readonly #inputs: Readonly<Record<"sensitivity" | "volume" | "ambience", HTMLInputElement>>
  readonly #values: Readonly<Record<keyof GameSettings, HTMLElement>>
  readonly #quality: ReadonlyArray<HTMLButtonElement>
  #current: GameSettings

  constructor(
    elements: { readonly pause: HTMLElement; readonly settings: HTMLElement; readonly controlsStrip: Element | null },
    settings: GameSettings,
    actions: {
      readonly apply: (settings: GameSettings) => void
      readonly resume: () => void
      /** Leaves the pause menu for the title screen's battle choice. */
      readonly title: () => void
    },
  ) {
    this.#pause = elements.pause
    this.#settings = elements.settings
    this.#current = settings
    if (elements.controlsStrip !== null) find(this.#pause, ".pm-card", HTMLElement).insertBefore(elements.controlsStrip.cloneNode(true), find(this.#pause, ".pm-foot", HTMLElement))
    const input = (name: string) => find(this.#settings, `[data-st="${name}"]`, HTMLInputElement)
    this.#inputs = { sensitivity: input("sensitivity"), volume: input("volume"), ambience: input("ambience") }
    this.#inputs.sensitivity.min = String(sensitivityRange.min)
    this.#inputs.sensitivity.max = String(sensitivityRange.max)
    const value = (name: keyof GameSettings) => find(this.#settings, `[data-st-value="${name}"]`, HTMLElement)
    this.#values = { sensitivity: value("sensitivity"), volume: value("volume"), ambience: value("ambience"), quality: value("quality") }
    this.#quality = [...this.#settings.querySelectorAll<HTMLButtonElement>("[data-quality]")]
    for (const key of ["sensitivity", "volume", "ambience"] as const) {
      this.#inputs[key].addEventListener("input", () => this.#change({ ...this.#current, [key]: Number(this.#inputs[key].value) }, actions.apply))
    }
    for (const button of this.#quality) {
      button.addEventListener("click", () => {
        const quality = button.dataset.quality
        if (quality === "low" || quality === "medium" || quality === "high") this.#change({ ...this.#current, quality }, actions.apply)
      })
    }
    find(this.#settings, '[data-st="done"]', HTMLButtonElement).addEventListener("click", () => this.closeSettings())
    this.#pause.addEventListener("click", (event) => {
      const action = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pm]")?.dataset.pm : undefined
      if (action === "settings") return this.openSettings()
      if (action === "title") return actions.title()
      // Anywhere else on the pause screen, as on the title screen, is back to sailing.
      if (action === "resume" || event.target === this.#pause) actions.resume()
    })
    this.#show(settings)
  }

  /** Which menus are up. */
  get shown(): MenusShown {
    return { paused: !this.#pause.hidden, settings: !this.#settings.hidden }
  }

  /** Shows or hides the pause menu; hiding it closes the settings too. */
  set paused(value: boolean) {
    this.#pause.hidden = !value
    if (!value) this.closeSettings()
  }

  /** Opens the settings panel over whatever shows. */
  openSettings(): void {
    this.#show(this.#current)
    this.#settings.hidden = false
  }

  /** Closes the settings panel, back to the menu under it. */
  closeSettings(): void {
    this.#settings.hidden = true
  }

  #change(settings: GameSettings, apply: (settings: GameSettings) => void) {
    this.#current = settings
    this.#show(settings)
    apply(settings)
  }

  #show(settings: GameSettings) {
    for (const key of ["sensitivity", "volume", "ambience"] as const) {
      const input = this.#inputs[key]
      input.value = String(settings[key])
      const share = (settings[key] - Number(input.min)) / (Number(input.max) - Number(input.min))
      input.style.setProperty("--fill", `${(share * 100).toFixed(1)}%`)
    }
    this.#values.sensitivity.textContent = `${settings.sensitivity.toFixed(2)}×`
    this.#values.volume.textContent = `${Math.round(settings.volume * 100)}`
    this.#values.ambience.textContent = `${Math.round(settings.ambience * 100)}`
    this.#values.quality.textContent = qualityNotes[settings.quality]
    for (const button of this.#quality) button.setAttribute("aria-pressed", String(button.dataset.quality === settings.quality))
  }
}
