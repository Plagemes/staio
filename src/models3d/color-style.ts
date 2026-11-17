/**
 * Stile a colori: superfici piene nel colore dell'alimento, ombreggiatura morbida a tre toni, luce d'ambiente emisferica
 * più una luce chiave, un bordo di luce leggero e un'ombra di contatto sfumata. Un solo shader, una sola mesh per parte:
 * nessun post-processing, nessuna texture. Fondo trasparente (la scheda dell'interfaccia dà lo sfondo).
 *
 * I valori che cambiano col tema (chiaro/scuro, colore del segnale) stanno in uniform condivise: cambiarli non ricrea nulla.
 */
import {
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import type { Model } from "./generate";
import type { InkColors } from "./materials";
import type { ModelObject } from "./three-model";

export interface ColorTheme {
  dark: boolean;
  colors: InkColors;
}

export interface ColorShared {
  /** Direzione verso la luce chiave, nello spazio della camera: la luce non gira col modello. */
  uKey: { value: Vector3 };
  /** Colore dell'ombra come moltiplicatore del colore di base: più scuro, un poco freddo. */
  uShadowTint: { value: Vector3 };
  uExposure: { value: number };
  /** Attenuazione dei mobili: nel tema scuro restano chiari ma non abbagliano. */
  uFurnitureDim: { value: number };
  uShadowOpacity: { value: number };
  uInk: { value: Color };
  uSignal: { value: Color };
}

export function createColorShared(theme: ColorTheme): ColorShared {
  const shared: ColorShared = {
    uKey: { value: new Vector3(-0.5, 0.68, 0.55).normalize() },
    uShadowTint: { value: new Vector3() },
    uExposure: { value: 1 },
    uFurnitureDim: { value: 1 },
    uShadowOpacity: { value: 0.22 },
    uInk: { value: new Color() },
    uSignal: { value: new Color() },
  };
  applyColorTheme(shared, theme);
  return shared;
}

export function applyColorTheme(shared: ColorShared, theme: ColorTheme): void {
  if (theme.dark) {
    shared.uShadowTint.value.set(0.44, 0.43, 0.58);
    shared.uExposure.value = 0.93;
    shared.uFurnitureDim.value = 0.34;
    shared.uShadowOpacity.value = 0.4;
  } else {
    shared.uShadowTint.value.set(0.52, 0.5, 0.64);
    shared.uExposure.value = 1;
    shared.uFurnitureDim.value = 1;
    shared.uShadowOpacity.value = 0.22;
  }
  shared.uInk.value.set(theme.colors.ink);
  shared.uSignal.value.set(theme.colors.signal);
}

// Il colore di uscita va convertito a mano: ShaderMaterial non applica lo spazio colore da solo. #include su una riga propria.
const OUTPUT = "\n#include <colorspace_fragment>\n";

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uKey; uniform vec3 uShadowTint;
uniform float uExposure; uniform float uDim; uniform float uGloss; uniform float uRim;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vV);
  vec3 base = uColor * uDim;
  // tre toni con passaggi morbidi: ombra, tono pieno, luce
  float h = dot(n, uKey) * 0.5 + 0.5;
  float toMid = smoothstep(0.30, 0.50, h);
  float toLight = smoothstep(0.66, 0.84, h);
  vec3 c = mix(base * uShadowTint, base, toMid);
  c = mix(c, mix(base, vec3(1.0), 0.14), toLight);
  // luce d'ambiente emisferica: un poco più chiaro verso l'alto
  c *= 0.94 + 0.10 * n.y;
  // bordo di luce leggero sul contorno
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0) * uRim * (0.55 + 0.45 * h);
  c = mix(c, mix(base, vec3(1.0), 0.65), rim);
  // riflesso piccolo e morbido, solo dove la superficie è lucida
  float sp = pow(max(dot(n, normalize(uKey + v)), 0.0), 36.0);
  c += vec3(1.0) * smoothstep(0.45, 0.62, sp) * uGloss;
  gl_FragColor = vec4(c * uExposure, 1.0);
  ${OUTPUT}
}`;

/** Quanto è lucida una parte: i frutti e le confezioni sì, foglie, steli ed etichette no. */
function glossOf(role: string): number {
  return role === "body" || role === "cap" || role === "rind" ? 0.16 : 0;
}

export interface ColorPartOptions {
  color: string;
  role: string;
  doubleSided: boolean;
  furniture: boolean;
}

export function createColorMaterial(shared: ColorShared, opts: ColorPartOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(opts.color) },
      uKey: shared.uKey,
      uShadowTint: shared.uShadowTint,
      uExposure: shared.uExposure,
      uDim: opts.furniture ? shared.uFurnitureDim : { value: 1 },
      uGloss: { value: opts.furniture ? 0.05 : glossOf(opts.role) },
      uRim: { value: opts.furniture ? 0.12 : 0.32 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: opts.doubleSided ? DoubleSide : FrontSide,
  });
}

/** Contorno a guscio rovesciato nel colore del segnale: solo per ciò che scade, insieme al segnale a forma di punto esclamativo. */
function createSignalOutline(shared: ColorShared, width: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uSignal: shared.uSignal, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      uniform float uWidth; attribute vec3 aOutline;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aOutline * uWidth, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSignal;
      void main(){ gl_FragColor = vec4(uSignal, 1.0); ${OUTPUT} }`,
    side: BackSide,
  });
}

