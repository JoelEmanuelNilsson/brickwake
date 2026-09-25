import { defaultHull, type Hull } from "./hull.ts"
import { applyImpulse, shipPointVelocity, type ShipState } from "./ship.ts"
import { tuning } from "./tuning.ts"
import { add, dot, rotate, rotateInverse, sub, vec3, type Vec3 } from "./vector.ts"

/** Parameter along segment p + t·d (t in 0…1) closest to point q, all horizontal. */
const closestOn = (p: Vec3, d: Vec3, q: Vec3) => {
  const dd = d.x * d.x + d.z * d.z
  return dd === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - p.x) * d.x + (q.z - p.z) * d.z) / dd))
}

/** Closest points of two horizontal segments by alternating projection; converges for convex sets, and the gap is what matters. */
const closestPoints = (p1: Vec3, d1: Vec3, p2: Vec3, d2: Vec3): readonly [Vec3, Vec3] => {
  let s = 0.5
  let t = 0.5
  for (let i = 0; i < 6; i++) {
    t = closestOn(p2, d2, vec3(p1.x + d1.x * s, 0, p1.z + d1.z * s))
    s = closestOn(p1, d1, vec3(p2.x + d2.x * t, 0, p2.z + d2.z * t))
  }
  return [vec3(p1.x + d1.x * s, 0, p1.z + d1.z * s), vec3(p2.x + d2.x * t, 0, p2.z + d2.z * t)]
}

const keel = (ship: ShipState) => {
  const half = rotate(ship.orientation, vec3(tuning.collision.halfLength, 0, 0))
  return { start: vec3(ship.position.x - half.x, 0, ship.position.z - half.z), along: vec3(2 * half.x, 0, 2 * half.z) }
}

const shift = (ship: ShipState, by: Vec3): ShipState => ({ ...ship, position: add(ship.position, by) })

const toLocal = (ship: ShipState, world: Vec3) => rotateInverse(ship.orientation, sub(world, ship.position))

/**
 * Pushes overlapping ships apart in the horizontal plane: each hull is a capsule along its keel. Overlap is split
 * evenly and closing speed at the contact is taken out with a slightly bouncy impulse, which also swings the hulls.
 * `collides(ship)` picks the ships that take part; the rest pass through untouched. No damage (spec: ram damage later).
 */
export const collideShips = (
  ships: ReadonlyArray<ShipState>,
  collides: (ship: ShipState) => boolean,
  hull: Hull = defaultHull,
): ReadonlyArray<ShipState> => {
  const out = [...ships]
  const { radius, restitution } = tuning.collision
  // Hulls meet side on, so the sway added mass sets how hard they push; each takes half the closing momentum.
  const pairMass = (hull.mass * (1 + tuning.hull.addedMass.sway)) / 2
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      let a = out[i]!
      let b = out[j]!
      if (!collides(a) || !collides(b)) continue
      const ka = keel(a)
      const kb = keel(b)
      const [pa, pb] = closestPoints(ka.start, ka.along, kb.start, kb.along)
      const gap = Math.hypot(pb.x - pa.x, pb.z - pa.z)
      const overlap = 2 * radius - gap
      if (overlap <= 0) continue
      // Crossed keels give no closest-point direction; centre to centre does.
      const dx = gap > 0.5 ? pb.x - pa.x : b.position.x - a.position.x
      const dz = gap > 0.5 ? pb.z - pa.z : b.position.z - a.position.z
      const span = Math.hypot(dx, dz)
      const normal = span > 1e-6 ? vec3(dx / span, 0, dz / span) : vec3(1, 0, 0)
      a = shift(a, vec3((-normal.x * overlap) / 2, 0, (-normal.z * overlap) / 2))
      b = shift(b, vec3((normal.x * overlap) / 2, 0, (normal.z * overlap) / 2))
      const contact = vec3((pa.x + pb.x) / 2, (a.position.y + b.position.y) / 2, (pa.z + pb.z) / 2)
      const localA = toLocal(a, contact)
      const localB = toLocal(b, contact)
      const closing = dot(sub(shipPointVelocity(b, localB, hull), shipPointVelocity(a, localA, hull)), normal)
      if (closing < 0) {
        const j = -(1 + restitution) * closing * pairMass
        a = applyImpulse(a, localA, vec3(-normal.x * j, 0, -normal.z * j), hull)
        b = applyImpulse(b, localB, vec3(normal.x * j, 0, normal.z * j), hull)
      }
      out[i] = a
      out[j] = b
    }
  }
  return out
}
