import { tuning } from "../../sim/tuning.ts"
import type { SailLevel } from "../../sim/ship.ts"

const knotsPerMetrePerSecond = 1.943844
const degrees = 180 / Math.PI

const markup = /* html */ `
  <div class="hud-panel hud-sail">
    <div class="hud-label">Sail</div>
    <div class="hud-sail-levels">
      <div class="hud-sail-level" data-level="2">Full</div>
      <div class="hud-sail-level" data-level="1">Half</div>
      <div class="hud-sail-level" data-level="0">Furled</div>
    </div>
    <div class="hud-meter"><div class="hud-meter-fill" data-hud="sail-set"></div></div>
    <div class="hud-key">W raise · S lower</div>
  </div>
  <div class="hud-panel hud-nav">
    <div class="hud-compass">
      <div class="hud-compass-ring"></div>
      <div class="hud-compass-ship" data-hud="ship-heading"></div>
      <div class="hud-compass-wind" data-hud="wind-arrow"><span></span></div>
      <div class="hud-speed"><b data-hud="speed">0.0</b><small>kn</small></div>
    </div>
    <div class="hud-point" data-hud="point-of-sail"></div>
    <div class="hud-wind" data-hud="wind"></div>
  </div>
  <div class="hud-panel hud-rudder">
    <div class="hud-label">Rudder</div>
    <div class="hud-rudder-track">
      <div class="hud-rudder-centre"></div>
      <div class="hud-rudder-needle" data-hud="rudder"></div>
    </div>
    <div class="hud-rudder-sides"><span>Port</span><span>Stbd</span></div>
    <div class="hud-key">A port · D starboard</div>
  </div>
`

/** Everything the sailing HUD shows, refreshed each frame. */
export interface HudReading {
  /** Speed over ground along the bow, m/s. */
  speed: number
  sailLevel: SailLevel
  /** Canvas set 0…1. */
  sailSet: number
  /** Radians; positive to starboard. */
  rudderAngle: number
  heading: number
  windToward: number
  windSpeed: number
  /** Yaw the camera looks along; the compass turns so this is up. */
  viewYaw: number
}

const pointOfSail = (angleOffWind: number) =>
  angleOffWind < 45 / degrees
    ? "In irons"
    : angleOffWind < 70 / degrees
      ? "Close-hauled"
      : angleOffWind < 112 / degrees
        ? "Beam reach"
        : angleOffWind < 155 / degrees
          ? "Broad reach"
          : "Running"

const find = (root: HTMLElement, name: string) => {
  const element = root.querySelector<HTMLElement>(`[data-hud="${name}"]`)
  if (element === null) throw new Error(`HUD markup lacks ${name}`)
  return element
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/** The sailing HUD: sail level, rudder, speed, wind and point of sail. Writes the DOM only when a shown value changes. */
export class Hud {
  readonly #speed: HTMLElement
  readonly #sailSet: HTMLElement
  readonly #levels: ReadonlyArray<HTMLElement>
  readonly #rudder: HTMLElement
  readonly #ship: HTMLElement
  readonly #windArrow: HTMLElement
  readonly #point: HTMLElement
  readonly #wind: HTMLElement
  #shown = { speed: Number.NaN, level: -1, set: Number.NaN, rudder: Number.NaN, ship: Number.NaN, wind: Number.NaN, point: "", windSpeed: Number.NaN }

  constructor(root: HTMLElement) {
    root.innerHTML = markup
    this.#speed = find(root, "speed")
    this.#sailSet = find(root, "sail-set")
    this.#levels = [...root.querySelectorAll<HTMLElement>(".hud-sail-level")]
    this.#rudder = find(root, "rudder")
    this.#ship = find(root, "ship-heading")
    this.#windArrow = find(root, "wind-arrow")
    this.#point = find(root, "point-of-sail")
    this.#wind = find(root, "wind")
  }

  /** Shows a reading. */
  update(reading: HudReading): void {
    const shown = this.#shown
    const speed = Math.round(reading.speed * knotsPerMetrePerSecond * 10) / 10
    if (speed !== shown.speed) this.#speed.textContent = speed.toFixed(1)
    shown.speed = speed
    if (reading.sailLevel !== shown.level) {
      for (const level of this.#levels) level.classList.toggle("active", level.dataset.level === String(reading.sailLevel))
      shown.level = reading.sailLevel
    }
    const set = Math.round(reading.sailSet * 100)
    if (set !== shown.set) this.#sailSet.style.transform = `scaleX(${set / 100})`
    shown.set = set
    const rudder = Math.round((reading.rudderAngle / tuning.rudder.maxAngle) * 100)
    if (rudder !== shown.rudder) this.#rudder.style.left = `${50 + rudder / 2}%`
    shown.rudder = rudder
    // CSS rotates clockwise; sim yaw turns counter-clockwise seen from above.
    const ship = Math.round(-wrap(reading.heading - reading.viewYaw) * degrees)
    if (ship !== shown.ship) this.#ship.style.transform = `rotate(${ship}deg)`
    shown.ship = ship
    const wind = Math.round(-wrap(reading.windToward - reading.viewYaw) * degrees)
    if (wind !== shown.wind) this.#windArrow.style.transform = `rotate(${wind}deg)`
    shown.wind = wind
    const point = pointOfSail(Math.abs(wrap(reading.heading - reading.windToward - Math.PI)))
    if (point !== shown.point) this.#point.textContent = point
    shown.point = point
    const windSpeed = Math.round(reading.windSpeed * knotsPerMetrePerSecond)
    if (windSpeed !== shown.windSpeed) this.#wind.textContent = `Wind ${windSpeed} kn`
    shown.windSpeed = windSpeed
  }
}
