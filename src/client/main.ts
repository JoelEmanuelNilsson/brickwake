import { Schema } from "effect"
import { ScenarioNameSchema } from "../protocol/messages.ts"
import { Game } from "./game/game.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#scene")
const hud = document.querySelector<HTMLElement>("#hud")
const overlay = document.querySelector<HTMLElement>("#overlay")
const status = document.querySelector<HTMLElement>("#status")
const reticle = document.querySelector<HTMLElement>("#reticle")
if (canvas === null || hud === null || overlay === null || status === null || reticle === null) {
  throw new Error("index.html is missing #scene, #hud, #overlay, #status or #reticle")
}

const params = new URLSearchParams(location.search)
const scenario = params.get("scenario")
const isScenario = Schema.is(ScenarioNameSchema)
if (scenario !== null && !isScenario(scenario)) {
  overlay.dataset.state = "error"
  overlay.querySelector(".overlay-hint")?.replaceChildren(`Unknown scenario “${scenario}”.`)
} else {
  new Game(canvas, { hud, overlay, status, reticle }, {
    scenario: scenario ?? undefined,
    // Starting camera angle off the stern in degrees, for screenshots from the side or bow.
    orbit: (Number(params.get("orbit") ?? 0) * Math.PI) / 180,
    pixelRatio: Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? 1.5)),
  })
}
