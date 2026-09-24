/** A 2D point in LDraw units (LDU). */
export type Point2 = readonly [number, number]
/** A 3D point in LDraw units (LDU), part-local frame with y up. */
export type Point3 = readonly [number, number, number]

/** LDraw unit sizes: stud pitch, plate height and brick height. */
export const ldu = { stud: 20, plate: 8, brick: 24 } as const

/** Metres per LDraw unit: a 20 LDU stud pitch is 0.4 m at minifig scale. */
export const metresPerLdu = 0.02

/**
 * What the simulation knows about a part shape: footprint, height and connection points.
 * Local frame: LDraw's with y and z negated (y up, still right-handed), origin at the bottom
 * centre of the footprint; slopes descend toward +z, cannons point +z.
 */
export interface PartInfo {
  readonly name: string
  /** Bounding footprint in studs, [x, z]. */
  readonly size: Point2
  /** Body height in LDU, studs excluded. */
  readonly height: number
  /** Stud base centres in LDU. */
  readonly studs: ReadonlyArray<Point3>
  /** Footprint cell centres (x, z in LDU) whose underside takes a stud; every cell when absent. */
  readonly sockets?: ReadonlyArray<Point2>
  /** Where the LDraw part origin sits in the local frame, for `.ldr` export. */
  readonly ldrawOrigin: Point3
  /** Geometry reaches past the footprint (cannon barrel, wheel rim). */
  readonly overhangs?: true
}

const { stud, plate, brick } = ldu

const studGrid = (sx: number, sz: number, y: number): Array<Point3> =>
  Array.from({ length: sx * sz }, (_, i): Point3 => [(i % sx) * stud - ((sx - 1) * stud) / 2, y, Math.floor(i / sx) * stud - ((sz - 1) * stud) / 2])

const block = (name: string, sx: number, sz: number, height: number, studs = studGrid(sx, sz, height)): PartInfo => ({ name, size: [sx, sz], height, studs, ldrawOrigin: [0, height, 0] })

const profiled = (name: string, sx: number, sz: number, height: number, studs: ReadonlyArray<Point3>, ldrawOrigin: Point3, sockets?: ReadonlyArray<Point2>): PartInfo =>
  sockets === undefined ? { name, size: [sx, sz], height, studs, ldrawOrigin } : { name, size: [sx, sz], height, studs, sockets, ldrawOrigin }

const wedge = (name: string, sx: number, sz: number, studs: ReadonlyArray<Point3>, mirror = false): PartInfo => ({
  name,
  size: [sx, sz],
  height: plate,
  studs: studs.map(([x, y, z]): Point3 => [mirror ? -x : x, y, z]),
  ldrawOrigin: [0, plate, 0],
})

const innerColumn = (length: number) => studGrid(1, length, plate).map(([, y, z]): Point3 => [10, y, z])
const backRow = (sx: number): Array<Point2> => studGrid(sx, 1, 0).map(([x]): Point2 => [x, -10])

const catalog = {
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
  "3040b": profiled("Slope 45 2 x 1", 1, 2, brick, [[0, brick, -10]], [0, brick, -10]),
  "3039": profiled("Slope 45 2 x 2", 2, 2, brick, [[-10, brick, -10], [10, brick, -10]], [0, brick, -10]),
  "3665": profiled("Slope 45 2 x 1 inverted", 1, 2, brick, studGrid(1, 2, brick), [0, brick, -10], backRow(1)),
  "3660": profiled("Slope 45 2 x 2 inverted", 2, 2, brick, studGrid(2, 2, brick), [0, brick, -10], backRow(2)),
  "85984": profiled("Slope 30 1 x 2 x 2/3", 2, 1, 16, [], [0, 0, 0]),
  "54200": profiled("Slope 30 1 x 1 x 2/3", 1, 1, 16, [], [0, 0, 0]),
  "11477": profiled("Slope curved 2 x 1 x 2/3", 1, 2, 16, [], [0, 0, 0]),
  "15068": profiled("Slope curved 2 x 2 x 2/3", 2, 2, 16, [], [0, 0, 0]),
  "50950": profiled("Slope curved 3 x 1", 1, 3, brick, [], [0, brick, 0]),
  "93273": profiled("Slope curved 4 x 1 double", 1, 4, 16, [], [0, 0, 0]),
  "41769": wedge("Wedge plate 4 x 2 right", 2, 4, innerColumn(4)),
  "41770": wedge("Wedge plate 4 x 2 left", 2, 4, innerColumn(4), true),
  "43722": wedge("Wedge plate 3 x 2 right", 2, 3, innerColumn(3)),
  "43723": wedge("Wedge plate 3 x 2 left", 2, 3, innerColumn(3), true),
  "24307": wedge("Wedge plate 2 x 2 right", 2, 2, innerColumn(2)),
  "24299": wedge("Wedge plate 2 x 2 left", 2, 2, innerColumn(2), true),
  "51739": wedge("Wedge plate 2 x 4", 4, 2, studGrid(2, 2, plate)),
  "6141": block("Round plate 1 x 1", 1, 1, plate),
  "3062b": block("Round brick 1 x 1", 1, 1, brick),
  "4032": block("Round plate 2 x 2", 2, 2, plate),
  "3941": block("Round brick 2 x 2", 2, 2, brick),
  "2527c01": { name: "Cannon on carriage", size: [2, 4], overhangs: true, height: 36, studs: [], ldrawOrigin: [0, 8, 0] },
  "37776": { name: "Minifig lantern", size: [1, 1], height: 34, studs: [], ldrawOrigin: [0, 34, 0] },
  "2489": { name: "Barrel", size: [2, 2], height: 40, studs: [], ldrawOrigin: [0, 40, 0] },
  "4790": { name: "Ship's wheel on post", size: [2, 1], overhangs: true, height: 72, studs: [], ldrawOrigin: [0, 8, 0] },
  "3633": { name: "Fence 1 x 4 x 1", size: [4, 1], height: 24, studs: [], ldrawOrigin: [0, 24, 0] },
} satisfies Record<string, PartInfo>

/** LDraw part ID of a shape in `partCatalog`. */
export type PartId = keyof typeof catalog

/** Every part shape ships are built from, keyed by LDraw part ID. */
export const partCatalog: Readonly<Record<PartId, PartInfo>> = catalog

/** All part IDs, in catalogue order. */
export const partIds = Object.keys(partCatalog).filter((id): id is PartId => Object.hasOwn(partCatalog, id))
