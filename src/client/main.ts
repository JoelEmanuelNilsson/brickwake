import { Schema } from "effect"
import { MatchModeSchema, ScenarioNameSchema } from "../protocol/messages.ts"
import { ffaRules, tdmRules } from "../sim/rules.ts"
import { Game, modeKey } from "./game/game.ts"
import { graphicsFor, loadSettings } from "./game/settings.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#scene")
const hud = document.querySelector<HTMLElement>("#hud")
const overlay = document.querySelector<HTMLElement>("#overlay")
const status = document.querySelector<HTMLElement>("#status")
const reticle = document.querySelector<HTMLElement>("#reticle")
const match = document.querySelector<HTMLElement>("#match")
const hits = document.querySelector<HTMLElement>("#hits")
const pause = document.querySelector<HTMLElement>("#pause")
const settings = document.querySelector<HTMLElement>("#settings")
const hint = document.querySelector<HTMLElement>("#hint")
if (canvas === null || hud === null || overlay === null || status === null || reticle === null || match === null || hits === null || pause === null || settings === null || hint === null) {
  throw new Error("index.html is missing #scene, #hud, #overlay, #status, #reticle, #match, #hits, #pause, #settings or #hint")
}

for (const rules of [ffaRules, tdmRules]) {
  const card = overlay.querySelector(`[data-mode="${rules.mode}"]`)
  card?.querySelector("[data-limit]")?.replaceChildren(String(rules.scoreLimit))
  card?.querySelector("[data-minutes]")?.replaceChildren(String(Math.round(rules.timeLimit / 60)))
}

const params = new URLSearchParams(location.search)
const scenario = params.get("scenario")
const isScenario = Schema.is(ScenarioNameSchema)
const isMode = Schema.is(MatchModeSchema)
const mode = params.get("mode") ?? localStorage.getItem(modeKey)
if (scenario !== null && !isScenario(scenario)) {
  overlay.dataset.state = "error"
  overlay.querySelector(".overlay-hint")?.replaceChildren(`Unknown scenario “${scenario}”.`)
} else {
  const room = params.get("room")
  new Game(canvas, { hud, overlay, status, reticle, match, hits, pause, settings, hint }, {
    scenario: scenario ?? undefined,
    // With a scenario, clients naming the same room share it (two-browser tests).
    room: room ?? undefined,
    mode: isMode(mode) ? mode : "ffa",
    // Starting camera angle off the stern in degrees, for screenshots from the side or bow.
    orbit: (Number(params.get("orbit") ?? 0) * Math.PI) / 180,
    settings: loadSettings(),
    graphics: (quality) => graphicsFor(quality, window.devicePixelRatio, params),
  })
}
