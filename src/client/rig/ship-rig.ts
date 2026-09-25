import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three"
import type { RigLayout } from "../../sim/ship/rig.ts"
import type { BrickDetail } from "../bricks/brick-ship-mesh.ts"
import { type AtlasRegion, atlasRegions, liveryAtlas, type SailLivery } from "./sail-livery.ts"

/** Sail set: 0 furled on the yards, 1 reefed to half, 2 full. */
export type SailLevel = 0 | 1 | 2

/** Geometry of one ship class's cosmetic rig, built once and shared by every ship of the class. */
export interface RigGeometry {
  /** Square sails and the jib; each vertex knows its sail, so one draw furls, billows and hides them all. */
  readonly sails: BufferGeometry
  readonly flags: BufferGeometry
  /** Ropes, ratlines and cosmetic spars; far detail draws only the first `farLineIndices` indices. */
  readonly lines: BufferGeometry
  readonly farLineIndices: number
  /** Sails in `sails`: the layout's square sails in order, then the jib. */
  readonly sailCount: number
}

const maxSails = 16
const maxMasts = 4
/** Sail holes one ship draws at once; the oldest is overwritten when more are punched. */
const maxHoles = 24
const openByLevel = [0, 0.55, 1] as const
// Level changes take about two seconds end to end, like hands going aloft.
const furlRate = 0.6

type V3 = readonly [number, number, number]
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit3 = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

const uvIn = (region: AtlasRegion, u: number, v: number): readonly [number, number] => {
  const [x, y, w, h] = atlasRegions[region]
  // Half a texel in from the edges so mipmaps never bleed a neighbouring print in.
  return [(x + 0.5 + u * (w - 1)) / 256, (y + 0.5 + v * (h - 1)) / 256]
}

/** A cloth grid: `rest(u, v)` fully set, `furled(u, v)` gathered, both in ship metres; normals and tangents come from the rest shape. */
const clothGrid = (
  out: { position: Array<number>; anchor: Array<number>; normal: Array<number>; uv: Array<number>; cloth: Array<number>; tangentU: Array<number>; tangentV: Array<number>; index: Array<number> },
  nu: number,
  nv: number,
  rest: (u: number, v: number) => V3,
  furled: (u: number, v: number) => V3,
  region: AtlasRegion,
  belly: number,
  id: number,
) => {
  const base = out.position.length / 3
  const e = 1e-3
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const v = j / nv
      const p = rest(u, v)
      // Tangents are taken a hair inside the edges: the jib's head is one point, where the u tangent would vanish and the normal be NaN.
      const vt = Math.min(Math.max(v, 1e-2), 1 - 1e-2)
      const tu = sub3(rest(Math.min(u + e, 1), vt), rest(Math.max(u - e, 0), vt)).map((c) => c / (Math.min(u + e, 1) - Math.max(u - e, 0)))
      const tv = sub3(rest(u, Math.min(v + e, 1)), rest(u, Math.max(v - e, 0))).map((c) => c / (Math.min(v + e, 1) - Math.max(v - e, 0)))
      const tU: V3 = [tu[0] ?? 0, tu[1] ?? 0, tu[2] ?? 0]
      const tV: V3 = [tv[0] ?? 0, tv[1] ?? 0, tv[2] ?? 0]
      out.position.push(...p)
      out.anchor.push(...furled(u, v))
      out.normal.push(...unit3(cross3(tU, tV)))
      out.uv.push(...uvIn(region, u, v))
      out.cloth.push(u, v, belly, id)
      out.tangentU.push(...tU)
      out.tangentV.push(...tV)
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i
      const b = a + 1
      const c = a + nu + 1
      const d = c + 1
      out.index.push(a, c, b, b, c, d)
    }
}

