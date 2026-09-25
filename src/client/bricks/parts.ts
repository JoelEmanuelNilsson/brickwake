import { type BufferGeometry, Matrix4 } from "three"
import { ldu, metresPerLdu, type PartId, type PartInfo, type Point2, partCatalog } from "../../sim/ship/parts.ts"
import { PartMesher } from "./geometry.ts"

const { stud, plate } = ldu

const slope45: ReadonlyArray<Point2> = [[-20, 0], [20, 0], [20, 4], [0, 24], [-20, 24]]
const inverted45: ReadonlyArray<Point2> = [[-20, 0], [0, 0], [20, 20], [20, 24], [-20, 24]]
const cheese: ReadonlyArray<Point2> = [[-10, 0], [10, 0], [10, 4], [-10, 16]]
// Curve samples read from the LDraw files 11477 and 50950, converted to this frame.
const curved2: ReadonlyArray<Point2> = [[-20, 0], [20, 0], [20, 4], [14.44, 7.53], [8.28, 10.51], [1.65, 12.88], [-5.36, 14.6], [-12.62, 15.65], [-20, 16]]
const curved3: ReadonlyArray<Point2> = [[-30, 0], [30, 0], [30, 4], [21.66, 9.89], [12.43, 14.85], [2.47, 18.8], [-8.04, 21.67], [-18.93, 23.41], [-30, 24]]
const doubleCurved: ReadonlyArray<Point2> = [
  [40, 0],
  ...Array.from({ length: 11 }, (_, i): Point2 => {
    const z = 40 - i * 8
    return [z, 4 + 12 * Math.cos((Math.PI * z) / 80)]
  }),
  [-40, 0],
]
const wedge4x2: ReadonlyArray<Point2> = [[-20, -40], [20, -40], [20, 40], [0, 40]]
const wedge3x2: ReadonlyArray<Point2> = [[-20, -30], [20, -30], [20, 30], [0, 30]]
const wedge2x2: ReadonlyArray<Point2> = [[-18.5, -20], [20, -20], [20, 20], [0, 20], [-18.5, -17]]
const wedge2x4: ReadonlyArray<Point2> = [[-38.5, -20], [38.5, -20], [38.5, -17], [20, 20], [-20, 20], [-38.5, -17]]

type Build = (mesher: PartMesher, info: PartInfo) => void

const rotateX90 = new Matrix4().makeRotationX(Math.PI / 2)
const rotateZ90 = new Matrix4().makeRotationZ(-Math.PI / 2)
const translated = (x: number, y: number, z: number, rotation = new Matrix4()) => new Matrix4().makeTranslation(x, y, z).multiply(rotation)

const cannon: Build = (m) => {
  m.box([-16, 0, -36], [16, 7, 30])
  for (const side of [-1, 1]) {
    m.box([side > 0 ? 9 : -15, 7, -30], [side > 0 ? 15 : -9, 23, 22])
    for (const z of [-24, 14]) m.lathe([[0, -3], [9, -3], [9, 3], [0, 3]], 10, translated(side * 18, 9, z, rotateZ90))
  }
  // Heavier and longer than the real part so the muzzle clears the proud port frame and reads at game distance.
  const barrel = translated(0, 29, 0, rotateX90.clone().multiply(new Matrix4().makeScale(1.25, 1.2, 1.25)))
  m.lathe([[0, -38], [3.5, -38], [4.5, -36], [3, -33], [7, -32], [9.5, -29], [9.5, -20], [8.5, -18], [8.5, 8], [7.5, 11], [7, 40], [8.5, 42], [9, 48], [8, 50], [5, 50], [5, 44]], 12, barrel)
  m.use(0, 0.08)
  m.lathe([[5, 44], [0, 44]], 12, barrel)
  m.use(0)
  m.lathe([[0, -5], [4, -5], [4, 5], [0, 5]], 8, translated(0, 29, -8, rotateZ90).multiply(new Matrix4().makeScale(1, 3.4, 1)))
}

/** Vertex shade that marks lantern glass: the plastic material lights it instead of tinting by instance colour. */
export const glassShade = 2

const lantern: Build = (m) => {
  m.lathe([[0, 0], [8, 0], [9, 1], [9, 4], [7, 5]], 8)
  m.use(0, glassShade)
  m.lathe([[7, 5], [7, 20]], 8)
  m.use(0)
  m.lathe([[7, 20], [9, 21], [9, 24], [7, 25], [4, 30], [2.5, 31], [2.5, 34], [0, 34]], 8)
  for (let k = 0; k < 4; k++) {
    const angle = Math.PI / 8 + (k * Math.PI) / 2
    m.box([-1, 5, -1], [1, 20, 1], translated(7.4 * Math.cos(angle), 0, -7.4 * Math.sin(angle)), 0.4)
  }
}

