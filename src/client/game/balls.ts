import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three"
import { ballFromWire, type ServerEvent } from "../../protocol/messages.ts"
import { writeBallPosition, type Cannonball } from "../../sim/gunnery.ts"
import { tuning } from "../../sim/tuning.ts"

type CannonFired = Extract<ServerEvent, { readonly _tag: "cannonFired" }>
/** How a ball's flight ended, as the server reported it. */
export type BallEnd = Extract<ServerEvent, { readonly _tag: "ballHit" | "ballSplash" }>

/** What happens to balls at the moments the render clock reaches. */
export interface BallMoments {
  /** The ball leaves the muzzle (render time reached `firedAt`). */
  readonly fired: (ball: Cannonball) => void
  /** The ball is drawn at (x, y, z) this frame. */
  readonly flying: (ball: Cannonball, x: number, y: number, z: number) => void
  /** The flight ends; `ball` is undefined when its firing was never seen (joined mid-flight). */
  readonly ended: (end: BallEnd, ball: Cannonball | undefined) => void
}

const capacity = 256
/** Drawn radius, metres: about twice a 24-pounder's, so the ball reads at a few hundred metres. */
const radius = 0.3
/** Beyond this distance, metres, a ball and its trail are drawn larger in proportion, so they keep their size on screen. */
const readableDistance = 110
const maxReadableScale = 3.5
/** The smoke streak behind a ball: its length is this many seconds of flight, its head half-width metres. */
const trailSeconds = 0.16
const trailWidth = 0.55
const trailSegments = 6

/**
 * Two crossed ribbons along +z (0 at the ball, 1 at the tail), widening as they go, with RGBA vertex colours: a faint
 * warm glow at the head fading into grey smoke, soft at the edges. Scaled per ball by its speed.
 */
