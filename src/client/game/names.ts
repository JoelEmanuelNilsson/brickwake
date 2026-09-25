import { ffaColors, ffaLivery, navyFleurLivery, navyLionLivery, pirateLivery, type SailLivery } from "../rig/sail-livery.ts"

const names = [
  "Black Gull",
  "Salt Widow",
  "Crimson Rook",
  "Storm Petrel",
  "Iron Kestrel",
  "Grey Maiden",
  "Gilded Eel",
  "Night Heron",
  "Brass Serpent",
  "Red Lantern",
  "Sea Wolf",
  "Drowned Crown",
  "Tar Jackdaw",
  "Ember Wake",
  "Hollow Bell",
  "Silver Mako",
] as const

const hash = (id: string) => {
  let index = 0
  for (let i = 0; i < id.length; i++) index = (index * 31 + id.charCodeAt(i)) >>> 0
  return index
}

/** The name a ship goes by on the HUD: quick-play captains in join order, bots from the end of the list, others by a stable hash of the id. */
export const shipName = (id: string): string => {
  const bot = /^bot-(\d+)$/.exec(id)?.[1]
  if (bot !== undefined) return names[(names.length - (Number(bot) % names.length)) % names.length]!
  const joined = /^ship-(\d+)$/.exec(id)?.[1]
  return names[(joined === undefined ? hash(id) : Number(joined) - 1) % names.length]!
}

const colours = ffaColors.length

/**
 * The sails a ship flies. TDM: pirates the black skull, navy the lion or the fleur-de-lis by id. FFA: captains take colours
 * in join order and bots from the end of the palette, so up to 12 ships differ; scenario ships fly the pirate black.
 */
export const shipLivery = (id: string, team: "pirates" | "navy" | null): SailLivery => {
  if (team === "pirates") return pirateLivery
  if (team === "navy") return hash(id) % 2 === 0 ? navyLionLivery : navyFleurLivery
  const joined = /^ship-(\d+)$/.exec(id)?.[1]
  const bot = /^bot-(\d+)$/.exec(id)?.[1]
  const slot = joined !== undefined ? (Number(joined) - 1) % colours : bot !== undefined ? colours - 1 - ((Number(bot) - 1) % colours) : -1
  return slot < 0 ? pirateLivery : ffaLivery(ffaColors[slot]!)
}
