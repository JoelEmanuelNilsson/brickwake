import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from "three"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"
import { metresPerLdu, type Point2, type Point3 } from "../../sim/ship/parts.ts"

/** Width of the 45° chamfer on every part edge, in LDU; it makes the highlight and the seam groove between parts. */
export const edgeChamfer = 1

// Profile corners that turn less than this are curve samples: shaded smooth and never chamfered.
const minCornerTurn = (20 * Math.PI) / 180
// 35° keeps 45° chamfers and box corners crisp while 12–24-segment round parts shade smooth.
const creaseAngle = (35 * Math.PI) / 180

const scratch = new Vector3()
const identity = new Matrix4()

const turn = (a: Point2, b: Point2, c: Point2) => {
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0])
  const a2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
}

const signedArea = (points: ReadonlyArray<Point2>) => {
  let area = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p
    area += p[0] * q[1] - q[0] * p[1]
  })
  return area / 2
}

const at = (points: ReadonlyArray<Point2>, i: number): Point2 => {
  const point = points[((i % points.length) + points.length) % points.length]
  if (point === undefined) throw new Error("empty profile")
  return point
}

const cutCorners = (points: ReadonlyArray<Point2>, size: number): Array<Point2> =>
  points.flatMap((p, i) => {
    const prev = at(points, i - 1)
    const next = at(points, i + 1)
    if (turn(prev, p, next) < minCornerTurn) return [p]
    const toward = (q: Point2): Point2 => {
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      return [p[0] + ((q[0] - p[0]) * size) / length, p[1] + ((q[1] - p[1]) * size) / length]
    }
    return [toward(prev), toward(next)]
  })

const inset = (points: ReadonlyArray<Point2>, distance: number): Array<Point2> =>
  points.map((p, i) => {
    const inward = (a: Point2, b: Point2): Point2 => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
    }
    const n1 = inward(at(points, i - 1), p)
    const n2 = inward(p, at(points, i + 1))
    const scale = distance / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    return [p[0] + (n1[0] + n2[0]) * scale, p[1] + (n1[1] + n2[1]) * scale]
  })

/** Axis a prism is extruded along; the profile lies in the other two axes, in (x,z), (z,y) or (x,y) order. */
export type PrismAxis = "x" | "y" | "z"

/** Accumulates part triangles in LDU and finishes them into a flat-and-crease-shaded `BufferGeometry` in metres. */
export class PartMesher {
  private readonly positions: Array<number> = []
  private readonly colors: Array<number> = []
  private readonly groups: Array<{ start: number; material: number }> = [{ start: 0, material: 0 }]
  private shade = 1

  /** Following triangles use this material index (0 plastic, 1 glow) and vertex shade (1 = instance colour). */
  use(material: number, shade = 1): void {
    this.shade = shade
    const last = this.groups[this.groups.length - 1]
    const start = this.positions.length / 3
    if (last !== undefined && last.start === start) last.material = material
    else if (last?.material !== material) this.groups.push({ start, material })
  }