/** Build the rig's shared geometry from its layout: square sails, jib, flags, rigging and spars. */
export const buildRigGeometry = (layout: RigLayout): RigGeometry => {
  const masts = [...layout.masts].sort((a, b) => a.x - b.x)
  const [heelX, heelY] = layout.bowsprit.heel
  const [tipX, tipY] = layout.bowsprit.tip
  const heel: V3 = [heelX, heelY, 0]
  const tip: V3 = [tipX, tipY, 0]
  const ringOf = (m: (typeof masts)[number]) => ({
    y: m.nest?.floor ?? (m.yards[0]?.bottom ?? m.top) - 0.1,
    rim: m.nest?.rim ?? m.yards[0]?.top ?? m.top,
    half: m.nest?.half ?? 0.3,
  })
  const stayHead = (m: (typeof masts)[number]) => (m.yards[m.yards.length - 1]?.bottom ?? m.top) - 0.15

  const cloth = { position: [] as Array<number>, anchor: [] as Array<number>, normal: [] as Array<number>, uv: [] as Array<number>, cloth: [] as Array<number>, tangentU: [] as Array<number>, tangentV: [] as Array<number>, index: [] as Array<number> }
  layout.sails.forEach((sail, id) => {
    const drop = sail.top - sail.foot
    const roach = sail.yard === 0 ? 0.25 : 0.12
    clothGrid(
      cloth,
      12,
      10,
      (u, v) => {
        const half = sail.topHalf + (sail.footHalf - sail.topHalf) * v
        // The foot is cut in a shallow curve (roach) so it clears the rail and stays.
        return [sail.x + 0.1, sail.top - v * (drop - roach * Math.sin(Math.PI * u)), (2 * u - 1) * half]
      },
      (u, v) => [sail.x + 0.14 + 0.1 * Math.sin(Math.PI * v), sail.top - 0.1 - 0.16 * v, (2 * u - 1) * sail.topHalf],
      sail.emblem ? "emblemSail" : "plainSail",
      0.2 * Math.min(2 * sail.topHalf, drop),
      id,
    )
  })
  const fore = masts[masts.length - 1]
  const jibStayFoot: V3 = fore === undefined ? heel : [fore.x + 0.15, stayHead(fore), 0]
  const head = lerp3(jibStayFoot, tip, 0.3)
  const tack = lerp3(jibStayFoot, tip, 0.93)
  const clew: V3 = [fore === undefined ? heelX : fore.x + 3, (fore?.foot ?? heelY) + 1.9, 0]
  const jibId = layout.sails.length
  clothGrid(cloth, 8, 10, (u, v) => lerp3(head, lerp3(tack, clew, u), v), (_, v) => lerp3(head, tack, v), "plainSail", -0.12 * Math.hypot(...sub3(tack, clew)), jibId)
  const sails = new BufferGeometry()
  sails.setAttribute("position", new Float32BufferAttribute(cloth.position, 3))
  sails.setAttribute("normal", new Float32BufferAttribute(cloth.normal, 3))
  sails.setAttribute("uv", new Float32BufferAttribute(cloth.uv, 2))
  sails.setAttribute("anchor", new Float32BufferAttribute(cloth.anchor, 3))
  sails.setAttribute("cloth", new Float32BufferAttribute(cloth.cloth, 4))
  sails.setAttribute("tangentU", new Float32BufferAttribute(cloth.tangentU, 3))
  sails.setAttribute("tangentV", new Float32BufferAttribute(cloth.tangentV, 3))
  const clothIds = cloth.cloth.filter((_, i) => i % 4 === 3)
  const mastIndex = (m: (typeof masts)[number] | undefined) => (m === undefined ? -1 : layout.masts.indexOf(m))
  // The jib is set on the fore stay, so it comes down with the foremast.
  sails.setAttribute("mast", new Float32BufferAttribute(clothIds.map((id) => (id === jibId ? mastIndex(fore) : (layout.sails[id]?.mast ?? -1))), 1))
  sails.setAttribute("brace", new Float32BufferAttribute(clothIds.flatMap((id) => braceOf(layout.masts[layout.sails[id]?.mast ?? -1])), 2))
  sails.setIndex(cloth.index)
  sails.computeBoundingSphere()
  if (sails.boundingSphere !== null) sails.boundingSphere.radius += 1.5

  const flag = { position: [] as Array<number>, pole: [] as Array<number>, flag: [] as Array<number>, uv: [] as Array<number>, mast: [] as Array<number>, index: [] as Array<number> }
  const addFlag = (pole: V3, length: number, height: number, taper: number, region: AtlasRegion, amplitude: number, mast: number) => {
    const base = flag.position.length / 3
    const nu = 12
    const nv = 3
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = i / nu
        const v = j / nv
        const h = -height * (0.5 + (v - 0.5) * (1 - taper * u))
        flag.position.push(pole[0] - u * length, pole[1] + h, pole[2])
        flag.pole.push(...pole)
        flag.flag.push(u * length, h, length, amplitude)
        flag.uv.push(...uvIn(region, u, v))
        flag.mast.push(mast)
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i
        flag.index.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2)
      }
  }
  const tallest = masts.reduce<(typeof masts)[number] | undefined>((t, m) => (t === undefined || m.top > t.top ? m : t), undefined)
  const poleTop = (m: (typeof masts)[number]): V3 => [m.x, m.top + 1.9, 0]
  for (const m of masts) {
    if (m === tallest) addFlag(poleTop(m), 2.2, 1.2, 0, "flag", 0.22, mastIndex(m))
    else addFlag(poleTop(m), 4.2, 0.5, 0.85, "pennant", 0.35, mastIndex(m))
  }
  const [ensignX, ensignY] = layout.ensign
  const ensignTop: V3 = [ensignX - 0.9, ensignY + 2.8, 0]
  addFlag(ensignTop, 1.9, 1.05, 0, "ensign", 0.2, -1)
  const flags = new BufferGeometry()
  flags.setAttribute("position", new Float32BufferAttribute(flag.position, 3))
  flags.setAttribute("pole", new Float32BufferAttribute(flag.pole, 3))
  flags.setAttribute("flag", new Float32BufferAttribute(flag.flag, 4))
  flags.setAttribute("uv", new Float32BufferAttribute(flag.uv, 2))
  flags.setAttribute("mast", new Float32BufferAttribute(flag.mast, 1))
  flags.setIndex(flag.index)
  flags.computeBoundingSphere()
  if (flags.boundingSphere !== null) flags.boundingSphere.radius += 5

  const line = { position: [] as Array<number>, normal: [] as Array<number>, color: [] as Array<number>, mast: [] as Array<number>, index: [] as Array<number> }
  // The mast each rope or spar comes down with (-1: none); set before each group of tubes.
  let lineMast = -1
  const rope = new Color(0x17110c)
  const wood = new Color(0x582a12).convertSRGBToLinear()
  rope.convertSRGBToLinear()
  const tube = (a: V3, b: V3, r0: number, r1: number, sides: number, color: Color) => {
    const dir = unit3(sub3(b, a))
    const n1 = unit3(cross3(dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]))
    const n2 = cross3(dir, n1)
    const base = line.position.length / 3
    for (const [end, r] of [[a, r0], [b, r1]] as const)
      for (let k = 0; k < sides; k++) {
        const t = (2 * Math.PI * k) / sides
        const n: V3 = [n1[0] * Math.cos(t) + n2[0] * Math.sin(t), n1[1] * Math.cos(t) + n2[1] * Math.sin(t), n1[2] * Math.cos(t) + n2[2] * Math.sin(t)]
        line.position.push(end[0] + n[0] * r, end[1] + n[1] * r, end[2] + n[2] * r)
        line.normal.push(...n)
        line.color.push(color.r, color.g, color.b)
        line.mast.push(lineMast)
      }
    for (let k = 0; k < sides; k++) {
      const a0 = base + k
      const a1 = base + ((k + 1) % sides)
      line.index.push(a0, a1, a0 + sides, a1, a1 + sides, a0 + sides)
    }
  }
  const ropeLine = (a: V3, b: V3, r: number) => tube(a, b, r, r, 3, rope)
  const mirrored = (fn: (side: number) => void) => {
    fn(1)
    fn(-1)
  }
  const shroudSets: Array<{ readonly lows: ReadonlyArray<(s: number) => V3>; readonly highs: ReadonlyArray<(s: number) => V3>; readonly mast: number }> = []
  masts.forEach((m, k) => {
    lineMast = mastIndex(m)
    const ring = ringOf(m)
    const head = stayHead(m)
    const lows = [0, 1, 2, 3].map((i) => (s: number): V3 => [m.x + 0.1 - 0.55 * i, m.chains.y, s * m.chains.half])
    const highs = [0, 1, 2, 3].map((i) => (s: number): V3 => [m.x + 0.2 - 0.25 * i, ring.y, s * ring.half])
    shroudSets.push({ lows, highs, mast: lineMast })
    const upper = m.yards[1]
    if (upper !== undefined) {
      const topLows = [0, 1, 2].map((i) => (s: number): V3 => [m.x + 0.3 - 0.35 * i, ring.rim, s * Math.max(ring.half, 1) * 0.95])
      const topHighs = [0, 1, 2].map((i) => (s: number): V3 => [m.x + 0.05 - 0.05 * i, upper.bottom - 0.12, s * 0.25])
      shroudSets.push({ lows: topLows, highs: topHighs, mast: lineMast })
    }
    const next = masts[k + 1]
    if (next === undefined) {
      ropeLine([m.x + (m.nest?.half ?? 0.2), ring.y, 0], lerp3(heel, tip, 0.45), 0.045)
      ropeLine(jibStayFoot, tip, 0.04)
    } else {
      ropeLine([m.x + (m.nest?.half ?? 0.2), ring.y, 0], [next.x - 0.25, next.foot + 0.9, 0], 0.045)
      ropeLine([m.x + 0.15, head, 0], [next.x - 0.3, ringOf(next).y + 0.1, 0], 0.035)
    }
    mirrored((s) => ropeLine([m.x - 0.1, head, s * 0.2], [m.x - 3.6, m.chains.y, s * (m.chains.half + 0.05)], 0.03))
  })
  for (const set of shroudSets) {
    lineMast = set.mast
    mirrored((s) => set.lows.forEach((low, i) => ropeLine(low(s), set.highs[i]?.(s) ?? low(s), 0.05)))
  }
  lineMast = -1
  tube(heel, tip, 0.17, 0.09, 8, wood)
  for (const m of masts) {
    lineMast = mastIndex(m)
    tube([m.x, m.top - 0.2, 0], poleTop(m), 0.07, 0.045, 6, wood)
  }
  lineMast = -1
  tube([ensignX, ensignY, 0], ensignTop, 0.07, 0.045, 6, wood)
  ropeLine(tip, [heelX + 1.6, 1.2, 0], 0.035)
  const farLineIndices = line.index.length

  for (const set of shroudSets) {
    lineMast = set.mast
    mirrored((s) => {
      const ends = set.lows.map((low, i) => [low(s), set.highs[i]?.(s) ?? low(s)] as const)
      const [first] = ends
      if (first === undefined) return
      const y0 = Math.max(...ends.map(([a]) => a[1]))
      const y1 = Math.min(...ends.map(([, b]) => b[1]))
      // Rungs every 0.4 m, a Lego rigging ladder's pitch at minifig scale.
      for (let y = y0 + 0.35; y < y1 - 0.15; y += 0.4) {
        const at = ends.map(([a, b]) => lerp3(a, b, (y - a[1]) / (b[1] - a[1])))
        for (let i = 0; i + 1 < at.length; i++) {
          const a = at[i]
          const b = at[i + 1]
          if (a !== undefined && b !== undefined) ropeLine(a, b, 0.036)
        }
      }
    })
  }
  const unbraced = line.position.length / 3
  for (const m of masts) {
    lineMast = mastIndex(m)
    m.yards.forEach((yard, i) => {
      const above = m.yards[i + 1]?.bottom ?? m.top - 0.1
      mirrored((s) => ropeLine([yard.front - 0.2, yard.top, s * (yard.half - 0.1)], [m.x + 0.2, above - 0.05, 0], 0.02))
    })
  }
  const lineBrace = new Float32Array((line.position.length / 3) * 2)
  for (const m of masts)
    for (let v = unbraced; v < line.position.length / 3; v++) {
      // Each lift runs from its mast's yard up the same mast, so its vertices lie within a few metres of that mast.
      if (Math.abs((line.position[v * 3] ?? 0) - m.x) < 3) lineBrace.set(braceOf(m), v * 2)
    }
  const lines = new BufferGeometry()
  lines.setAttribute("brace", new Float32BufferAttribute(lineBrace, 2))
  lines.setAttribute("position", new Float32BufferAttribute(line.position, 3))
  lines.setAttribute("normal", new Float32BufferAttribute(line.normal, 3))
  lines.setAttribute("color", new Float32BufferAttribute(line.color, 3))
  lines.setAttribute("mast", new Float32BufferAttribute(line.mast, 1))
  lines.setIndex(line.index)
  lines.computeBoundingSphere()
  return { sails, flags, lines, farLineIndices, sailCount: jibId + 1 }
}

