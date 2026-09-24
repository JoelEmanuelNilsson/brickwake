/** Name of a brick colour in `brickColors`. */
export type BrickColor =
  | "black"
  | "darkRed"
  | "red"
  | "pearlGold"
  | "tan"
  | "darkTan"
  | "reddishBrown"
  | "darkBrown"
  | "darkBluishGrey"
  | "lightBluishGrey"
  | "white"
  | "yellow"
  | "blue"
  | "darkBlue"
  | "transOrange"

/** Surface finish of a colour: ABS plastic, or LEGO's metallic pearl. */
export type BrickFinish = "plastic" | "pearl"

/** Brick colours by name, with the LDraw colour code, the sRGB value the renderer uses and the finish. */
export const brickColors: Readonly<Record<BrickColor, { readonly ldraw: number; readonly srgb: number; readonly finish: BrickFinish }>> = {
  black: { ldraw: 0, srgb: 0x1d2024, finish: "plastic" },
  darkRed: { ldraw: 320, srgb: 0x720e0f, finish: "plastic" },
  red: { ldraw: 4, srgb: 0xc91a09, finish: "plastic" },
  pearlGold: { ldraw: 297, srgb: 0xc9a04a, finish: "pearl" },
  tan: { ldraw: 19, srgb: 0xe4cd9e, finish: "plastic" },
  darkTan: { ldraw: 28, srgb: 0x958a73, finish: "plastic" },
  reddishBrown: { ldraw: 70, srgb: 0x582a12, finish: "plastic" },
  darkBrown: { ldraw: 308, srgb: 0x352100, finish: "plastic" },
  darkBluishGrey: { ldraw: 72, srgb: 0x6c6e68, finish: "plastic" },
  lightBluishGrey: { ldraw: 71, srgb: 0xa0a5a9, finish: "plastic" },
  white: { ldraw: 15, srgb: 0xf2f3f2, finish: "plastic" },
  yellow: { ldraw: 14, srgb: 0xf2cd37, finish: "plastic" },
  blue: { ldraw: 1, srgb: 0x0055bf, finish: "plastic" },
  darkBlue: { ldraw: 272, srgb: 0x0a3463, finish: "plastic" },
  transOrange: { ldraw: 182, srgb: 0xf08f1c, finish: "plastic" },
}
