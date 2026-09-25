import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  LinearSRGBColorSpace,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import type { ScenarioName } from "../../sim/scenarios.ts"
import type { ClientMessage, MatchPhaseSnapshot, ServerEvent, ServerMessage, WindSnapshot } from "../../protocol/messages.ts"
import { ffaRules } from "../../sim/rules.ts"
import { createSunsetSky } from "../lab/sky.ts"
import { GameAudio } from "../audio/game-audio.ts"
import { ChaseCamera } from "./chase-camera.ts"
import { connect, type Connection } from "./connection.ts"
import { Controls } from "./controls.ts"
import { installDebugHook } from "./debug-hook.ts"
import { Effects } from "./effects.ts"
import { FrameStats } from "./frame-stats.ts"
import { Gunnery } from "./gunnery.ts"
import { HitIndicator } from "./hit-indicator.ts"
import { Hud, type HudReading } from "./hud.ts"
import { MatchHud, type MatchReading } from "./match-hud.ts"
import { OceanSurface } from "./ocean.ts"
import { Reticle } from "./reticle.ts"
import { ShipView } from "./ship-view.ts"
import { SinkingShips } from "./sinking.ts"
import { EventQueue, SnapshotTimeline } from "./timeline.ts"

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

/** Sky colours in linear HDR, equal to the lab sky dome's constants so water, fog and sky meet without a seam. */
const sky = {
  horizon: new Color().setRGB(1.5, 0.56, 0.2, LinearSRGBColorSpace),
  zenith: new Color().setRGB(0.07, 0.1, 0.15, LinearSRGBColorSpace),
  sun: new Color().setRGB(1.8, 0.75, 0.25, LinearSRGBColorSpace),
  sunDirection: new Vector3().setFromSphericalCoords(1, (83 * Math.PI) / 180, 1.25),
}
const fogDensity = 0.0011
const maxFrameSeconds = 0.1

/** How far above the highest possible crest the camera stays, metres. */
const cameraClearance = 1.5

/** The running game: connection, snapshot timeline, scene, render loop, HUD and debug hook. */
export class Game {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  readonly hooks: Array<FrameHook> = []
  readonly eventHandlers: Array<EventHandler> = []
  readonly #composer: EffectComposer
  readonly #connection: Connection
  readonly #frame: FrameContext = { dt: 0, renderTime: 0, renderTick: 0 }
  readonly #stats: FrameStats
  readonly #ships = new Map<string, { readonly view: ShipView; seen: number }>()
  readonly #appliedEvents: Array<ServerEvent> = []
  readonly #sweep = (entry: { readonly view: ShipView; seen: number }, id: string) => {
    if (entry.seen === this.#frameCount) return
    this.scene.remove(entry.view.group)
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
    },
  ) {
    this.canvas = canvas
    this.elements = elements
    this.#orbit = options.orbit
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(options.pixelRatio)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.5
    // The composer's target does the antialiasing; HDR half floats keep the sky and glints above 1 for tone mapping.
    this.#composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }))
    this.#stats = new FrameStats(this.renderer)
    this.#hud = new Hud(elements.hud)
    this.#matchHud = new MatchHud(elements.match)
    this.#matchReading = { dt: 0, renderTime: 0, rules: ffaRules, phase: this.#phase, ownId: "", own: undefined, ships: this.#ships }
    this.#hitIndicator = new HitIndicator(elements.hits)

    this.scene.fog = new FogExp2(sky.horizon.getHex(), fogDensity)
    this.scene.fog.color.copy(sky.horizon)
    const dome = createSunsetSky(sky.sunDirection)
    this.scene.add(dome)
    const pmrem = new PMREMGenerator(this.renderer)
    const skyOnly = new Scene()
    skyOnly.add(dome.clone())
    this.scene.environment = pmrem.fromScene(skyOnly, 0, 1, 5000).texture
    this.scene.environmentIntensity = 0.6
    pmrem.dispose()
    const sun = new DirectionalLight(0xffb27a, 3.2)
    sun.position.copy(sky.sunDirection).multiplyScalar(100)
    this.scene.add(sun, new HemisphereLight(0xffc49a, 0x0b2a30, 1.1))
    this.effects = new Effects(this.scene, sky.sunDirection)
    this.#gunnery = new Gunnery({
      scene: this.scene,
      effects: this.effects,
      reticle: new Reticle(elements.reticle),
      audio: this.audio,
      send: (message) => this.#connection.send(message),
      ownId: () => this.#shipId,
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
        this.#ocean = new OceanSurface(message.sea, sky)
        this.scene.add(this.#ocean.mesh)
        const crest = message.sea.waves.reduce((sum, wave) => sum + wave.amplitude, 0)
        const camera = this.#camera ?? new ChaseCamera(crest + cameraClearance)
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
    this.#composer.setPixelRatio(this.renderer.getPixelRatio())
    this.#composer.setSize(width, height)
    if (this.#camera === undefined) return
    this.#camera.camera.aspect = width / height
    this.#camera.camera.updateProjectionMatrix()
    this.#composer.passes.length = 0
    this.#composer.addPass(new RenderPass(this.scene, this.#camera.camera))
    this.#composer.addPass(new OutputPass())
  }

  #renderFrame(nowMs: number) {
    const started = performance.now()
    const dt = Number.isNaN(this.#lastFrameMs) ? 0 : Math.min(maxFrameSeconds, (nowMs - this.#lastFrameMs) / 1000)
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

    const ships = timeline.ships()
    for (let i = 0; i < ships.length; i++) {
      const id = ships[i]?.id
      if (id === undefined) continue
      let entry = this.#ships.get(id)
      if (entry === undefined) {
        entry = { view: new ShipView(id), seen: 0 }
        this.#ships.set(id, entry)
        this.scene.add(entry.view.group)
      }
      entry.seen = this.#frameCount
      if (timeline.sample(id, entry.view.pose)) {
        entry.view.update(entry.view.pose, this.#wind.toward)
        entry.view.group.visible = this.#sinking.update(id, entry.view.pose, dt, renderTime, ocean.sea, camera)
      }
    }
    this.#ships.forEach(this.#sweep)

    const own = this.#shipId === null ? undefined : this.#ships.get(this.#shipId)
    if (own !== undefined) {
      const pose = own.view.pose
      // A foundering ship drags the camera no lower than the sea surface: the captain watches it go.
      camera.follow(pose.x, pose.life === "afloat" ? pose.y : Math.max(pose.y, 0), pose.z, dt)
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
    ocean.update(renderTime, camera.camera.position.x, camera.camera.position.z)
    camera.camera.updateMatrixWorld()
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
    const windX = Math.cos(this.#wind.toward) * this.#wind.speed
    const windZ = -Math.sin(this.#wind.toward) * this.#wind.speed
    this.effects.update(dt, renderTime, windX, windZ, ocean.sea, camera.camera)
    this.audio.update(dt, camera.camera, own?.view.pose, this.#wind.speed, this.#phase._tag)
    for (let i = 0; i < this.hooks.length; i++) this.hooks[i]?.(frame)

    this.#stats.beginGpu()
    this.#composer.render(dt)
    this.#stats.endGpu()
    this.#stats.record(performance.now() - started, dt * 1000)
  }
}
