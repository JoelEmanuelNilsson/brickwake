import { describe, expect, test } from "bun:test"
import { renderSoundBank } from "./sound-bank.ts"
import { bandShare, decaySeconds, envelopeFrames, peakLevel, spectralCentroid } from "./sound-analysis.ts"
import { whistlePeakSeconds } from "./sound-recipes.ts"

const sampleRate = 48000
const bank = renderSoundBank(sampleRate)

describe("sound bank", () => {
  test("every sound is finite, audible and below full scale", () => {
    const all = [...Object.values(bank.oneShots).flat(), ...Object.values(bank.loops), ...bank.reverb]
    for (const samples of all) {
      expect(samples.every(Number.isFinite)).toBe(true)
      expect(peakLevel(samples)).toBeGreaterThan(0.5)
      expect(peakLevel(samples)).toBeLessThanOrEqual(1)
    }
  })

  test("a near cannon boom is mostly low body with a crack on its attack and a long tail; a distant one is darker", () => {
    for (const boom of bank.oneShots.cannonBoom) {
      expect(bandShare(boom, sampleRate, 0, 150)).toBeGreaterThan(0.8)
      expect(spectralCentroid(boom.slice(0, sampleRate / 10), sampleRate)).toBeGreaterThan(350)
      expect(decaySeconds(boom, sampleRate)).toBeGreaterThan(3.5)
    }
    for (const boom of bank.oneShots.distantBoom) expect(spectralCentroid(boom, sampleRate)).toBeLessThan(300)
  })

  test("the fuse hisses high and the hull thud booms low", () => {
    expect(spectralCentroid(bank.oneShots.fuse[0]!, sampleRate)).toBeGreaterThan(4000)
    expect(bandShare(bank.oneShots.hullThud[0]!, sampleRate, 0, 150)).toBeGreaterThan(0.8)
  })

  test("a fire roars low under bright crackle; catching, it thumps and then whooshes up", () => {
    for (const crackle of bank.oneShots.fireCrackle) {
      expect(bandShare(crackle, sampleRate, 0, 500)).toBeGreaterThan(0.3)
      expect(bandShare(crackle, sampleRate, 1000, 6000)).toBeGreaterThan(0.3)
    }
    for (const ignite of bank.oneShots.ignite) {
      const thump = spectralCentroid(ignite.slice(0, sampleRate / 10), sampleRate)
      expect(spectralCentroid(ignite.slice(sampleRate / 4, sampleRate / 2), sampleRate)).toBeGreaterThan(4 * thump)
    }
  })

  test("a whistle is loudest at its closest pass", () => {
    for (const whistle of bank.oneShots.whistle) {
      const env = envelopeFrames(whistle, sampleRate, 0.01)
      const loudest = env.indexOf(Math.max(...env)) * 0.01
      expect(Math.abs(loudest - whistlePeakSeconds)).toBeLessThan(0.05)
    }
  })

  test("ambience loops have no seam: the step across the loop point is an ordinary step", () => {
    for (const loop of Object.values(bank.loops)) {
      const steps = Array.from({ length: loop.length - 1 }, (_, i) => Math.abs((loop[i + 1] ?? 0) - (loop[i] ?? 0))).sort((a, b) => a - b)
      const typical = steps[Math.floor(steps.length * 0.99)] ?? 0
      expect(Math.abs((loop[0] ?? 0) - (loop[loop.length - 1] ?? 0))).toBeLessThanOrEqual(typical)
    }
  })
})
