import { CanvasTexture, Color, PointLight, type Camera, type Scene, type Texture, type Vector3 } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
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
/** Dust off shattered brick and timber: warm grey-tan. */
const dustColor = [0.5, 0.43, 0.34] as const

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
  readonly #lightPeak = new Float32Array(lightCount)
  #nextLight = 0
  #sea: SeaState | undefined
  #seaTime = 0
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
      soft: 1.5,
    }
    this.smoke = new ParticleLayer({ ...base, capacity: 8192, texture: puff, soft: 3 }, sunDirection)
    this.spray = new ParticleLayer({ ...base, capacity: 1024, texture: sprayTexture(), shade: [0.62, 0.7, 0.78], brightness: 0.42, fadeIn: 0.02, fadeOut: 1.1, streak: 0.09, water: "vanish" }, sunDirection)
    this.droplets = new ParticleLayer(
      { ...base, capacity: 2048, texture: dot, brightness: 0.45, soft: 0.15, sorted: false, fadeIn: 0.01, fadeOut: 0.6, streak: 0.035, water: "vanish" },
      sunDirection,
    )
    const hot: Omit<ParticleLayerOptions, "capacity" | "texture"> = { ...base, blending: "additive", lit: false, sorted: false, fadeIn: 0.001, soft: 0.6 }
    this.fire = new ParticleLayer({ ...hot, capacity: 512, texture: flashTexture(), fadeOut: 1.6, endTint: [0.55, 0.22, 0.06] }, sunDirection)
    this.sparks = new ParticleLayer({ ...hot, capacity: 1024, texture: dot, fadeOut: 1.2, endTint: [0.7, 0.25, 0.05], streak: 0.012, water: "vanish", soft: 0.1 }, sunDirection)
    this.foam = new ParticleLayer({ ...base, capacity: 768, texture: foamTexture(), brightness: 0.5, lit: false, sorted: false, fadeIn: 0.05, fadeOut: 1.6, water: "ride", soft: 0.3, softLift: 0.6 }, sunDirection)
    this.chips = new ChipLayer(512)
    this.chips.onWater = (x, y, z, speed) => this.plop(x, y, z, speed)
    this.#layers = [this.foam, this.smoke, this.spray, this.droplets, this.fire, this.sparks]
    for (const layer of this.#layers) scene.add(layer.mesh)
    scene.add(this.chips.mesh)
    this.#lights = Array.from({ length: lightCount }, () => {
      const light = new PointLight(0xff9a4a, 0, 0, 2)
      scene.add(light)
      return light
    })
  }

  /** The pooled muzzle-flash lights, for surfaces that light themselves (the sea). */
  get flashLights(): ReadonlyArray<PointLight> {
    return this.#lights
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

  /**
   * One gun fires from (x, y, z) along the unit barrel (dx, dy, dz): a white-hot flash and light, a cone of flame, sparks
   * and burning wadding, a jet of smoke whose head rolls out as a ring and then hangs and drifts downwind for half a
   * minute, and the blast slapping the water below: a fast ring and a sheet of spray.
   */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const p = this.#p
    this.#at(x + dx * 1.2, y + dy * 1.2, z + dz * 1.2)
    this.#look(0, 0, 0, 7, 11, 0.07, 12, 9, 6, 1)
    p.rotation = Math.random() * Math.PI * 2
    this.fire.emit(p)
    this.#at(x + dx * 1.4, y + dy * 1.4, z + dz * 1.4)
    this.#look(0, 0, 0, 5, 8.5, 0.14, 6, 3.4, 1.2, 1)
    p.rotation = Math.random() * Math.PI * 2
    this.fire.emit(p)
    for (const [out, size] of [[0.9, 2.8], [2, 3.6], [3.3, 3.2], [4.7, 2.4], [6.2, 1.6]] as const) {
      this.#at(x + dx * out, y + dy * out, z + dz * out)
      this.#look(dx * 6, dy * 6, dz * 6, size, size * 1.6, random(0.07, 0.12), 8, 4.2, 1.3, 1)
      p.rotation = Math.random() * Math.PI * 2
      this.fire.emit(p)
    }
    for (let i = 0; i < 6; i++) {
      const speed = random(8, 22)
      this.#at(x + dx * 1.5, y + dy * 1.5, z + dz * 1.5)
      this.#look(dx * speed + jitter(4), dy * speed + random(1, 5), dz * speed + jitter(4), 0.16, 0.1, random(1.4, 2.6), 3.2, 1.2, 0.3, 1)
      p.gravity = 9.81
      p.drag = 0.9
      p.shape = ParticleShape.streak
      this.sparks.emit(p)
    }
    for (let i = 0; i < 6; i++) {
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
    // The jet: dense, dark-cored puffs shot out along the barrel that pile up where the drag stops them.
    for (let i = 0; i < 7; i++) {
      const speed = random(6, 40)
      this.#at(x + dx * random(0.5, 2.5), y + dy * random(0.5, 2.5) + jitter(0.3), z + dz * random(0.5, 2.5))
      const tone = random(0.5, 0.8)
      this.#look(dx * speed + jitter(2), dy * speed + random(0, 1.5), dz * speed + jitter(2), random(2.2, 3.2), random(14, 22), random(8, 16), tone, tone * 0.97, tone * 0.93, random(0.75, 0.95))
      this.#drift(random(1.3, 2), 0.55, -0.1)
      this.smoke.emit(p)
    }
    // The head of the jet curls back on itself: a ring of puffs rolling outward round the barrel's line.
    const sideX = -dz
    const sideZ = dx
    const across = Math.hypot(sideX, sideZ) || 1
    const ux = sideX / across
    const uz = sideZ / across
    const ring = 7
    const turn = Math.random() * Math.PI * 2
    for (let i = 0; i < ring; i++) {
      const a = turn + (i / ring) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const rx = ux * c
      const ry = sn
      const rz = uz * c
      const speed = random(22, 32)
      const out = random(3, 4.5)
      this.#at(x + dx * out + rx * 0.8, y + dy * out + ry * 0.8, z + dz * out + rz * 0.8)
      const tone = random(0.78, 1.05)
      this.#look(dx * speed + rx * random(4, 7), dy * speed + ry * random(4, 7) + 0.5, dz * speed + rz * random(4, 7), random(2.6, 3.6), random(20, 28), random(18, 28), 0.82 * tone, 0.8 * tone, 0.76 * tone, random(0.6, 0.8))
      this.#drift(random(1.1, 1.5), 0.6, -0.14)
      p.spin = (i % 2 === 0 ? 1 : -1) * random(0.3, 0.6)
      this.smoke.emit(p)
    }
    // A low bank hugging the water, as the heavy smoke of a broadside settles and rolls downwind.
    for (let i = 0; i < 2; i++) {
      const out = random(5, 12)
      this.#at(x + dx * out, Math.max(0.8, y - 2 + random(0, 1)), z + dz * out)
      this.#look(dx * random(4, 10), 0, dz * random(4, 10), random(5, 7), random(24, 32), random(22, 30), 0.78, 0.76, 0.72, 0.45)
      this.#drift(0.9, 0.55, 0)
      this.smoke.emit(p)
    }
    this.#blastOnWater(x + dx * 3, y, z + dz * 3, dx, dz)
    this.flash(x + dx * 3, y + dy * 3 + 0.5, z + dz * 3, 1.4)
  }

  /** The muzzle blast at height `y` slaps the sea under (x, z), outward along (dx, dz): a racing ring, a flattened sheet of spray and mist. */
  #blastOnWater(x: number, y: number, z: number, dx: number, dz: number) {
    const sea = this.#sea
    const water = sea === undefined ? 0 : oceanHeight(sea, x, z, this.#seaTime)
    const height = y - water
    if (height > 8) return
    const k = 1 - Math.max(0, height) / 10
    const p = this.#p
    this.#at(x, water, z)
    this.#look(0, 0, 0, 2, 22 * k, 0.8, 0.95, 0.98, 1, 0.6 * k)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    this.foam.emit(p)
    this.#at(x + dx * 4, water, z + dz * 4)
    this.#look(dx * 3, 0, dz * 3, 4, 26 * k, 2.6, 0.92, 0.96, 0.98, 0.35 * k)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    this.foam.emit(p)
    for (let i = 0; i < 12; i++) {
      const a = Math.atan2(dz, dx) + jitter(1.1)
      const speed = random(6, 16) * k
      this.#at(x + Math.cos(a) * 1.5, water + 0.2, z + Math.sin(a) * 1.5)
      this.#look(Math.cos(a) * speed, random(1.5, 4), Math.sin(a) * speed, random(0.2, 0.4), 0.2, 1.5, 1.2, 1.25, 1.3, 0.8)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.droplets.emit(p)
    }
    for (let i = 0; i < 3; i++) {
      const out = random(2, 8)
      this.#at(x + dx * out + jitter(1.5), water + random(0.3, 1), z + dz * out + jitter(1.5))
      this.#look(dx * random(4, 9), random(0.3, 1.2), dz * random(4, 9), 2 * k, random(7, 11) * k, random(1.2, 2), 1.0, 1.04, 1.08, 0.4 * k)
      this.#drift(1.2, 0.6, 0)
      this.spray.emit(p)
    }
  }

  /** A brief warm light at (x, y, z) that also lights the sea; `strength` 1 is a muzzle flash. */
  flash(x: number, y: number, z: number, strength: number): void {
    const light = this.#lights[this.#nextLight]
    if (light !== undefined) {
      light.position.set(x, y, z)
      this.#lightAge[this.#nextLight] = 0
      this.#lightPeak[this.#nextLight] = lightPeak * strength
    }
    this.#nextLight = (this.#nextLight + 1) % lightCount
  }

  /** Dust and splinters where something heavy lands on a deck, `size` 0–1.5. */
  dust(x: number, y: number, z: number, size: number): void {
    const p = this.#p
    for (let i = 0; i < 4; i++) {
      this.#at(x + jitter(1), y + random(0, 0.5), z + jitter(1))
      this.#look(jitter(3) * size, random(0.5, 2), jitter(3) * size, 1.2 * size, random(4, 7) * size, random(2, 3.5), dustColor[0], dustColor[1], dustColor[2], 0.6)
      this.#drift(1.6, 0.8, -0.2)
      this.smoke.emit(p)
    }
    const c = this.#c
    for (let i = 0; i < 6; i++) {
      c.x = x
      c.y = y + 0.2
      c.z = z
      c.vx = jitter(5)
      c.vy = random(2, 6)
      c.vz = jitter(5)
      c.sx = 0.06
      c.sy = 0.06
      c.sz = random(0.4, 0.9)
      c.color.copy(splinterColor)
      c.life = random(3, 5)
      this.chips.throw(c)
    }
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

  /** Something meets the sea at (x, y, z) at `speed` m/s (a ball ~75): a column and crown of spray, drifting mist and a foam ring, sized by the impact. */
  splash(x: number, y: number, z: number, speed: number): void {
    const k = Math.min(2.2, Math.max(0.5, speed / 75))
    const p = this.#p
    // The column: a tight, tall jet, thickest at its foot, that stands 15–20 m before it falls back.
    for (let i = 0; i < 14; i++) {
      const rise = i / 13
      this.#at(x + jitter(0.35 * k), y + 0.2, z + jitter(0.35 * k))
      this.#look(jitter(0.5), (11 + 15 * rise) * k, jitter(0.5), (1.3 - 0.5 * rise) * k, (2.6 - rise) * k, 1.8 + 1.8 * rise, 1.15, 1.2, 1.25, 0.75)
      p.gravity = 9.81
      p.drag = 0.2
      p.windShare = 0.3
      p.shape = ParticleShape.streak
      this.spray.emit(p)
    }
    // Mist thrown up with it that hangs where the column stood, so it reads as a pillar for a few seconds.
    for (let i = 0; i < 5; i++) {
      this.#at(x + jitter(0.5 * k), y + 1, z + jitter(0.5 * k))
      this.#look(jitter(0.8), random(6, 22) * k, jitter(0.8), 1.6 * k, random(5, 8) * k, random(2.5, 4), 1.05, 1.1, 1.14, 0.45)
      p.drag = 1.1
      p.gravity = 0.6
      p.windShare = 0.6
      p.rotation = Math.random() * Math.PI * 2
      this.spray.emit(p)
    }
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

  /**
   * A ball strikes a hull at (x, y, z) travelling along unit (dx, dy, dz): an ember flash with light, a burst of brick
   * chips and splinters, sparks and a dust puff. The whole bricks it knocks out are `BrickDebris`.
   */
  hit(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const p = this.#p
    const c = this.#c
    this.#at(x - dx * 0.5, y - dy * 0.5, z - dz * 0.5)
    this.#look(0, 0, 0, 3.2, 4.5, 0.08, 7, 4.6, 2.4, 1)
    this.fire.emit(p)
    for (let i = 0; i < 5; i++) {
      this.#at(x - dx * 0.8 + jitter(0.6), y + jitter(0.6), z - dz * 0.8 + jitter(0.6))
      this.#look(-dx * random(1, 4) + jitter(1.5), random(0.5, 2.5), -dz * random(1, 4) + jitter(1.5), random(0.8, 1.4), random(1.6, 2.6), random(0.18, 0.32), 5.5, 2.2, 0.5, 0.9)
      p.rotation = Math.random() * Math.PI * 2
      this.fire.emit(p)
    }
    this.flash(x - dx * 3, y + 1, z - dz * 3, 0.2)
    for (let i = 0; i < 12; i++) {
      c.x = x + jitter(0.4)
      c.y = y + jitter(0.4)
      c.z = z + jitter(0.4)
      const back = random(2, 9)
      c.vx = -dx * back + jitter(5)
      c.vy = random(3, 10)
      c.vz = -dz * back + jitter(5)
      const brick = Math.random() < 0.5
      c.sx = brick ? 0.2 : 0.14
      c.sy = brick ? 0.16 : 0.08
      c.sz = brick ? 0.3 : 0.2
      c.color.copy(chipColors[i % chipColors.length] ?? splinterColor)
      c.life = random(4, 8)
      this.chips.throw(c)
    }
    for (let i = 0; i < 18; i++) {
      c.x = x
      c.y = y
      c.z = z
      const speed = random(4, 16)
      c.vx = -dx * speed + jitter(6)
      c.vy = random(2, 9)
      c.vz = -dz * speed + jitter(6)
      c.sx = 0.07
      c.sy = 0.07
      c.sz = random(0.6, 1.6)
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
      this.#look(-dx * random(2, 6) + jitter(2), random(0.5, 2.5), -dz * random(2, 6) + jitter(2), 1.2, random(5, 8), random(2.5, 4.5), dustColor[0], dustColor[1], dustColor[2], 0.7)
      this.#drift(1.6, 0.8, -0.2)
      this.smoke.emit(p)
    }
  }

  /**
   * A foundering hull at deck point (x, y, z) over water at `water`: black smoke and embers from the deck while it is above
   * the sea, churned foam and air boiling up where the hull meets the water. `intensity` 0–1 scales it.
   */
  founder(x: number, y: number, z: number, water: number, intensity: number): void {
    const p = this.#p
    if (y > water + 0.3) {
      this.#at(x + jitter(1.5), y + random(0, 1), z + jitter(1.5))
      const tone = random(0.08, 0.16)
      this.#look(jitter(1), random(2, 4), jitter(1), random(2, 3), random(10, 16), random(6, 9), tone, tone * 0.95, tone * 0.9, 0.85 * intensity)
      this.#drift(0.8, 0.55, -1.2)
      this.smoke.emit(p)
      if (Math.random() < 0.5 * intensity) {
        this.#at(x + jitter(1.5), y + 0.4, z + jitter(1.5))
        this.#look(jitter(2), random(3, 7), jitter(2), 0.1, 0.04, random(0.6, 1.2), 8, 3.6, 1, 1)
        p.gravity = 4
        p.shape = ParticleShape.streak
        this.sparks.emit(p)
        this.#at(x, y + 0.3, z)
        this.#look(0, random(1, 2), 0, random(1.2, 2), random(2.5, 4), random(0.25, 0.4), 4.5, 2, 0.6, 0.9)
        p.rotation = Math.random() * Math.PI * 2
        this.fire.emit(p)
      }
    }
    for (let i = 0; i < 3; i++) {
      this.#at(x + jitter(4), water + 0.1, z + jitter(4))
      this.#look(jitter(1), random(1.5, 4) * intensity, jitter(1), random(0.6, 1.2), random(1.5, 3), random(0.8, 1.4), 1.2, 1.25, 1.3, 0.55)
      p.gravity = 9.81
      p.drag = 0.6
      this.spray.emit(p)
    }
    this.#at(x + jitter(3), water, z + jitter(3))
    this.#look(0, 0, 0, random(2, 4), random(7, 11), random(3, 5), 0.92, 0.96, 0.98, 0.7 * intensity)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    p.spin = jitter(0.2)
    this.foam.emit(p)
  }

  /** Trapped air bursts out of a foundering hull at the waterline (x, y, z): jets of spray and a boil of foam and mist. */
  airBurst(x: number, y: number, z: number): void {
    const p = this.#p
    for (let i = 0; i < 16; i++) {
      this.#at(x + jitter(1.5), y + 0.2, z + jitter(1.5))
      this.#look(jitter(3), random(9, 20), jitter(3), random(1, 1.8), random(3, 5), random(1.4, 2.4), 1.15, 1.2, 1.25, 0.75)
      p.gravity = 9.81
      p.drag = 0.4
      p.windShare = 0.4
      p.shape = ParticleShape.streak
      this.spray.emit(p)
    }
    for (let i = 0; i < 30; i++) {
      this.#at(x + jitter(1), y + 0.3, z + jitter(1))
      this.#look(jitter(6), random(6, 16), jitter(6), random(0.25, 0.45), 0.2, 3, 1.3, 1.35, 1.4, 0.9)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.droplets.emit(p)
    }
    for (let i = 0; i < 3; i++) {
      this.#at(x + jitter(2), y + random(1, 3), z + jitter(2))
      this.#look(jitter(1), random(1, 2), jitter(1), 3, random(10, 14), random(3, 5), 1.0, 1.03, 1.06, 0.4)
      this.#drift(0.8, 0.8, 0)
      this.spray.emit(p)
    }
    this.#at(x, y, z)
    this.#look(0, 0, 0, 2, random(9, 13), random(4, 6), 0.95, 0.97, 1, 0.85)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    this.foam.emit(p)
  }

  /** Air boiling up through the water round a sinking hull at (x, y, z): white bubbles bursting in foam. */
  bubbles(x: number, y: number, z: number, spread: number): void {
    const p = this.#p
    for (let i = 0; i < 4; i++) {
      this.#at(x + jitter(spread), y + 0.05, z + jitter(spread))
      this.#look(jitter(0.4), random(0.6, 1.6), jitter(0.4), random(0.15, 0.3), 0.05, random(0.4, 0.8), 1.3, 1.35, 1.4, 0.85)
      p.gravity = 2
      p.shape = ParticleShape.billboard
      this.droplets.emit(p)
    }
    this.#at(x + jitter(spread), y, z + jitter(spread))
    this.#look(0, 0, 0, random(0.8, 1.6), random(2.5, 4), random(1.5, 2.5), 0.95, 0.97, 1, 0.8)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    this.foam.emit(p)
  }

  /** The whirl where a hull went down at (x, y, z): foam wheeling round and in; `strength` fades 1 → 0 over its life. */
  vortex(x: number, y: number, z: number, strength: number): void {
    const p = this.#p
    const arms = 3
    for (let i = 0; i < arms * 2; i++) {
      const radius = random(2, 11)
      const angle = (i % arms) * ((Math.PI * 2) / arms) + radius * 0.35 + Math.random() * 0.4
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const swirl = 5 / Math.sqrt(radius)
      this.#at(x + cos * radius, y, z + sin * radius)
      // Tangential and a little inward: the spiral a drain draws.
      this.#look(-sin * swirl * radius * 0.5 - cos * 1.2, 0, cos * swirl * radius * 0.5 - sin * 1.2, random(1.2, 2.4), random(3, 5), random(2.5, 4), 0.95, 0.97, 1, 0.85 * strength)
      p.drag = 0.5
      p.shape = ParticleShape.flat
      p.rotation = angle
      p.spin = 0.9
      this.foam.emit(p)
    }
    this.#at(x, y, z)
    this.#look(0, 0, 0, random(4, 6), random(8, 12), random(2, 3), 0.9, 0.95, 0.97, 0.7 * strength)
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    p.spin = 1.2
    this.foam.emit(p)
  }

  /** The hull slips under at (x, y, z): the sea closes over it in a heave of spray, a ring of foam and a last breath of steam. */
  plunge(x: number, y: number, z: number): void {
    const p = this.#p
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2
      const out = random(2, 9)
      this.#at(x + Math.cos(angle) * random(1, 8), y + 0.2, z + Math.sin(angle) * random(1, 8))
      this.#look(Math.cos(angle) * out, random(5, 14), Math.sin(angle) * out, random(1.5, 2.8), random(5, 9), random(1.6, 2.8), 1.35, 1.4, 1.45, 0.85)
      p.gravity = 9.81
      p.drag = 0.3
      p.windShare = 0.3
      p.shape = ParticleShape.streak
      this.spray.emit(p)
    }
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2
      const out = random(4, 12)
      this.#at(x + Math.cos(angle) * 3, y + 0.3, z + Math.sin(angle) * 3)
      this.#look(Math.cos(angle) * out, random(4, 13), Math.sin(angle) * out, random(0.25, 0.5), 0.2, 3, 1.3, 1.35, 1.4, 0.9)
      p.gravity = 9.81
      p.shape = ParticleShape.streak
      this.droplets.emit(p)
    }
    for (let i = 0; i < 8; i++) {
      this.#at(x + jitter(6), y + random(0.5, 3), z + jitter(6))
      this.#look(jitter(1), random(1, 2.5), jitter(1), 4, random(14, 20), random(4, 6), 1.0, 1.03, 1.06, 0.35)
      this.#drift(0.8, 0.8, 0)
      this.spray.emit(p)
    }
    for (let i = 0; i < 4; i++) {
      this.#at(x + jitter(4), y, z + jitter(4))
      this.#look(0, 0, 0, random(6, 9), random(22, 30), random(7, 10), 0.9, 0.95, 0.97, 0.8)
      p.shape = ParticleShape.flat
      p.rotation = Math.random() * Math.PI * 2
      p.spin = jitter(0.08)
      this.foam.emit(p)
    }
  }

  /**
   * Sea pouring into a foundering hull at the waterline point (x, y, z), flowing along the unit (dx, dz): sheets of white
   * water tumbling over the rail or through a hole, and foam swept after them. `intensity` 0–1 scales it.
   */
  inrush(x: number, y: number, z: number, dx: number, dz: number, intensity: number): void {
    const p = this.#p
    for (let i = 0; i < 2; i++) {
      const speed = random(1.5, 3.5)
      this.#at(x + jitter(0.8), y + random(0, 0.4), z + jitter(0.8))
      this.#look(dx * speed + jitter(0.5), random(0.4, 1.8), dz * speed + jitter(0.5), random(0.7, 1.2), random(2, 3.2), random(0.6, 1), 1.15, 1.2, 1.25, 0.65 * intensity)
      p.gravity = 9.81
      p.drag = 0.5
      p.shape = ParticleShape.streak
      this.spray.emit(p)
    }
    this.#at(x + jitter(1), y, z + jitter(1))
    this.#look(dx * 1.5, 0, dz * 1.5, random(1.2, 2.2), random(3.5, 6), random(2, 3.5), 0.93, 0.96, 0.99, 0.75 * intensity)
    p.drag = 0.7
    p.shape = ParticleShape.flat
    p.rotation = Math.random() * Math.PI * 2
    p.spin = jitter(0.3)
    this.foam.emit(p)
  }

  /**
   * A battered ship smoulders from the hole at (x, y, z): a column of smoke, greyer when `intensity` (0–1) is low and
   * black when high; `burning` adds flame licking out of it and the odd ember.
   */
  smoulder(x: number, y: number, z: number, intensity: number, burning: boolean): void {
    const p = this.#p
    const tone = 0.3 - 0.2 * intensity + random(-0.03, 0.03)
    this.#at(x + jitter(0.4), y + random(0, 0.4), z + jitter(0.4))
    this.#look(jitter(0.4), random(1.5, 3), jitter(0.4), random(0.8, 1.4), random(6, 10), random(5, 8), tone, tone * 0.96, tone * 0.92, 0.35 + 0.45 * intensity)
    this.#drift(0.7, 0.6, -0.8)
    this.smoke.emit(p)
    if (!burning) return
    this.#at(x + jitter(0.3), y + random(0, 0.3), z + jitter(0.3))
    this.#look(jitter(0.4), random(1, 2.2), jitter(0.4), random(0.6, 1.1), random(1.3, 2.2), random(0.25, 0.45), 4.5, 2, 0.6, 0.85)
    p.rotation = Math.random() * Math.PI * 2
    this.fire.emit(p)
    if (Math.random() < 0.3) {
      this.#at(x, y + 0.3, z)
      this.#look(jitter(1.5), random(2, 5), jitter(1.5), 0.08, 0.03, random(0.6, 1.2), 8, 3.6, 1, 1)
      p.gravity = 4
      p.shape = ParticleShape.streak
      this.sparks.emit(p)
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
    this.#sea = sea
    this.#seaTime = time
    for (const layer of this.#layers) layer.update(dt, time, windX, windZ, sea, camera)
    this.chips.update(dt, time, sea)
    for (let i = 0; i < lightCount; i++) {
      const age = this.#lightAge[i]! + dt
      this.#lightAge[i] = age
      const light = this.#lights[i]
      if (light !== undefined) light.intensity = age > lightSeconds * 8 ? 0 : this.#lightPeak[i]! * Math.exp(-age / lightSeconds)
    }
  }

  /** A chip, splinter or brick drops into the sea at `speed` m/s. */
  plop(x: number, y: number, z: number, speed: number): void {
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
