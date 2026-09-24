import { DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, SphereGeometry, type Scene } from "three"
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
  readonly #moments: BallMoments
  readonly #flights: Array<Flight> = Array.from({ length: capacity }, () => ({ ball: undefined, launched: false, end: undefined }))
  readonly #matrix = new Matrix4()
  readonly #at = { x: 0, y: 0, z: 0 }
  #count = 0

  constructor(scene: Scene, moments: BallMoments) {
    this.#moments = moments
    this.mesh = new InstancedMesh(new SphereGeometry(radius, 14, 10), new MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.7, roughness: 0.35 }), capacity)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
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

  /** Plays the moments the render clock passed and draws the balls at `renderTime`. */
  update(renderTime: number): void {
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
      writeBallPosition(ball, renderTime, this.#at)
      this.#moments.flying(ball, this.#at.x, this.#at.y, this.#at.z)
      this.mesh.setMatrixAt(drawn++, this.#matrix.makeTranslation(this.#at.x, this.#at.y, this.#at.z))
      i++
    }
    this.mesh.count = drawn
    this.mesh.instanceMatrix.needsUpdate = true
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
