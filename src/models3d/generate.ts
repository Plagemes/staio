/**
 * Generatore procedurale: `buildModel(ricetta, seme)` produce le parti del modello senza WebGL.
 * Il modello è normalizzato: altezza 1, base su y = 0, centrato su x e z.
 */
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from "three";
import { buildBag } from "./archetypes/bag";
import { buildBox } from "./archetypes/box";
import { buildCluster } from "./archetypes/cluster";
import { buildElongated } from "./archetypes/elongated";
import { buildLeaf } from "./archetypes/leaf";
import { buildLathe } from "./archetypes/lathe";
import { buildWedge } from "./archetypes/wedge";
import type { BuildContext, PartRole, RawPart } from "./archetypes/types";
import { smoothByPosition } from "./geometry";
import { parseRecipe, type Recipe } from "./recipe";
import { createRng } from "./rng";

export type { PartRole } from "./archetypes/types";

export interface PartTransform {
  position: [number, number, number];
  /** Angoli di Eulero XYZ in radianti. */
  rotation: [number, number, number];
  /** Scala uniforme. */
  scale: number;
}

export interface ModelPart {
  name: string;
  role: PartRole;
  /** Attributi: position, normal, uv, aOutline (direzione liscia per il contorno a guscio). */
  geometry: BufferGeometry;
  /** Tratti d'inchiostro espliciti (LineSegments), nello stesso spazio della geometria. */
  lines: BufferGeometry | null;
  /** Numero di tratti per unità UV [u, v]. */
  strokeScale: [number, number];
  /** Spessore del contorno nelle unità del modello (altezza = 1). */
  outline: number;
  /** Angolo oltre cui disegnare gli spigoli, in gradi; null = nessuno. */
  edgeAngle: number | null;
  doubleSided: boolean;
  /** Disegnare nel colore segnale. */
  signal: boolean;
  transform: PartTransform;
}

export interface Model {
  recipeId: string;
  seed: string;
  parts: ModelPart[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Dimensioni della scatola di contenimento. size[1] vale 1. */
  size: [number, number, number];
  /** Dimensione di riferimento a schermo: max(altezza, larghezza, profondità). */
  refSize: number;
}

/** Tratti per dimensione di riferimento con densità 1: calibrato sulla pera della prova approvata. */
const BASE_LINES = 24;

const deg = (d: number) => (d * Math.PI) / 180;

export function partMatrix(t: PartTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...t.position),
    new Quaternion().setFromEuler(new Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ")),
    new Vector3(t.scale, t.scale, t.scale),
  );
}

function boundsOf(items: { geometry: BufferGeometry; matrix: Matrix4 }[]) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (const { geometry, matrix } of items) {
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      min.min(p);
      max.max(p);
    }
  }
  return { min, max };
}

/** Scatola di contenimento del modello con le trasformazioni delle parti applicate. */
export function modelBounds(model: Pick<Model, "parts">): { min: [number, number, number]; max: [number, number, number] } {
  const { min, max } = boundsOf(model.parts.map((part) => ({ geometry: part.geometry, matrix: partMatrix(part.transform) })));
  return { min: min.toArray() as [number, number, number], max: max.toArray() as [number, number, number] };
}

/** Lunghezza media di dP/du e dP/dv sulla superficie (pesata per area), con la geometria scalata. */
function estimateUvExtent(g: BufferGeometry, scale: number): [number, number] {
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const get = (i: number) => (idx ? idx.getX(i) : i);
  const e1 = new Vector3();
  const e2 = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let sumU = 0;
  let sumV = 0;
  let sumA = 0;
  for (let i = 0; i < count; i += 3) {
    const i0 = get(i);
    const i1 = get(i + 1);
    const i2 = get(i + 2);
    a.fromBufferAttribute(pos, i0);
    e1.fromBufferAttribute(pos, i1).sub(a).multiplyScalar(scale);
    e2.fromBufferAttribute(pos, i2).sub(a).multiplyScalar(scale);
    const du1 = uv.getX(i1) - uv.getX(i0);
    const dv1 = uv.getY(i1) - uv.getY(i0);
    const du2 = uv.getX(i2) - uv.getX(i0);
    const dv2 = uv.getY(i2) - uv.getY(i0);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    const area = 0.5 * b.copy(e1).cross(e2).length();
    a.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);
    c.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);
    sumU += area * a.length();
    sumV += area * c.length();
    sumA += area;
  }
  return sumA > 0 ? [sumU / sumA, sumV / sumA] : [1, 1];
}

