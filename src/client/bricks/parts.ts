import { Matrix4 } from "three"
import { type Point2, type Point3, PartMesher, metresPerLdu } from "./geometry.ts"

/** LDraw unit sizes: stud pitch, plate height and brick height. */
export const ldu = { stud: 20, plate: 8, brick: 24 } as const

/**
 * One part shape. Local frame: LDraw's with y and z negated (y up, still right-handed),
 * origin at the bottom centre of the footprint; slopes descend toward +z, cannons point +z.
 */
export interface PartShape {
  readonly name: string
  /** Bounding footprint in studs, [x, z]. */
  readonly size: Point2
  /** Body height in LDU, studs excluded. */
  readonly height: number
  /** Stud base centres in LDU. */
  readonly studs: ReadonlyArray<Point3>
  /** Where the LDraw part origin sits in the local frame, for `.ldr` export. */
  readonly ldrawOrigin: Point3
  /** Geometry reaches past the footprint (cannon barrel, wheel rim). */
  readonly overhangs?: true
  readonly build: (mesher: PartMesher) => void
}

const { stud, plate, brick } = ldu

const studGrid = (sx: number, sz: number, y: number): Array<Point3> =>
  Array.from({ length: sx * sz }, (_, i): Point3 => [(i % sx) * stud - ((sx - 1) * stud) / 2, y, Math.floor(i / sx) * stud - ((sz - 1) * stud) / 2])

const block = (name: string, sx: number, sz: number, height: number, studs = studGrid(sx, sz, height)): PartShape => ({
  name,
  size: [sx, sz],
  height,
  studs,
  ldrawOrigin: [0, height, 0],
  build: (m) => m.box([(-sx * stud) / 2, 0, (-sz * stud) / 2], [(sx * stud) / 2, height, (sz * stud) / 2]),
})

/** A side profile in (z, y) extruded across the part's width along x. */
const sideProfile = (name: string, sx: number, sz: number, height: number, profile: ReadonlyArray<Point2>, studs: ReadonlyArray<Point3>, ldrawOrigin: Point3): PartShape => ({
  name,
  size: [sx, sz],
  height,
  studs,
  ldrawOrigin,
  build: (m) => m.prism(profile, "x", (-sx * stud) / 2, (sx * stud) / 2),
})

/** A plan outline in (x, z) extruded one plate up; `mirror` makes the left-hand twin of a right-hand wedge. */
const wedgePlate = (name: string, sx: number, sz: number, outline: ReadonlyArray<Point2>, studs: ReadonlyArray<Point3>, mirror = false): PartShape => {
  const flip = mirror ? -1 : 1
  return {
    name,
    size: [sx, sz],
    height: plate,
    studs: studs.map(([x, y, z]): Point3 => [x * flip, y, z]),
    ldrawOrigin: [0, plate, 0],
    build: (m) => m.prism(outline.map(([x, z]): Point2 => [x * flip, z]), "y", 0, plate),
  }
}

/** A round part as a chamfered cylinder. */
const round = (name: string, size: number, height: number, segments: number, studs: ReadonlyArray<Point3>): PartShape => {
  const r = (size * stud) / 2
  const c = 0.7
  return {
    name,
    size: [size, size],
    height,
    studs,
    ldrawOrigin: [0, height, 0],
    build: (m) => m.lathe([[0, 0], [r - c, 0], [r, c], [r, height - c], [r - c, height], [0, height]], segments),
  }
}

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

const rotateX90 = new Matrix4().makeRotationX(Math.PI / 2)
const rotateZ90 = new Matrix4().makeRotationZ(-Math.PI / 2)
const translated = (x: number, y: number, z: number, rotation = new Matrix4()) => new Matrix4().makeTranslation(x, y, z).multiply(rotation)

const cannon: PartShape = {
  name: "Cannon on carriage",
  size: [2, 4],
  overhangs: true,
  height: 36,
  studs: [],
  ldrawOrigin: [0, 8, 0],
  build: (m) => {
    m.box([-16, 0, -36], [16, 7, 30])
    for (const side of [-1, 1]) {
      m.box([side > 0 ? 9 : -15, 7, -30], [side > 0 ? 15 : -9, 23, 22])
      for (const z of [-24, 14]) m.lathe([[0, -3], [9, -3], [9, 3], [0, 3]], 10, translated(side * 18, 9, z, rotateZ90))
    }
    const barrel = translated(0, 29, 0, rotateX90)
    m.lathe([[0, -38], [3.5, -38], [4.5, -36], [3, -33], [7, -32], [9.5, -29], [9.5, -20], [8.5, -18], [8.5, 8], [7.5, 11], [7, 40], [8.5, 42], [9, 48], [8, 50], [5, 50], [5, 44]], 12, barrel)
    m.use(0, 0.08)
    m.lathe([[5, 44], [0, 44]], 12, barrel)
    m.use(0)
    m.lathe([[0, -5], [4, -5], [4, 5], [0, 5]], 8, translated(0, 29, -8, rotateZ90).multiply(new Matrix4().makeScale(1, 3.4, 1)))
  },
}

