import { expect, test } from "bun:test"
import { gunLayout, gunsOnSide } from "./gun-layout.ts"

test("the galleon carries two decks of six guns a side, rippling bow to stern 50 ms apart", () => {
  for (const side of ["port", "starboard"] as const) {
    const guns = gunsOnSide(gunLayout, side)
    expect(guns).toHaveLength(12)
    expect(guns.filter((g) => g.deck === "lower").every((g) => g.position.y === 1.3)).toBe(true)
    expect(guns.filter((g) => g.deck === "upper")).toHaveLength(6)
    expect(guns.map((g) => g.rippleDelay)).toEqual(guns.map((_, i) => i * 0.05))
    expect(guns.every((g, i) => i === 0 || g.position.x <= (guns[i - 1]?.position.x ?? Infinity))).toBe(true)
    expect(guns.every((g) => Math.sign(g.outward.z) === (side === "port" ? -1 : 1))).toBe(true)
  }
})
