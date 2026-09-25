import { makeSea, type SeaState } from "./ocean.ts"
import { nextRandom, type RngState } from "./rng.ts"
import { makeWind, type Wind } from "./wind.ts"

/** Every weather a match can have. */
export const weatherNames = ["clear", "overcast", "fog", "storm"] as const

/** The weather of one match, fixed for the whole match. */
export type WeatherName = (typeof weatherNames)[number]

/** How a weather scales the base wind and sea. */
export interface WeatherEffect {
  readonly windSpeed: number
  readonly gustiness: number
  /** Multiplies every wave amplitude. */
  readonly waveHeight: number
}

/**
 * Wave heights keep the match sea's steepness (~0.06 at 1×) well under `makeSea`'s limit of 1. Wind stays near 1×:
 * heel grows steeply with it, and 1.25× with doubled gusts rolls a ship turning under full sail past 90°.
 */
export const weatherEffects: Readonly<Record<WeatherName, WeatherEffect>> = {
  clear: { windSpeed: 1, gustiness: 1, waveHeight: 1 },
  overcast: { windSpeed: 1, gustiness: 1.2, waveHeight: 1.3 },
  fog: { windSpeed: 0.75, gustiness: 0.5, waveHeight: 0.6 },
  storm: { windSpeed: 1.05, gustiness: 1.4, waveHeight: 1.8 },
}

/** Draws a weather, each equally likely. */
export const drawWeather = (rng: RngState): readonly [WeatherName, RngState] => {
  const [u, next] = nextRandom(rng)
  return [weatherNames[Math.floor(u * weatherNames.length)] ?? "clear", next]
}

/** `sea` with every wave amplitude multiplied by `factor`; throws, as `makeSea` does, if that makes the crests loop over. */
export const scaleSea = (sea: SeaState, factor: number): SeaState =>
  makeSea(sea.waves.map((wave) => ({ ...wave, amplitude: wave.amplitude * factor })))

/** The base sea and wind as `weather` changes them. */
export const applyWeather = (weather: WeatherName, sea: SeaState, wind: Wind): { readonly sea: SeaState; readonly wind: Wind } => {
  const effect = weatherEffects[weather]
  return {
    sea: scaleSea(sea, effect.waveHeight),
    wind: makeWind({ toward: wind.baseToward, speed: wind.baseSpeed * effect.windSpeed, gustiness: wind.gustiness * effect.gustiness }),
  }
}
