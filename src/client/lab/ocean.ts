import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, RGBAFormat, Vector2 } from "three"

/** A flat sea with a tiling wave normal map; the lab's stand-in until the Gerstner ocean from C1 merges. */
export const createOceanStandIn = (): Mesh => {
  const size = 256
  const waves = Array.from({ length: 24 }, (_, i) => {
    const angle = i * 2.399963
    const frequency = 2 + (i % 7) * 1.3 + i * 0.35
    return { kx: Math.round(Math.cos(angle) * frequency), ky: Math.round(Math.sin(angle) * frequency), amplitude: 1 / (1 + frequency), phase: i * 1.7 }
  })
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0
      let dy = 0
      for (const w of waves) {
        const t = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase
        const slope = Math.cos(t) * w.amplitude
        dx += slope * w.kx
        dy += slope * w.ky
      }
      const scale = 0.08
      const nx = -dx * scale
      const ny = -dy * scale
      const length = Math.hypot(nx, ny, 1)
      const o = (y * size + x) * 4
      data[o] = ((nx / length) * 0.5 + 0.5) * 255
      data[o + 1] = ((ny / length) * 0.5 + 0.5) * 255
      data[o + 2] = ((1 / length) * 0.5 + 0.5) * 255
      data[o + 3] = 255
    }
  }
  const normalMap = new DataTexture(data, size, size, RGBAFormat)
  normalMap.wrapS = RepeatWrapping
  normalMap.wrapT = RepeatWrapping
  normalMap.repeat.set(220, 220)
  normalMap.magFilter = LinearFilter
  normalMap.minFilter = LinearMipmapLinearFilter
  normalMap.generateMipmaps = true
  normalMap.anisotropy = 8
  normalMap.needsUpdate = true

  const material = new MeshStandardMaterial({ color: 0x0f4a52, roughness: 0.16, metalness: 0, envMapIntensity: 0.2, normalMap, normalScale: new Vector2(0.55, 0.55) })
  const ocean = new Mesh(new PlaneGeometry(2400, 2400), material)
  ocean.rotation.x = -Math.PI / 2
  ocean.receiveShadow = true
  ocean.name = "ocean stand-in"
  return ocean
}