function runArchetype(recipe: Recipe, ctx: BuildContext): RawPart[] {
  switch (recipe.archetype) {
    case "lathe":
      return buildLathe(recipe.params, ctx);
    case "box":
      return buildBox(recipe.params, ctx);
    case "bag":
      return buildBag(recipe.params, ctx);
    case "elongated":
      return buildElongated(recipe.params, ctx);
    case "leaf":
      return buildLeaf(recipe.params, ctx);
    case "cluster":
      return buildCluster(recipe.params, ctx);
    case "wedge":
      return buildWedge(recipe.params, ctx);
  }
}

/** Le forme organiche si inclinano un po' a seconda del seme; confezioni e oggetti col tappo restano dritti. */
function tiltJitterDeg(recipe: Recipe): number {
  switch (recipe.archetype) {
    case "lathe":
      return recipe.details?.cap || recipe.details?.label ? 0 : 3;
    case "elongated":
    case "leaf":
    case "cluster":
      return 3;
    default:
      return 0;
  }
}

/**
 * Costruisce il modello. Funzione pura: stesso seme, stesse posizioni dei vertici.
 * La geometria appartiene al chiamante, che deve liberarla con `dispose()`.
 */
export function buildModel(input: Recipe, seed: string | number = input.id): Model {
  const recipe = parseRecipe(input);
  const seedText = String(seed);
  const rng = createRng(`${recipe.id}|${seedText}`);
  const variation = recipe.variation ?? 1;
  const tilt = deg((recipe.pose?.tiltDeg ?? 0) + rng.signed() * tiltJitterDeg(recipe) * variation);
  const raw = runArchetype(recipe, { rng, variation, details: recipe.details ?? {} });

  const tiltM = new Matrix4().makeRotationZ(tilt);
  const placed = raw.map((part) => ({ part, matrix: tiltM.clone().multiply(part.matrix) }));
  const { min, max } = boundsOf(placed.map(({ part, matrix }) => ({ geometry: part.geometry, matrix })));
  const height = max.y - min.y;
  const s = 1 / height;
  const norm = new Matrix4()
    .makeTranslation(-((min.x + max.x) / 2) * s, -min.y * s, -((min.z + max.z) / 2) * s)
    .multiply(new Matrix4().makeScale(s, s, s));

  const size: [number, number, number] = [(max.x - min.x) * s, 1, (max.z - min.z) * s];
  const refSize = Math.max(1, size[0], size[2]);
  const density = recipe.hatch?.density ?? 1;

  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const euler = new Euler();

  const parts: ModelPart[] = placed.map(({ part, matrix }) => {
    new Matrix4().multiplyMatrices(norm, matrix).decompose(pos, quat, scl);
    euler.setFromQuaternion(quat, "XYZ");
    const transform: PartTransform = { position: pos.toArray() as [number, number, number], rotation: [euler.x, euler.y, euler.z], scale: scl.x };

    const g = part.geometry;
    g.setAttribute("aOutline", new Float32BufferAttribute(smoothByPosition(g, g.getAttribute("normal").array), 3));
    const [du, dv] = estimateUvExtent(g, transform.scale);
    const k = (BASE_LINES * density * (part.densityMul ?? 1)) / refSize;
    const strokeScale: [number, number] = [Math.max(2, Math.round(du * k)), Math.max(2, Math.round(dv * k * 10) / 10)];

    let lines: BufferGeometry | null = null;
    if (part.lines && part.lines.length > 0) {
      lines = new BufferGeometry();
      lines.setAttribute("position", new Float32BufferAttribute(part.lines, 3));
    }
    return {
      name: part.name,
      role: part.role,
      geometry: g,
      lines,
      strokeScale,
      outline: part.outline * refSize,
      edgeAngle: part.edgeAngle ?? null,
      doubleSided: part.doubleSided === true,
      signal: part.signal === true,
      transform,
    };
  });

  const model: Model = { recipeId: recipe.id, seed: seedText, parts, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, size, refSize };
  model.bounds = modelBounds(model);
  return model;
}

/** Libera le geometrie del modello. */
export function disposeModel(model: Model): void {
  for (const part of model.parts) {
    part.geometry.dispose();
    part.lines?.dispose();
  }
}
