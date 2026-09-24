import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from "three"
import { tuning } from "../../sim/tuning.ts"
import { ShipPose } from "./timeline.ts"

type Point = readonly [x: number, y: number, z: number]

/** Hull cross-section at one station, port to starboard, from the sim's hull lines so the drawn hull floats as the sim's does. */
const section = (x: number, halfBreadth: number, draft: number, top: number): ReadonlyArray<Point> => [
  [x, top, -halfBreadth],
  [x, -0.3 * draft, -halfBreadth],
  [x, -0.85 * draft, -0.6 * halfBreadth],
  [x, -draft, 0],
  [x, -0.85 * draft, 0.6 * halfBreadth],
  [x, -0.3 * draft, halfBreadth],
  [x, top, halfBreadth],
]

const pushTriangle = (out: Array<number>, a: Point, b: Point, c: Point) => out.push(...a, ...b, ...c)

const geometryOf = (positions: Array<number>) => {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

const buildHull = () => {
  const stations = tuning.hull.stations
  const last = stations[stations.length - 1]
  const first = stations[0]
  if (first === undefined || last === undefined) throw new Error("hull lines have no stations")
  const stem = { x: last.x + 2, halfBreadth: 0.12, draft: last.draft * 0.5, top: last.top + 0.5 }
  const sections = [...stations, stem].map((s) => section(s.x, s.halfBreadth, s.draft, s.top))
  const sides: Array<number> = []
  const deck: Array<number> = []
  for (let s = 0; s + 1 < sections.length; s++) {
    const a = sections[s]
    const b = sections[s + 1]
    if (a === undefined || b === undefined) continue
    for (let p = 0; p + 1 < a.length; p++) {
      const a0 = a[p]
      const a1 = a[p + 1]
      const b0 = b[p]
      const b1 = b[p + 1]
      if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) continue
      pushTriangle(sides, a0, b0, a1)
      pushTriangle(sides, a1, b0, b1)
    }
    const aPort = a[0]
    const aStarboard = a[a.length - 1]
    const bPort = b[0]
    const bStarboard = b[b.length - 1]
    if (aPort === undefined || aStarboard === undefined || bPort === undefined || bStarboard === undefined) continue
    pushTriangle(deck, aPort, aStarboard, bPort)
    pushTriangle(deck, bPort, aStarboard, bStarboard)
  }
  const transom = sections[0] ?? []
  const centre: Point = [first.x, (first.top - first.draft) / 2, 0]
  for (let p = 0; p < transom.length; p++) {
    const a = transom[p]
    const b = transom[(p + 1) % transom.length]
    if (a !== undefined && b !== undefined) pushTriangle(sides, centre, a, b)
  }
  return { sides: geometryOf(sides), deck: geometryOf(deck) }
}

const hullGeometry = buildHull()
const hullMaterial = new MeshStandardMaterial({ color: 0x24201d, roughness: 0.8, flatShading: true, side: DoubleSide })
const deckMaterial = new MeshStandardMaterial({ color: 0x7a6248, roughness: 0.9, flatShading: true, side: DoubleSide })
const sparMaterial = new MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.85 })
const sailMaterial = new MeshStandardMaterial({ color: 0xd9d1bf, roughness: 0.95, side: DoubleSide })
const rudderMaterial = new MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.8, flatShading: true })

const deckHeight = 2.6
const mastRadius = 0.28
/** Masts fore to aft: position along the keel, height above deck, and sail courses as [width, depth] from the top yard down. */
const masts = [
  { x: 6, height: 19, courses: [[6.5, 4.5], [9, 5.5]] },
  { x: -1, height: 22, courses: [[7.5, 5], [10.5, 6.5]] },
  { x: -8.5, height: 15, courses: [[7, 5.5]] },
] as const

/** Sail yards brace this fraction of the wind's angle off the bow, up to `maxBrace`. */
const braceGain = 0.5
const maxBrace = 0.65
/** A furled sail keeps this share of its depth, the bundle on the yard. */
const furledDepth = 0.06

const rudderChord = 2.2
const rudderGeometry = new BoxGeometry(rudderChord, 3.6, 0.3).translate(-rudderChord / 2, -0.2, 0)

/** A grey-box ship: hull lofted from the sim's hull lines, masts, sails that set and brace, a rudder that turns. */
export class ShipView {
  readonly group = new Group()
  /** Where the ship is drawn this frame; the game samples the timeline into it. */
  readonly pose = new ShipPose()
  readonly #rudder = new Mesh(rudderGeometry, rudderMaterial)
  readonly #rigs: Array<Group> = []
  readonly #sails: Array<Object3D> = []

  constructor(name: string) {
    this.group.name = `ship ${name}`
    this.group.add(new Mesh(hullGeometry.sides, hullMaterial), new Mesh(hullGeometry.deck, deckMaterial))
    this.#rudder.position.set(tuning.hull.stations[0]?.x ?? -12, 0, 0)
    this.group.add(this.#rudder)
    const bowsprit = new Mesh(new CylinderGeometry(0.16, 0.24, 9, 8), sparMaterial)
    bowsprit.position.set(16.5, 4.8, 0)
    bowsprit.rotation.z = -Math.PI / 2 + 0.3
    this.group.add(bowsprit)
    for (const mast of masts) {
      const spar = new Mesh(new CylinderGeometry(mastRadius * 0.6, mastRadius, mast.height, 10), sparMaterial)
      spar.position.set(mast.x, deckHeight + mast.height / 2, 0)
      this.group.add(spar)
      const rig = new Group()
      rig.position.set(mast.x + mastRadius + 0.15, 0, 0)
      let yardY = deckHeight + mast.height - 1
      for (const [width, depth] of mast.courses) {
        const yard = new Mesh(new CylinderGeometry(0.13, 0.13, width + 1.2, 6), sparMaterial)
        yard.rotation.x = Math.PI / 2
        yard.position.y = yardY
        const sail = new Mesh(new PlaneGeometry(width, depth).rotateY(Math.PI / 2).translate(0, -depth / 2, 0), sailMaterial)
        sail.position.y = yardY
        rig.add(yard, sail)
        this.#sails.push(sail)
        yardY -= depth + 0.4
      }
      this.#rigs.push(rig)
      this.group.add(rig)
    }
  }

  /** Poses the ship and its rig; `windToward` is the wind's yaw angle (see `directionFromAngle`). */
  update(pose: ShipPose, windToward: number): void {
    this.group.position.set(pose.x, pose.y, pose.z)
    this.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw)
    this.#rudder.rotation.y = pose.rudderAngle
    const depth = Math.max(furledDepth, pose.sailSet)
    for (const sail of this.#sails) sail.scale.y = depth
    const forwardX = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)
    const forwardZ = 2 * (pose.qx * pose.qz - pose.qw * pose.qy)
    const relative = windToward - Math.atan2(-forwardZ, forwardX)
    const offBow = Math.atan2(Math.sin(relative), Math.cos(relative))
    const brace = Math.max(-maxBrace, Math.min(maxBrace, offBow * braceGain))
    for (const rig of this.#rigs) rig.rotation.y = brace
  }
}
