import type { BrickPlacement } from "../bricks/brick-ship-mesh.ts"
import type { BrickColor } from "../../sim/ship/colors.ts"
import { ldu, type PartId, partCatalog, partIds } from "../../sim/ship/parts.ts"
import { gridMatrix } from "../bricks/parts.ts"

interface Placed {
  readonly part: PartId
  readonly color: BrickColor
  readonly x: number
  readonly y: number
  readonly z: number
  readonly turns: number
}

const bricksByLength: Readonly<Record<number, PartId>> = { 1: "3005", 2: "3004", 3: "3622", 4: "3010", 6: "3009", 8: "3008" }
const platesByLength: Readonly<Record<number, PartId>> = { 1: "3024", 2: "3023", 3: "3623", 4: "3710", 6: "3666", 8: "3460" }
const runPattern = [4, 6, 3, 8, 4, 2, 6, 4]

/** Split a run into part lengths, offset per course so joints never line up (running bond). */
const runLengths = (length: number, course: number) => {
  const lengths: Array<number> = []
  let left = length
  let k = course * 3
  if (course % 2 === 1 && left > 2) {
    lengths.push(2)
    left -= 2
  }
  while (left > 0) {
    const want = runPattern[k++ % runPattern.length] ?? 4
    const take = want <= left ? want : ([6, 4, 3, 2, 1].find((l) => l <= left) ?? 1)
    lengths.push(take)
    left -= take
  }
  return lengths
}

const hash = (a: number, b: number, c: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return h - Math.floor(h)
}

/** Sampler footprint in studs: x across, z along; the stern end is at z = 0. */
export const samplerSize = { x: 20, z: 44, deckPlates: 17 } as const

/**
 * The lab's part sampler: a hull block in the refs' colour strakes (black, dark-red wale,
 * pearl-gold trim) with a deck showing every part shape once. Covered studs are hidden.
 */
export const buildSampler = (): Array<BrickPlacement> => {
  const placed: Array<Placed> = []
  const place = (part: PartId, color: BrickColor, x: number, y: number, z: number, turns = 0) => placed.push({ part, color, x, y, z, turns })

  const wall = (course: number, y: number, byLength: Readonly<Record<number, PartId>>, color: (x: number, z: number) => BrickColor) => {
    const runs: ReadonlyArray<readonly [number, number, number, boolean]> = [
      [0, 0, samplerSize.z, true],
      [samplerSize.x - 1, 0, samplerSize.z, true],
      [1, 0, samplerSize.x - 2, false],
      [1, samplerSize.z - 1, samplerSize.x - 2, false],
    ]
    for (const [x0, z0, length, alongZ] of runs) {
      let at = 0
      for (const l of runLengths(length, course + (alongZ ? 0 : 1))) {
        const x = alongZ ? x0 : x0 + at
        const z = alongZ ? z0 + at : z0
        place(byLength[l] ?? "3005", color(x, z), x, y, z, alongZ ? 1 : 0)
        at += l
      }
    }
  }
  const hullBlack = (x: number, z: number): BrickColor => (hash(x, z, 1) > 0.9 ? "darkRed" : hash(x, z, 2) > 0.93 ? "darkBluishGrey" : "black")
  wall(0, 0, bricksByLength, hullBlack)
  wall(1, 3, bricksByLength, hullBlack)
  wall(2, 6, bricksByLength, (x, z) => (hash(x, z, 3) > 0.92 ? "black" : "darkRed"))
  wall(3, 9, platesByLength, () => "pearlGold")
  wall(4, 10, bricksByLength, hullBlack)
  wall(5, 13, bricksByLength, hullBlack)
  wall(6, 16, platesByLength, () => "pearlGold")
  for (let x = 1; x < samplerSize.x - 1; x += 2) {
    for (let z = 1, k = x; z < samplerSize.z - 1; k++) {
      const l = Math.min([6, 4, 6, 3][k % 4] ?? 4, samplerSize.z - 1 - z)
      const part: PartId = l >= 6 ? "3795" : l >= 4 ? "3020" : l >= 3 ? "3021" : l >= 2 ? "3022" : "3023"
      if (part === "3023") place(part, "reddishBrown", x, 16, z, 0)
      else place(part, hash(x, z, 4) > 0.85 ? "darkTan" : "reddishBrown", x, 16, z, 1)
      z += part === "3023" ? 1 : l
    }
  }

  const deck = samplerSize.deckPlates
  const palette: ReadonlyArray<BrickColor> = ["black", "darkRed", "pearlGold", "reddishBrown", "tan", "red", "white", "darkBluishGrey", "darkTan", "blue", "yellow"]
  const showcase = partIds.filter((id) => id !== "3633" && id !== "37776")
  let x = 3
  let z = 5
  let rowDepth = 0
  showcase.forEach((part, i) => {
    const [sx, sz] = partCatalog[part].size
    const turns = part === "2527c01" ? 3 : 0
    const [fx, fz] = turns % 2 === 1 ? [sz, sx] : [sx, sz]
    if (x + fx > samplerSize.x - 3) {
      x = 3
      z += rowDepth + 1
      rowDepth = 0
    }
    const color = part === "2527c01" ? "black" : (palette[i % palette.length] ?? "black")
    place(part, color, x, deck, z, turns)
    x += fx + 1
    rowDepth = Math.max(rowDepth, fz)
  })

  for (let z = 1; z + 4 <= samplerSize.z - 1; z += 4) place("3633", "pearlGold", samplerSize.x - 2, deck, z, 1)
  for (const [lx, lz] of [[0, 0], [samplerSize.x - 1, 0], [0, samplerSize.z - 1]] as const) {
    place("3062b", "black", lx, deck, lz)
    place("3062b", "pearlGold", lx, deck + 3, lz)
    place("37776", "black", lx, deck + 6, lz)
  }

  return resolveStuds(placed)
}

const footprint = ({ part, turns }: Placed) => {
  const [sx, sz] = partCatalog[part].size
  return turns % 2 === 1 ? [sz, sx] : [sx, sz]
}

const resolveStuds = (placed: ReadonlyArray<Placed>): Array<BrickPlacement> => {
  const covered = new Set<string>()
  for (const p of placed) {
    const [fx = 1, fz = 1] = footprint(p)
    for (let i = 0; i < fx; i++) for (let j = 0; j < fz; j++) covered.add(`${p.y},${p.x + i},${p.z + j}`)
  }
  return placed.map((p) => {
    const [fx = 1, fz = 1] = footprint(p)
    const cx = p.x + fx / 2
    const cz = p.z + fz / 2
    const shape = partCatalog[p.part]
    const top = p.y + Math.round(shape.height / ldu.plate)
    const angle = (p.turns * Math.PI) / 2
    const hiddenStuds = shape.studs.flatMap(([sx, , sz], s) => {
      const wx = cx + (sx * Math.cos(angle) + sz * Math.sin(angle)) / ldu.stud
      const wz = cz + (-sx * Math.sin(angle) + sz * Math.cos(angle)) / ldu.stud
      return covered.has(`${top},${Math.floor(wx)},${Math.floor(wz)}`) ? [s] : []
    })
    return { part: p.part, color: p.color, matrix: gridMatrix(cx, p.y, cz, p.turns), hiddenStuds }
  })
}
