import { type GeneratedShip, gridMetres, gunPortCells } from "./generate.ts"
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

  const gunPart = spec.gun.parts[0]?.part
  // The port through the wall (shell and tumblehome prop) must be clear of everything but its own gun.
  const occupied = new Set(parts.flatMap((p) => (p.part === gunPart ? [] : occupiedCells(p))).map((c) => c.join(",")))
  const courseTops = new Set(spec.courses.reduce<Array<number>>((tops, c) => [...tops, (tops[tops.length - 1] ?? 0) + (c === "brick" ? 3 : 1)], [0]))
  for (const deck of spec.guns.decks) {
    const halfBeam = Math.round(deck.halfBeam / gridMetres.stud)
    for (const gx of deck.xs) {
      const cells = gunPortCells(spec, deck.height, gx)
      const port = ship.ports.find((p) => p.x[0] === cells.x[0] && p.y[0] === cells.y[0])
      if (Math.abs(gx / gridMetres.stud - Math.round(gx / gridMetres.stud)) > 1e-6) issues.push(`${deck.deck} gun at x ${gx} m is not on a stud boundary`)
      if (port === undefined) {
        issues.push(`${deck.deck} gun at x ${gx} m has no port`)
        continue
      }
      if (!courseTops.has(port.y[0]) || !courseTops.has(port.y[1])) issues.push(`${deck.deck} port at x ${gx} m does not span whole courses`)
      const barrelRow = Math.floor(spec.waterline + deck.height / gridMetres.plate)
      for (const side of [1, -1]) {
        const cell = (x: number, y: number, z: number) => `${x},${y},${side > 0 ? z : -1 - z}`
        for (let y = port.y[0]; y < port.y[1]; y++)
          for (let x = port.x[0]; x < port.x[1]; x++)
            for (let z = halfBeam - spec.shell - 1; z < halfBeam; z++) if (occupied.has(cell(x, y, z))) issues.push(`${deck.deck} port at x ${gx} m is blocked at ${x},${y}`)
        // The frame is flush: beside the port at the barrel's row the hull face is at the gun half-beam, nothing proud of it.
        for (const x of [port.x[0] - 1, port.x[1]])
          if (!occupied.has(cell(x, barrelRow, halfBeam - 1)) || occupied.has(cell(x, barrelRow, halfBeam))) issues.push(`hull face beside the ${deck.deck} port at x ${gx} m is not at the gun half-beam`)
        const gunCell = cell(port.x[0] + spec.port.width / 2, port.y[0], halfBeam - spec.gunInboard + 1)
        const armed = parts.some((p) => p.part === gunPart && occupiedCells(p).some((c) => c.join(",") === gunCell))
        if (!armed) issues.push(`${deck.deck} port at x ${gx} m on the ${side > 0 ? "starboard" : "port"} side has no ${spec.gun.name}`)
      }
    }
  }
  return [...new Set(issues)]
}
