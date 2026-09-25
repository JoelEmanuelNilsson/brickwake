import { ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight, PCFShadowMap, PerspectiveCamera, Quaternion, Scene, Vector2, Vector3, WebGLRenderer } from "three"
import type { ScenarioName } from "../../sim/scenarios.ts"
import { hulkFromWire, type ClientMessage, type MatchPhaseSnapshot, type ServerEvent, type ServerMessage, type WindSnapshot } from "../../protocol/messages.ts"
import { ballVelocityAt, segmentBoxEntry } from "../../sim/gunnery.ts"
import { galleonClass, shipWreck } from "../../sim/wreck.ts"
import { ffaRules, type MatchMode } from "../../sim/rules.ts"
import type { ShipState } from "../../sim/ship.ts"
import { SIM_DT, tuning } from "../../sim/tuning.ts"
import type { WeatherName } from "../../sim/weather.ts"
import { GameAudio } from "../audio/game-audio.ts"
import { BrickDebris } from "./brick-debris.ts"
import { ChaseCamera } from "./chase-camera.ts"
import { connect, type Connection } from "./connection.ts"
import { Controls } from "./controls.ts"
import { ControlsHint, type HintReading } from "./controls-hint.ts"
import { Menus } from "./menus.ts"
import { type GameSettings, type Graphics, type GraphicsQuality, saveSettings } from "./settings.ts"
import { type FrameMeasure, installDebugHook } from "./debug-hook.ts"
import { Effects } from "./effects.ts"
import { type GalleonModel, loadGalleon } from "./galleon.ts"
import { FrameStats } from "./frame-stats.ts"
import { Gunnery, type HullAlong } from "./gunnery.ts"
import { HitIndicator } from "./hit-indicator.ts"
import { Hud, type HudReading } from "./hud.ts"
import { MatchHud, type MatchReading } from "./match-hud.ts"
import { OceanSurface } from "./ocean.ts"
import { Reticle } from "./reticle.ts"
import { RenderPipeline } from "./render-pipeline.ts"
import { ShipView } from "./ship-view.ts"
import { Hulks } from "./hulks.ts"
import { Wrecks, type Wreck } from "./wrecks.ts"
import { SinkingShips } from "./sinking.ts"
import { createGameSky, type GameSky } from "./sky.ts"
import { Rain } from "./rain.ts"
import { weatherLooks } from "./weather-look.ts"
import { EventQueue, type ShipPose, SnapshotTimeline } from "./timeline.ts"
import { shipLivery } from "./names.ts"
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
  /** Esc menu, settings panel and the first-run controls hint. */
  readonly pause: HTMLElement
  readonly settings: HTMLElement
  readonly hint: HTMLElement
}

/** Where the title screen remembers the last quick-play mode chosen. */
export const modeKey = "brickwake.mode"

/** A ship in play: its pooled view, the frame it was last seen, and the team its sails were printed for. */
interface ShipEntry {
  view: ShipView
  seen: number
  livery: { readonly team: ShipPose["team"]; readonly name: string } | undefined
}

/** A low sunset sun, 5° up. */
const sunDirection = new Vector3().setFromSphericalCoords(1, (85 * Math.PI) / 180, 1.25)
/** Muzzle-flash light colour, as the pooled PointLights in `Effects`. */
const flashColor = new Color(0xff9a4a)
/** Half the side of the square the sun's shadow map covers around the camera's ship, metres: this ship and its close neighbours. */
const shadowHalfWidth = 45
/** How far up-sun the shadow camera stands, metres; the low sun's shadow box runs twice this deep. */
const shadowReach = 150
const maxFrameSeconds = 0.1
/** The parts of a ship no ball has struck yet. */
const intact = shipWreck([])

/** How far above the highest possible crest the camera stays, metres. */
const cameraClearance = 1.5