  triangle(a: Point3, b: Point3, c: Point3, transform: Matrix4 = identity): void {
    const same = (p: Point3, q: Point3) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2]
    if (same(a, b) || same(b, c) || same(a, c)) return
    for (const p of [a, b, c]) {
      scratch.set(p[0], p[1], p[2]).applyMatrix4(transform)
      this.positions.push(scratch.x, scratch.y, scratch.z)
      this.colors.push(this.shade, this.shade, this.shade)
    }
  }

  /**
   * Extrude a convex profile from `from` to `to` along `axis`, chamfering every edge. Along y the bottom edge
   * is left square: it sits on the course below, where the top bevel alone draws the seam, and skipping it
   * saves a quarter of a brick's triangles.
   */
  prism(profile: ReadonlyArray<Point2>, axis: PrismAxis, from: number, to: number, transform: Matrix4 = identity, chamfer = edgeChamfer): void {
    // (u, v, w) is a right-handed cyclic permutation of (x, y, z), so a CCW profile gives outward faces.
    let points = profile.map((p): Point2 => (axis === "z" ? p : [p[1], p[0]]))
    if (signedArea(points) < 0) points = points.toReversed()
    const outer = chamfer > 0 ? cutCorners(points, chamfer) : points
    const inner = chamfer > 0 ? inset(outer, chamfer) : outer
    const toXyz = ([u, v]: Point2, w: number): Point3 => (axis === "z" ? [u, v, w] : axis === "x" ? [w, u, v] : [v, w, u])
    const rings: ReadonlyArray<readonly [ReadonlyArray<Point2>, number]> =
      chamfer <= 0
        ? [[outer, from], [outer, to]]
        : axis === "y"
          ? [[outer, from], [outer, to - chamfer], [inner, to]]
          : [[inner, from], [outer, from + chamfer], [outer, to - chamfer], [inner, to]]
    const bottom = chamfer > 0 && axis !== "y" ? inner : outer
    for (let k = 0; k + 1 < rings.length; k++) {
      const [lower, w0] = rings[k] ?? [[], 0]
      const [upper, w1] = rings[k + 1] ?? [[], 0]
      for (let i = 0; i < outer.length; i++) {
        const a0 = toXyz(at(lower, i), w0)
        const b0 = toXyz(at(lower, i + 1), w0)
        const a1 = toXyz(at(upper, i), w1)
        const b1 = toXyz(at(upper, i + 1), w1)
        this.triangle(a0, b0, b1, transform)
        this.triangle(a0, b1, a1, transform)
      }
    }
    for (let i = 1; i + 1 < inner.length; i++) {
      this.triangle(toXyz(at(bottom, 0), from), toXyz(at(bottom, i + 1), from), toXyz(at(bottom, i), from), transform)
      this.triangle(toXyz(at(inner, 0), to), toXyz(at(inner, i), to), toXyz(at(inner, i + 1), to), transform)
    }
  }

  /** Chamfered box spanning `min`..`max`. */
  box(min: Point3, max: Point3, transform: Matrix4 = identity, chamfer = edgeChamfer): void {
    const profile: ReadonlyArray<Point2> = [[min[0], min[2]], [max[0], min[2]], [max[0], max[2]], [min[0], max[2]]]
    this.prism(profile, "y", min[1], max[1], transform, Math.min(chamfer, (max[1] - min[1]) / 3))
  }

  /** Revolve an (r, y) profile around the y axis; list it bottom to top so faces point outward. */
  lathe(profile: ReadonlyArray<Point2>, segments: number, transform: Matrix4 = identity): void {
    const ring = (p: Point2, j: number): Point3 => {
      const angle = (j / segments) * Math.PI * 2
      return [p[0] * Math.cos(angle), p[1], -p[0] * Math.sin(angle)]
    }
    for (let i = 0; i + 1 < profile.length; i++) {
      const p = at(profile, i)
      const q = at(profile, i + 1)
      for (let j = 0; j < segments; j++) {
        this.triangle(ring(p, j), ring(p, j + 1), ring(q, j + 1), transform)
        this.triangle(ring(p, j), ring(q, j + 1), ring(q, j), transform)
      }
    }
  }

  /** Finish into a non-indexed geometry in metres with crease normals, a `color` shade attribute and material groups. */
  finish(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions.map((v) => v * metresPerLdu), 3))
    geometry.setAttribute("color", new Float32BufferAttribute(this.colors, 3))
    const vertexCount = this.positions.length / 3
    this.groups.forEach((group, i) => {
      const end = this.groups[i + 1]?.start ?? vertexCount
      if (end > group.start) geometry.addGroup(group.start, end - group.start, group.material)
    })
    if (geometry.groups.length === 1) geometry.clearGroups()
    const shaded = toCreasedNormals(geometry, creaseAngle)
    shaded.computeBoundingBox()
    shaded.computeBoundingSphere()
    return shaded
  }
}
