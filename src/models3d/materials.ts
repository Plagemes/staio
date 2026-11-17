/**
 * Materiali a incisione portati dalla prova approvata (three r128) a three 0.187.
 * I colori stanno in uniform condivise: cambiare tema = aggiornare tre valori.
 */
import { BackSide, Color, DoubleSide, FrontSide, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from "three";

export interface InkColors {
  ink: string;
  paper: string;
  signal: string;
}

/** Valori di ripiego, uguali a quelli del tema chiaro della prova. */
export const FALLBACK_COLORS: InkColors = { ink: "#14171A", paper: "#F6F5F1", signal: "#A8321C" };

export interface SharedUniforms {
  uInk: { value: Color };
  uPaper: { value: Color };
  uSignal: { value: Color };
  uLight: { value: Vector3 };
  uDensity: { value: number };
}

export function createSharedUniforms(colors: Partial<InkColors> = {}): SharedUniforms {
  const shared: SharedUniforms = {
    uInk: { value: new Color() },
    uPaper: { value: new Color() },
    uSignal: { value: new Color() },
    uLight: { value: new Vector3(-0.55, 0.65, 0.55).normalize() },
    uDensity: { value: 1 },
  };
  applyColors(shared, { ...FALLBACK_COLORS, ...colors });
  return shared;
}

/** Aggiorna i colori condivisi; tutti i materiali che li usano cambiano subito. */
export function applyColors(shared: SharedUniforms, colors: Partial<InkColors>): void {
  if (colors.ink) shared.uInk.value.set(colors.ink);
  if (colors.paper) shared.uPaper.value.set(colors.paper);
  if (colors.signal) shared.uSignal.value.set(colors.signal);
}

// In WebGL2 fwidth è disponibile senza estensioni (in r128 serviva `extensions.derivatives`).
// Il colore di uscita va convertito a mano con colorspace_fragment: ShaderMaterial non lo fa da solo.
// La direttiva #include deve stare su una riga propria.
const OUTPUT = "\n#include <colorspace_fragment>\n";

const HATCH = /* glsl */ `
float hatch(float coord, float w){
  float d = fwidth(coord);
  float dist = abs(fract(coord) - 0.5);
  float a = 1.0 - smoothstep(w * 0.5 - d, w * 0.5 + d, dist);
  a = mix(a, w, smoothstep(0.35, 0.7, d));
  return a * smoothstep(0.0, 0.04, w);
}`;

const ENGRAVE_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ENGRAVE_FRAG = /* glsl */ `
uniform vec3 uInk; uniform vec3 uPaper; uniform vec3 uLight;
uniform float uDensity; uniform float uCross; uniform vec2 uScale;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
${HATCH}
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float lum = clamp(dot(n, uLight) * 0.6 + 0.45, 0.0, 1.0);
  float fres = 1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float tone = clamp(1.0 - lum + pow(fres, 3.0) * 0.35, 0.0, 1.0);
  float w1 = smoothstep(0.12, 0.85, tone) * 0.78;
  float w2 = smoothstep(0.5, 1.0, tone) * 0.6 * uCross;
  float a = hatch(vUv.y * uScale.y * uDensity, w1);
  float b = hatch((vUv.x * uScale.x + vUv.y * uScale.y * 0.35) * uDensity, w2);
  gl_FragColor = vec4(mix(uPaper, uInk, max(a, b)), 1.0);
  ${OUTPUT}
}`;

export interface EngravingOptions {
  /** Tratti per unità UV [u, v], da `ModelPart.strokeScale`. */
  strokeScale: readonly [number, number];
  /** Disegna nel colore segnale invece che nell'inchiostro. */
  signal?: boolean;
  doubleSided?: boolean;
  /** Secondo tratteggio incrociato nelle zone scure. Predefinito true. */
  cross?: boolean;
}

export function createEngravingMaterial(shared: SharedUniforms, opts: EngravingOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uInk: opts.signal ? shared.uSignal : shared.uInk,
      uPaper: shared.uPaper,
      uLight: shared.uLight,
      uDensity: shared.uDensity,
      uCross: { value: opts.cross === false ? 0 : 1 },
      uScale: { value: new Vector2(opts.strokeScale[0], opts.strokeScale[1]) },
    },
    vertexShader: ENGRAVE_VERT,
    fragmentShader: ENGRAVE_FRAG,
    side: opts.doubleSided ? DoubleSide : FrontSide,
    // spinge il riempimento un poco indietro, così i tratti espliciti sulla superficie vincono sempre
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Contorno a guscio rovesciato: la geometria gonfiata lungo `aOutline` e disegnata di dietro. */
export function createOutlineMaterial(shared: SharedUniforms, width: number, signal = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uInk: signal ? shared.uSignal : shared.uInk, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      uniform float uWidth; attribute vec3 aOutline;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aOutline * uWidth, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main(){ gl_FragColor = vec4(uInk, 1.0); ${OUTPUT} }`,
    side: BackSide,
  });
}

/** Tratto sottile per spigoli e linee esplicite (LineSegments). */
export function createLineMaterial(shared: SharedUniforms, signal = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uInk: signal ? shared.uSignal : shared.uInk },
    vertexShader: /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main(){ gl_FragColor = vec4(uInk, 1.0); ${OUTPUT} }`,
  });
}

/** Ombra a terra tratteggiata: un piano quadrato di lato `size` centrato nell'origine, a y = 0. */
export function createGroundShadow(shared: SharedUniforms, size: number): Mesh {
  const material = new ShaderMaterial({
    uniforms: { uInk: shared.uInk, uDensity: shared.uDensity },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk; uniform float uDensity; varying vec2 vUv;
      ${HATCH}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float w = (1.0 - smoothstep(0.1, 0.62, length(p))) * 0.5;
        gl_FragColor = vec4(uInk, hatch((vUv.x + vUv.y) * 46.0 * uDensity * ${size.toFixed(3)} / 3.8, w));
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}
