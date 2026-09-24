import { REVISION, WebGLRenderer } from "three"

const canvas = document.querySelector<HTMLCanvasElement>("#scene")
const status = document.querySelector<HTMLElement>("#status")
if (canvas === null || status === null) throw new Error("index.html is missing #scene or #status")

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setClearColor(0x0b1d24)

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.clear()
}
window.addEventListener("resize", resize)
resize()

const showSocket = (state: "connecting" | "hello" | "closed") => {
  status.dataset.ws = state
  status.textContent = `three r${REVISION} · ws ${state}`
}

showSocket("connecting")
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
socket.addEventListener("message", (event) => {
  if (event.data === "hello") showSocket("hello")
})
socket.addEventListener("close", () => showSocket("closed"))
