const markup = /* html */ `
  <div class="feel-layer feel-burn" data-feel="burn"></div>
  <div class="feel-layer feel-hit" data-feel="hit"></div>
  <div class="feel-layer feel-flash" data-feel="flash"></div>
`

/** Spring of the HUD's jolt: natural frequency (rad/s) and damping ratio; underdamped so a knock rings once and settles. */
const omega = 30
const damping = 0.34
/** Velocity a jolt of 1 gives the panels, px/s, and the furthest they may be thrown, px: a knock, never a blur. */
const joltSpeed = 330
const maxOffset = 9
/** Degrees a jolt of 1 tilts the panels, at most. */
const joltTilt = 0.9
/** Share of the jolt the reticle takes: it must stay on the aim. */
const reticleShare = 0.35
/** Per-second decay of the red hit flash and of the white blast flash. */
const hitFade = 2.6
const flashFade = 7
/** Burning glow at the screen edge: its level with one fire and with `fullFires` or more, and how fast it follows. */
const burnLow = 0.45
const fullFires = 4
const burnFollow = 3

const find = (root: HTMLElement, name: string) => {
  const element = root.querySelector<HTMLElement>(`[data-feel="${name}"]`)
  if (element === null) throw new Error(`feel markup lacks ${name}`)
  return element
}

/**
 * The HUD reacting physically to the battle: panels jolt on a spring when a gun fires, a ball strikes or something
 * blows up nearby, scaled by the size and distance the camera shake already measures; the screen edge flashes red when
 * the own ship is struck and white-hot at a blast; and while the ship burns, a flickering warm glow rises from the
 * edges. Honours reduced motion: the flashes stay, the jolts go. Writes the DOM once per frame, only what changed.
 */
export class HudFeel {
  readonly #panels: ReadonlyArray<HTMLElement>
  readonly #reticle: HTMLElement
  readonly #burn: HTMLElement
  readonly #hit: HTMLElement
  readonly #flash: HTMLElement
  readonly #still: boolean
  #x = 0
  #y = 0
  #vx = 0
  #vy = 0
  #tilt = 0
  #tiltV = 0
  #hitLevel = 0
  #flashLevel = 0
  #burnLevel = 0
  #time = 0
  readonly #shown = { move: "", reticle: "", tilt: "", hit: -1, flash: -1, burn: -1 }

  constructor(root: HTMLElement, panels: ReadonlyArray<HTMLElement>, reticle: HTMLElement) {
    root.innerHTML = markup
    this.#panels = panels
    this.#reticle = reticle
    this.#burn = find(root, "burn")
    this.#hit = find(root, "hit")
    this.#flash = find(root, "flash")
    this.#still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }

  /** A knock of `amount` (camera-shake units, 0…1) throws the panels; `down` biases it downward, as a blow from above. */
  jolt(amount: number, down = 0): void {
    const angle = Math.random() * Math.PI * 2
    const speed = joltSpeed * Math.min(1, amount)
    this.#vx += Math.cos(angle) * speed
    this.#vy += Math.sin(angle) * speed * (1 - down) + speed * down
    this.#tiltV += (Math.random() < 0.5 ? -1 : 1) * joltTilt * omega * Math.min(1, amount) * 0.5
  }

  /** The own ship took `damage` HP: the edge flashes red and the panels are knocked, harder for heavier hits. */
  struck(damage: number): void {
    const k = Math.min(1, damage / 5)
    this.#hitLevel = Math.min(1, this.#hitLevel + 0.35 + 0.45 * k)
    this.jolt(0.35 + 0.45 * k, 0.5)
  }

  /** A blast of `amount` (0…1, already scaled by distance) lights the screen white-hot for an instant. */
  blast(amount: number): void {
    this.#flashLevel = Math.min(0.6, this.#flashLevel + amount)
  }

  /** Advances by `dt` seconds with `fires` burning on the own ship. */
  update(dt: number, fires: number): void {
    this.#time += dt
    const h = Math.min(dt, 1 / 30)
    const steps = Math.max(1, Math.ceil(dt / h))
    for (let i = 0; i < steps; i++) {
      const step = dt / steps
      this.#vx += (-omega * omega * this.#x - 2 * damping * omega * this.#vx) * step
      this.#vy += (-omega * omega * this.#y - 2 * damping * omega * this.#vy) * step
      this.#tiltV += (-omega * omega * this.#tilt - 2 * damping * omega * this.#tiltV) * step
      this.#x += this.#vx * step
      this.#y += this.#vy * step
      this.#tilt += this.#tiltV * step
    }
    this.#x = Math.max(-maxOffset, Math.min(maxOffset, this.#x))
    this.#y = Math.max(-maxOffset, Math.min(maxOffset, this.#y))
    this.#tilt = Math.max(-joltTilt, Math.min(joltTilt, this.#tilt))
    this.#hitLevel *= Math.exp(-hitFade * dt)
    this.#flashLevel *= Math.exp(-flashFade * dt)
    const burnTarget = fires === 0 ? 0 : burnLow + (1 - burnLow) * Math.min(1, (fires - 1) / (fullFires - 1))
    this.#burnLevel += (burnTarget - this.#burnLevel) * Math.min(1, burnFollow * dt)
    const t = this.#time
    const flicker = 0.82 + 0.1 * Math.sin(t * 9.3) + 0.08 * Math.sin(t * 23.7) * Math.sin(t * 3.1)
    this.#write(this.#burnLevel * flicker)
  }

  #write(burn: number) {
    const shown = this.#shown
    if (!this.#still) {
      const x = Math.round(this.#x * 2) / 2
      const y = Math.round(this.#y * 2) / 2
      const move = x === 0 && y === 0 ? "" : `${x}px ${y}px`
      if (move !== shown.move) {
        for (const panel of this.#panels) panel.style.translate = move
        shown.move = move
      }
      const rx = Math.round(this.#x * reticleShare * 2) / 2
      const ry = Math.round(this.#y * reticleShare * 2) / 2
      const reticle = rx === 0 && ry === 0 ? "" : `${rx}px ${ry}px`
      if (reticle !== shown.reticle) {
        this.#reticle.style.translate = reticle
        shown.reticle = reticle
      }
      const degrees = Math.round(this.#tilt * 20) / 20
      const tilt = degrees === 0 ? "" : `${degrees}deg`
      if (tilt !== shown.tilt) {
        for (const panel of this.#panels) panel.style.rotate = tilt
        shown.tilt = tilt
      }
    }
    shown.hit = opacity(this.#hit, this.#hitLevel, shown.hit)
    shown.flash = opacity(this.#flash, this.#flashLevel, shown.flash)
    shown.burn = opacity(this.#burn, burn, shown.burn)
  }
}

const opacity = (element: HTMLElement, level: number, shown: number) => {
  const quantized = Math.round(level * 100) / 100
  if (quantized !== shown) element.style.opacity = String(quantized)
  return quantized
}