const barrel: Build = (m) => {
  m.lathe([[0, 0], [14, 0], [15, 1], [16, 6]], 20)
  m.use(0, 0.55)
  m.lathe([[16, 6], [16.8, 9]], 20)
  m.use(0)
  m.lathe([[16.8, 9], [17.7, 15], [18, 20], [17.7, 25], [16.8, 31]], 20)
  m.use(0, 0.55)
  m.lathe([[16.8, 31], [16, 34]], 20)
  m.use(0)
  m.lathe([[16, 34], [15, 39], [14, 40], [0, 40]], 20)
}

const shipWheel: Build = (m) => {
  m.box([-20, 0, -10], [20, 8, 10])
  m.box([-4, 8, -10], [4, 38, -3])
  const hub = translated(0, 38, 0, rotateX90)
  m.lathe([[24, -2], [28, -2], [28, 2], [24, 2], [24, -2]], 24, hub)
  m.lathe([[0, -5], [6, -5], [7, -4], [7, 4], [6, 5], [0, 5]], 12, hub)
  for (let k = 0; k < 8; k++) {
    const spoke = translated(0, 38, 0, new Matrix4().makeRotationZ((k * Math.PI) / 4))
    m.box([5, -1.5, -1.5], [26, 1.5, 1.5], spoke, 0)
    m.lathe([[0, 25], [2.8, 28], [2, 33], [0, 36]], 6, spoke.clone().multiply(rotateZ90))
  }
}

const fence: Build = (m) => {
  m.box([-40, 0, -5], [40, 4, 5])
  m.box([-40, 20, -3.5], [40, 24, 3.5])
  for (const x of [-37, -18.5, 0, 18.5, 37]) m.box([x - 2.5, 4, -2.5], [x + 2.5, 20, 2.5], undefined, 0.5)
}

const rotateZ = (angle: number) => new Matrix4().makeRotationZ(angle)

// Tile face toward +z on a bracket; the slab is shaded near-black so the gold relief reads as the print.
const skullPlaque: Build = (m) => {
  m.use(0, 0.12)
  m.box([-20, 0, -10], [20, 8, 10])
  m.box([-20, 8, 2], [20, 48, 10])
  m.use(0)
  for (const angle of [0.62, -0.62]) {
    const bone = translated(0, 27, 11.2).multiply(rotateZ(angle))
    m.box([-17, -2, -1.2], [17, 2, 1.2], bone, 0.5)
    for (const end of [-17, 17]) for (const side of [-2.2, 2.2]) m.lathe([[0, -1.5], [2.6, -1.5], [2.6, 1.5], [0, 1.5]], 6, bone.clone().multiply(translated(end, side, 0, rotateX90)))
  }
  m.lathe([[0, 0], [10, 0], [9.6, 2.4], [8.2, 4.4], [5.8, 5.8], [2.8, 6.6], [0, 6.8]], 12, translated(0, 33, 10, rotateX90))
  m.box([-5.5, 20, 10], [5.5, 26, 14.5], undefined, 0.6)
  m.use(0, 0.05)
  for (const side of [-1, 1]) m.box([side > 0 ? 1.4 : -6.4, 29.5, 13], [side > 0 ? 6.4 : -1.4, 34.5, 16.6], undefined, 0.6)
  m.box([-1.2, 25.6, 13], [1.2, 28.4, 16.2], undefined, 0.3)
  for (const x of [-3, 0, 3]) m.box([x - 0.5, 20.5, 13.8], [x + 0.5, 25, 14.8], undefined, 0)
}

const boxed: Build = (m, { size: [sx, sz], height }) => m.box([(-sx * stud) / 2, 0, (-sz * stud) / 2], [(sx * stud) / 2, height, (sz * stud) / 2])

/** A side profile in (z, y) extruded across the part's width along x. */
const sideProfile =
  (profile: ReadonlyArray<Point2>): Build =>
  (m, { size: [sx] }) =>
    m.prism(profile, "x", (-sx * stud) / 2, (sx * stud) / 2)

/** A plan outline in (x, z) extruded one plate up; `mirror` makes the left-hand twin of a right-hand wedge. */
const wedgePlate =
  (outline: ReadonlyArray<Point2>, mirror = false): Build =>
  (m) =>
    m.prism(outline.map(([x, z]): Point2 => [mirror ? -x : x, z]), "y", 0, plate)

