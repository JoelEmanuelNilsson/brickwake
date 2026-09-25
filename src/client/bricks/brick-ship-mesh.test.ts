import { expect, test } from "bun:test"
import { InstancedMesh, Matrix4, Vector3 } from "three"
import { type BrickPlacement, BrickShipMesh, brickDetailFor, createBrickLibrary } from "./brick-ship-mesh.ts"
import { type PartId, partCatalog, partIds } from "../../sim/ship/parts.ts"
import { buildPartGeometry, gridMatrix } from "./parts.ts"

const library = createBrickLibrary()

const signedVolume = (part: PartId) => {
  const position = buildPartGeometry(part).getAttribute("position")
  let volume = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    volume += a.dot(b.cross(c)) / 6
  }
  return volume
}

test("every part shape is closed with outward faces and fits its footprint", () => {
  expect(partIds.length).toBeGreaterThanOrEqual(50)
  for (const part of partIds) {
    expect({ part, outward: signedVolume(part) > 0 }).toEqual({ part, outward: true })
    const box = buildPartGeometry(part).boundingBox
    const [sx, sz] = partCatalog[part].size
    expect(box).not.toBeNull()
    if (box === null || partCatalog[part].overhangs) continue
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(sx * 0.4 + 1e-6)
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(sz * 0.4 + 1e-6)
  }
})

const pool = (ship: BrickShipMesh, name: string) => {
  const mesh = ship.root.getObjectByName(name)
  if (!(mesh instanceof InstancedMesh)) throw new Error(`no instanced mesh named ${name}`)
  return mesh
}

const instances = (mesh: InstancedMesh) =>
  Array.from({ length: mesh.count }, (_, slot) => {
    const matrix = new Matrix4()
    mesh.getMatrixAt(slot, matrix)
    return new Vector3().setFromMatrixPosition(matrix).toArray().map((v) => Math.round(v * 1000))
  }).sort()

test("removing a part swaps the last instance into its slot without rebuilding", () => {
  const placements: Array<BrickPlacement> = Array.from({ length: 10 }, (_, i) => ({
    part: i % 2 === 0 ? "3001" : "3040b",
    color: "black",
    matrix: gridMatrix(i * 4, 0, 0),
  }))
  const ship = new BrickShipMesh(library, placements)
  const bricks = pool(ship, "part 3001")
  const studs = pool(ship, "studs")
  expect(bricks.count).toBe(5)
  expect(studs.count).toBe(5 * 8 + 5)
  const matrixBuffer = bricks.instanceMatrix.array
  const before = ship.stats()

  expect(ship.remove(2)).toBe(true)
  expect(ship.remove(2)).toBe(false)
  expect(ship.remove(0)).toBe(true)

  expect(bricks.instanceMatrix.array).toBe(matrixBuffer)
  expect(bricks.count).toBe(3)
  expect(studs.count).toBe(3 * 8 + 5)
  expect(instances(bricks)).toEqual(instances(pool(new BrickShipMesh(library, placements.filter((_, i) => i % 2 === 0 && i > 2)), "part 3001")))
  expect(bricks.instanceMatrix.updateRanges.length).toBeGreaterThan(0)
  expect(ship.stats().triangles).toBeLessThan(before.triangles)

  for (const index of [4, 6, 8]) ship.remove(index)
  expect(bricks.visible).toBe(false)
  expect(ship.stats().draws).toBe(before.draws - 1)
  expect(ship.partCount).toBe(5)
})

test("covered studs start hidden and can be shown when their cover falls", () => {
  const ship = new BrickShipMesh(library, [{ part: "3003", color: "darkRed", matrix: gridMatrix(0, 0, 0), hiddenStuds: [0, 1, 2] }])
  expect(ship.stats().studs).toBe(1)
  ship.setStudVisible(0, 1, true)
  ship.setStudVisible(0, 3, false)
  expect(ship.stats().studs).toBe(1)
  ship.remove(0)
  expect(ship.stats()).toEqual({ parts: 0, studs: 0, draws: 0, triangles: 0 })
})

test("detail follows on-screen size with hysteresis, and a first pick uses the band midpoints", () => {
  expect(brickDetailFor(40)).toBe("near")
  expect(brickDetailFor(23)).toBe("mid")
  expect(brickDetailFor(23, "near")).toBe("near")
  expect(brickDetailFor(21, "near")).toBe("mid")
  expect(brickDetailFor(25, "mid")).toBe("mid")
  expect(brickDetailFor(27, "mid")).toBe("near")
  expect(brickDetailFor(8, "mid")).toBe("mid")
  expect(brickDetailFor(8, "far")).toBe("far")
  expect(brickDetailFor(3)).toBe("far")
})

test("removing a part takes it out of every detail level, with the plug it owns", () => {
  const placements: Array<BrickPlacement> = [
    { part: "3001", color: "black", matrix: gridMatrix(0, 0, 0) },
    { part: "3001", color: "black", matrix: gridMatrix(4, 0, 0), interior: true },
    { part: "3040b", color: "darkRed", matrix: gridMatrix(8, 0, 0) },
  ]
  const ship = new BrickShipMesh(library, placements, [{ owner: 2, matrix: gridMatrix(8, 0, 2) }])
  expect(ship.stats("far")).toMatchObject({ parts: 2, studs: 0, draws: 3 })
  expect(ship.stats("mid")).toMatchObject({ parts: 3, studs: 17 })
  ship.setDetail("far")
  expect(ship.root.getObjectByName("part 3001")?.parent?.visible).toBe(false)
  ship.remove(2)
  ship.remove(1)
  expect(ship.stats("far")).toMatchObject({ parts: 1, draws: 1 })
  expect(ship.stats("mid")).toMatchObject({ parts: 1, studs: 8, draws: 2 })
  expect(ship.stats("near")).toMatchObject({ parts: 1, studs: 8, draws: 2 })
})
