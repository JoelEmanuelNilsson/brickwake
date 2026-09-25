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

/** The name a ship goes by on the HUD: quick-play ships in join order, others by a stable hash of the id. */
export const shipName = (id: string): string => {
  const joined = /^ship-(\d+)$/.exec(id)?.[1]
  let index = joined === undefined ? 0 : Number(joined) - 1
  if (joined === undefined) for (let i = 0; i < id.length; i++) index = (index * 31 + id.charCodeAt(i)) >>> 0
  return names[index % names.length]!
}
