import { ldrawColorCodes } from "./colors.ts"
import { ldu, partCatalog } from "./parts.ts"
import { footprint, type ShipPart } from "./structure.ts"

const cosine = [1, 0, -1, 0] as const
const sine = [0, 1, 0, -1] as const

/** An LDraw model of the parts, for LDView or Studio; LDraw's frame is ours with y and z negated. */
export const toLdr = (name: string, parts: ReadonlyArray<ShipPart>): string => {
  const lines = parts.map((p) => {
    const [fx, fz] = footprint(p)
    const [ox, oy, oz] = partCatalog[p.part].ldrawOrigin
    const c = cosine[p.turns]
    const s = sine[p.turns]
    const x = (p.x + fx / 2) * ldu.stud + ox * c + oz * s
    const y = p.y * ldu.plate + oy
    const z = (p.z + fz / 2) * ldu.stud - ox * s + oz * c
    const rotation = [c, 0, -s, 0, 1, 0, s, 0, c].map((v) => v + 0)
    return `1 ${ldrawColorCodes[p.color]} ${x} ${-y + 0} ${-z + 0} ${rotation.join(" ")} ${p.part}.dat`
  })
  return [`0 ${name}`, `0 Name: ${name}.ldr`, "0 Author: Brickwake ship generator", ...lines, ""].join("\n")
}
