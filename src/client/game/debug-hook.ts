import { Vector3 } from "three"
import type { ServerEvent } from "../../protocol/messages.ts"
import { sampleOcean, type SeaState } from "../../sim/ocean.ts"
import { angleOfDirection, rotate, vec3, type Quat } from "../../sim/vector.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { ConnectionState } from "./connection.ts"
import type { HelmRequest } from "./controls.ts"
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
}

/** The chase camera; `roll` is the tilt of its horizon, which stays 0 whatever the ship does. */
export interface DebugCamera {
  readonly position: readonly [number, number, number]
  readonly yaw: number
  readonly pitch: number
  readonly distance: number
  readonly roll: number
}

/** Read-only view of the client's match on `window.brickwake`, for Playwright. Every call returns fresh plain data. */
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
  }
  Object.defineProperty(window, "brickwake", { value: Object.freeze(hook), writable: false, configurable: false })
}
