import { expect, test } from "bun:test"
import { changeWeather, createMatch, stepMatch } from "./match.ts"
import { seas } from "./ocean.ts"
import { seedRng } from "./rng.ts"
import { ffaRules } from "./rules.ts"
import { shipId } from "./ship.ts"
import { SIM_HZ } from "./tuning.ts"
import { drawWeather, scaleSea, weatherEffects, weatherNames, type WeatherName } from "./weather.ts"
import { makeWind } from "./wind.ts"

const wind = makeWind({ toward: 0.4, speed: 14, gustiness: 1 })
const match = (seed: number, weather?: WeatherName) =>
  createMatch(weather === undefined ? { seed, sea: seas.open, wind, ships: [] } : { seed, weather, sea: seas.open, wind, ships: [] })

test("each weather is drawn about equally often", () => {
  const counts = new Map<WeatherName, number>()
  for (let seed = 0; seed < 4000; seed++) {
    const [weather] = drawWeather(seedRng(seed))
    counts.set(weather, (counts.get(weather) ?? 0) + 1)
  }
  for (const name of weatherNames) expect(counts.get(name)).toBeGreaterThan(850)
})

test("a match draws its weather from its seed and keeps it for the whole match", () => {
  expect(match(11).weather).toBe(match(11).weather)
  expect(new Set(Array.from({ length: 40 }, (_, seed) => match(seed).weather)).size).toBe(weatherNames.length)
  const start = match(11)
  let state = start
  for (let tick = 0; tick < 10 * SIM_HZ; tick++) state = stepMatch(state, new Map()).state
  expect(state.weather).toBe(start.weather)
  expect(state.sea).toBe(start.sea)
})

test("a pinned weather leaves the RNG stream as the seed starts it", () => {
  expect(match(11, "storm").rng).toBe(seedRng(11))
})

test("weather scales the base sea's amplitudes and the wind, keeping the wave list", () => {
  for (const name of weatherNames) {
    const state = match(3, name)
    const effect = weatherEffects[name]
    expect(state.sea.waves.map((wave) => ({ ...wave, amplitude: 0 }))).toEqual(seas.open.waves.map((wave) => ({ ...wave, amplitude: 0 })))
    state.sea.waves.forEach((wave, i) => expect(wave.amplitude).toBeCloseTo(seas.open.waves[i]!.amplitude * effect.waveHeight, 9))
    expect(state.wind.baseSpeed).toBeCloseTo(14 * effect.windSpeed, 9)
    expect(state.wind.gustiness).toBeCloseTo(effect.gustiness, 9)
    expect(state.wind.baseToward).toBe(0.4)
  }
  expect(match(3, "clear").sea).toEqual(seas.open)
  expect(weatherEffects.storm.waveHeight).toBeGreaterThan(1)
  expect(weatherEffects.fog.waveHeight).toBeLessThan(1)
})

test("scaling a sea past the loop-over steepness is refused", () => {
  expect(() => scaleSea(seas.open, 40)).toThrow()
})

test("no weather rolls a ship turning under full sail past 60°", () => {
  const id = shipId("captain")
  for (const name of weatherNames) {
    let state = createMatch({ seed: 1, weather: name, rules: { ...ffaRules, warmupSeconds: 0 }, sea: seas.open, wind, ships: [{ id, x: 0, z: 0, heading: 0 }] })
    let worst = 0
    for (let tick = 0; tick < 90 * SIM_HZ; tick++) {
      state = stepMatch(state, new Map([[id, { rudder: tick % (30 * SIM_HZ) < 10 * SIM_HZ ? 1 : 0, sail: 2 }]])).state
      const q = state.ships[0]!.orientation
      worst = Math.max(worst, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))))
    }
    expect(worst * (180 / Math.PI)).toBeLessThan(60)
  }
})

test("changing the weather rescales to what that weather would have made", () => {
  const changed = changeWeather(match(5, "fog"), "storm")
  const storm = match(5, "storm")
  expect(changed.weather).toBe("storm")
  changed.sea.waves.forEach((wave, i) => expect(wave.amplitude).toBeCloseTo(storm.sea.waves[i]!.amplitude, 9))
  expect(changed.wind.baseSpeed).toBeCloseTo(storm.wind.baseSpeed, 9)
  expect(changed.wind.gustiness).toBeCloseTo(storm.wind.gustiness, 9)
})
