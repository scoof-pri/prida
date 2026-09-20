// Picture settings: a colour-grading shader applied to the final frame (world and first-person weapon).
// Values are in display space; the defaults leave the image unchanged.
import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const GRADE_FIELDS = [
  // key, label, min, max, step, default
  ['exposure', 'Exposure', 0.5, 1.8, 0.01, 1.1],
  ['brightness', 'Brightness', -0.25, 0.25, 0.005, 0],
  ['contrast', 'Contrast', 0.6, 1.6, 0.01, 1],
  ['saturation', 'Saturation', 0, 2, 0.01, 1],
  ['vibrance', 'Vibrance', -1, 1, 0.01, 0],
  ['gamma', 'Gamma', 0.6, 1.6, 0.01, 1],
  ['warmth', 'Warmth', -1, 1, 0.01, 0],
  ['tint', 'Tint (green ↔ magenta)', -1, 1, 0.01, 0],
  ['vignette', 'Vignette', 0, 1, 0.01, 0],
  ['sharpness', 'Sharpness', 0, 1.5, 0.01, 0],
  ['grain', 'Film grain', 0, 0.2, 0.005, 0],
  ['bloom', 'Bloom (Quality mode)', 0, 1.2, 0.01, 0.22],
];
export const DEFAULT_GRADE = Object.fromEntries(GRADE_FIELDS.map((f) => [f[0], f[5]]));
export const GRADE_PRESETS = {
  standard: {},
  vivid: { contrast: 1.12, saturation: 1.3, vibrance: 0.35, sharpness: 0.35, bloom: 0.3 },
  cinematic: { contrast: 1.18, saturation: 0.85, warmth: 0.25, vignette: 0.45, grain: 0.04, exposure: 1.0 },
  warm: { warmth: 0.55, saturation: 1.1, brightness: 0.02 },
  cold: { warmth: -0.5, tint: -0.1, contrast: 1.08, saturation: 0.9 },
  noir: { saturation: 0, contrast: 1.35, vignette: 0.55, grain: 0.07, gamma: 1.05 },
  retro: { saturation: 0.75, warmth: 0.35, tint: 0.15, contrast: 0.9, grain: 0.1, vignette: 0.35 },
  bright: { exposure: 1.35, brightness: 0.04, gamma: 1.12 },
};
// What a new player starts with (the Reset button returns to it); STANDARD is the untouched image.
export const DEFAULT_PRESET = 'cinematic';
export const startingGrade = () => sanitizeGrade({ ...DEFAULT_GRADE, ...GRADE_PRESETS[DEFAULT_PRESET] });
export function sanitizeGrade(g) {
  const out = { ...DEFAULT_GRADE };
  for (const [key, , min, max] of GRADE_FIELDS) {
    const v = Number(g?.[key]);
    if (Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v));
  }
  return out;
}
export const isNeutral = (g) =>
  GRADE_FIELDS.every(([key, , , , , def]) => key === 'exposure' || key === 'bloom' || Math.abs(g[key] - def) < 1e-6);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    texel: { value: new T.Vector2(1 / 1024, 1 / 1024) },
    time: { value: 0 },
    brightness: { value: 0 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    vibrance: { value: 0 },
    gamma: { value: 1 },
    warmth: { value: 0 },
    tint: { value: 0 },
    vignette: { value: 0 },
    sharpness: { value: 0 },
    grain: { value: 0 },
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform vec2 texel;uniform float time;
    uniform float brightness,contrast,saturation,vibrance,gamma,warmth,tint,vignette,sharpness,grain;
    varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      if(sharpness>0.0){
        vec3 n=texture2D(tDiffuse,vUv+vec2(texel.x,0.0)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.0)).rgb
          +texture2D(tDiffuse,vUv+vec2(0.0,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.0,texel.y)).rgb;
        c+=(c-n*0.25)*sharpness;
      }
      c+=brightness;
      c=(c-0.5)*contrast+0.5;
      float l=dot(c,vec3(0.2126,0.7152,0.0722));
      c=mix(vec3(l),c,saturation);
      float spread=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
      c=mix(vec3(l),c,1.0+vibrance*(1.0-clamp(spread*2.0,0.0,1.0)));
      c+=vec3(warmth*0.07,-tint*0.05,-warmth*0.07)+vec3(tint*0.025,0.0,tint*0.025);
      c=pow(max(c,vec3(0.0)),vec3(1.0/gamma));
      float d=distance(vUv,vec2(0.5));
      c*=1.0-vignette*smoothstep(0.3,0.85,d);
      if(grain>0.0)c+=(hash(vUv*vec2(1731.0,977.0)+time)-0.5)*grain;
      gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
    }`,
};

// Final pass: grades whatever the passes before produced and writes it to the screen.
export class GradePass extends Pass {
  constructor() {
    super();
    this.material = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.clone(GradeShader.uniforms),
      vertexShader: GradeShader.vertexShader,
      fragmentShader: GradeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  set(grade) {
    for (const key of Object.keys(DEFAULT_GRADE)) if (this.material.uniforms[key]) this.material.uniforms[key].value = grade[key];
  }
  setSize(w, h) {
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.time.value = (performance.now() / 1000) % 100;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

// Draws the first-person weapon over the world inside the composer, so it is graded too.
export class WeaponPass extends Pass {
  // `view` supplies weaponScene / weaponCamera (created after the first quality setup).
  constructor(view) {
    super();
    this.view = view;
    this.needsSwap = false;
    this.enabled = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    if (this.view.weaponScene) renderer.render(this.view.weaponScene, this.view.weaponCamera);
    renderer.autoClear = auto;
  }
}