/** A round part as a chamfered cylinder. */
const round =
  (segments: number): Build =>
  (m, { size: [size], height }) => {
    const r = (size * stud) / 2
    const c = 0.7
    m.lathe([[0, 0], [r - c, 0], [r, c], [r, height - c], [r - c, height], [0, height]], segments)
  }

const builders: Readonly<Record<PartId, Build>> = {
  "3005": boxed,
  "3004": boxed,
  "3622": boxed,
  "3010": boxed,
  "3009": boxed,
  "3008": boxed,
  "3003": boxed,
  "3002": boxed,
  "3001": boxed,
  "3024": boxed,
  "3023": boxed,
  "3623": boxed,
  "3710": boxed,
  "3666": boxed,
  "3460": boxed,
  "3022": boxed,
  "3021": boxed,
  "3020": boxed,
  "3795": boxed,
  "3794b": boxed,
  "3070b": boxed,
  "3069b": boxed,
  "63864": boxed,
  "2431": boxed,
  "3068b": boxed,
  "3040b": sideProfile(slope45),
  "3039": sideProfile(slope45),
  "3665": sideProfile(inverted45),
  "3660": sideProfile(inverted45),
  "85984": sideProfile(cheese),
  "54200": sideProfile(cheese),
  "11477": sideProfile(curved2),
  "15068": sideProfile(curved2),
  "50950": sideProfile(curved3),
  "93273": sideProfile(doubleCurved),
  "41769": wedgePlate(wedge4x2),
  "41770": wedgePlate(wedge4x2, true),
  "43722": wedgePlate(wedge3x2),
  "43723": wedgePlate(wedge3x2, true),
  "24307": wedgePlate(wedge2x2),
  "24299": wedgePlate(wedge2x2, true),
  "51739": wedgePlate(wedge2x4),
  "6141": round(16),
  "3062b": round(16),
  "4032": round(24),
  "3941": round(24),
  "2527c01": cannon,
  "37776": lantern,
  "2489": barrel,
  "4790": shipWheel,
  "3633": fence,
  "3068bp9b": skullPlaque,
}

/** Build a part's geometry in metres; call once per shape and share it across ships. */
export const buildPartGeometry = (id: PartId) => {
  const mesher = new PartMesher()
  builders[id](mesher, partCatalog[id])
  return mesher.finish()
}

/**
 * How a far-detail shape is drawn: a flat-faced geometry shared under `key`, stretched by `scale` (x, y, z)
 * so every box-like part shares one draw.
 */
export interface FlatShape {
  readonly key: string
  readonly scale: readonly [number, number, number]
  build(): BufferGeometry
}

const flatBuild = (build: (m: PartMesher) => void) => () => {
  const mesher = new PartMesher()
  build(mesher)
  return mesher.finish()
}
const unitBox = flatBuild((m) => m.box([-10, 0, -10], [10, 1, 10], undefined, 0))
const flatProfile = (profile: ReadonlyArray<Point2>) => flatBuild((m) => m.prism(profile, "x", -stud / 2, stud / 2, undefined, 0))
const flatWedge = (mirror: boolean) => flatBuild((m) => m.prism(wedge4x2.map(([x, z]): Point2 => [mirror ? -x : x, z]), "y", 0, plate, undefined, 0))
const unitRound = flatBuild((m) => m.lathe([[0, 0], [10, 0], [10, 1], [0, 1]], 8))

