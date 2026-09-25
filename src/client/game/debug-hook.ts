import { Vector3 } from "three"
import type { ServerEvent } from "../../protocol/messages.ts"
import type { AudioStats, GameAudio } from "../audio/game-audio.ts"
import { sampleOcean, type SeaState } from "../../sim/ocean.ts"
import { angleOfDirection, rotate, vec3, type Quat } from "../../sim/vector.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { ConnectionState } from "./connection.ts"
import type { Effects } from "./effects.ts"
import type { AimReading, FireOutcome, Gunnery } from "./gunnery.ts"
import type { HelmRequest } from "./controls.ts"
import type { MatchHud, MatchHudText, MatchReading } from "./match-hud.ts"
import type { FrameAverages, FrameStats } from "./frame-stats.ts"
import type { ShipPose, SnapshotTimeline } from "./timeline.ts"

/** A ship as the client draws it at the render time. Angles in radians, as in `ShipAttitude`. */
export interface DebugShip {
  readonly id: string
  readonly position: readonly [number, number, number]
  readonly heading: number
  readonly pitch: number
  readonly heel: number
  /** Speed along the bow, m/s. */
  readonly speed: number
  readonly rudder: -1 | 0 | 1
  readonly sail: 0 | 1 | 2
  readonly rudderAngle: number
  readonly sailSet: number
  /** Height of the drawn water under the ship's origin at the render time. */
  readonly waterHeight: number
  readonly hp: number
  /** Sim time, seconds, from which `[port, starboard]` may fire again. */
  readonly reloadedAt: readonly [number, number]
  readonly life: ShipPose["life"]
  readonly kills: number
  readonly deaths: number
  /** Changes on each respawn or restart. */
  readonly spawn: number
}

/** The match as the client shows it. */
export interface DebugMatch {
  readonly phase: MatchReading["phase"]
  readonly rules: MatchReading["rules"]
  /** Sim time drawn now; compare with the phase's times. */
  readonly renderTime: number
  readonly hud: MatchHudText
}

/** Live effects: particles per layer, chips, balls drawn in flight, and camera shake 0…1. */
export interface DebugEffects {
  readonly particles: ReturnType<Effects["counts"]>
  readonly ballsInFlight: number
  readonly shake: number
}

/** The chase camera; `roll` is the tilt of its horizon, which stays 0 whatever the ship does. */
export interface DebugCamera {
  readonly position: readonly [number, number, number]
  readonly yaw: number
  readonly pitch: number
  readonly distance: number
  readonly roll: number
}

/** The client's match on `window.brickwake` for Playwright, plus a few test controls. Every read returns fresh plain data. */
export interface BrickwakeDebug {
  readonly connection: ConnectionState
  readonly joined: boolean
  /** True after the player's click from the title overlay. */
  readonly sailing: boolean
  readonly shipId: string | null
  readonly latestTick: number
  /** Fractional sim tick being drawn. */
  readonly renderTick: number
  ships(): ReadonlyArray<DebugShip>
  ownShip(): DebugShip | null
  camera(): DebugCamera | null
  helm(): HelmRequest | null
  frames(): FrameAverages
  /** The last 32 events applied at their tick. */
  events(): ReadonlyArray<ServerEvent>
  /** Where the reticle aims on the drawn sea, the facing side, and whether it can fire. */
  aim(): AimReading | null
  effects(): DebugEffects
  /** Sound: bank ready, context state, voices busy, sounds played, dropped and stolen. */
  audio(): AudioStats
  match(): DebugMatch | null
  /** Test control: fires as a left click does (headless browsers refuse the pointer lock clicks need). */
  fire(): FireOutcome
  /** Test control: fires the side facing `point` at that point on the sea. */
  fireAt(point: readonly [number, number, number]): FireOutcome
  /** Test control: sets the camera orbit as mouse and wheel do; `yaw` is the view direction (see `directionFromAngle`). */
  orbit(yaw: number, pitch: number, distance?: number): void
}

declare global {
  interface Window {
    readonly brickwake?: BrickwakeDebug
  }
}

