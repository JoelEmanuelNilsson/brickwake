import type { ClientMessage } from "../../protocol/messages.ts"
import type { RudderCommand, SailLevel } from "../../sim/ship.ts"
import type { ChaseCamera } from "./chase-camera.ts"

/** The helm the player has asked for; the server's echo arrives in snapshots. */
export interface HelmRequest {
  readonly rudder: RudderCommand
  readonly sail: SailLevel
}

const raise: Record<SailLevel, SailLevel> = { 0: 1, 1: 2, 2: 2 }
const lower: Record<SailLevel, SailLevel> = { 0: 0, 1: 0, 2: 1 }

/**
 * Keyboard helm (W/S sail a level, A/D held rudder), pointer-locked mouse orbit and left-click fire. Input counts only
 * once `active` is true, after the player's first click.
 */
export class Controls {
  #sail: SailLevel = 0
  #rudder: RudderCommand = 0
  #port = false
  #starboard = false
  active = false
  readonly #send: (message: ClientMessage) => void

  constructor(element: HTMLElement, camera: ChaseCamera, send: (message: ClientMessage) => void, fire: () => void) {
    this.#send = send
    window.addEventListener("keydown", (event) => {
      if (!this.active) return
      switch (event.code) {
        case "KeyW":
          if (!event.repeat) this.#setSail(raise[this.#sail])
          break
        case "KeyS":
          if (!event.repeat) this.#setSail(lower[this.#sail])
          break
        case "KeyA":
          this.#port = true
          this.#steer()
          break
        case "KeyD":
          this.#starboard = true
          this.#steer()
          break
        default:
          return
      }
      event.preventDefault()
    })
    window.addEventListener("keyup", (event) => {
      if (event.code === "KeyA") this.#port = false
      else if (event.code === "KeyD") this.#starboard = false
      else return
      this.#steer()
    })
    // A key released while the window lost focus never sends keyup; centre the rudder instead of leaving it hard over.
    window.addEventListener("blur", () => {
      this.#port = false
      this.#starboard = false
      this.#steer()
    })
    element.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === element) camera.look(event.movementX, event.movementY)
    })
    // Without pointer lock the click is the one that asks for it, not a shot.
    element.addEventListener("mousedown", (event) => {
      if (this.active && event.button === 0 && document.pointerLockElement === element) fire()
    })
    element.addEventListener("wheel", (event) => camera.zoom(event.deltaY), { passive: true })
  }

  /** The helm last asked for. */
  get helm(): HelmRequest {
    return { rudder: this.#rudder, sail: this.#sail }
  }

  /** Adopts the ship's sail level from the server, for a fresh join. */
  syncSail(level: SailLevel): void {
    this.#sail = level
  }

  #setSail(level: SailLevel) {
    if (level === this.#sail) return
    this.#sail = level
    this.#send({ _tag: "setSail", level })
  }

  #steer() {
    const rudder: RudderCommand = this.#starboard === this.#port ? 0 : this.#starboard ? 1 : -1
    if (rudder === this.#rudder) return
    this.#rudder = rudder
    this.#send({ _tag: "setHelm", rudder })
  }
}
