import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, SRGBColorSpace } from "three"

/** Emblem artwork a livery can print on its main sail and flags. */
export type EmblemArt = "skull" | "lion" | "fleur"

/** The sail and flag print of one ship: cloth, edge bands, emblem on the main course, flag and pennant colours (CSS colours). */
export interface SailLivery {
  readonly name: string
  readonly cloth: string
  /** Vertical bands down both edges of every sail. */
  readonly bands?: string
  readonly emblem: { readonly art: EmblemArt; readonly color: string; readonly backing?: string }
  readonly flag: { readonly field: string; readonly emblem: string }
  readonly pennant: string
}

/** Pirates: black canvas, white skull and crossbones on the main course, a jolly roger and red pennants. */
export const pirateLivery: SailLivery = {
  name: "pirate",
  cloth: "#2a2725",
  emblem: { art: "skull", color: "#eceae4" },
  flag: { field: "#131316", emblem: "#eceae4" },
  pennant: "#b3170c",
}

/** Navy, lion: white canvas with red edge bands and a red lion. */
export const navyLionLivery: SailLivery = {
  name: "navy-lion",
  cloth: "#ece8dc",
  bands: "#b3170c",
  emblem: { art: "lion", color: "#1a1414", backing: "#ece8dc" },
  flag: { field: "#b3170c", emblem: "#ece8dc" },
  pennant: "#b3170c",
}

/** Navy, fleur-de-lis: blue canvas, a white centre panel with a blue fleur-de-lis. */
export const navyFleurLivery: SailLivery = {
  name: "navy-fleur",
  cloth: "#2a56b0",
  emblem: { art: "fleur", color: "#1d3f86", backing: "#ece8dc" },
  flag: { field: "#1d3f86", emblem: "#f2cd37" },
  pennant: "#ece8dc",
}

/** Free-for-all sail colours, one per player slot, each printed with a skull. */
export const ffaColors = ["#b3170c", "#1f6f3a", "#d8761b", "#5b2c83", "#e3b721", "#177a86", "#8a1b4d", "#3d5fa8", "#6b4a2b", "#9aa02a", "#c24a86", "#2a2d33"] as const

/** A free-for-all livery: `cloth` sails with a skull in black or white, whichever reads against them. */
export const ffaLivery = (cloth: string): SailLivery => {
  const hex = Number.parseInt(cloth.slice(1), 16)
  const luma = 0.3 * ((hex >> 16) & 255) + 0.59 * ((hex >> 8) & 255) + 0.11 * (hex & 255)
  const ink = luma > 150 ? "#141416" : "#eceae4"
  return { name: `ffa-${cloth}`, cloth, emblem: { art: "skull", color: ink }, flag: { field: cloth, emblem: ink }, pennant: cloth }
}

/** Where each print sits in the 256 × 256 livery atlas, in texels [x, y, width, height], y down. */
export const atlasRegions = {
  emblemSail: [0, 0, 128, 128],
  plainSail: [128, 0, 128, 128],
  flag: [0, 128, 128, 64],
  ensign: [0, 192, 128, 64],
  pennant: [128, 128, 128, 16],
} as const

/** A region of the atlas. */
export type AtlasRegion = keyof typeof atlasRegions

const skull = [
  "....#####....",
  "..#########..",
  ".###########.",
  "#############",
  "#############",
  "###..###..###",
  "##....#....##",
  "##....#....##",
  "###..###..###",
  "######.######",
  ".####...####.",
  "..#########..",
  "..#.#.#.#.#..",
  "..#########..",
]
const lion = [
  "....##..........",
  "...####.........",
  "..######.##.....",
  "..#######.......",
  "...######.......",
  "....######......",
  "...########.....",
  "..##########....",
  ".###.######.#...",
  ".##..#######....",
  ".....#######....",
  "....####..##....",
  "...####....##...",
  "...###......#...",
  "..###.......##..",
  ".####......####.",
]
const fleur = [
  ".......#.......",
  "......###......",
  ".....#####.....",
  ".....#####.....",
  "..##..###..##..",
  ".####.###.####.",
  "##..#.###.#..##",
  "#...#######...#",
  "#..#########..#",
  ".....#####.....",
  ".#############.",
  ".....#####.....",
  "....###.###....",
  "...###...###...",
  "..###.....###..",
  "..#.........#..",
]
const arts: Readonly<Record<EmblemArt, ReadonlyArray<string>>> = { skull, lion, fleur }