const lantern: PartShape = {
  name: "Minifig lantern",
  size: [1, 1],
  height: 34,
  studs: [],
  ldrawOrigin: [0, 34, 0],
  build: (m) => {
    m.lathe([[0, 0], [8, 0], [9, 1], [9, 4], [7, 5]], 8)
    m.use(1)
    m.lathe([[7, 5], [7, 20]], 8)
    m.use(0)
    m.lathe([[7, 20], [9, 21], [9, 24], [7, 25], [4, 30], [2.5, 31], [2.5, 34], [0, 34]], 8)
    for (let k = 0; k < 4; k++) {
      const angle = Math.PI / 8 + (k * Math.PI) / 2
      m.box([-1, 5, -1], [1, 20, 1], translated(7.4 * Math.cos(angle), 0, -7.4 * Math.sin(angle)), 0.4)
    }
  },
}

const barrel: PartShape = {
  name: "Barrel",
  size: [2, 2],
  height: 40,
  studs: [],
  ldrawOrigin: [0, 40, 0],
  build: (m) => {
    m.lathe([[0, 0], [14, 0], [15, 1], [16, 6]], 20)
    m.use(0, 0.55)
    m.lathe([[16, 6], [16.8, 9]], 20)
    m.use(0)
    m.lathe([[16.8, 9], [17.7, 15], [18, 20], [17.7, 25], [16.8, 31]], 20)
    m.use(0, 0.55)
    m.lathe([[16.8, 31], [16, 34]], 20)
    m.use(0)
    m.lathe([[16, 34], [15, 39], [14, 40], [0, 40]], 20)
  },
}

const shipWheel: PartShape = {
  name: "Ship's wheel on post",
  size: [2, 1],
  overhangs: true,
  height: 72,
  studs: [],
  ldrawOrigin: [0, 8, 0],
  build: (m) => {
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
  },
}

const fence: PartShape = {
  name: "Fence 1 x 4 x 1",
  size: [4, 1],
  height: 24,
  studs: [],
  ldrawOrigin: [0, 24, 0],
  build: (m) => {
    m.box([-40, 0, -5], [40, 4, 5])
    m.box([-40, 20, -3.5], [40, 24, 3.5])
    for (const x of [-37, -18.5, 0, 18.5, 37]) m.box([x - 2.5, 4, -2.5], [x + 2.5, 20, 2.5], undefined, 0.5)
  },
}

