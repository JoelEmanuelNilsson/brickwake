import { expect, test } from "bun:test"
import { dirname, relative, resolve } from "node:path"

type Layer = "sim" | "protocol" | "server" | "client"

const allowedLayers: Record<Layer, ReadonlyArray<Layer>> = {
  sim: [],
  protocol: ["sim"],
  server: ["sim", "protocol"],
  client: ["sim", "protocol"],
}

const bannedPackages: Record<Layer, ReadonlyArray<string>> = {
  sim: ["bun", "node:", "@effect/platform-bun", "three", "vite"],
  protocol: ["bun", "node:", "@effect/platform-bun", "three", "vite"],
  server: ["three", "vite"],
  client: ["bun", "node:", "@effect/platform-bun"],
}

const isBanned = (specifier: string, banned: string) =>
  banned.endsWith(":") ? specifier.startsWith(banned) : specifier === banned || specifier.startsWith(`${banned}/`)

const srcDir = resolve(import.meta.dir)
// Matches static, re-export, side-effect, type-only and dynamic imports.
const importSpecifier = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g

const isLayer = (name: string | undefined): name is Layer => name !== undefined && Object.hasOwn(allowedLayers, name)

const layerOf = (path: string): Layer | undefined => {
  const top = relative(srcDir, path).split("/")[0]
  return isLayer(top) ? top : undefined
}

const sources = async () => {
  const files: Array<{ path: string; layer: Layer; text: string }> = []
  for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: srcDir, absolute: true })) {
    const layer = layerOf(path)
    if (layer !== undefined) files.push({ path, layer, text: await Bun.file(path).text() })
  }
  return files
}

test("src layers import only what the architecture allows", async () => {
  const violations: Array<string> = []
  for (const { path, layer, text } of await sources()) {
    for (const [, specifier = ""] of text.matchAll(importSpecifier)) {
      const where = `${relative(srcDir, path)} imports "${specifier}"`
      if (specifier.startsWith(".")) {
        const target = layerOf(resolve(dirname(path), specifier))
        if (target === undefined) violations.push(`${where}: outside the four layers`)
        else if (target !== layer && !allowedLayers[layer].includes(target)) violations.push(`${where}: ${layer} may not import ${target}`)
      } else if (bannedPackages[layer].some((banned) => isBanned(specifier, banned))) {
        violations.push(`${where}: package banned in ${layer}`)
      }
    }
  }
  expect(violations).toEqual([])
})

test("sim stays deterministic", async () => {
  const violations = (await sources())
    .filter(({ layer, text }) => layer === "sim" && /\b(Date\.now|Math\.random|performance\.now)\b/.test(text))
    .map(({ path }) => relative(srcDir, path))
  expect(violations).toEqual([])
})