/** Brace attribute of a vertex that swings with `mast`'s yards: the mast's x (the pivot) and weight 1; others 0, 0. */
const braceOf = (mast: { readonly x: number } | undefined): [number, number] => (mast === undefined ? [0, 0] : [mast.x, 1])

// Yards swing about their mast's vertical axis; three's rotation.y convention, so +angle turns the bow-facing sail to port.
const braceChunk = /* glsl */ `
attribute vec2 brace;
uniform float uBrace;
vec3 bracedDirection(vec3 d, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}
vec3 bracedPoint(vec3 p, float angle, float pivot) {
  return bracedDirection(p - vec3(pivot, 0.0, 0.0), angle) + vec3(pivot, 0.0, 0.0);
}
`

// A rope, sail or flag goes with its mast (uMastShown) or, with no mast, with the hull's rig (uHullShown).
const shownChunk = /* glsl */ `
attribute float mast;
uniform float uMastShown[${maxMasts}];
uniform float uHullShown;
float rigShown() { return mast < -0.5 ? uHullShown : uMastShown[int(mast + 0.5)]; }
`

const sailChunk = /* glsl */ `
${braceChunk}
${shownChunk}
varying vec3 vSail;
attribute vec3 anchor;
attribute vec4 cloth;
attribute vec3 tangentU;
attribute vec3 tangentV;
uniform float uTime;
uniform vec3 uWind;
uniform float uOpen;
uniform float uShown[${maxSails}];
void sailShape(out vec3 p, out vec3 n) {
  float u = cloth.x;
  float v = cloth.y;
  float amp = abs(cloth.z);
  float id = cloth.w;
  float angle = uBrace * brace.y;
  vec3 wind = bracedDirection(uWind, -angle);
  float speed = length(wind);
  float d = dot(wind, normal) / 10.0;
  // Square sails go aback only a little before they lie on the mast; the jib (negative amplitude) fills to either side.
  float fill = cloth.z < 0.0 ? clamp(d, -1.0, 1.0) : clamp(d, -0.25, 1.0);
  fill *= 1.0 + 0.06 * sin(uTime * 1.3 + id * 2.1);
  float su = sin(PI * u);
  float cu = cos(PI * u);
  float a = PI * (0.1 + 0.8 * v);
  float sv = sin(a);
  float cv = cos(a);
  float luff = (0.02 + 0.1 * (1.0 - min(abs(fill), 1.0))) * min(speed / 10.0, 1.5);
  float ph = u * 9.0 + v * 4.0 - uTime * 5.0 + id * 1.7;
  float sp = sin(ph);
  float cp = cos(ph);
  float belly = (amp * fill * su * sv + luff * sp * su * v) * uOpen;
  float dbu = (amp * fill * PI * cu * sv + luff * v * (9.0 * cp * su + PI * cu * sp)) * uOpen;
  float dbv = (amp * fill * su * cv * 0.8 * PI + luff * su * (sp + 4.0 * v * cp)) * uOpen;
  vSail = vec3(id, position.yz);
  p = bracedPoint(mix(anchor, position, uOpen) + normal * belly, angle, brace.x) * uShown[int(id + 0.5)] * rigShown();
  n = bracedDirection(normalize(cross(tangentU + normal * dbu, tangentV * max(uOpen, 0.05) + normal * dbv)), angle);
}
`

