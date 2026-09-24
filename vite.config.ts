import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const serverPort = Number(process.env.SERVER_PORT ?? 8787)

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true } },
  },
  build: {
    // One entry per page; the ship lab adds `lab: "lab.html"` here.
    rolldownOptions: {
      input: { main: fileURLToPath(new URL("index.html", import.meta.url)) },
    },
  },
})
