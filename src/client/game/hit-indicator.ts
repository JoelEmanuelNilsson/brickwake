const slots = 4
/** Seconds a hit marker stays, fading after the first quarter. */
const hold = 1.8

const markup = Array.from(
  { length: slots },
  () => /* html */ `
  <div class="hitdir">
    <svg viewBox="-140 -140 280 280"><path d="M -46 -118 A 127 127 0 0 1 46 -118 L 38 -100 A 108 108 0 0 0 -38 -100 Z" /></svg>
  </div>`,
).join("")

/**
 * Red arcs around the reticle pointing to where incoming hits came from. Each keeps its world bearing, so it swings as
 * the camera turns and stays true. Four pooled arcs; the oldest is reused.
 */
export class HitIndicator {
  readonly #arcs: ReadonlyArray<HTMLElement>
  readonly #bearing = new Float64Array(slots)
  readonly #age = new Float64Array(slots).fill(Number.POSITIVE_INFINITY)
  readonly #shown = new Float64Array(slots).fill(Number.NaN)
  #next = 0

  constructor(root: HTMLElement) {
    root.innerHTML = markup
    this.#arcs = [...root.querySelectorAll<HTMLElement>(".hitdir")]
  }

  /** A hit arrived from world yaw `bearing` (see `directionFromAngle`), seen from the own ship. */
  hit(bearing: number): void {
    this.#bearing[this.#next] = bearing
    this.#age[this.#next] = 0
    this.#next = (this.#next + 1) % slots
  }

  /** Ages the arcs and turns them to the view looking along world yaw `viewYaw`. */
  update(dt: number, viewYaw: number): void {
    for (let i = 0; i < slots; i++) {
      const arc = this.#arcs[i]
      if (arc === undefined) continue
      const age = (this.#age[i] ?? Number.POSITIVE_INFINITY) + dt
      this.#age[i] = age
      const opacity = age >= hold ? 0 : Math.min(1, (hold - age) / (hold * 0.75))
      const quantized = Math.round(opacity * 50) / 50
      if (quantized === 0 && this.#shown[i] === 0) continue
      // CSS turns clockwise with screen-up as the view direction; sim yaw turns counter-clockwise from above.
      const relative = viewYaw - (this.#bearing[i] ?? 0)
      arc.style.opacity = String(quantized)
      arc.style.transform = `rotate(${relative}rad)`
      this.#shown[i] = quantized
    }
  }
}
