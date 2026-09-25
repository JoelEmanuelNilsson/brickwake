import type { WebGLRenderer } from "three"

const sampleCount = 120

/** Averages over the last few frames, in milliseconds; `gpuMs` is NaN where the browser hides GPU timers. */
export interface FrameAverages {
  readonly frames: number
  readonly cpuMs: number
  readonly gpuMs: number
  readonly intervalMs: number
}

/** Percentiles of every frame since `FrameStats.restart`, milliseconds: the frame's own CPU time and the interval between frames. */
export interface FrameSpread {
  readonly frames: number
  readonly cpu: { readonly p50: number; readonly p99: number; readonly max: number }
  readonly interval: { readonly p50: number; readonly p99: number; readonly max: number }
  /** Frames more than twice the median interval apart. */
  readonly hitches: number
}

const historyCount = 8192

/** Frame timing: CPU time of each frame, the interval between frames, and GPU time from timer queries when available. */
export class FrameStats {
  readonly #cpu = new Float64Array(sampleCount)
  readonly #interval = new Float64Array(sampleCount)
  readonly #gpu = new Float64Array(sampleCount)
  #frames = 0
  #gpuSamples = 0
  readonly #cpuHistory = new Float32Array(historyCount)
  readonly #intervalHistory = new Float32Array(historyCount)
  #history = 0
  readonly #gl: WebGL2RenderingContext
  readonly #timer: { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number } | null
  readonly #query: WebGLQuery | null
  #queryState: "idle" | "running" | "pending" = "idle"

  constructor(renderer: WebGLRenderer) {
    this.#gl = renderer.getContext() as WebGL2RenderingContext // three r186 only creates WebGL2 contexts.
    this.#timer = this.#gl.getExtension("EXT_disjoint_timer_query_webgl2")
    this.#query = this.#timer === null ? null : this.#gl.createQuery()
  }

  /** Starts timing the frame's GPU work, unless the previous measurement is still in flight. */
  beginGpu(): void {
    const gl = this.#gl
    if (this.#timer === null || this.#query === null) return
    if (this.#queryState === "pending" && gl.getQueryParameter(this.#query, gl.QUERY_RESULT_AVAILABLE) === true) {
      if (gl.getParameter(this.#timer.GPU_DISJOINT_EXT) !== true) {
        const nanoseconds: number = gl.getQueryParameter(this.#query, gl.QUERY_RESULT)
        this.#gpu[this.#gpuSamples % sampleCount] = nanoseconds / 1e6
        this.#gpuSamples++
      }
      this.#queryState = "idle"
    }
    if (this.#queryState !== "idle") return
    gl.beginQuery(this.#timer.TIME_ELAPSED_EXT, this.#query)
    this.#queryState = "running"
  }

  /** Ends the GPU timing begun this frame. */
  endGpu(): void {
    if (this.#timer === null || this.#queryState !== "running") return
    this.#gl.endQuery(this.#timer.TIME_ELAPSED_EXT)
    this.#queryState = "pending"
  }

  /** Records one frame's CPU time and the interval since the previous frame. */
  record(cpuMs: number, intervalMs: number): void {
    const slot = this.#frames % sampleCount
    this.#cpu[slot] = cpuMs
    this.#interval[slot] = intervalMs
    this.#frames++
    if (this.#history < historyCount && intervalMs > 0) {
      this.#cpuHistory[this.#history] = cpuMs
      this.#intervalHistory[this.#history] = intervalMs
      this.#history++
    }
  }

  /** Forget the frames recorded so far; `spread` covers the frames from here on (up to 8192). */
  restart(): void {
    this.#history = 0
  }

  /** Percentiles of the frames since `restart`. */
  spread(): FrameSpread {
    const n = this.#history
    const cpu = this.#cpuHistory.slice(0, n).sort()
    const interval = this.#intervalHistory.slice(0, n).sort()
    const at = (values: Float32Array, q: number) => values[Math.min(n - 1, Math.floor(n * q))] ?? Number.NaN
    const median = at(interval, 0.5)
    let hitches = 0
    for (let i = 0; i < n; i++) if ((interval[i] ?? 0) > 2 * median) hitches++
    return {
      frames: n,
      cpu: { p50: at(cpu, 0.5), p99: at(cpu, 0.99), max: cpu[n - 1] ?? Number.NaN },
      interval: { p50: median, p99: at(interval, 0.99), max: interval[n - 1] ?? Number.NaN },
      hitches,
    }
  }

  /** Averages over the last 120 frames. */
  averages(): FrameAverages {
    const mean = (values: Float64Array, count: number) => {
      const n = Math.min(count, sampleCount)
      if (n === 0) return Number.NaN
      let sum = 0
      for (let i = 0; i < n; i++) sum += values[i] ?? 0
      return sum / n
    }
    return { frames: this.#frames, cpuMs: mean(this.#cpu, this.#frames), gpuMs: mean(this.#gpu, this.#gpuSamples), intervalMs: mean(this.#interval, this.#frames) }
  }
}