/** Deterministic per-texel hash in [0, 1), so every client prints the same weathering. */
const grain = (x: number, y: number) => {
  let h = Math.imul(x ^ 0x27d4eb2f, 0x85ebca6b) ^ Math.imul(y ^ 0x165667b1, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 13), 0x2c1b3c6d)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const drawArt = (g: CanvasRenderingContext2D, art: ReadonlyArray<string>, cx: number, cy: number, scale: number, color: string) => {
  const w = art[0]?.length ?? 0
  const x0 = Math.round(cx - (w * scale) / 2)
  const y0 = Math.round(cy - (art.length * scale) / 2)
  g.fillStyle = color
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(x0 + x * scale, y0 + y * scale, scale, scale)
  })
}

const crossbones = (g: CanvasRenderingContext2D, cx: number, cy: number, reach: number, scale: number, color: string) => {
  g.fillStyle = color
  for (const dir of [1, -1]) {
    for (let t = -reach; t <= reach; t++) g.fillRect(cx + t * scale, cy + dir * t * scale, scale * 2, scale * 2)
    for (const end of [-reach, reach]) {
      const x = cx + end * scale
      const y = cy + dir * end * scale
      g.fillRect(x - scale, y, scale * 4, scale * 2)
      g.fillRect(x, y - scale, scale * 2, scale * 4)
    }
  }
}

const cloth = (g: CanvasRenderingContext2D, livery: SailLivery, [x0, y0, w, h]: readonly [number, number, number, number]) => {
  g.fillStyle = livery.cloth
  g.fillRect(x0, y0, w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = grain(x0 + x, y0 + y)
      // Panel seams every 16 texels and weathered speckle: the woven look of a cloth Lego sail.
      const shade = x % 16 === 0 ? 0.22 : n < 0.06 ? 0.1 : n > 0.97 ? -0.08 : 0
      if (shade === 0) continue
      g.fillStyle = shade > 0 ? `rgba(0,0,0,${shade})` : `rgba(255,255,255,${-shade})`
      g.fillRect(x0 + x, y0 + y, 1, 1)
    }
  if (livery.bands !== undefined) {
    g.fillStyle = livery.bands
    g.fillRect(x0 + 6, y0, 18, h)
    g.fillRect(x0 + w - 24, y0, 18, h)
  }
  g.fillStyle = "rgba(0,0,0,0.35)"
  for (const ry of [0.16, 0.3]) for (let x = 6; x < w - 4; x += 8) g.fillRect(x0 + x, y0 + Math.round(h * ry), 2, 2)
  g.fillStyle = "rgba(0,0,0,0.45)"
  g.fillRect(x0, y0, w, 3)
  g.fillRect(x0, y0 + h - 3, w, 3)
  g.fillRect(x0, y0, 3, h)
  g.fillRect(x0 + w - 3, y0, 3, h)
}

const emblem = (g: CanvasRenderingContext2D, art: EmblemArt, color: string, cx: number, cy: number, scale: number) => {
  if (art === "skull") {
    crossbones(g, cx - scale, cy + scale * 2, 9, scale, color)
    drawArt(g, skull, cx, cy - scale * 2, scale, color)
  } else drawArt(g, arts[art], cx, cy, scale, color)
}

const paint = (livery: SailLivery): HTMLCanvasElement => {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext("2d")
  if (g === null) throw new Error("no 2D canvas context for the sail atlas")
  cloth(g, livery, atlasRegions.emblemSail)
  cloth(g, livery, atlasRegions.plainSail)
  const [ex, ey, ew, eh] = atlasRegions.emblemSail
  if (livery.emblem.backing !== undefined) {
    g.fillStyle = livery.emblem.backing
    g.fillRect(ex + ew * 0.25, ey + 3, ew * 0.5, eh - 6)
  }
  emblem(g, livery.emblem.art, livery.emblem.color, ex + ew / 2, ey + eh * 0.52, 4)
  for (const region of [atlasRegions.flag, atlasRegions.ensign]) {
    const [fx, fy, fw, fh] = region
    g.fillStyle = livery.flag.field
    g.fillRect(fx, fy, fw, fh)
    emblem(g, livery.emblem.art, livery.flag.emblem, fx + fw / 2, fy + fh / 2, 2)
  }
  const [px, py, pw, ph] = atlasRegions.pennant
  g.fillStyle = livery.pennant
  g.fillRect(px, py, pw, ph)
  g.fillStyle = "rgba(0,0,0,0.25)"
  g.fillRect(px, py + ph - 3, pw, 3)
  return canvas
}

const atlases = new Map<string, CanvasTexture>()

/** The pixel-art atlas for `livery`, painted once and shared by every ship that flies it; see `atlasRegions`. */
export const liveryAtlas = (livery: SailLivery): CanvasTexture => {
  const cached = atlases.get(livery.name)
  if (cached !== undefined) return cached
  const texture = new CanvasTexture(paint(livery))
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  atlases.set(livery.name, texture)
  return texture
}
