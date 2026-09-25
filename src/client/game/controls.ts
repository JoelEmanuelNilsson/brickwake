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

/** Wheel-equivalent delta of one Q/E press. */
const zoomStep = 180

/**
 * Keyboard helm (W/S sail a level, A/D held rudder), pointer-locked mouse orbit and aim, left click or F to fire, right
 * mouse or Space held for the aim view, wheel or Q/E to zoom. Input counts only once `active` is true, after the player's first click.
 */
export class Controls {
  #sail: SailLevel = 0
  #rudder: RudderCommand = 0
  #port = false
  #starboard = false
  #aimKey = false
  #aimButton = false
  active = false
  readonly #send: (message: ClientMessage) => void
  readonly #camera: ChaseCamera

  constructor(element: HTMLElement, camera: ChaseCamera, send: (message: ClientMessage) => void, fire: () => void) {
    this.#send = send
    this.#camera = camera
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
        case "Space":
          this.#aimKey = true
          this.#aim()
          break
        case "KeyF":
          if (!event.repeat) fire()
          break
        case "KeyQ":
          camera.zoom(zoomStep)
          break
        case "KeyE":
          camera.zoom(-zoomStep)
          break
        default:
          return
      }
      event.preventDefault()
    })
    window.addEventListener("keyup", (event) => {
      if (event.code === "KeyA") this.#port = false
      else if (event.code === "KeyD") this.#starboard = false
      else if (event.code === "Space") {
        this.#aimKey = false
        return this.#aim()
      } else return
      this.#steer()
    })
    // A key released while the window lost focus never sends keyup; centre the rudder instead of leaving it hard over.
    window.addEventListener("blur", () => this.release())
    element.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === element) camera.look(event.movementX, event.movementY)
    })
    // Without pointer lock the click is the one that asks for it, not a shot.
    element.addEventListener("mousedown", (event) => {
      if (this.active && event.button === 0 && document.pointerLockElement === element) fire()
      if (this.active && event.button === 2) {
        this.#aimButton = true
        this.#aim()
      }
    })
    window.addEventListener("mouseup", (event) => {
      if (event.button !== 2) return
      this.#aimButton = false
      this.#aim()
    })
    element.addEventListener("contextmenu", (event) => event.preventDefault())
    element.addEventListener("wheel", (event) => camera.zoom(event.deltaY), { passive: true })
  }

  /** The helm last asked for. */
  get helm(): HelmRequest {
    return { rudder: this.#rudder, sail: this.#sail }
  }

  /** Lets go of every held input: the rudder centres and the aim view ends. Sail stays as set. */
  release(): void {
    this.#port = false
    this.#starboard = false
    this.#aimKey = false
    this.#aimButton = false
    this.#steer()
    this.#aim()
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

  #aim() {
    this.#camera.holdAim(this.#aimKey || this.#aimButton)
  }

  #steer() {
    const rudder: RudderCommand = this.#starboard === this.#port ? 0 : this.#starboard ? 1 : -1
    if (rudder === this.#rudder) return
    this.#rudder = rudder
    this.#send({ _tag: "setHelm", rudder })
  }
}