const trailGeometry = () => {
  const position: Array<number> = []
  const color: Array<number> = []
  const index: Array<number> = []
  for (const plane of [0, 1]) {
    const base = position.length / 3
    for (let s = 0; s <= trailSegments; s++) {
      const t = s / trailSegments
      const half = 0.5 + 1.1 * t
      const alpha = (1 - t) ** 1.6 * 0.45
      const heat = Math.max(0, 1 - t * 6)
      for (const across of [-1, 0, 1]) {
        position.push(plane === 0 ? across * half : 0, plane === 1 ? across * half : 0, t)
        color.push(0.34 + 0.8 * heat, 0.33 + 0.3 * heat, 0.32, across === 0 ? alpha : 0)
      }
      if (s < trailSegments) {
        const a = base + s * 3
        index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
  geometry.setAttribute("color", new Float32BufferAttribute(color, 4))
  geometry.setIndex(index)
  return geometry
}

interface Flight {
  ball: Cannonball | undefined
  launched: boolean
  end: BallEnd | undefined
}

/**
 * Balls in flight, drawn from `ballPositionAt` at the render time. Firing and impact are timed to the exact sim
 * time the server reports, not to the tick their event arrives in, so a ripple broadside ripples on screen.
 */
export class Cannonballs {
  readonly mesh: InstancedMesh
  /** The smoke streak behind each drawn ball, instance for instance with `mesh`. */
  readonly trails: InstancedMesh
  readonly #moments: BallMoments
  readonly #flights: Array<Flight> = Array.from({ length: capacity }, () => ({ ball: undefined, launched: false, end: undefined }))
  readonly #matrix = new Matrix4()
  readonly #at = { x: 0, y: 0, z: 0 }
  readonly #back = new Vector3()
  readonly #side = new Vector3()
  readonly #up = new Vector3()
  #count = 0

  constructor(scene: Scene, moments: BallMoments) {
    this.#moments = moments
    this.mesh = new InstancedMesh(new SphereGeometry(radius, 14, 10), new MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.7, roughness: 0.35 }), capacity)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
    this.trails = new InstancedMesh(trailGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }), capacity)
    this.trails.instanceMatrix.setUsage(DynamicDrawUsage)
    this.trails.count = 0
    this.trails.frustumCulled = false
    scene.add(this.trails)
  }

  /** Balls fired and not yet ended at the render time. */
  get inFlight(): number {
    let n = 0
    for (let i = 0; i < this.#count; i++) if (this.#flights[i]?.launched === true) n++
    return n
  }

  /** Handles the gunnery events among the server events. */
  onEvent(event: ServerEvent): void {
    if (event._tag === "cannonFired") this.#add(event)
    else if (event._tag === "ballHit" || event._tag === "ballSplash") this.#end(event)
  }

  /** The ball `id` while it is known (fired and not yet ended at the render time). */
  find(id: number): Cannonball | undefined {
    for (let i = 0; i < this.#count; i++) if (this.#flights[i]?.ball?.id === id) return this.#flights[i]?.ball
    return undefined
  }

  #add(event: CannonFired) {
    if (this.#count >= capacity) return
    const flight = this.#flights[this.#count++]
    if (flight === undefined) return
    flight.ball = ballFromWire(event)
    flight.launched = false
    flight.end = undefined
  }

  #end(event: BallEnd) {
    for (let i = 0; i < this.#count; i++) {
      const flight = this.#flights[i]
      if (flight?.ball?.id === event.ballId) {
        flight.end = event
        return
      }
    }
    this.#moments.ended(event, undefined)
  }

  /** Plays the moments the render clock passed and draws the balls at `renderTime`, seen from `eye`. */
  update(renderTime: number, eye: Vector3): void {
    let drawn = 0
    for (let i = 0; i < this.#count; ) {
      const flight = this.#flights[i]
      const ball = flight?.ball
      if (flight === undefined || ball === undefined) break
      if (renderTime < ball.firedAt) {
        i++
        continue
      }
      if (!flight.launched) {
        flight.launched = true
        this.#moments.fired(ball)
      }
      const end = flight.end
      if ((end !== undefined && renderTime >= end.time) || renderTime > ball.firedAt + tuning.guns.maxFlightSeconds) {
        if (end !== undefined) this.#moments.ended(end, ball)
        this.#remove(i)
        continue
      }
      const at = this.#at
      writeBallPosition(ball, renderTime, at)
      this.#moments.flying(ball, at.x, at.y, at.z)
      const scale = Math.min(maxReadableScale, Math.max(1, Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z) / readableDistance))
      this.mesh.setMatrixAt(drawn, this.#matrix.makeScale(scale, scale, scale).setPosition(at.x, at.y, at.z))
      this.#placeTrail(drawn++, ball, renderTime, scale)
      i++
    }
    this.mesh.count = drawn
    this.mesh.instanceMatrix.needsUpdate = true
    this.trails.count = drawn
    this.trails.instanceMatrix.needsUpdate = true
  }

  /** Lays trail `instance` back along the flight from the ball just drawn, no longer than the ball has flown. */
  #placeTrail(instance: number, ball: Cannonball, renderTime: number, scale: number) {
    const at = this.#at
    const hx = at.x
    const hy = at.y
    const hz = at.z
    writeBallPosition(ball, Math.max(ball.firedAt, renderTime - trailSeconds), at)
    const tail = this.#back.set(at.x - hx, at.y - hy, at.z - hz)
    const length = tail.length()
    if (length > 1e-4) tail.divideScalar(length)
    else tail.set(0, 0, 1)
    const side = this.#side.set(-tail.z, 0, tail.x)
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    side.normalize()
    const up = this.#up.crossVectors(tail, side)
    const w = trailWidth * scale
    this.#matrix.makeBasis(side.multiplyScalar(w), up.multiplyScalar(w), tail.multiplyScalar(length)).setPosition(hx, hy, hz)
    this.trails.setMatrixAt(instance, this.#matrix)
  }

  #remove(i: number) {
    const last = --this.#count
    const gone = this.#flights[i]
    const moved = this.#flights[last]
    if (gone === undefined || moved === undefined) return
    this.#flights[i] = moved
    this.#flights[last] = gone
    gone.ball = undefined
    gone.end = undefined
  }
}
