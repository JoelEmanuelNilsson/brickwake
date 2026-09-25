import { DepthTexture, HalfFloatType, NoBlending, type PerspectiveCamera, type Scene, ShaderMaterial, type Texture, Vector2, WebGLRenderTarget, type WebGLRenderer } from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { glowLayer, particleLayer, particleScene } from "./particles.ts"

/** Bloom: strength, radius and the HDR threshold above which things glow (lanterns, flashes, sun glint). */
const bloomSettings = { strength: 0.28, radius: 0.45, threshold: 2.0 } as const

/** Scene colour under half-resolution particles, which hold premultiplied colour and coverage. */
const compositeMaterial = () =>
  new ShaderMaterial({
    uniforms: { scene: { value: null as Texture | null }, particles: { value: null as Texture | null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D scene;
      uniform sampler2D particles;
      varying vec2 vUv;
      void main() {
        vec4 over = texture2D(particles, vUv);
        gl_FragColor = vec4(texture2D(scene, vUv).rgb * (1.0 - over.a) + over.rgb, 1.0);
      }
    `,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  })

/**
 * The frame: the scene into an antialiased HDR target whose depth is kept; smoke and spray at half resolution (their
 * overdraw is the costliest thing on screen) tested against that depth by hand (soft particles) and laid over it; fire
 * and sparks at full resolution; bloom; then ACES tone mapping to the screen.
 */
export class RenderPipeline {
  readonly #renderer: WebGLRenderer
  readonly #scene: Scene
  readonly #sceneTarget: WebGLRenderTarget
  readonly #postTarget: WebGLRenderTarget
  readonly #particleTarget: WebGLRenderTarget
  readonly #composite = new FullScreenQuad(compositeMaterial())
  readonly #bloom: UnrealBloomPass
  readonly #output = new OutputPass()
  /** Whether bloom runs; off only to measure its cost. */
  bloom = true

  /** `samples` is the MSAA sample count of the scene target (0 for none). */
  constructor(renderer: WebGLRenderer, scene: Scene, samples: number) {
    this.#renderer = renderer
    this.#scene = scene
    this.#sceneTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples, depthTexture: new DepthTexture(1, 1) })
    this.#postTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
    this.#particleTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
    this.#bloom = new UnrealBloomPass(new Vector2(1, 1), bloomSettings.strength, bloomSettings.radius, bloomSettings.threshold)
    this.#output.renderToScreen = true
    particleScene.depth.value = this.#sceneTarget.depthTexture
  }

  /** Size every target to the drawing buffer, in physical pixels. */
  setSize(width: number, height: number): void {
    this.#sceneTarget.setSize(width, height)
    this.#postTarget.setSize(width, height)
    this.#particleTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2))
    this.#bloom.setSize(width, height)
    this.#output.setSize(width, height)
  }

  render(camera: PerspectiveCamera): void {
    const renderer = this.#renderer
    camera.layers.set(0)
    renderer.setRenderTarget(this.#sceneTarget)
    renderer.render(this.#scene, camera)

    const autoClear = renderer.autoClear
    const shadows = renderer.shadowMap.autoUpdate
    const clearAlpha = renderer.getClearAlpha()
    renderer.autoClear = false
    renderer.shadowMap.autoUpdate = false
    particleScene.nearFar.value.set(camera.near, camera.far)
    particleScene.depthScale.value = 2
    renderer.setRenderTarget(this.#particleTarget)
    renderer.setClearAlpha(0)
    renderer.clear(true, false, false)
    renderer.setClearAlpha(clearAlpha)
    camera.layers.set(particleLayer)
    renderer.render(this.#scene, camera)

    renderer.setRenderTarget(this.#postTarget)
    const composite = this.#composite.material
    if (composite instanceof ShaderMaterial) {
      const uniforms = composite.uniforms
      if (uniforms.scene !== undefined) uniforms.scene.value = this.#sceneTarget.texture
      if (uniforms.particles !== undefined) uniforms.particles.value = this.#particleTarget.texture
    }
    this.#composite.render(renderer)
    particleScene.depthScale.value = 1
    camera.layers.set(glowLayer)
    renderer.render(this.#scene, camera)
    renderer.autoClear = autoClear
    renderer.shadowMap.autoUpdate = shadows
    camera.layers.set(0)

    if (this.bloom) this.#bloom.render(renderer, this.#postTarget, this.#postTarget, 0, false)
    this.#output.render(renderer, this.#postTarget, this.#postTarget, 0, false)
  }
}
