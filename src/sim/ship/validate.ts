import { type GeneratedShip, gridMetres } from "./generate.ts"
import type { ShipSpec } from "./spec.ts"
import { findOverlaps, occupiedCells, reachable } from "./structure.ts"

/** Checks a generated ship against its spec; every string is one violation, empty means valid. */
export const validateShip = (spec: ShipSpec, ship: GeneratedShip): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const { parts } = ship
  const [min, max] = spec.partRange
  if (parts.length < min || parts.length > max) issues.push(`part count ${parts.length} outside [${min}, ${max}]`)
  for (const [a, b, cell] of findOverlaps(parts).slice(0, 20)) issues.push(`parts ${a} and ${b} overlap at ${cell.join(",")}`)
  const seen = reachable(parts.length, ship.edges, ship.keel)
  const loose = parts.flatMap((p, i) => (seen[i] === 1 ? [] : [`${p.part}@${p.x},${p.y},${p.z}`]))
  if (loose.length > 0) issues.push(`${loose.length} parts not connected to the keel: ${loose.slice(0, 12).join(" ")}`)

  const occupied = new Set(parts.flatMap(occupiedCells).map((c) => c.join(",")))
  const courseTops = new Set(spec.courses.reduce<Array<number>>((tops, c) => [...tops, (tops[tops.length - 1] ?? 0) + (c === "brick" ? 3 : 1)], [0]))
  for (const deck of spec.guns.decks) {
    const halfBeam = deck.halfBeam / gridMetres.stud
    for (const gx of deck.xs) {
      const x0 = spec.midship + gx / gridMetres.stud - spec.port.width / 2
      const centre = spec.waterline + deck.height / gridMetres.plate
      const port = ship.ports.find((p) => p.x[0] === Math.round(x0) && Math.abs((p.y[0] + p.y[1]) / 2 - centre) <= 0.5)
      if (Math.abs(x0 - Math.round(x0)) > 1e-6) issues.push(`${deck.deck} gun at x ${gx} m is not on a stud boundary`)
      if (port === undefined) {
        issues.push(`${deck.deck} gun at x ${gx} m has no port within half a plate of ${deck.height} m`)
        continue
      }
      if (!courseTops.has(port.y[0]) || !courseTops.has(port.y[1])) issues.push(`${deck.deck} port at x ${gx} m does not span whole courses`)
      for (const side of [1, -1]) {
        const faceZ = side > 0 ? halfBeam - 1 : -halfBeam
        for (let y = port.y[0]; y < port.y[1]; y++) {
          for (let x = port.x[0]; x < port.x[1]; x++)
            for (let z = 0; z < halfBeam; z++) if (occupied.has(`${x},${y},${side > 0 ? z : -1 - z}`)) issues.push(`${deck.deck} port at x ${gx} m is blocked at ${x},${y}`)
          for (const x of [port.x[0] - 1, port.x[1]]) if (!occupied.has(`${x},${y},${faceZ}`) || occupied.has(`${x},${y},${faceZ + side}`)) issues.push(`hull face beside the ${deck.deck} port at x ${gx} m is not at the gun half-beam`)
        }
      }
    }
  }
  return [...new Set(issues)]
}