const shapes = {
  "3005": block("Brick 1 x 1", 1, 1, brick),
  "3004": block("Brick 1 x 2", 2, 1, brick),
  "3622": block("Brick 1 x 3", 3, 1, brick),
  "3010": block("Brick 1 x 4", 4, 1, brick),
  "3009": block("Brick 1 x 6", 6, 1, brick),
  "3008": block("Brick 1 x 8", 8, 1, brick),
  "3003": block("Brick 2 x 2", 2, 2, brick),
  "3002": block("Brick 2 x 3", 3, 2, brick),
  "3001": block("Brick 2 x 4", 4, 2, brick),
  "3024": block("Plate 1 x 1", 1, 1, plate),
  "3023": block("Plate 1 x 2", 2, 1, plate),
  "3623": block("Plate 1 x 3", 3, 1, plate),
  "3710": block("Plate 1 x 4", 4, 1, plate),
  "3666": block("Plate 1 x 6", 6, 1, plate),
  "3460": block("Plate 1 x 8", 8, 1, plate),
  "3022": block("Plate 2 x 2", 2, 2, plate),
  "3021": block("Plate 2 x 3", 3, 2, plate),
  "3020": block("Plate 2 x 4", 4, 2, plate),
  "3795": block("Plate 2 x 6", 6, 2, plate),
  "3794b": block("Plate 1 x 2 with 1 centre stud (jumper)", 2, 1, plate, [[0, plate, 0]]),
  "3070b": block("Tile 1 x 1", 1, 1, plate, []),
  "3069b": block("Tile 1 x 2", 2, 1, plate, []),
  "63864": block("Tile 1 x 3", 3, 1, plate, []),
  "2431": block("Tile 1 x 4", 4, 1, plate, []),
  "3068b": block("Tile 2 x 2", 2, 2, plate, []),
  "3040b": sideProfile("Slope 45 2 x 1", 1, 2, brick, slope45, [[0, brick, -10]], [0, brick, -10]),
  "3039": sideProfile("Slope 45 2 x 2", 2, 2, brick, slope45, [[-10, brick, -10], [10, brick, -10]], [0, brick, -10]),
  "3665": sideProfile("Slope 45 2 x 1 inverted", 1, 2, brick, inverted45, [[0, brick, -10]], [0, brick, -10]),
  "3660": sideProfile("Slope 45 2 x 2 inverted", 2, 2, brick, inverted45, [[-10, brick, -10], [10, brick, -10]], [0, brick, -10]),
  "85984": sideProfile("Slope 30 1 x 2 x 2/3", 2, 1, 16, cheese, [], [0, 0, 0]),
  "54200": sideProfile("Slope 30 1 x 1 x 2/3", 1, 1, 16, cheese, [], [0, 0, 0]),
  "11477": sideProfile("Slope curved 2 x 1 x 2/3", 1, 2, 16, curved2, [], [0, 0, 0]),
  "15068": sideProfile("Slope curved 2 x 2 x 2/3", 2, 2, 16, curved2, [], [0, 0, 0]),
  "50950": sideProfile("Slope curved 3 x 1", 1, 3, brick, curved3, [], [0, brick, 0]),
  "93273": sideProfile("Slope curved 4 x 1 double", 1, 4, 16, doubleCurved, [], [0, 0, 0]),
  "41769": wedgePlate("Wedge plate 4 x 2 right", 2, 4, wedge4x2, studGrid(1, 4, plate).map(([, y, z]): Point3 => [10, y, z])),
  "41770": wedgePlate("Wedge plate 4 x 2 left", 2, 4, wedge4x2, studGrid(1, 4, plate).map(([, y, z]): Point3 => [10, y, z]), true),
  "43722": wedgePlate("Wedge plate 3 x 2 right", 2, 3, wedge3x2, studGrid(1, 3, plate).map(([, y, z]): Point3 => [10, y, z])),
  "43723": wedgePlate("Wedge plate 3 x 2 left", 2, 3, wedge3x2, studGrid(1, 3, plate).map(([, y, z]): Point3 => [10, y, z]), true),
  "24307": wedgePlate("Wedge plate 2 x 2 right", 2, 2, wedge2x2, [[10, plate, -10], [10, plate, 10]]),
  "24299": wedgePlate("Wedge plate 2 x 2 left", 2, 2, wedge2x2, [[10, plate, -10], [10, plate, 10]], true),
  "51739": wedgePlate("Wedge plate 2 x 4", 4, 2, wedge2x4, studGrid(2, 2, plate)),
  "6141": round("Round plate 1 x 1", 1, plate, 16, [[0, plate, 0]]),
  "3062b": round("Round brick 1 x 1", 1, brick, 16, [[0, brick, 0]]),
  "4032": round("Round plate 2 x 2", 2, plate, 24, studGrid(2, 2, plate)),
  "3941": round("Round brick 2 x 2", 2, brick, 24, studGrid(2, 2, brick)),
  "2527c01": cannon,
  "37776": lantern,
  "2489": barrel,
  "4790": shipWheel,
  "3633": fence,
} satisfies Record<string, PartShape>

/** LDraw part ID of a shape in `partShapes`. */
export type PartId = keyof typeof shapes

/** Every part shape the ships are built from, keyed by LDraw part ID. */
export const partShapes: Readonly<Record<PartId, PartShape>> = shapes

/** All part IDs, in catalogue order. */
export const partIds = Object.keys(partShapes).filter((id): id is PartId => Object.hasOwn(partShapes, id))

/** Build a part's geometry in metres; call once per shape and share it across ships. */
export const buildPartGeometry = (id: PartId) => {
  const mesher = new PartMesher()
  partShapes[id].build(mesher)
  return mesher.finish()
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

/** Ship-space transform of a part on the brick grid: footprint centre (x, z) in studs, bottom y in plates, quarter turns about +y. */
export const gridMatrix = (x: number, yPlates: number, z: number, quarterTurns = 0, target = new Matrix4()): Matrix4 =>
  target.makeRotationY((quarterTurns * Math.PI) / 2).setPosition(x * stud * metresPerLdu, yPlates * plate * metresPerLdu, z * stud * metresPerLdu)