const flatDetails: Partial<Record<PartId, () => BufferGeometry>> = {
  "2527c01": flatBuild((m) => {
    m.box([-16, 0, -36], [16, 23, 22], undefined, 0)
    m.lathe([[0, -38], [9.5, -38], [9.5, -20], [8.5, -18], [7, 40], [9, 48], [0, 50]], 6, translated(0, 29, 0, rotateX90))
  }),
  "37776": flatBuild((m) => {
    m.box([-9, 0, -9], [9, 5, 9], undefined, 0)
    m.use(0, glassShade)
    m.box([-5.5, 5, -5.5], [5.5, 20, 5.5], undefined, 0)
    m.use(0)
    for (const x of [-7, 5.5]) for (const z of [-7, 5.5]) m.box([x, 5, z], [x + 1.5, 20, z + 1.5], undefined, 0)
    m.lathe([[9, 20], [9, 24], [2.5, 31], [2.5, 34], [0, 34]], 4)
  }),
  "3633": flatBuild((m) => {
    m.box([-40, 0, -5], [40, 4, 5], undefined, 0)
    m.box([-40, 20, -3.5], [40, 24, 3.5], undefined, 0)
    for (const x of [-37, 0, 37]) m.box([x - 2.5, 4, -2.5], [x + 2.5, 20, 2.5], undefined, 0)
  }),
  "4790": flatBuild((m) => {
    m.box([-20, 0, -10], [20, 8, 10], undefined, 0)
    m.box([-4, 8, -10], [4, 38, -3], undefined, 0)
    m.lathe([[0, -2], [28, -2], [28, 2], [0, 2]], 8, translated(0, 38, 0, rotateX90))
  }),
  "3068bp9b": flatBuild((m) => {
    m.use(0, 0.12)
    m.box([-20, 0, -10], [20, 8, 10], undefined, 0)
    m.box([-20, 8, 2], [20, 48, 10], undefined, 0)
    m.use(0)
    for (const angle of [0.62, -0.62]) m.box([-18, -2, -1.2], [18, 2, 1.2], translated(0, 27, 11.2).multiply(rotateZ(angle)), 0)
    m.lathe([[0, 0], [10, 0], [7, 5], [0, 6.8]], 6, translated(0, 33, 10, rotateX90))
    m.box([-5.5, 20, 10], [5.5, 26, 14.5], undefined, 0)
    m.use(0, 0.05)
    m.box([-6.4, 29.5, 13], [6.4, 34.5, 16.6], undefined, 0)
  }),
}

/** The far-detail stand-in for a part shape. */
export const flatShape = (id: PartId): FlatShape => {
  const { size: [sx, sz], height } = partCatalog[id]
  const detail = flatDetails[id]
  if (detail !== undefined) return { key: id, scale: [1, 1, 1], build: detail }
  const builder = builders[id]
  if (builder === boxed) return { key: "box", scale: [sx, height, sz], build: unitBox }
  if (id === "6141" || id === "3062b" || id === "4032" || id === "3941" || id === "2489") return { key: "round", scale: [sx, height, sz], build: unitRound }
  const profiles: Partial<Record<PartId, readonly [string, ReadonlyArray<Point2>]>> = {
    "3040b": ["slope45", slope45],
    "3039": ["slope45", slope45],
    "3665": ["inverted45", inverted45],
    "3660": ["inverted45", inverted45],
    "85984": ["cheese", cheese],
    "54200": ["cheese", cheese],
    "11477": ["curved2", curved2],
    "15068": ["curved2", curved2],
    "50950": ["curved3", curved3],
    "93273": ["doubleCurved", doubleCurved],
  }
  const profile = profiles[id]
  if (profile !== undefined) return { key: profile[0], scale: [sx, 1, 1], build: flatProfile(profile[1]) }
  const wedgeLength: Partial<Record<PartId, readonly [boolean, number]>> = { "41769": [false, 4], "43722": [false, 3], "24307": [false, 2], "41770": [true, 4], "43723": [true, 3], "24299": [true, 2] }
  const wedge = wedgeLength[id]
  if (wedge !== undefined) return { key: wedge[0] ? "wedgeLeft" : "wedgeRight", scale: [1, 1, wedge[1] / 4], build: flatWedge(wedge[0]) }
  return { key: id, scale: [1, 1, 1], build: () => buildPartGeometry(id) }
}

/** Stud radius and height in LDU, and the segment count that sets its triangle cost. */
export const studShape = { radius: 6, height: 4, segments: 12 } as const

/** Build the shared stud geometry: a cylinder with a rounded top edge and no bottom. */
export const buildStudGeometry = () => {
  const { radius: r, height: h, segments } = studShape
  const mesher = new PartMesher()
  mesher.lathe([[r, 0], [r, h - 0.7], [r - 0.7, h], [0, h]], segments)
  return mesher.finish()
}

/** Build the mid-detail stud: a six-sided prism, a third of the full stud's triangles. */
export const buildFlatStudGeometry = () => {
  const { radius: r, height: h } = studShape
  const mesher = new PartMesher()
  mesher.lathe([[r, 0], [r, h], [0, h]], 6)
  return mesher.finish()
}

/** Ship-space transform of a part on the brick grid: footprint centre (x, z) in studs, bottom y in plates, quarter turns about +y. */
export const gridMatrix = (x: number, yPlates: number, z: number, quarterTurns = 0, target = new Matrix4()): Matrix4 =>
  target.makeRotationY((quarterTurns * Math.PI) / 2).setPosition(x * stud * metresPerLdu, yPlates * plate * metresPerLdu, z * stud * metresPerLdu)