const flagChunk = /* glsl */ `
${shownChunk}
attribute vec3 pole;
attribute vec4 flag;
uniform float uTime;
uniform vec3 uWind;
void flagShape(out vec3 p, out vec3 n) {
  float speed = length(uWind.xz);
  vec2 d = speed > 0.1 ? uWind.xz / speed : vec2(-1.0, 0.0);
  float stream = clamp(speed / 8.0, 0.0, 1.0);
  float s = flag.x;
  float len = flag.z;
  float k = 6.2832 / max(len * 0.6, 0.5);
  float ph = k * s - uTime * (4.0 + speed * 0.4) + pole.x;
  float gain = flag.w * (0.3 + stream);
  float w = gain * (s / len) * sin(ph);
  float dw = gain * (sin(ph) / len + (s / len) * k * cos(ph));
  vec3 along = normalize(vec3(d.x, -(1.0 - stream) * 0.8, d.y));
  vec3 side = normalize(vec3(-d.y, 0.0, d.x));
  p = (pole + along * s + vec3(0.0, flag.y, 0.0) + side * w) * rigShown();
  n = normalize(cross(along + side * dw, vec3(0.0, 1.0, 0.0)));
}
`

// Each hole is (sail id, rest y, rest z, radius) in the sail's unbraced rest frame, so it moves with the cloth; ragged, with a scorched rim.
const holeFragment = /* glsl */ `
float scorch = 0.0;
for (int i = 0; i < ${maxHoles}; i++) {
  vec4 h = uHoles[i];
  if (abs(h.x - vSail.x) > 0.5) continue;
  vec2 d = vSail.yz - h.yz;
  float a = atan(d.y, d.x);
  float r = h.w * (1.0 + 0.22 * sin(a * 5.0 + h.y * 7.0) + 0.12 * sin(a * 13.0 + h.z * 5.0));
  float l = length(d);
  if (l < r) discard;
  scorch = max(scorch, 1.0 - smoothstep(r, r * 1.6, l));
}
diffuseColor.rgb *= 1.0 - 0.8 * scorch;
`