/** The running game: connection, snapshot timeline, scene, render loop, HUD and debug hook. */
export class Game {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  readonly hooks: Array<FrameHook> = []
  readonly eventHandlers: Array<EventHandler> = []
  readonly #pipeline: RenderPipeline
  readonly #sun = new DirectionalLight()
  /** A warm light from over the camera's shoulder, as ref-01 lights the faces it shows: hulls read in colour even against the sun. */
  readonly #fill = new DirectionalLight()
  readonly #hemisphere = new HemisphereLight()
  readonly #fog = new FogExp2(0)
  readonly #rain = new Rain()
  readonly #sky: GameSky
  /** The weather the sky was last captured in. */
  #weather: WeatherName = "clear"
  readonly #wake = new WakeField()
  readonly #galleon: GalleonModel
  readonly #wrecks: Wrecks
  /** Built ships not in play: views are built at load, so a ship joining mid-match costs no frame. */
  readonly #spareViews: Array<ShipView> = []
  readonly #connection: Connection
  readonly #frame: FrameContext = { dt: 0, renderTime: 0, renderTick: 0 }
  readonly #stats: FrameStats
  readonly #ships = new Map<string, ShipEntry>()
  readonly #appliedEvents: Array<ServerEvent> = []
  readonly #sweep = (entry: ShipEntry, id: string) => {
    if (entry.seen === this.#frameCount) return
    this.#releaseView(entry.view)
    this.#ships.delete(id)
  }
  readonly #releaseView = (view: ShipView) => {
    this.scene.remove(view.group)
    this.#debris.forget(view)
    this.#spareViews.push(view)
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
  readonly #hulks: Hulks
  /** Hulks respawned ships left, from their `shipRespawned` until the ship's new life is drawn, with the damage drawn on them. */
  readonly #hulksDue = new Map<string, { readonly hulk: ShipState; readonly time: number; readonly wreck: Wreck | undefined }>()
  readonly #debris: BrickDebris
  /** Hits that broke bricks this frame, thrown as debris once the ships are posed. */
  readonly #strikes: Array<{ readonly hit: Extract<ServerEvent, { readonly _tag: "ballHit" }>; readonly detached: ReadonlyArray<number> }> = []
  readonly #ballVelocity = new Vector3()
  readonly #hullRay = { origin: new Vector3(), direction: new Vector3(), end: new Vector3(), turn: new Quaternion() }
  /** The aim ray against every other afloat ship's remaining parts, as the sim's balls meet them. */
  readonly #hullAlong: HullAlong = (origin, direction, reach) => {
    const { min, max } = galleonClass()
    const ray = this.#hullRay
    let nearest: number | undefined
    for (const [id, entry] of this.#ships) {
      const pose = entry.view.pose
      if (id === this.#shipId || pose.life !== "afloat" || !entry.view.group.visible) continue
      ray.turn.set(pose.qx, pose.qy, pose.qz, pose.qw).invert()
      ray.origin.set(origin.x - pose.x, origin.y - pose.y, origin.z - pose.z).applyQuaternion(ray.turn)
      ray.direction.copy(direction).applyQuaternion(ray.turn)
      ray.end.copy(ray.direction).multiplyScalar(nearest ?? reach).add(ray.origin)
      if (segmentBoxEntry(ray.origin, ray.end, min, max) === undefined) continue
      const along = (this.#wrecks.of(id)?.damage ?? intact).firstPartAlong(ray.origin, ray.direction, nearest ?? reach)
      if (along !== undefined) nearest = along
    }
    return nearest
  }
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
  /** Esc menu up: this view takes no input while the server's match sails on. */
  #paused = false
  #pointerLocked = false
  #settings: GameSettings
  #graphics: Graphics
  readonly #graphicsFor: (quality: GraphicsQuality) => Graphics
  readonly #menus: Menus
  readonly #hint: ControlsHint
  #frameCount = 0
  #lastFrameMs = Number.NaN
  readonly #hintReading: HintReading = { sailing: false, paused: false, sailLevel: 0, rudder: 0, canFire: false, aim: false }
  readonly #reading: HudReading = { speed: 0, sailLevel: 0, sailSet: 0, rudderAngle: 0, heading: 0, windToward: 0, windSpeed: 0, viewYaw: 0, weather: "" }

  readonly canvas: HTMLCanvasElement
  readonly #orbit: number
  readonly #scenario: ScenarioName | undefined
  #mode: MatchMode
  readonly elements: GameElements

  constructor(
    canvas: HTMLCanvasElement,
    elements: GameElements,
    options: {
      readonly scenario: ScenarioName | undefined
      readonly room: string | undefined
      /** With `scenario`: the weather its room opens in. */
      readonly weather: WeatherName | undefined
      /** Quick-play mode to join at load; the title screen can switch it. Scenario rooms bring their own rules. */
      readonly mode: MatchMode
      readonly orbit: number
      readonly settings: GameSettings
      /** How each graphics quality renders on this device and page. */
      readonly graphics: (quality: GraphicsQuality) => Graphics
    },
  ) {
    this.#settings = options.settings
    this.#graphicsFor = options.graphics
    this.#graphics = options.graphics(options.settings.quality)
    const graphics = this.#graphics
    this.canvas = canvas
    this.elements = elements
    this.#orbit = options.orbit
    this.#mode = options.mode
    this.#scenario = options.scenario
    elements.overlay.dataset.mode = options.scenario === undefined ? options.mode : "scenario"
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
    this.renderer.setPixelRatio(graphics.pixelRatio)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.5
    // The frame renders several passes; counters reset once per frame so they count all of them.
    this.renderer.info.autoReset = false
    this.#pipeline = new RenderPipeline(this.renderer, this.scene, graphics.samples)
    this.#pipeline.bloom = graphics.bloom
    this.#stats = new FrameStats(this.renderer)
    this.#hud = new Hud(elements.hud)
    this.#matchHud = new MatchHud(elements.match)
    this.#matchReading = {
      dt: 0,
      renderTime: 0,
      rules: ffaRules,
      phase: this.#phase,
      teamSinks: { pirates: 0, navy: 0 },
      ownId: "",
      own: undefined,
      ships: this.#ships,
    }
    this.#hitIndicator = new HitIndicator(elements.hits)

    this.#sky = createGameSky(this.renderer, sunDirection, weatherLooks.clear.sky)
    this.scene.fog = this.#fog
    this.scene.add(this.#sky.dome, this.#rain.mesh)
    this.#dress("clear")
    const sun = this.#sun
    sun.position.copy(sunDirection).multiplyScalar(shadowReach)
    this.renderer.shadowMap.enabled = graphics.shadows
    this.renderer.shadowMap.type = PCFShadowMap
    sun.castShadow = graphics.shadows
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
    this.scene.add(sun, sun.target, this.#hemisphere, this.#fill)
    this.effects = new Effects(this.scene, sunDirection)
    this.#galleon = loadGalleon()
    this.#wrecks = new Wrecks(this.#galleon.graph)
    this.#debris = new BrickDebris(this.scene, this.#galleon, this.effects, this.audio)
    for (let i = 0; i < tuning.match.maxShips; i++) this.#spareViews.push(new ShipView(`spare ${i}`, this.#galleon))
    // Compile every ship shader now, so the first ship in view costs no frame.
    const warm = this.#spareViews[0]
    if (warm !== undefined) {
      this.scene.add(warm.group)
      const debris = this.#debris.warm()
      this.renderer.compile(this.scene, new PerspectiveCamera())
      debris.done()
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
      hullAlong: this.#hullAlong,
    })
    this.#sinking = new SinkingShips(this.effects, this.audio, this.#debris, this.#galleon)
    this.#hulks = new Hulks(this.#sinking, this.#releaseView)
    this.#wrecks.onStrike = (hit, detached) => this.#strikes.push({ hit, detached })
    this.eventHandlers.push((event) => this.#gunnery.onEvent(event))
    this.eventHandlers.push((event) => this.#onMatchEvent(event))
    this.eventHandlers.push((event) => this.#wrecks.onEvent(event))

    this.audio.volume = this.#settings.volume
    this.audio.ambienceVolume = this.#settings.ambience
    this.#menus = new Menus({ pause: elements.pause, settings: elements.settings, controlsStrip: elements.overlay.querySelector(".menu-keys") }, this.#settings, {
      apply: (settings) => this.#applySettings(settings),
      resume: () => this.#resume(),
      title: () => this.#showTitle(),
    })
    this.#hint = new ControlsHint(elements.hint, options.scenario === undefined)

    window.addEventListener("resize", () => this.#resize())
    elements.overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : undefined
      if (target?.closest("[data-action=settings]")) return this.#menus.openSettings()
      const choice = target?.closest<HTMLElement>("[data-mode]")?.dataset.mode
      if (choice === "ffa" || choice === "tdm") this.#chooseMode(choice)
      this.#setSail()
    })
    canvas.addEventListener("click", () => this.#lockPointer())
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas
      this.elements.status.dataset.pointer = locked ? "locked" : "free"
      // The browser's own Esc ends the lock without a keydown reaching the page: losing the lock is the pause.
      if (this.#pointerLocked && !locked && this.#sailing) this.#pause()
      this.#pointerLocked = locked
    })
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Escape" || event.repeat) return
      if (this.#menus.shown.settings) this.#menus.closeSettings()
      else if (this.#paused) this.#resume()
      else if (this.#sailing) this.#pause()
    })

    this.#connection = connect({
      onOpen: () => {
        this.#status("joining")
        const join: ClientMessage =
          options.scenario === undefined
            ? { _tag: "join", mode: this.#mode }
            : {
                _tag: "join",
                mode: this.#mode,
                scenario: options.scenario,
                ...(options.room === undefined ? {} : { room: options.room }),
                ...(options.weather === undefined ? {} : { weather: options.weather }),
              }
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
      livery: (id) => this.#ships.get(id)?.livery?.name,
      paintOwn: (livery) => {
        const own = this.#ships.get(this.#shipId ?? "")
        if (own === undefined) return
        own.view.rig.setLivery(livery)
        own.livery = { team: own.view.pose.team, name: livery.name }
      },
      shipIds: () => [...this.#ships.keys()],
      camera: () => this.#camera,
      helm: () => this.#controls?.helm,
      stats: () => this.#stats,
      events: () => this.#appliedEvents,
      sea: () => this.#ocean?.sea,
      gunnery: () => this.#gunnery,
      effects: () => this.effects,
      debris: () => this.#debris,
      audio: () => this.audio,
      match: () => this.#matchReading,
      weather: () => this.#weather,
      matchHud: () => this.#matchHud,
      measure: (frames) => this.#measure(frames),
      ui: () => ({
        paused: this.#paused,
        settingsOpen: this.#menus.shown.settings,
        hint: this.#hint.showing ?? null,
        settings: this.#settings,
        graphics: this.#graphics,
        cameraSensitivity: this.#camera?.sensitivity ?? null,
        volume: this.audio.volume,
        ambience: this.audio.ambienceVolume,
        audioPaused: this.audio.paused,
      }),
      wreck: (id) => {
        const view = this.#ships.get(id)?.view
        return view === undefined ? undefined : { gone: this.#wrecks.of(id)?.gone ?? [], drawnParts: view.partCount }
      },
    })
    this.#resize()
    this.renderer.setAnimationLoop((ms) => this.#renderFrame(ms))
  }

  #newEntry(id: string): ShipEntry {
    const entry: ShipEntry = { view: this.#spareViews.pop() ?? new ShipView(id, this.#galleon), seen: 0, livery: undefined }
    entry.view.group.name = `ship ${id}`
    this.#ships.set(id, entry)
    this.scene.add(entry.view.group)
    return entry
  }

  #status(text: string) {
    this.elements.status.dataset.state = text
    this.elements.overlay.dataset.state = text
  }

  /** Moves to a quick-play room of `mode` when it differs from the one joined; the next welcome swaps the world. */
  #chooseMode(mode: MatchMode) {
    if (this.#scenario !== undefined || mode === this.#mode) return
    this.#mode = mode
    this.elements.overlay.dataset.mode = mode
    localStorage.setItem(modeKey, mode)
    this.#connection.send({ _tag: "leave" })
    this.#connection.send({ _tag: "join", mode })
  }

  #setSail() {
    this.#sailing = true
    this.audio.start()
    this.elements.overlay.hidden = true
    this.#resume()
  }

  #pause() {
    if (this.#paused) return
    this.#paused = true
    this.#menus.paused = true
    this.audio.paused = true
    if (this.#controls !== undefined) {
      this.#controls.release()
      this.#controls.active = false
    }
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  #resume() {
    this.#paused = false
    this.#menus.paused = false
    this.audio.paused = false
    if (this.#controls !== undefined) this.#controls.active = this.#sailing
    this.#lockPointer()
  }

  /** From the pause menu back to the title screen, to change battle or set sail again; the ship stays in the match. */
  #showTitle() {
    this.#paused = false
    this.#menus.paused = false
    this.#sailing = false
    this.elements.overlay.hidden = false
  }

  #applySettings(settings: GameSettings) {
    const quality = settings.quality !== this.#settings.quality
    this.#settings = settings
    saveSettings(settings)
    if (this.#camera !== undefined) this.#camera.sensitivity = settings.sensitivity
    this.audio.volume = settings.volume
    this.audio.ambienceVolume = settings.ambience
    if (!quality) return
    const graphics = this.#graphicsFor(settings.quality)
    this.#graphics = graphics
    this.renderer.setPixelRatio(graphics.pixelRatio)
    this.#pipeline.samples = graphics.samples
    this.#pipeline.bloom = graphics.bloom
    this.renderer.shadowMap.enabled = graphics.shadows
    this.#sun.castShadow = graphics.shadows
    this.#resize()
  }

  #lockPointer() {
    if (!this.#sailing || document.pointerLockElement === this.canvas) return
    // Headless browsers and some focus states refuse pointer lock; sailing works without it, orbit waits for the next click.
    this.canvas.requestPointerLock()?.catch(() => undefined)
  }

  /** Dresses the scene for `weather`: sky, lights, fog and rain. The sea takes its part when it is built. */
  #dress(weather: WeatherName) {
    const look = weatherLooks[weather]
    if (weather !== this.#weather) this.#sky.restyle(look.sky)
    this.#weather = weather
    this.scene.environment = this.#sky.environment
    this.scene.environmentIntensity = look.environment
    this.#fog.density = look.fogDensity
    this.#fog.color.copy(this.#sky.horizon)
    this.#sun.color.setRGB(...look.sun.color)
    this.#sun.intensity = look.sun.intensity
    this.#fill.color.setRGB(...look.fill.color)
    this.#fill.intensity = look.fill.intensity
    this.#hemisphere.color.setRGB(...look.hemisphere.sky)
    this.#hemisphere.groundColor.setRGB(...look.hemisphere.ground)
    this.#hemisphere.intensity = look.hemisphere.intensity
    this.#rain.amount = look.rain
    this.#reading.weather = look.label
  }

  #receive(message: ServerMessage, arrival: number) {
    switch (message._tag) {
      case "welcome": {
        this.#shipId = message.shipId
        this.#wind = message.wind
        this.#matchReading.rules = message.rules
        this.#matchReading.teamSinks = message.teamSinks
        this.#phase = message.phase
        this.#timeline = new SnapshotTimeline(message.simHz)
        this.#timeline.push(message.tick, message.ships, arrival)
        this.#events = new EventQueue<ServerEvent>()
        this.#gunnery.joined()
        this.#wrecks.load(message.wrecks)
        this.#hulks.clear()
        this.#hulksDue.clear()
        if (this.#ocean !== undefined) this.scene.remove(this.#ocean.mesh)
        this.#dress(message.weather)
        const sea = weatherLooks[message.weather].sea
        this.#ocean = new OceanSurface(
          message.sea,
          { sky: this.#sky.cube, sun: new Color(...sea.sun), water: new Color(...sea.water), glint: sea.glint, foam: sea.foam, reflection: new Color(...sea.reflection), sunDirection, flashColor },
          wakePeriod,
        )
        this.scene.add(this.#ocean.mesh)
        const crest = message.sea.waves.reduce((sum, wave) => sum + wave.amplitude, 0)
        const camera = this.#camera ?? new ChaseCamera(crest + cameraClearance)
        camera.minHeight = crest + cameraClearance
        this.#camera = camera
        camera.sensitivity = this.#settings.sensitivity
        const own = message.ships.find((ship) => ship.id === message.shipId)
        if (own !== undefined) {
          const [x, y, z, w] = own.orientation
          camera.placeBehind(Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)) + this.#orbit)
        }
        this.#controls ??= new Controls(this.canvas, camera, (m) => this.#connection.send(m), () => {
          if (this.#gunnery.fire() === "fired") this.#hint.done("fire")
        })
        this.#controls.active = this.#sailing && !this.#paused
        if (own !== undefined) this.#controls.syncSail(own.sail)
        this.#resize()
        this.#status("joined")
        return
      }
      case "snapshot": {
        this.#wind = message.wind
        this.#phase = message.phase
        this.#matchReading.teamSinks = message.teamSinks
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
    // Runs before `Wrecks` forgets the damage, so the hulk keeps what was shot off it.
    if (event._tag === "shipRespawned" && event.hulk !== null)
      this.#hulksDue.set(event.shipId, { hulk: hulkFromWire(event.shipId, event.hulk), time: (event.tick + 1) * SIM_DT, wreck: this.#wrecks.of(event.shipId) })
    if (event._tag === "shipLeft") this.#hulksDue.delete(event.shipId)
    if (event._tag === "sailHit") this.#ships.get(event.target)?.view.punchSail(...event.localPoint)
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
      const fresh = entry === undefined
      if (entry === undefined) {
        entry = this.#newEntry(id)
        this.#hulksDue.delete(id)
      }
      entry.seen = this.#frameCount
      let pose = entry.view.pose
      const spawn = pose.spawn
      if (timeline.sample(id, pose)) {
        if (!fresh && pose.spawn !== spawn) {
          const due = this.#hulksDue.get(id)
          if (due !== undefined) {
            // The ship's new life is drawn from here: its old view sinks on as a hulk, and the ship takes a fresh one.
            this.#hulksDue.delete(id)
            this.#hulks.add(id, entry.view, due.hulk, due.time)
            entry = this.#newEntry(id)
            entry.seen = this.#frameCount
            pose = entry.view.pose
            timeline.sample(id, pose)
          }
          if (id === this.#shipId) camera.placeBehind(Math.atan2(-2 * (pose.qx * pose.qz - pose.qw * pose.qy), 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)))
        }
        // Until the hulk takes the view, it keeps the damage the ship's old life left.
        entry.view.showWreck(this.#hulksDue.get(id)?.wreck ?? this.#wrecks.of(id))
        const livery = entry.livery
        if (livery === undefined || livery.team !== pose.team) {
          const print = shipLivery(id, pose.team)
          entry.view.rig.setLivery(print)
          entry.livery = { team: pose.team, name: print.name }
        }
        entry.view.update(pose, windX, windZ, dt, camera.camera, viewportHeight)
        entry.view.group.visible = this.#sinking.update(id, entry.view, dt, renderTime, ocean.sea, camera)
        if (pose.life === "afloat") {
          const forwardX = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)
          const forwardZ = 2 * (pose.qx * pose.qz - pose.qw * pose.qy)
          const flat = Math.hypot(forwardX, forwardZ) || 1
          this.#wake.stamp(pose.x, pose.z, Math.atan2(-forwardZ, forwardX), Math.max(0, (pose.vx * forwardX + pose.vz * forwardZ) / flat))
        }
      }
    }
    this.#ships.forEach(this.#sweep)
    this.#hulks.update(dt, renderTime, ocean.sea, this.#wind, camera, viewportHeight)
    for (const { hit, detached } of this.#strikes) {
      const view = this.#ships.get(hit.target)?.view
      const ball = this.#gunnery.balls.find(hit.ballId)
      const velocity = ball === undefined ? undefined : this.#ballVelocity.copy(ballVelocityAt(ball, hit.time))
      if (view !== undefined) this.#debris.shatter(view, hit.removed, detached, velocity)
    }
    this.#strikes.length = 0

    const own = this.#shipId === null ? undefined : this.#ships.get(this.#shipId)
    if (own !== undefined) {
      const pose = own.view.pose
      // A foundering ship drags the camera no lower than the sea surface: the captain watches it go.
      const manning = pose.life === "afloat" && this.#phase._tag !== "ended" ? own.view.group : undefined
      camera.follow(pose.x, pose.life === "afloat" ? pose.y : Math.max(pose.y, 0), pose.z, dt, manning)
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
      const hint = this.#hintReading
      hint.sailing = this.#sailing && pose.life === "afloat"
      hint.paused = this.#paused
      hint.sailLevel = pose.sail
      hint.rudder = pose.rudder
      hint.canFire = this.#gunnery.canFire
      hint.aim = camera.aimView.held
      this.#hint.update(dt, hint)
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
    this.#debris.update(dt, renderTime, ocean.sea, camera.camera.position, windX, windZ)
    this.#rain.update(renderTime, camera.camera.position, windX, windZ)
    const lights = this.effects.flashLights
    for (let i = 0; i < ocean.flashes.length; i++) {
      const light = lights[i]
      if (light !== undefined) ocean.flashes[i]?.set(light.position.x, light.position.y, light.position.z, light.intensity)
    }
    this.audio.update(dt, camera.camera, own?.view.pose, this.#wind.speed, this.#phase._tag)
    for (let i = 0; i < this.hooks.length; i++) this.hooks[i]?.(frame)

    this.#stats.beginGpu()
    this.#pipeline.render(camera.camera)
    this.#stats.endGpu()
    this.#stats.record(performance.now() - started, dt * 1000)
  }
}
