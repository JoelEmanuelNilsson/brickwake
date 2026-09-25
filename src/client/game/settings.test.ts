import { beforeEach, expect, test } from "bun:test"
import { defaultSettings, graphicsFor, graphicsPresets, loadSettings, saveSettings } from "./settings.ts"

const stored = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) },
})
beforeEach(() => stored.clear())

test("settings persist across visits and a first visit gets the defaults", () => {
  expect(loadSettings()).toEqual(defaultSettings)
  const chosen = { sensitivity: 1.6, volume: 0.35, ambience: 0.5, quality: "low" } as const
  saveSettings(chosen)
  expect(loadSettings()).toEqual(chosen)
})

test("a corrupt store gives the defaults; one bad field keeps its default and the rest", () => {
  stored.set("brickwake.settings", "{not json")
  expect(loadSettings()).toEqual(defaultSettings)
  stored.set("brickwake.settings", JSON.stringify({ sensitivity: 40, volume: 0.2, ambience: "loud", quality: "ultra" }))
  expect(loadSettings()).toEqual({ ...defaultSettings, volume: 0.2 })
})

test("a graphics preset caps the pixel ratio to the device; URL measurement overrides win", () => {
  expect(graphicsFor("high", 2, new URLSearchParams())).toEqual({ pixelRatio: 1.5, samples: 4, bloom: true, shadows: true })
  expect(graphicsFor("high", 1, new URLSearchParams()).pixelRatio).toBe(1)
  expect(graphicsFor("low", 2, new URLSearchParams())).toEqual({ pixelRatio: graphicsPresets.low.maxPixelRatio, samples: 0, bloom: false, shadows: false })
  expect(graphicsFor("low", 2, new URLSearchParams("msaa=4&bloom=1&dpr=2"))).toEqual({ pixelRatio: 2, samples: 4, bloom: true, shadows: false })
})
