import { CanvasTexture, Color, PointLight, type Camera, type Scene, type Texture, type Vector3 } from "three"
import type { SeaState } from "../../sim/ocean.ts"
import { chipSpawn, ChipLayer } from "./debris.ts"
import { ParticleLayer, ParticleShape, particleSpawn, type ParticleLayerOptions } from "./particles.ts"

const size = 128

const canvasTexture = (draw: (g: CanvasRenderingContext2D) => void): Texture => {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext("2d")
  if (g === null) throw new Error("2D canvas is unavailable")
  draw(g)
  const texture = new CanvasTexture(canvas)
  texture.generateMipmaps = true
  return texture
}

const radial = (g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: ReadonlyArray<readonly [number, string]>) => {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  g.fillStyle = gradient
  g.fillRect(x - r, y - r, 2 * r, 2 * r)
}

/** A billowing cauliflower puff: overlapping soft lobes, darker in the folds, faded to nothing at the edge. */
const puffTexture = () =>
  canvasTexture((g) => {
    const c = size / 2
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2
      const reach = Math.random() * 0.26 * size
      const shade = 130 + Math.floor(Math.random() * 125)
      radial(g, c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, (0.14 + Math.random() * 0.14) * size, [
        [0, `rgba(${shade},${shade},${shade},0.5)`],
        [0.55, `rgba(${shade},${shade},${shade},0.32)`],
        [1, `rgba(${shade},${shade},${shade},0)`],
      ])
    }
    g.globalCompositeOperation = "destination-in"
    radial(g, c, c, c, [
      [0, "rgba(0,0,0,1)"],
      [0.55, "rgba(0,0,0,0.85)"],
      [1, "rgba(0,0,0,0)"],
    ])
  })

/** Streaky sheets of spray; streaks run along u, which streak-shaped particles align with their velocity. */
const sprayTexture = () =>
  canvasTexture((g) => {
    const c = size / 2
    radial(g, c, c, c * 0.8, [
      [0, "rgba(255,255,255,0.45)"],
      [1, "rgba(255,255,255,0)"],
    ])
    for (let i = 0; i < 60; i++) {
      const y = c + (Math.random() + Math.random() + Math.random() - 1.5) * c * 0.55
      const from = Math.random() * c * 0.8
      const to = size - Math.random() * c * 0.8
      const line = g.createLinearGradient(from, 0, to, 0)
      line.addColorStop(0, "rgba(255,255,255,0)")
      line.addColorStop(0.5, `rgba(255,255,255,${(0.35 + Math.random() * 0.5).toFixed(2)})`)
      line.addColorStop(1, "rgba(255,255,255,0)")
      g.fillStyle = line
      g.fillRect(from, y, to - from, 1 + Math.random() * 3)
    }
    g.globalCompositeOperation = "destination-in"
    radial(g, c, c, c, [
      [0, "rgba(0,0,0,1)"],
      [0.6, "rgba(0,0,0,0.8)"],
      [1, "rgba(0,0,0,0)"],
    ])
  })

/** A hot core with a few ragged rays, for muzzle and impact flashes. */
const flashTexture = () =>
  canvasTexture((g) => {
    const c = size / 2
    g.translate(c, c)
    for (let i = 0; i < 9; i++) {
      g.rotate((Math.PI * 2) / 9 + Math.random() * 0.3)
      const length = (0.32 + Math.random() * 0.18) * size
      const ray = g.createLinearGradient(0, 0, length, 0)
      ray.addColorStop(0, "rgba(255,255,255,0.8)")
      ray.addColorStop(1, "rgba(255,255,255,0)")
      g.fillStyle = ray
      g.beginPath()
      g.moveTo(0, -size * 0.035)
      g.lineTo(length, 0)
      g.lineTo(0, size * 0.035)
      g.fill()
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
    radial(g, c, c, c * 0.75, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.75)"],
      [1, "rgba(255,255,255,0)"],
    ])
  })

