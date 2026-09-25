import { Option, Schema } from "effect"

/** The graphics presets the settings menu offers. */
export type GraphicsQuality = "low" | "medium" | "high"

/** What one graphics preset renders. */
export interface GraphicsPreset {
  /** Cap on the device pixel ratio the scene renders at. */
  readonly maxPixelRatio: number
  /** MSAA samples of the scene target. */
  readonly samples: number
  readonly bloom: boolean
  readonly shadows: boolean
}

/** Presets from cheapest to the full look; "high" is what every measured frame time in the tickets used. */
export const graphicsPresets: Readonly<Record<GraphicsQuality, GraphicsPreset>> = {
  low: { maxPixelRatio: 1, samples: 0, bloom: false, shadows: false },
  medium: { maxPixelRatio: 1, samples: 4, bloom: true, shadows: true },
  high: { maxPixelRatio: 1.5, samples: 4, bloom: true, shadows: true },
}

/** The player's settings, kept across visits. */
export interface GameSettings {
  /** Mouse look speed as a multiple of the default. */
  readonly sensitivity: number
  /** Master volume 0–1. */
  readonly volume: number
  /** Sea, wind and rigging ambience 0–1, relative to the guns. */
  readonly ambience: number
  readonly quality: GraphicsQuality
}

/** Slider range of `GameSettings.sensitivity`. */
export const sensitivityRange = { min: 0.25, max: 3 } as const

/** Settings of a first visit. */
export const defaultSettings: GameSettings = { sensitivity: 1, volume: 0.8, ambience: 1, quality: "high" }

const settingsKey = "brickwake.settings"
const unit = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const fields = {
  sensitivity: Schema.Number.check(Schema.isBetween({ minimum: sensitivityRange.min, maximum: sensitivityRange.max })),
  volume: unit,
  ambience: unit,
  quality: Schema.Literals(["low", "medium", "high"]),
} as const
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** The stored settings; a missing or out-of-range field keeps its default, so one bad value never resets the rest. */
export const loadSettings = (): GameSettings => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(settingsKey)
  } catch {
    // Storage can be disabled (private mode): play on the defaults.
  }
  const stored = raw === null ? undefined : Option.getOrUndefined(decodeStored(raw))
  if (typeof stored !== "object" || stored === null) return defaultSettings
  const pick = <K extends keyof GameSettings>(key: K, schema: Schema.Codec<GameSettings[K]>): GameSettings[K] => {
    const value: unknown = Reflect.get(stored, key)
    return Schema.is(schema)(value) ? value : defaultSettings[key]
  }
  return {
    sensitivity: pick("sensitivity", fields.sensitivity),
    volume: pick("volume", fields.volume),
    ambience: pick("ambience", fields.ambience),
    quality: pick("quality", fields.quality),
  }
}

/** Keeps the settings for the next visit; with storage disabled they last this visit only. */
export const saveSettings = (settings: GameSettings): void => {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings))
  } catch {
    // Storage can be disabled (private mode).
  }
}

/** How the scene renders: a preset resolved against the device. */
export interface Graphics {
  readonly pixelRatio: number
  readonly samples: number
  readonly bloom: boolean
  readonly shadows: boolean
}

/** Resolves a graphics preset against the device and URL overrides (`dpr`, `msaa`, `bloom`, `shadows` for measurements). */
export const graphicsFor = (quality: GraphicsQuality, devicePixelRatio: number, params: URLSearchParams): Graphics => {
  const preset = graphicsPresets[quality]
  return {
    pixelRatio: Math.min(devicePixelRatio, Number(params.get("dpr") ?? preset.maxPixelRatio)),
    samples: Number(params.get("msaa") ?? preset.samples),
    bloom: params.has("bloom") ? params.get("bloom") !== "0" : preset.bloom,
    shadows: params.has("shadows") ? params.get("shadows") !== "0" : preset.shadows,
  }
}
