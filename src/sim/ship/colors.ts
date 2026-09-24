/** LDraw colour code of every brick colour ships use; the keys name the colours. */
export const ldrawColorCodes = {
  black: 0,
  darkRed: 320,
  red: 4,
  pearlGold: 297,
  tan: 19,
  darkTan: 28,
  reddishBrown: 70,
  darkBrown: 308,
  darkBluishGrey: 72,
  lightBluishGrey: 71,
  white: 15,
  yellow: 14,
  blue: 1,
  darkBlue: 272,
  transOrange: 182,
} as const

/** Name of a brick colour. */
export type BrickColor = keyof typeof ldrawColorCodes
