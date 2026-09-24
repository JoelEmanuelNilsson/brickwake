import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from "three"

/** A sunset sky dome with sun glow and procedural clouds, in linear HDR; the lab's stand-in until C5's sky. */
export const createSunsetSky = (sunDirection: Vector3): Mesh => {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDirection: { value: sunDirection.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDirection;
      varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDirection);
        float h = max(d.y, 0.0);
        float s = max(dot(d, sunDirection), 0.0);
        vec3 horizon = vec3(1.5, 0.56, 0.2);
        vec3 low = vec3(0.62, 0.24, 0.11);
        vec3 zenith = vec3(0.07, 0.1, 0.15);
        vec3 color = mix(horizon, low, smoothstep(0.0, 0.12, h));
        color = mix(color, zenith, smoothstep(0.1, 0.75, h));
        color += vec3(1.8, 0.75, 0.25) * (pow(s, 5.0) * 0.8 + pow(s, 60.0) * 3.0);
        color += vec3(12.0, 9.0, 6.0) * smoothstep(0.99955, 0.9998, s);
        vec2 uv = d.xz / (h + 0.06) * 0.9;
        float n = fbm(uv + vec2(3.1, 7.4));
        float cloud = smoothstep(0.48, 0.78, n) * smoothstep(0.01, 0.1, h);
        vec3 lit = mix(vec3(0.16, 0.07, 0.06), vec3(2.6, 1.05, 0.35), clamp(pow(s, 4.0) + (n - 0.5) * 0.9, 0.0, 1.0));
        color = mix(color, lit, cloud * 0.9);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(3000, 48, 24), material)
  sky.name = "sunset sky"
  sky.frustumCulled = false
  return sky
}