/** The game state the hook reads. */
export interface DebugSource {
  readonly connection: () => ConnectionState
  readonly sailing: () => boolean
  readonly shipId: () => string | null
  readonly timeline: () => SnapshotTimeline | undefined
  readonly pose: (id: string) => ShipPose | undefined
  readonly shipIds: () => ReadonlyArray<string>
  readonly camera: () => ChaseCamera | undefined
  readonly helm: () => HelmRequest | undefined
  readonly stats: () => FrameStats
  readonly events: () => ReadonlyArray<ServerEvent>
  readonly sea: () => SeaState | undefined
  readonly gunnery: () => Gunnery
  readonly effects: () => Effects
  readonly audio: () => GameAudio
  readonly match: () => MatchReading
  readonly matchHud: () => MatchHud
}

const describeShip = (id: string, pose: ShipPose, sea: SeaState | undefined, time: number): DebugShip => {
  const q: Quat = { x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }
  const forward = rotate(q, vec3(1, 0, 0))
  const starboard = rotate(q, vec3(0, 0, 1))
  const flat = Math.hypot(forward.x, forward.z)
  return {
    id,
    position: [pose.x, pose.y, pose.z],
    heading: angleOfDirection(forward.x, forward.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
    heel: Math.asin(Math.max(-1, Math.min(1, -starboard.y))),
    speed: flat === 0 ? 0 : (pose.vx * forward.x + pose.vz * forward.z) / flat,
    rudder: pose.rudder,
    sail: pose.sail,
    rudderAngle: pose.rudderAngle,
    sailSet: pose.sailSet,
    waterHeight: sea === undefined ? 0 : sampleOcean(sea, pose.x, pose.z, time).height,
    hp: pose.hp,
    reloadedAt: [pose.reloadPort, pose.reloadStarboard],
    life: pose.life,
    kills: pose.kills,
    deaths: pose.deaths,
    spawn: pose.spawn,
  }
}

/** Installs `window.brickwake`. */
export const installDebugHook = (source: DebugSource): void => {
  const ship = (id: string) => {
    const pose = source.pose(id)
    return pose === undefined ? null : describeShip(id, pose, source.sea(), source.timeline()?.renderTime ?? 0)
  }
  const hook: BrickwakeDebug = {
    get connection() {
      return source.connection()
    },
    get joined() {
      return source.timeline() !== undefined
    },
    get sailing() {
      return source.sailing()
    },
    get shipId() {
      return source.shipId()
    },
    get latestTick() {
      return source.timeline()?.latestTick ?? -1
    },
    get renderTick() {
      const timeline = source.timeline()
      return timeline === undefined ? Number.NaN : timeline.renderTime * timeline.simHz
    },
    ships: () => source.shipIds().flatMap((id) => ship(id) ?? []),
    ownShip: () => {
      const id = source.shipId()
      return id === null ? null : ship(id)
    },
    camera: () => {
      const chase = source.camera()
      if (chase === undefined) return null
      const { position } = chase.camera
      const right = new Vector3(1, 0, 0).applyQuaternion(chase.camera.quaternion)
      return { position: [position.x, position.y, position.z], yaw: chase.yaw, pitch: chase.pitch, distance: chase.distance, roll: Math.asin(right.y) }
    },
    helm: () => source.helm() ?? null,
    frames: () => source.stats().averages(),
    events: () => [...source.events()],
    aim: () => (source.pose(source.shipId() ?? "") === undefined ? null : source.gunnery().aim()),
    effects: () => ({
      particles: source.effects().counts(),
      ballsInFlight: source.gunnery().balls.inFlight,
      shake: source.camera()?.trauma ?? 0,
    }),
    audio: () => source.audio().stats(),
    match: () => {
      if (source.shipId() === null) return null
      const reading = source.match()
      return { phase: reading.phase, rules: reading.rules, renderTime: reading.renderTime, hud: source.matchHud().shown() }
    },
    fire: () => source.gunnery().fire(),
    fireAt: ([x, y, z]) => source.gunnery().fire({ x, y, z }),
    orbit: (yaw, pitch, distance) => {
      const chase = source.camera()
      if (chase === undefined) return
      chase.yaw = yaw + Math.PI
      chase.pitch = pitch
      if (distance !== undefined) chase.distance = distance
    },
  }
  Object.defineProperty(window, "brickwake", { value: Object.freeze(hook), writable: false, configurable: false })
}