/** Tinta unita sopra a tutto: il segnale di scadenza non deve sparire dietro un ripiano. */
function createMarkMaterial(shared: ColorShared | null, halo: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uSignal: shared ? shared.uSignal : { value: new Color("#ffffff") } },
    vertexShader: /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSignal;
      void main(){ gl_FragColor = vec4(${halo ? "1.0, 1.0, 1.0" : "uSignal"}, 1.0); ${OUTPUT} }`,
    depthTest: false,
    depthWrite: false,
    // nella lista trasparente passa dopo l'ombra a terra, che altrimenti potrebbe velarlo
    transparent: true,
  });
}

/**
 * Punto esclamativo sopra il modello (barra che si assottiglia e punto), con un alone bianco: dice «scade» con la forma,
 * non solo col colore. Misure in unità del modello (altezza 1).
 */
function buildAlertMark(model: Model, shared: ColorShared, geometries: BufferGeometry[], materials: Material[]): Group {
  const s = Math.max(1, model.refSize) * 0.14;
  const group = new Group();
  group.name = "alert-mark";
  const fill = createMarkMaterial(shared, false);
  const halo = createMarkMaterial(null, true);
  materials.push(fill, halo);
  for (const [material, grow, order] of [[halo, 1.45, 19], [fill, 1, 20]] as const) {
    const bar = new CylinderGeometry(0.34 * s * grow, 0.2 * s * grow, 1.15 * s * grow, 14);
    const dot = new SphereGeometry(0.26 * s * grow, 14, 10);
    geometries.push(bar, dot);
    const barMesh = new Mesh(bar, material);
    barMesh.position.y = 0.95 * s;
    const dotMesh = new Mesh(dot, material);
    dotMesh.position.y = -0.25 * s;
    barMesh.renderOrder = dotMesh.renderOrder = order;
    group.add(barMesh, dotMesh);
  }
  group.position.set(0, model.bounds.max[1] + 0.62 * s, 0);
  return group;
}

export interface ColorObjectOptions {
  /** Scade presto: contorno e punto esclamativo nel colore del segnale. */
  signal?: boolean;
  /** Mobile: tinte più basse nel tema scuro. */
  furniture?: boolean;
}

export function createColorModelObject(model: Model, shared: ColorShared, opts: ColorObjectOptions = {}): ModelObject {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  for (const part of model.parts) {
    const holder = new Group();
    holder.name = part.name;
    holder.position.fromArray(part.transform.position);
    holder.rotation.set(...part.transform.rotation);
    holder.scale.setScalar(part.transform.scale);

    const body = createColorMaterial(shared, { color: part.color, role: part.role, doubleSided: part.doubleSided, furniture: opts.furniture === true });
    materials.push(body);
    holder.add(new Mesh(part.geometry, body));

    if (opts.signal && !part.doubleSided) {
      // la larghezza è nello spazio locale della parte, che ha una sua scala
      const outline = createSignalOutline(shared, Math.max(part.outline, 0.022 * model.refSize) / part.transform.scale);
      materials.push(outline);
      holder.add(new Mesh(part.geometry, outline));
    }
    group.add(holder);
  }
  if (opts.signal) group.add(buildAlertMark(model, shared, geometries, materials));

  const disposeMaterials = () => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  };
  return {
    group,
    disposeMaterials,
    dispose() {
      for (const part of model.parts) {
        part.geometry.dispose();
        part.lines?.dispose();
      }
      disposeMaterials();
    },
  };
}

/** Ombra di contatto: un velo scuro che sfuma dal centro verso il bordo, su un piano quadrato di lato `size` a y = 0. */
export function createContactShadow(shared: ColorShared, size: number): Mesh {
  const material = new ShaderMaterial({
    uniforms: { uOpacity: shared.uShadowOpacity },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying vec2 vUv;
      void main(){
        float r = length((vUv - 0.5) * 2.0);
        float a = pow(1.0 - smoothstep(0.05, 0.85, r), 1.6);
        gl_FragColor = vec4(vec3(0.04, 0.03, 0.08), a * uOpacity);
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

/** Linea sottile nel colore dell'inchiostro (anello di selezione). */
export function createInkLineMaterial(shared: ColorShared): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uInk: shared.uInk },
    vertexShader: /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main(){ gl_FragColor = vec4(uInk, 1.0); ${OUTPUT} }`,
  });
}