const dotTexture = () =>
  canvasTexture((g) =>
    radial(g, size / 2, size / 2, size / 2, [
      [0, "rgba(255,255,255,1)"],
      [0.35, "rgba(255,255,255,0.7)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  )

/** A broken ring of foam, speckled, as a splash leaves on the water. */
const foamTexture = () =>
  canvasTexture((g) => {
    const c = size / 2
    radial(g, c, c, c, [
      [0, "rgba(255,255,255,0.25)"],
      [0.45, "rgba(255,255,255,0.35)"],
      [0.72, "rgba(255,255,255,0.95)"],
      [1, "rgba(255,255,255,0)"],
    ])
    g.globalCompositeOperation = "destination-out"
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2
      const reach = Math.random() * c * 0.95
      radial(g, c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, 2 + Math.random() * 9, [
        [0, "rgba(0,0,0,0.9)"],
        [1, "rgba(0,0,0,0)"],
      ])
    }
  })

const random = (min: number, max: number) => min + Math.random() * (max - min)
const jitter = (spread: number) => (Math.random() * 2 - 1) * spread

/** Hull debris colours: dark and light wood, black, Lego red and tan. Linear. */
const chipColors = [0x24201d, 0x3b2c20, 0x151515, 0xa3201c, 0xd8c08e].map((hex) => new Color(hex))
const splinterColor = new Color(0xc9a46c)

const lightCount = 4
const lightPeak = 9000
const lightSeconds = 0.06

/**
 * Gun and impact effects: muzzle flash with light, lingering wind-drifted smoke, water splashes sized by impact,
 * brick chips and splinters on hits, ball trails. Every layer is a fixed pool; nothing allocates per frame.
 * Later effects (debris physics, sinking) add layers and recipes here.
 */
export class Effects {
  readonly smoke: ParticleLayer
  readonly spray: ParticleLayer
  readonly droplets: ParticleLayer
  readonly fire: ParticleLayer
  readonly sparks: ParticleLayer
  readonly foam: ParticleLayer
  readonly chips: ChipLayer
  readonly #layers: ReadonlyArray<ParticleLayer>
  readonly #lights: ReadonlyArray<PointLight>
  readonly #lightAge = new Float32Array(lightCount).fill(Number.POSITIVE_INFINITY)
  #nextLight = 0
  readonly #p = particleSpawn()
  readonly #c = chipSpawn()

  constructor(scene: Scene, sunDirection: Vector3) {
    const puff = puffTexture()
    const dot = dotTexture()
    const base: Omit<ParticleLayerOptions, "capacity" | "texture"> = {
      blending: "alpha",
      lit: true,
      sorted: true,
      fadeIn: 0.04,
      fadeOut: 1.4,
      shade: [0.3, 0.33, 0.4],
      endTint: [1, 1, 1],
      streak: 0,
      water: "ignore",
    }
    this.smoke = new ParticleLayer({ ...base, capacity: 4096, texture: puff }, sunDirection)
    this.spray = new ParticleLayer({ ...base, capacity: 1024, texture: sprayTexture(), shade: [0.62, 0.7, 0.78], fadeIn: 0.02, fadeOut: 1.1, streak: 0.09, water: "vanish" }, sunDirection)
    this.droplets = new ParticleLayer(
      { ...base, capacity: 2048, texture: dot, sorted: false, fadeIn: 0.01, fadeOut: 0.6, streak: 0.035, water: "vanish" },
      sunDirection,
    )
    const hot: Omit<ParticleLayerOptions, "capacity" | "texture"> = { ...base, blending: "additive", lit: false, sorted: false, fadeIn: 0.001 }
    this.fire = new ParticleLayer({ ...hot, capacity: 512, texture: flashTexture(), fadeOut: 1.6, endTint: [0.55, 0.22, 0.06] }, sunDirection)
    this.sparks = new ParticleLayer({ ...hot, capacity: 1024, texture: dot, fadeOut: 1.2, endTint: [0.7, 0.25, 0.05], streak: 0.012, water: "vanish" }, sunDirection)
    this.foam = new ParticleLayer({ ...base, capacity: 256, texture: foamTexture(), lit: false, sorted: false, fadeIn: 0.05, fadeOut: 1.6, water: "ride" }, sunDirection)
    this.chips = new ChipLayer(512)
    this.chips.onWater = (x, y, z, speed) => this.#plop(x, y, z, speed)
    this.#layers = [this.foam, this.smoke, this.spray, this.droplets, this.fire, this.sparks]
    for (const layer of this.#layers) scene.add(layer.mesh)
    scene.add(this.chips.mesh)
    this.#lights = Array.from({ length: lightCount }, () => {
      const light = new PointLight(0xff9a4a, 0, 0, 2)
      scene.add(light)
      return light
    })
  }

  /** Live particles per layer and chips, for the debug hook. */
  counts(): Record<"smoke" | "spray" | "droplets" | "fire" | "sparks" | "foam" | "chips", number> {
    return {
      smoke: this.smoke.count,
      spray: this.spray.count,
      droplets: this.droplets.count,
      fire: this.fire.count,
      sparks: this.sparks.count,
      foam: this.foam.count,
      chips: this.chips.count,
    }
  }

  /** One gun fires from (x, y, z) along the unit barrel (dx, dy, dz): flash, light, embers and a bank of smoke. */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const p = this.#p
    this.#at(x + dx * 1.4, y + dy * 1.4, z + dz * 1.4)
    this.#look(0, 0, 0, 5, 8.5, 0.12, 6, 3.4, 1.2, 1)
    p.rotation = Math.random() * Math.PI * 2
    this.fire.emit(p)
    for (let i = 0; i < 8; i++) {
      const out = random(0.8, 4)
      const speed = random(25, 80)
      this.#at(x + dx * out, y + dy * out, z + dz * out)
      this.#look(dx * speed + jitter(6), dy * speed + jitter(6), dz * speed + jitter(6), random(2, 3), random(4, 6.5), random(0.09, 0.18), 5.5, 2.6, 0.8, 1)
      p.drag = 14
      p.rotation = Math.random() * Math.PI * 2
      this.fire.emit(p)
    }
    for (let i = 0; i < 8; i++) {
      const speed = random(20, 60)
      this.#at(x + dx, y + dy, z + dz)
      this.#look(dx * speed + jitter(12), dy * speed + jitter(12) + 3, dz * speed + jitter(12), 0.12, 0.06, random(0.3, 0.7), 9, 3.8, 0.9, 1)
      p.gravity = 9.81
      p.drag = 1.2
      p.shape = ParticleShape.streak
      this.sparks.emit(p)
    }
    for (let i = 0; i < 4; i++) {
      this.#at(x + dx * random(0.5, 2.5), y + dy + random(-0.3, 0.6), z + dz * random(0.5, 2.5))
      this.#look(dx * random(4, 12), random(0.5, 2), dz * random(4, 12), random(2.5, 3.5), random(7, 10), random(2.5, 4), 0.3, 0.29, 0.28, 0.9)
      this.#drift(1.8, 0.4, -0.2)
      this.smoke.emit(p)
    }
    for (let i = 0; i < 14; i++) {
      const out = random(1, 5)
      const speed = random(8, 45)
      this.#at(x + dx * out, y + dy * out + jitter(0.5), z + dz * out)
      const tone = random(0.85, 1.12)
      this.#look(dx * speed + jitter(4), dy * speed + random(0, 3), dz * speed + jitter(4), random(2.5, 3.5), random(13, 22), random(10, 16), 0.8 * tone, 0.77 * tone, 0.72 * tone, random(0.5, 0.78))
      this.#drift(random(1, 1.5), 0.45, -0.3)
      this.smoke.emit(p)
    }
    const light = this.#lights[this.#nextLight]
    if (light !== undefined) {
      light.position.set(x + dx * 3, y + dy * 3 + 0.5, z + dz * 3)
      this.#lightAge[this.#nextLight] = 0
    }
    this.#nextLight = (this.#nextLight + 1) % lightCount
  }

  /** The fuse at a touch hole takes: a few sparks and a thread of smoke, played locally on click. */
  fuse(x: number, y: number, z: number): void {
    const p = this.#p
    for (let i = 0; i < 5; i++) {
      this.#at(x, y + 0.2, z)
      this.#look(jitter(2), random(2, 5), jitter(2), 0.07, 0.03, random(0.25, 0.5), 8, 4.5, 1.4, 1)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.sparks.emit(p)
    }
    this.#at(x, y + 0.3, z)
    this.#look(0, 1.2, 0, 0.25, 1.4, 1.4, 0.7, 0.68, 0.66, 0.4)
    this.#drift(2, 0.6, -0.4)
    this.smoke.emit(p)
  }

  /** A ball meets the sea at (x, y, z) at `speed` m/s: a column and crown of spray, drifting mist and a foam ring. */
  splash(x: number, y: number, z: number, speed: number): void {
    const k = Math.min(1.4, Math.max(0.5, speed / 75))
    const p = this.#p
    for (let i = 0; i < 22; i++) {
      const rise = Math.pow(Math.random(), 0.6)
      this.#at(x + jitter(1.1 * k), y + random(0, 0.8), z + jitter(1.1 * k))
      this.#look(jitter(2.4 * k), (7 + 14 * rise) * k, jitter(2.4 * k), 1.8 * k, random(4, 7) * k, 1.4 + 1.6 * rise, 1.35, 1.4, 1.45, 0.9)
      p.gravity = 9.81
      p.drag = 0.35
      p.windShare = 0.4
      p.shape = ParticleShape.streak
      this.spray.emit(p)
    }
    for (let i = 0; i < 48; i++) {
      const angle = Math.random() * Math.PI * 2
      const out = random(3, 10) * k
      this.#at(x + Math.cos(angle) * 0.8 * k, y + 0.3, z + Math.sin(angle) * 0.8 * k)
      this.#look(Math.cos(angle) * out, random(4, 16) * k, Math.sin(angle) * out, random(0.25, 0.5), 0.2, 3, 1.3, 1.35, 1.4, 0.9)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.droplets.emit(p)
    }
    for (let i = 0; i < 5; i++) {
      this.#at(x + jitter(1.5 * k), y + random(0.5, 3) * k, z + jitter(1.5 * k))
      this.#look(jitter(1), random(1, 3), jitter(1), 2.5 * k, random(8, 12) * k, random(3, 4.5), 1.0, 1.04, 1.08, 0.32)
      this.#drift(0.8, 0.8, 0)
      this.spray.emit(p)
    }
    for (let i = 0; i < 2; i++) {
      this.#at(x, y, z)
      this.#look(0, 0, 0, 2 * k, random(10, 15) * k, random(5, 7.5), 0.9, 0.95, 0.97, 0.75)
      p.shape = ParticleShape.flat
      p.rotation = Math.random() * Math.PI * 2
      p.spin = jitter(0.1)
      this.foam.emit(p)
    }
  }

  /** A ball strikes a hull at (x, y, z) travelling along unit (dx, dy, dz): brick chips, splinters, dust and a spark of impact. */
  hit(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const p = this.#p
    const c = this.#c
    this.#at(x - dx * 0.5, y - dy * 0.5, z - dz * 0.5)
    this.#look(0, 0, 0, 3.2, 4.5, 0.08, 7, 4.6, 2.4, 1)
    this.fire.emit(p)
    for (let i = 0; i < 18; i++) {
      c.x = x + jitter(0.4)
      c.y = y + jitter(0.4)
      c.z = z + jitter(0.4)
      const back = random(2, 9)
      c.vx = -dx * back + jitter(5)
      c.vy = random(3, 10)
      c.vz = -dz * back + jitter(5)
      const brick = Math.random() < 0.5
      c.sx = 0.4
      c.sy = brick ? 0.48 : 0.16
      c.sz = brick ? 0.8 : 0.4
      c.color.copy(chipColors[i % chipColors.length] ?? splinterColor)
      c.life = random(4, 8)
      this.chips.throw(c)
    }
    for (let i = 0; i < 10; i++) {
      c.x = x
      c.y = y
      c.z = z
      const speed = random(4, 12)
      c.vx = -dx * speed + jitter(6)
      c.vy = random(2, 9)
      c.vz = -dz * speed + jitter(6)
      c.sx = 0.07
      c.sy = 0.07
      c.sz = random(0.6, 1.3)
      c.color.copy(splinterColor)
      c.life = random(3, 6)
      this.chips.throw(c)
    }
    for (let i = 0; i < 12; i++) {
      this.#at(x, y, z)
      const speed = random(8, 25)
      this.#look(-dx * speed + jitter(8), random(1, 8), -dz * speed + jitter(8), 0.1, 0.05, random(0.2, 0.5), 7, 4, 1.5, 1)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.sparks.emit(p)
    }
    for (let i = 0; i < 7; i++) {
      this.#at(x - dx + jitter(0.6), y + jitter(0.6), z - dz + jitter(0.6))
      this.#look(-dx * random(2, 6) + jitter(2), random(0.5, 2.5), -dz * random(2, 6) + jitter(2), 1.2, random(5, 8), random(2.5, 4.5), 0.46, 0.39, 0.31, 0.7)
      this.#drift(1.6, 0.8, -0.2)
      this.smoke.emit(p)
    }
  }

  /** A faint wisp behind a ball in flight, so the arc reads at range. */
  trail(x: number, y: number, z: number): void {
    this.#at(x, y, z)
    this.#look(0, 0, 0, 0.3, random(1.2, 1.8), random(0.7, 1.1), 0.8, 0.78, 0.76, 0.22)
    this.#drift(2, 1, 0)
    this.smoke.emit(this.#p)
  }

  /** Advances every effect by `dt` seconds; `time` is the sim time the sea is drawn at, wind in m/s. */
  update(dt: number, time: number, windX: number, windZ: number, sea: SeaState | undefined, camera: Camera): void {
    for (const layer of this.#layers) layer.update(dt, time, windX, windZ, sea, camera)
    this.chips.update(dt, time, sea)
    for (let i = 0; i < lightCount; i++) {
      const age = this.#lightAge[i]! + dt
      this.#lightAge[i] = age
      const light = this.#lights[i]
      if (light !== undefined) light.intensity = age > lightSeconds * 8 ? 0 : lightPeak * Math.exp(-age / lightSeconds)
    }
  }

  /** A chip or splinter drops into the sea. */
  #plop(x: number, y: number, z: number, speed: number) {
    const p = this.#p
    const n = speed > 6 ? 5 : 2
    for (let i = 0; i < n; i++) {
      this.#at(x, y, z)
      this.#look(jitter(1.5), random(1.5, 4), jitter(1.5), 0.12, 0.08, 1, 1.1, 1.14, 1.18, 0.85)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.droplets.emit(p)
    }
    this.#at(x, y, z)
    this.#look(0, 0, 0, 0.4, 1.6, 2.5, 0.9, 0.95, 0.97, 0.6)
    p.shape = ParticleShape.flat
    this.foam.emit(p)
  }

  #at(x: number, y: number, z: number) {
    const p = this.#p
    p.x = x
    p.y = y
    p.z = z
  }

  /** Sets motion and look, and resets the rest of the spawn record to neutral. */
  #look(vx: number, vy: number, vz: number, size: number, endSize: number, life: number, r: number, g: number, b: number, alpha: number) {
    const p = this.#p
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.size = size
    p.endSize = endSize
    p.life = life
    p.r = r
    p.g = g
    p.b = b
    p.alpha = alpha
    p.drag = 0
    p.gravity = 0
    p.windShare = 0
    p.rotation = 0
    p.spin = 0
    p.shape = ParticleShape.billboard
  }

  /** Smoke-like motion: relaxes to the wind at `drag`/s, carried by `windShare` of it, rising at −`gravity`. */
  #drift(drag: number, windShare: number, gravity: number) {
    const p = this.#p
    p.drag = drag
    p.windShare = windShare
    p.gravity = gravity
    p.rotation = Math.random() * Math.PI * 2
    p.spin = jitter(0.25)
  }
}
