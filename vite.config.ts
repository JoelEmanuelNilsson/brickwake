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
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        lab: fileURLToPath(new URL("lab.html", import.meta.url)),
        sound: fileURLToPath(new URL("sound.html", import.meta.url)),
      },
    },
  },
})
