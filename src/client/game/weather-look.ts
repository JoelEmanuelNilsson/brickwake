import type { WeatherName } from "../../sim/weather.ts"
import type { SkyLook } from "./sky.ts"

type Rgb = readonly [number, number, number]

/** How one weather looks: sky, lights, fog, sea and rain. Colours are linear. */
export interface WeatherLook {
  /** Name the HUD shows. */
  readonly label: string
  readonly sky: SkyLook
  readonly sun: { readonly color: Rgb; readonly intensity: number }
  /** The warm light from over the camera's shoulder. */
  readonly fill: { readonly color: Rgb; readonly intensity: number }
  readonly hemisphere: { readonly sky: Rgb; readonly ground: Rgb; readonly intensity: number }
  readonly environment: number
  readonly fogDensity: number
  /** Sunlight on the water, multiplier on the water's own colour, sun-glint and foam brightness, and the tint of reflected sky. */
  readonly sea: { readonly sun: Rgb; readonly water: Rgb; readonly glint: number; readonly foam: number; readonly reflection: Rgb }
  /** Rain drops drawn, 0…1 of the most. */
  readonly rain: number
}

/** Every weather's look. `clear` is the tuned ref-01 sunset; the others dim and grey it. */
export const weatherLooks: Readonly<Record<WeatherName, WeatherLook>> = {
  clear: {
    label: "Clear",
    sky: { turbidity: 12, rayleigh: 4, cloudCoverage: 0.62, cloudDensity: 1, sunDisc: 25, cloudShade: 1, cloudLight: [0.8, 0.36, 0.16], saturation: 0.3, grade: [1.3, 0.546, 0.364] },
    sun: { color: [1, 0.44, 0.19], intensity: 3.2 },
    fill: { color: [1, 0.58, 0.3], intensity: 1.4 },
    hemisphere: { sky: [1, 0.55, 0.32], ground: [0.004, 0.024, 0.03], intensity: 1.1 },
    environment: 0.4,
    fogDensity: 0.0011,
    sea: { sun: [1.8, 0.75, 0.25], water: [1, 1, 1], glint: 1, foam: 1, reflection: [0.45, 1.2, 2.2] },
    rain: 0,
  },
  overcast: {
    label: "Overcast",
    sky: { turbidity: 12, rayleigh: 2, cloudCoverage: 0.95, cloudDensity: 1.4, sunDisc: 0, cloudShade: 1, cloudLight: [0.3, 0.26, 0.22], saturation: 0.12, grade: [0.8, 0.66, 0.58] },
    sun: { color: [0.75, 0.55, 0.4], intensity: 1.2 },
    fill: { color: [0.8, 0.66, 0.55], intensity: 0.9 },
    hemisphere: { sky: [0.5, 0.45, 0.4], ground: [0.01, 0.025, 0.03], intensity: 1.4 },
    environment: 0.5,
    fogDensity: 0.0017,
    sea: { sun: [0.5, 0.35, 0.22], water: [0.95, 1, 1.05], glint: 0.15, foam: 0.45, reflection: [0.6, 1, 1.4] },
    rain: 0,
  },
  fog: {
    label: "Fog",
    sky: { turbidity: 12, rayleigh: 1, cloudCoverage: 1.4, cloudDensity: 12, sunDisc: 0, cloudShade: 0.15, cloudLight: [1.1, 1.05, 1], saturation: 0.05, grade: [1.7, 1.65, 1.6] },
    sun: { color: [0.8, 0.65, 0.5], intensity: 0.8 },
    fill: { color: [0.8, 0.75, 0.68], intensity: 0.8 },
    hemisphere: { sky: [0.6, 0.57, 0.53], ground: [0.02, 0.03, 0.035], intensity: 1.6 },
    environment: 0.6,
    fogDensity: 0.0065,
    sea: { sun: [0.4, 0.3, 0.2], water: [1.1, 1.15, 1.1], glint: 0.1, foam: 0.7, reflection: [0.8, 0.95, 1.05] },
    rain: 0,
  },
  storm: {
    label: "Storm",
    sky: { turbidity: 12, rayleigh: 1, cloudCoverage: 1.4, cloudDensity: 2.5, sunDisc: 0, cloudShade: 1, cloudLight: [0.1, 0.11, 0.13], saturation: 0.05, grade: [0.38, 0.43, 0.5] },
    sun: { color: [0.55, 0.62, 0.72], intensity: 0.7 },
    fill: { color: [0.6, 0.66, 0.75], intensity: 0.6 },
    hemisphere: { sky: [0.3, 0.35, 0.42], ground: [0.004, 0.012, 0.016], intensity: 1.1 },
    environment: 0.35,
    fogDensity: 0.0024,
    sea: { sun: [0.2, 0.22, 0.25], water: [0.7, 0.85, 0.9], glint: 0, foam: 0.15, reflection: [0.35, 0.5, 0.6] },
    rain: 1,
  },
}