type RigUniforms = {
  readonly uHoles: { value: Array<Vector4> }
  readonly uMastShown: { value: Array<number> }
  readonly uHullShown: { value: number }
  readonly uTime: { value: number }
  readonly uWind: { value: Vector3 }
  readonly uOpen: { value: number }
  readonly uShown: { value: Array<number> }
  readonly uBrace: { value: number }
}

const shaped = (chunk: string, fn: string, uniforms: RigUniforms, depth: boolean) => (shader: WebGLProgramParametersWithUniforms) => {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${chunk}`)
  shader.vertexShader = depth
    ? shader.vertexShader.replace("#include <begin_vertex>", `vec3 rigP; vec3 rigN; ${fn}(rigP, rigN);\nvec3 transformed = rigP;`)
    : shader.vertexShader
        .replace("#include <beginnormal_vertex>", `vec3 rigP; vec3 rigN; ${fn}(rigP, rigN);\nvec3 objectNormal = rigN;`)
        .replace("#include <begin_vertex>", "vec3 transformed = rigP;")
}

const scratchQuaternion = new Quaternion()
const scratchWind = new Vector3()

/**
 * One ship's sails, flags and rigging under `root` (add it to the ship's root, which is ship-local metres).
 * Sails billow and flags stream in the vertex shader from `update`'s wind; nothing allocates per frame.
 */
export class ShipRig {
  readonly root = new Group()
  private readonly uniforms: RigUniforms
  private readonly sailMaterial: MeshStandardMaterial
  private readonly flagMaterial: MeshStandardMaterial
  private readonly depthMaterials: ReadonlyArray<MeshDepthMaterial>
  private readonly lineMaterial: MeshStandardMaterial
  private readonly sails: Mesh
  private readonly flags: Mesh
  private readonly lines: Mesh
  private readonly geometry: RigGeometry
  private level: SailLevel = 2
  private detailLevel: BrickDetail = "near"
  private nextHole = 0
  /** The livery the sails and flags are printed with. */
  livery: SailLivery

  constructor(geometry: RigGeometry, livery: SailLivery) {
    this.geometry = geometry
    this.livery = livery
    this.uniforms = {
      uHoles: { value: Array.from({ length: maxHoles }, () => new Vector4(-1, 0, 0, 0)) },
      uMastShown: { value: new Array<number>(maxMasts).fill(1) },
      uHullShown: { value: 1 },
      uTime: { value: 0 }, uWind: { value: new Vector3() }, uOpen: { value: 1 }, uShown: { value: new Array<number>(maxSails).fill(1) }, uBrace: { value: 0 } }
    const map = liveryAtlas(livery)
    this.sailMaterial = new MeshStandardMaterial({ map, side: DoubleSide, roughness: 0.92, metalness: 0 })
    const sailShape = shaped(sailChunk, "sailShape", this.uniforms, false)
    this.sailMaterial.onBeforeCompile = (shader) => {
      sailShape(shader)
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vSail;\nuniform vec4 uHoles[${maxHoles}];`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${holeFragment}`)
    }
    this.sailMaterial.customProgramCacheKey = () => "rig-sail"
    this.flagMaterial = new MeshStandardMaterial({ map, side: DoubleSide, roughness: 0.9, metalness: 0 })
    this.flagMaterial.onBeforeCompile = shaped(flagChunk, "flagShape", this.uniforms, false)
    this.flagMaterial.customProgramCacheKey = () => "rig-flag"
    const sailDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
    sailDepth.onBeforeCompile = shaped(sailChunk, "sailShape", this.uniforms, true)
    sailDepth.customProgramCacheKey = () => "rig-sail-depth"
    const flagDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
    flagDepth.onBeforeCompile = shaped(flagChunk, "flagShape", this.uniforms, true)
    flagDepth.customProgramCacheKey = () => "rig-flag-depth"
    this.depthMaterials = [sailDepth, flagDepth]
    this.lineMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
    this.lineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uBrace = this.uniforms.uBrace
      shader.uniforms.uMastShown = this.uniforms.uMastShown
      shader.uniforms.uHullShown = this.uniforms.uHullShown
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${braceChunk}\n${shownChunk}`)
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = bracedDirection(normal, uBrace * brace.y);")
        .replace("#include <begin_vertex>", "vec3 transformed = bracedPoint(position, uBrace * brace.y, brace.x) * rigShown();")
    }
    this.lineMaterial.customProgramCacheKey = () => "rig-lines"

    this.sails = new Mesh(geometry.sails, this.sailMaterial)
    this.sails.name = "sails"
    this.sails.customDepthMaterial = sailDepth
    this.flags = new Mesh(geometry.flags, this.flagMaterial)
    this.flags.name = "flags"
    this.flags.customDepthMaterial = flagDepth
    this.lines = new Mesh(geometry.lines, this.lineMaterial)
    this.lines.name = "rigging"
    for (const mesh of [this.sails, this.flags, this.lines]) {
      mesh.castShadow = mesh !== this.flags
      mesh.receiveShadow = true
      this.root.add(mesh)
    }
    // The line geometry is shared by every ship, so each ship sets its own range just before it draws.
    const range = () => geometry.lines.setDrawRange(0, this.detailLevel === "far" ? geometry.farLineIndices : Infinity)
    this.lines.onBeforeRender = range
    this.lines.onBeforeShadow = range
    this.root.name = "rig"
  }

  /** Print the sails and flags with `livery`; atlases are shared per livery name. */
  setLivery(livery: SailLivery): void {
    this.livery = livery
    const map = liveryAtlas(livery)
    this.sailMaterial.map = map
    this.flagMaterial.map = map
  }

  /** Set sail to `level`; `update` animates the cloth there. */
  setSailLevel(level: SailLevel): void {
    this.level = level
  }

  get sailLevel(): SailLevel {
    return this.level
  }

  /** How far the sails are let out right now, 0 furled to 1 full. */
  get openness(): number {
    return this.uniforms.uOpen.value
  }

  /** Swing the square yards and their sails about the masts by `angle` radians (three's rotation.y sense; 0 = square). */
  setBrace(angle: number): void {
    this.uniforms.uBrace.value = angle
  }

  /** Show or hide one sail by its index (layout sails in order, then the jib), e.g. when its yard falls. */
  setSailShown(sail: number, shown: boolean): void {
    if (sail >= 0 && sail < this.geometry.sailCount) this.uniforms.uShown.value[sail] = shown ? 1 : 0
  }

  /** Show or hide everything that comes down with mast `mast` (a `RigLayout.masts` index): its sails, flags, ropes and pole. */
  setMastShown(mast: number, shown: boolean): void {
    if (mast >= 0 && mast < maxMasts) this.uniforms.uMastShown.value[mast] = shown ? 1 : 0
  }

  /** Show or hide the rig no mast carries: bowsprit, its stays, the ensign. */
  setHullRigShown(shown: boolean): void {
    this.uniforms.uHullShown.value = shown ? 1 : 0
  }

  /** Tear a ragged hole of `radius` metres in sail `sail` at rest-frame height `y` and athwartships `z` (ship-local, unbraced). */
  punchSail(sail: number, y: number, z: number, radius: number): void {
    this.uniforms.uHoles.value[this.nextHole]?.set(sail, y, z, radius)
    this.nextHole = (this.nextHole + 1) % maxHoles
  }

  /** Mend every sail: whole cloth, every mast and the hull rig shown. */
  mend(): void {
    for (const hole of this.uniforms.uHoles.value) hole.set(-1, 0, 0, 0)
    this.uniforms.uMastShown.value.fill(1)
    this.uniforms.uHullShown.value = 1
    this.uniforms.uShown.value.fill(1)
  }

  /** Take on `other`'s livery, brace, sail set and holes at once: a torn-off copy of its rig. */
  copyFrom(other: ShipRig): void {
    this.setLivery(other.livery)
    this.level = other.level
    this.uniforms.uOpen.value = other.uniforms.uOpen.value
    this.uniforms.uBrace.value = other.uniforms.uBrace.value
    this.uniforms.uHoles.value.forEach((hole, i) => hole.copy(other.uniforms.uHoles.value[i] ?? hole))
  }

  /** Match the hull's detail level; far drops ratlines and lifts, which are under a pixel wide there. */
  setDetail(detail: BrickDetail): void {
    this.detailLevel = detail
  }

  /** Advance the cloth by `dt` seconds under a world-space wind velocity in m/s (x, z). */
  update(dt: number, windX: number, windZ: number): void {
    const u = this.uniforms
    u.uTime.value += dt
    const target = openByLevel[this.level]
    const step = furlRate * dt
    u.uOpen.value += Math.max(-step, Math.min(step, target - u.uOpen.value))
    this.root.getWorldQuaternion(scratchQuaternion).invert()
    u.uWind.value.copy(scratchWind.set(windX, 0, windZ).applyQuaternion(scratchQuaternion))
  }

  /** Draw calls per colour pass and triangles at `detail` (the current level when omitted). */
  stats(detail: BrickDetail = this.detailLevel): { readonly draws: number; readonly triangles: number } {
    const count = (g: BufferGeometry, limit = Infinity) => Math.min(g.getIndex()?.count ?? 0, limit) / 3
    const lines = count(this.geometry.lines, detail === "far" ? this.geometry.farLineIndices : Infinity)
    return { draws: 3, triangles: count(this.geometry.sails) + count(this.geometry.flags) + lines }
  }

  /** Free this ship's materials; the shared geometry and livery atlases stay. */
  dispose(): void {
    for (const material of [this.sailMaterial, this.flagMaterial, this.lineMaterial, ...this.depthMaterials]) material.dispose()
    this.root.removeFromParent()
  }
}
