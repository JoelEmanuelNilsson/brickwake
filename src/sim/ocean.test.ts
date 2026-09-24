import { expect, test } from "bun:test"
import { gerstnerPoint, makeSea, sampleOcean, seas, swell, waveAngularFrequency } from "./ocean.ts"
import { length } from "./vector.ts"

const points = Array.from({ length: 40 }, (_, i) => ({ x: Math.sin(i * 12.9898) * 400, z: Math.cos(i * 78.233) * 400, t: i * 3.7 }))

test("calm water is flat and still", () => {
  expect(sampleOcean(seas.calm, 12, -40, 99)).toEqual({ height: 0, normal: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } })
})

test("the sampled height is the height of the drawn (displaced) surface", () => {
  for (const sea of [seas.open, swell(1)]) {
    for (const { x, z, t } of points) {
      const drawn = gerstnerPoint(sea, x, z, t)
      expect(Math.abs(sampleOcean(sea, drawn.x, drawn.z, t).height - drawn.y)).toBeLessThan(0.005)
    }
  }
})

test("the sampled velocity is the surface water's motion", () => {
  const dt = 1e-3
  for (const { x, z, t } of points) {
    const at = gerstnerPoint(seas.open, x, z, t)
    const next = gerstnerPoint(seas.open, x, z, t + dt)
    const sampled = sampleOcean(seas.open, at.x, at.z, t).velocity
    expect(Math.abs(sampled.x - (next.x - at.x) / dt)).toBeLessThan(0.02)
    expect(Math.abs(sampled.y - (next.y - at.y) / dt)).toBeLessThan(0.02)
    expect(Math.abs(sampled.z - (next.z - at.z) / dt)).toBeLessThan(0.02)
  }
})

test("the normal is a unit vector perpendicular to the surface", () => {
  const e = 0.01
  for (const { x, z, t } of points) {
    const { normal, height } = sampleOcean(seas.open, x, z, t)
    const slopeX = (sampleOcean(seas.open, x + e, z, t).height - height) / e
    const slopeZ = (sampleOcean(seas.open, x, z + e, t).height - height) / e
    expect(length(normal)).toBeCloseTo(1, 9)
    expect(Math.abs(-normal.x / normal.y - slopeX)).toBeLessThan(0.01)
    expect(Math.abs(-normal.z / normal.y - slopeZ)).toBeLessThan(0.01)
  }
})

test("the match sea is heavy swell: crests over a metre, periods of several seconds", () => {
  const heights = points.map(({ x, z, t }) => sampleOcean(seas.open, x, z, t).height)
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2.5)
  const main = seas.open.waves[0]
  expect(main && (2 * Math.PI) / waveAngularFrequency(main)).toBeGreaterThan(7)
})

test("a sea whose crests would loop over is rejected", () => {
  expect(() => makeSea([{ direction: 0, wavelength: 20, amplitude: 4, sharpness: 1, phase: 0 }])).toThrow()
})
