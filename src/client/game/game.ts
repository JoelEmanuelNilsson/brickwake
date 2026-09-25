import { ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight, LinearSRGBColorSpace, PCFShadowMap, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from "three"
import type { ScenarioName } from "../../sim/scenarios.ts"
import type { ClientMessage, MatchPhaseSnapshot, ServerEvent, ServerMessage, WindSnapshot } from "../../protocol/messages.ts"
import { ffaRules } from "../../sim/rules.ts"
import { tuning } from "../../sim/tuning.ts"
import { GameAudio } from "../audio/game-audio.ts"
import { ChaseCamera } from "./chase-camera.ts"
import { connect, type Connection } from "./connection.ts"
import { Controls } from "./controls.ts"
import { type FrameMeasure, installDebugHook } from "./debug-hook.ts"
import { Effects } from "./effects.ts"
import { type GalleonModel, loadGalleon } from "./galleon.ts"
import { FrameStats } from "./frame-stats.ts"
import { Gunnery } from "./gunnery.ts"
import { GunDeckLanterns } from "./gunport-view.ts"
import { HitIndicator } from "./hit-indicator.ts"
import { Hud, type HudReading } from "./hud.ts"
import { MatchHud, type MatchReading } from "./match-hud.ts"
import { OceanSurface } from "./ocean.ts"
import { Reticle } from "./reticle.ts"
import { RenderPipeline } from "./render-pipeline.ts"
import { ShipView } from "./ship-view.ts"
import { SinkingShips } from "./sinking.ts"
import { createGameSky, type GameSky } from "./sky.ts"
import { EventQueue, SnapshotTimeline } from "./timeline.ts"
import { WakeField, wakePeriod } from "./wake.ts"

/** What every render-loop hook sees for one frame. One object, rewritten each frame. */
export interface FrameContext {
  /** Seconds since the previous frame, capped at 0.1. */
  dt: number
  /** Sim time the world is drawn at, seconds. */
  renderTime: number
  /** `renderTime` in (fractional) sim ticks. */
  renderTick: number
}

/** Per-frame work added by later systems (balls, effects); runs after ships are posed, before rendering. */
export type FrameHook = (frame: FrameContext) => void

/** Handles a server event once the render clock reaches its tick. */
export type EventHandler = (event: ServerEvent) => void

/** The page elements the game draws its interface into. */
export interface GameElements {
  readonly hud: HTMLElement
  readonly overlay: HTMLElement
  readonly status: HTMLElement
  readonly reticle: HTMLElement
  /** Match layer: clock, kill feed, hull and guns, banners, scoreboard. */
  readonly match: HTMLElement
  /** Hit-direction arcs around the reticle. */
  readonly hits: HTMLElement
}

/** A low sunset sun, 5° up, and the colour its light reaches the sea with (linear HDR). */
const sunDirection = new Vector3().setFromSphericalCoords(1, (85 * Math.PI) / 180, 1.25)
const sunColor = new Color().setRGB(1.8, 0.75, 0.25, LinearSRGBColorSpace)
/** Muzzle-flash light colour, as the pooled PointLights in `Effects`. */
const flashColor = new Color(0xff9a4a)
const fogDensity = 0.0011
/** Half the side of the square the sun's shadow map covers around the camera's ship, metres: this ship and its close neighbours. */
const shadowHalfWidth = 45
/** How far up-sun the shadow camera stands, metres; the low sun's shadow box runs twice this deep. */
const shadowReach = 150
const maxFrameSeconds = 0.1

/** How far above the highest possible crest the camera stays, metres. */
const cameraClearance = 1.5

/** The running game: connection, snapshot timeline, scene, render loop, HUD and debug hook. */
export class Game {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  readonly hooks: Array<FrameHook> = []
  readonly eventHandlers: Array<EventHandler> = []
  readonly #pipeline: RenderPipeline
  readonly #sun = new DirectionalLight(0xffb27a, 3.2)
  /** A warm light from over the camera's shoulder, as ref-01 lights the faces it shows: hulls read in colour even against the sun. */
  readonly #fill = new DirectionalLight(0xffc896, 1.4)
  readonly #sky: GameSky
  readonly #wake = new WakeField()
  readonly #galleon: GalleonModel
  readonly #lanterns: GunDeckLanterns
  /** Built ships not in play: views are built at load, so a ship joining mid-match costs no frame. */
  readonly #spareViews: Array<ShipView> = []
  readonly #connection: Connection
  readonly #frame: FrameContext = { dt: 0, renderTime: 0, renderTick: 0 }
  readonly #stats: FrameStats
  readonly #ships = new Map<string, { readonly view: ShipView; seen: number }>()
  readonly #appliedEvents: Array<ServerEvent> = []
  readonly #sweep = (entry: { readonly view: ShipView; seen: number }, id: string) => {
    if (entry.seen === this.#frameCount) return
    this.scene.remove(entry.view.group)
    this.#spareViews.push(entry.view)
    this.#ships.delete(id)
  }
  readonly #applyEvent = (event: ServerEvent) => {
    this.#appliedEvents.push(event)
    if (this.#appliedEvents.length > 32) this.#appliedEvents.shift()
    for (let i = 0; i < this.eventHandlers.length; i++) this.eventHandlers[i]?.(event)
  }
  #camera: ChaseCamera | undefined
  #controls: Controls | undefined
  readonly #hud: Hud
  readonly #matchHud: MatchHud
  readonly #hitIndicator: HitIndicator
  readonly #sinking: SinkingShips
  #phase: MatchPhaseSnapshot = { _tag: "warmup", endsAt: 0 }
  readonly #matchReading: MatchReading
  /** All game sound; `audio.volume` is the persisted volume setting. */
  readonly audio = new GameAudio()
  /** Gun and impact effects; later systems (debris, sinking) add their own through it. */
  readonly effects: Effects
  readonly #gunnery: Gunnery
  #ocean: OceanSurface | undefined
  #timeline: SnapshotTimeline | undefined
  #events = new EventQueue<ServerEvent>()
  #shipId: string | null = null
  #wind: WindSnapshot = { toward: 0, speed: 0 }
  #sailing = false
  #frameCount = 0
  #lastFrameMs = Number.NaN
  readonly #reading: HudReading = { speed: 0, sailLevel: 0, sailSet: 0, rudderAngle: 0, heading: 0, windToward: 0, windSpeed: 0, viewYaw: 0 }

  readonly canvas: HTMLCanvasElement
  readonly #orbit: number
  readonly elements: GameElements

  constructor(
    canvas: HTMLCanvasElement,
    elements: GameElements,
    options: {
      readonly scenario: ScenarioName | undefined
      readonly room: string | undefined
      readonly pixelRatio: number
      readonly orbit: number
      /** MSAA samples of the scene target. */
      readonly samples: number
      readonly bloom: boolean
      readonly shadows: boolean
    },
  ) {
    this.canvas = canvas
    this.elements = elements
    this.#orbit = options.orbit
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(options.pixelRatio)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.5
    // The frame renders several passes; counters reset once per frame so they count all of them.
    this.renderer.info.autoReset = false
    this.#pipeline = new RenderPipeline(this.renderer, this.scene, options.samples)
    this.#pipeline.bloom = options.bloom
    this.#stats = new FrameStats(this.renderer)
    this.#hud = new Hud(elements.hud)
    this.#matchHud = new MatchHud(elements.match)
    this.#matchReading = { dt: 0, renderTime: 0, rules: ffaRules, phase: this.#phase, ownId: "", own: undefined, ships: this.#ships }
    this.#hitIndicator = new HitIndicator(elements.hits)

    this.#sky = createGameSky(this.renderer, sunDirection)
    this.scene.fog = new FogExp2(0, fogDensity)
    this.scene.fog.color.copy(this.#sky.horizon)
    this.scene.add(this.#sky.dome)
    this.scene.environment = this.#sky.environment
    this.scene.environmentIntensity = 0.4
    const sun = this.#sun
    sun.position.copy(sunDirection).multiplyScalar(shadowReach)
    this.renderer.shadowMap.enabled = options.shadows
    this.renderer.shadowMap.type = PCFShadowMap
    sun.castShadow = options.shadows
    sun.shadow.mapSize.set(2048, 2048)
    const box = sun.shadow.camera
    box.left = -shadowHalfWidth
    box.right = shadowHalfWidth
    box.top = shadowHalfWidth
    box.bottom = -shadowHalfWidth
    box.near = 1
    box.far = shadowReach * 2
    sun.shadow.bias = -0.0003
    sun.shadow.normalBias = 0.03
    this.scene.add(sun, sun.target, new HemisphereLight(0xffc49a, 0x0b2a30, 1.1), this.#fill)
    this.effects = new Effects(this.scene, sunDirection)
    this.#galleon = loadGalleon()
    this.#lanterns = new GunDeckLanterns(this.scene, this.#galleon)
    for (let i = 0; i < tuning.match.maxShips; i++) this.#spareViews.push(new ShipView(`spare ${i}`, this.#galleon))
    // Compile every ship shader now, so the first ship in view costs no frame.
    const warm = this.#spareViews[0]
    if (warm !== undefined) {
      this.scene.add(warm.group)
      this.renderer.compile(this.scene, new PerspectiveCamera())
      this.#lanterns.compileLit(() => this.renderer.compile(this.scene, new PerspectiveCamera()))
      this.scene.remove(warm.group)
    }
    this.#gunnery = new Gunnery({
      scene: this.scene,
      effects: this.effects,
      reticle: new Reticle(elements.reticle),
      audio: this.audio,
      send: (message) => this.#connection.send(message),
      ownId: () => this.#shipId,
      gunFired: (ball, muzzle) => {
        const view = this.#ships.get(ball.shooter)?.view
        if (view === undefined) return false
        view.fire(ball.gun)
        view.muzzle(ball.gun, muzzle)
        return true
      },
    })
    this.#sinking = new SinkingShips(this.effects, this.audio)
    this.eventHandlers.push((event) => this.#gunnery.onEvent(event))
    this.eventHandlers.push((event) => this.#onMatchEvent(event))

    window.addEventListener("resize", () => this.#resize())
    elements.overlay.addEventListener("click", () => this.#setSail())
    canvas.addEventListener("click", () => this.#lockPointer())
    document.addEventListener("pointerlockchange", () => {
      this.elements.status.dataset.pointer = document.pointerLockElement === canvas ? "locked" : "free"
    })

    this.#connection = connect({
      onOpen: () => {
        this.#status("joining")
        const join: ClientMessage =
          options.scenario === undefined
            ? { _tag: "join", mode: "ffa" }
            : options.room === undefined
              ? { _tag: "join", mode: "ffa", scenario: options.scenario }
              : { _tag: "join", mode: "ffa", scenario: options.scenario, room: options.room }
        this.#connection.send(join)
      },
      onMessage: (message, arrival) => this.#receive(message, arrival),
      onClose: () => this.#status("closed"),
    })
    this.#status("connecting")
    installDebugHook({
      connection: () => this.#connection.state(),
      sailing: () => this.#sailing,
      shipId: () => this.#shipId,
      timeline: () => this.#timeline,
      pose: (id) => this.#ships.get(id)?.view.pose,
      shipIds: () => [...this.#ships.keys()],
      camera: () => this.#camera,
      helm: () => this.#controls?.helm,
      stats: () => this.#stats,
      events: () => this.#appliedEvents,
      sea: () => this.#ocean?.sea,
      gunnery: () => this.#gunnery,
      effects: () => this.effects,
      audio: () => this.audio,
      match: () => this.#matchReading,
      matchHud: () => this.#matchHud,
      measure: (frames) => this.#measure(frames),
    })
    this.#resize()
    this.renderer.setAnimationLoop((ms) => this.#renderFrame(ms))
  }

  #status(text: string) {
    this.elements.status.dataset.state = text
    this.elements.overlay.dataset.state = text
  }

  #setSail() {
    this.#sailing = true
    //this.audio.start()
    this.elements.overlay.hidden = true
    if (this.#controls !== undefined) this.#controls.active = true
    this.#lockPointer()
  }

  #lockPointer() {
    if (!this.#sailing || document.pointerLockElement === this.canvas) return
    // Headless browsers and some focus states refuse pointer lock; sailing works without it, orbit waits for the next click.
    this.canvas.requestPointerLock()?.catch(() => undefined)
  }

  #receive(message: ServerMessage, arrival: number) {
    switch (message._tag) {
      case "welcome": {
        this.#shipId = message.shipId
        this.#wind = message.wind
        this.#matchReading.rules = message.rules
        this.#phase = message.phase
        this.#timeline = new SnapshotTimeline(message.simHz)
        this.#timeline.push(message.tick, message.ships, arrival)
        this.#events = new EventQueue<ServerEvent>()
        if (this.#ocean !== undefined) this.scene.remove(this.#ocean.mesh)
        this.#ocean = new OceanSurface(message.sea, { sky: this.#sky.cube, sun: sunColor, sunDirection, flashColor }, wakePeriod)
        this.scene.add(this.#ocean.mesh)
        const crest = message.sea.waves.reduce((sum, wave) => sum + wave.amplitude, 0)
        const camera = this.#camera ?? new ChaseCamera(crest + cameraClearance, this.#galleon.guns)
        this.#camera = camera
        const own = message.ships.find((ship) => ship.id === message.shipId)
        if (own !== undefined) {
          const [x, y, z, w] = own.orientation
          camera.placeBehind(Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)) + this.#orbit)
        }
        this.#controls ??= new Controls(this.canvas, camera, (m) => this.#connection.send(m), () => this.#gunnery.fire())
        this.#controls.active = this.#sailing
        if (own !== undefined) this.#controls.syncSail(own.sail)
        this.#resize()
        this.#status("joined")
        return
      }
      case "snapshot": {
        this.#wind = message.wind
        this.#phase = message.phase
        this.#timeline?.push(message.tick, message.ships, arrival)
        this.#events.push(message.events)
        return
      }
      case "rejected":
        console.warn(`server rejected a message: ${message.reason}`)
        return
    }
  }

  #onMatchEvent(event: ServerEvent) {
    this.#matchHud.onEvent(event)
    if (event._tag === "shipRespawned" && event.shipId === this.#shipId) this.#controls?.syncSail(0)
    if (event._tag !== "ballHit" || event.target !== this.#shipId) return
    const own = this.#ships.get(event.target)?.view.pose
    const shooter = this.#ships.get(event.shooter)?.view.pose
    // From the shooter when it is in view, else back along the ball's line into the hull.
    const [x, , z] = event.point
    const fromX = shooter === undefined ? x - (own?.x ?? x) : shooter.x - (own?.x ?? 0)
    const fromZ = shooter === undefined ? z - (own?.z ?? z) : shooter.z - (own?.z ?? 0)
    this.#hitIndicator.hit(Math.atan2(-fromZ, fromX))
  }

  #resize() {
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setSize(width, height, false)
    const pixels = this.renderer.getDrawingBufferSize(new Vector2())
    this.#pipeline.setSize(pixels.x, pixels.y)
    if (this.#camera === undefined) return
    this.#camera.camera.aspect = width / height
    this.#camera.camera.updateProjectionMatrix()
  }

  #measure(count: number): FrameMeasure {
    this.renderer.setAnimationLoop(null)
    const gl = this.renderer.getContext()
    const pixel = new Uint8Array(4)
    const times: Array<number> = []
    const info = this.renderer.info
    let draws = 0
    let triangles = 0
    for (let i = 0; i < count; i++) {
      const start = performance.now()
      this.#renderFrame(start)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      times.push(performance.now() - start)
      draws = info.render.calls
      triangles = info.render.triangles
    }
    const pipelineStart = performance.now()
    for (let i = 0; i < count; i++) this.#renderFrame(performance.now())
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const pipelined = (performance.now() - pipelineStart) / count
    this.renderer.setAnimationLoop((ms) => this.#renderFrame(ms))
    times.sort((a, b) => a - b)
    const detail = { near: 0, mid: 0, far: 0 }
    this.#ships.forEach((entry) => {
      if (entry.view.group.visible) detail[entry.view.detail]++
    })
    return {
      median: times[Math.floor(count / 2)] ?? 0,
      p90: times[Math.floor(count * 0.9)] ?? 0,
      worst: times[count - 1] ?? 0,
      pipelined,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      draws,
      triangles,
      detail,
    }
  }

  #renderFrame(nowMs: number) {
    const started = performance.now()
    this.renderer.info.reset()
    // A rAF timestamp is the frame's start and can precede the last performance.now() frame `measure` drew: never step back.
    const dt = Number.isNaN(this.#lastFrameMs) ? 0 : Math.max(0, Math.min(maxFrameSeconds, (nowMs - this.#lastFrameMs) / 1000))
    this.#lastFrameMs = nowMs
    const timeline = this.#timeline
    const camera = this.#camera
    const ocean = this.#ocean
    if (timeline === undefined || camera === undefined || ocean === undefined) return
    this.#frameCount++
    const renderTime = timeline.advance(nowMs / 1000, dt)
    const frame = this.#frame
    frame.dt = dt
    frame.renderTime = renderTime
    frame.renderTick = renderTime * timeline.simHz
    this.#events.drain(frame.renderTick, this.#applyEvent)

    const windX = Math.cos(this.#wind.toward) * this.#wind.speed
    const windZ = -Math.sin(this.#wind.toward) * this.#wind.speed
    const viewportHeight = this.renderer.domElement.height
    const ships = timeline.ships()
    this.#wake.begin()
    for (let i = 0; i < ships.length; i++) {
      const id = ships[i]?.id
      if (id === undefined) continue
      let entry = this.#ships.get(id)
      if (entry === undefined) {
        entry = { view: this.#spareViews.pop() ?? new ShipView(id, this.#galleon), seen: 0 }
        entry.view.group.name = `ship ${id}`
        this.#ships.set(id, entry)
        this.scene.add(entry.view.group)
      }
      entry.seen = this.#frameCount
      const pose = entry.view.pose
      if (timeline.sample(id, pose)) {
        entry.view.update(pose, windX, windZ, dt, camera.camera, viewportHeight)
        entry.view.group.visible = this.#sinking.update(id, pose, dt, renderTime, ocean.sea, camera)
        if (pose.life === "afloat") {
          const forwardX = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)
          const forwardZ = 2 * (pose.qx * pose.qz - pose.qw * pose.qy)
          const flat = Math.hypot(forwardX, forwardZ) || 1
          this.#wake.stamp(pose.x, pose.z, Math.atan2(-forwardZ, forwardX), Math.max(0, (pose.vx * forwardX + pose.vz * forwardZ) / flat))
        }
      }
    }
    this.#ships.forEach(this.#sweep)

    const own = this.#shipId === null ? undefined : this.#ships.get(this.#shipId)
    if (own !== undefined) {
      const pose = own.view.pose
      // A foundering ship drags the camera no lower than the sea surface: the captain watches it go.
      const manning = pose.life === "afloat" && this.#phase._tag !== "ended" ? own.view.group : undefined
      camera.follow(pose.x, pose.life === "afloat" ? pose.y : Math.max(pose.y, 0), pose.z, dt, manning)
      this.#lanterns.update(manning, camera.gunport)
      this.#sun.target.position.set(pose.x, 0, pose.z)
      this.#sun.position.copy(sunDirection).multiplyScalar(shadowReach).add(this.#sun.target.position)
      const forwardX = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)
      const forwardZ = 2 * (pose.qx * pose.qz - pose.qw * pose.qy)
      const flat = Math.hypot(forwardX, forwardZ)
      const reading = this.#reading
      reading.speed = flat === 0 ? 0 : (pose.vx * forwardX + pose.vz * forwardZ) / flat
      reading.sailLevel = pose.sail
      reading.sailSet = pose.sailSet
      reading.rudderAngle = pose.rudderAngle
      reading.heading = Math.atan2(-forwardZ, forwardX)
      reading.windToward = this.#wind.toward
      reading.windSpeed = this.#wind.speed
      reading.viewYaw = camera.yaw + Math.PI
      this.#hud.update(reading)
      this.elements.hud.hidden = !this.#sailing
    }
    this.#wake.render(this.renderer, dt)
    ocean.update(renderTime, camera.camera.position.x, camera.camera.position.z, this.#wake.texture)
    camera.camera.updateMatrixWorld()
    this.#sky.update(camera.camera.position, renderTime)
    const eye = camera.camera.position
    const viewYaw = camera.yaw + Math.PI
    this.#fill.target.position.set(eye.x + Math.cos(viewYaw) * 10, eye.y - 4, eye.z - Math.sin(viewYaw) * 10)
    this.#fill.position.copy(eye)
    this.#fill.target.updateMatrixWorld()
    const manned = own !== undefined && own.view.pose.life === "afloat" && this.#phase._tag !== "ended"
    this.#gunnery.update(dt, renderTime, manned ? own.view.pose : undefined, camera, ocean.sea, this.#sailing)
    if (this.#shipId !== null) {
      const reading = this.#matchReading
      reading.dt = dt
      reading.renderTime = renderTime
      reading.phase = this.#phase
      reading.ownId = this.#shipId
      reading.own = own?.view.pose
      this.#matchHud.update(reading)
      this.#matchHud.visible = this.#sailing
    }
    this.#hitIndicator.update(dt, camera.yaw + Math.PI)
    this.effects.update(dt, renderTime, windX, windZ, ocean.sea, camera.camera)
    const lights = this.effects.flashLights
    for (let i = 0; i < ocean.flashes.length; i++) {
      const light = lights[i]
      if (light !== undefined) ocean.flashes[i]?.set(light.position.x, light.position.y, light.position.z, light.intensity)
    }
    this.#lanterns.dimFlashes(this.effects.flashLights, camera.camera.position, camera.gunport)
    this.audio.update(dt, camera.camera, own?.view.pose, this.#wind.speed, this.#phase._tag)
    for (let i = 0; i < this.hooks.length; i++) this.hooks[i]?.(frame)

    this.#stats.beginGpu()
    this.#pipeline.render(camera.camera)
    this.#stats.endGpu()
    this.#stats.record(performance.now() - started, dt * 1000)
  }
}
