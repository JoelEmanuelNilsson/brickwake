import type { BrickColor } from "../../sim/ship/colors.ts"

/** Surface finish of a colour: ABS plastic, LEGO's metallic pearl, or transparent plastic lit from behind (windows). */
export type BrickFinish = "plastic" | "pearl" | "glow"

/** Brick colours by name, with the sRGB value the renderer uses and the finish. */
export const brickColors: Readonly<Record<BrickColor, { readonly srgb: number; readonly finish: BrickFinish }>> = {
  black: { srgb: 0x10151d, finish: "plastic" },
  darkRed: { srgb: 0x720e0f, finish: "plastic" },
  red: { srgb: 0xc91a09, finish: "plastic" },
  pearlGold: { srgb: 0xbcb48e, finish: "pearl" },
  tan: { srgb: 0xe4cd9e, finish: "plastic" },
  darkTan: { srgb: 0x958a73, finish: "plastic" },
  reddishBrown: { srgb: 0x582a12, finish: "plastic" },
  darkBrown: { srgb: 0x352100, finish: "plastic" },
  darkBluishGrey: { srgb: 0x6c6e68, finish: "plastic" },
  lightBluishGrey: { srgb: 0xa0a5a9, finish: "plastic" },
  white: { srgb: 0xf2f3f2, finish: "plastic" },
  yellow: { srgb: 0xf2cd37, finish: "plastic" },
  blue: { srgb: 0x0055bf, finish: "plastic" },
  darkBlue: { srgb: 0x0a3463, finish: "plastic" },
  transOrange: { srgb: 0xf08f1c, finish: "glow" },
}
