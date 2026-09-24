import { tuning } from "./tuning.ts"
import { vec3, type Vec3 } from "./vector.ts"

/** The side a broadside fires to. */
export type BroadsideSide = "port" | "starboard"

/** Which gun deck a gun sits on. */
export type GunDeck = "lower" | "upper"

/** One cannon's mount, ship-local. */
export interface GunMount {
  readonly side: BroadsideSide
  readonly deck: GunDeck
  /** Trunnion position at the gunport, ship-local metres. */
  readonly position: Vec3
  /** Unit vector straight out of the port, ship-local (±z). */
  readonly outward: Vec3
  /** Seconds after the broadside order that this gun fires; the ripple runs bow to stern. */
  readonly rippleDelay: number
}

/** Where a ship's gunports are: per deck its height above the waterline and the port x positions. */
export interface GunLayoutSpec {
  readonly decks: ReadonlyArray<{ readonly deck: GunDeck; readonly height: number; readonly xs: ReadonlyArray<number> }>
  /** Distance from the centreline to the gunports, metres. */
  readonly halfBeam: number
}

/** Two gun decks × 6 per side; upper ports are staggered against the lower ones, as on a real galleon. */
export const galleonGunSpec: GunLayoutSpec = {
  decks: [
    { deck: "lower", height: 1.3, xs: [-8.5, -5.5, -2.5, 0.5, 3.5, 6.5] },
    { deck: "upper", height: 3.3, xs: [-10, -7, -4, -1, 2, 5] },
  ],
  halfBeam: 4,
}

/** Builds every gun mount of a layout, both sides. */
export const makeGunLayout = (spec: GunLayoutSpec): ReadonlyArray<GunMount> =>
  (["port", "starboard"] as const).flatMap((side) => {
    const sign = side === "port" ? -1 : 1
    const mounts = spec.decks.flatMap(({ deck, height, xs }) =>
      xs.map((x) => ({ side, deck, position: vec3(x, height, sign * spec.halfBeam), outward: vec3(0, 0, sign) })),
    )
    const bowFirst = [...mounts].sort((a, b) => b.position.x - a.position.x)
    return bowFirst.map((mount, order) => ({ ...mount, rippleDelay: order * tuning.guns.rippleInterval }))
  })

/** The galleon's guns. */
export const gunLayout: ReadonlyArray<GunMount> = makeGunLayout(galleonGunSpec)

/** The guns that fire on one side, bow first. */
export const gunsOnSide = (layout: ReadonlyArray<GunMount>, side: BroadsideSide): ReadonlyArray<GunMount> =>
  layout.filter((gun) => gun.side === side)
