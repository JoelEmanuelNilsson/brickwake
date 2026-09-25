import { Schema } from "effect"
import { ScenarioNameSchema } from "../protocol/messages.ts"
import { Game } from "./game/game.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#scene")
const hud = document.querySelector<HTMLElement>("#hud")
const overlay = document.querySelector<HTMLElement>("#overlay")
const status = document.querySelector<HTMLElement>("#status")
const reticle = document.querySelector<HTMLElement>("#reticle")
const match = document.querySelector<HTMLElement>("#match")
const hits = document.querySelector<HTMLElement>("#hits")
if (canvas === null || hud === null || overlay === null || status === null || reticle === null || match === null || hits === null) {
  throw new Error("index.html is missing #scene, #hud, #overlay, #status, #reticle, #match or #hits")
}

const params = new URLSearchParams(location.search)
const scenario = params.get("scenario")
const isScenario = Schema.is(ScenarioNameSchema)
if (scenario !== null && !isScenario(scenario)) {
  overlay.dataset.state = "error"
  overlay.querySelector(".overlay-hint")?.replaceChildren(`Unknown scenario “${scenario}”.`)
} else {
  const room = params.get("room")
  new Game(canvas, { hud, overlay, status, reticle, match, hits }, {
    scenario: scenario ?? undefined,
    // With a scenario, clients naming the same room share it (two-browser tests).
    room: room ?? undefined,
    // Starting camera angle off the stern in degrees, for screenshots from the side or bow.
    orbit: (Number(params.get("orbit") ?? 0) * Math.PI) / 180,
    pixelRatio: Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? 1.5)),
  })
}
