/** A 3D vector in metres, metres per second, or radians per second, by context. World axes: +y up. */
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** A unit quaternion rotating ship-local vectors into world space. */
export interface Quat {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

/** Builds a Vec3. */
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** The zero vector. */
export const zeroVec3: Vec3 = vec3(0, 0, 0)

/** Component-wise sum. */
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z)

/** Component-wise difference a − b. */
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z)

/** Scales a vector. */
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s)

/** Dot product. */
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

/** Cross product a × b. */
export const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)

/** Euclidean length. */
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

/** The unit vector along a; the zero vector stays zero. */
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l === 0 ? zeroVec3 : scale(a, 1 / l)
}

/**
 * Horizontal unit direction for a yaw angle in radians. Angle 0 is +x; positive angles turn
 * counter-clockwise seen from above (toward −z). Every heading and wind angle in the sim uses this.
 */
export const directionFromAngle = (angle: number): Vec3 => vec3(Math.cos(angle), 0, -Math.sin(angle))

/** Yaw angle of a horizontal direction; inverse of `directionFromAngle`. */
export const angleOfDirection = (x: number, z: number): number => Math.atan2(-z, x)

/** Wraps an angle into (−π, π]. */
export const wrapAngle = (angle: number): number => {
  const wrapped = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI))
  return wrapped === -Math.PI ? Math.PI : wrapped
}

/** Rotation by `angle` radians about a unit `axis`. */
export const quatFromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2)
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) }
}

/** Hamilton product: applies b, then a. */
export const multiplyQuat = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
})

/** Rotates v by q (local → world for a ship orientation). */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return vec3(
    v.x + q.w * tx + q.y * tz - q.z * ty,
    v.y + q.w * ty + q.z * tx - q.x * tz,
    v.z + q.w * tz + q.x * ty - q.y * tx,
  )
}

/** Rotates v by the inverse of q (world → local for a ship orientation). */
export const rotateInverse = (q: Quat, v: Vec3): Vec3 => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v)

/** Advances an orientation by a world-space angular velocity over dt seconds, renormalized. */
export const integrateQuat = (q: Quat, angularVelocity: Vec3, dt: number): Quat => {
  const angle = length(angularVelocity) * dt
  if (angle === 0) return q
  const r = multiplyQuat(quatFromAxisAngle(scale(angularVelocity, 1 / length(angularVelocity)), angle), q)
  const n = Math.hypot(r.x, r.y, r.z, r.w)
  return { x: r.x / n, y: r.y / n, z: r.z / n, w: r.w / n }
}
