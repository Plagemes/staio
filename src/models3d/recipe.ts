/**
 * Ricetta di un modello 3D: testo piccolo (JSON-compatibile) che descrive un alimento.
 * Tutte le misure geometriche sono relative all'altezza del corpo principale (= 1),
 * salvo dove indicato. L'altezza reale in cm serve solo come metadato.
 */

export const ARCHETYPES = ["lathe", "box", "bag", "elongated", "leaf", "cluster", "wedge"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  lathe: "Solido di rotazione",
  box: "Confezione",
  bag: "Sacchetto",
  elongated: "Forma allungata",
  leaf: "Foglie",
  cluster: "Grappolo",
  wedge: "Spicchio",
};

export const CATEGORIES = [
  "frutta",
  "verdura",
  "erbe",
  "latticini",
  "formaggi",
  "uova",
  "carne",
  "pesce",
  "pane",
  "pasta-riso",
  "dispensa",
  "conserve",
  "bevande",
  "surgelati",
  "dolci",
  "condimenti",
  "altro",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  frutta: "Frutta",
  verdura: "Verdura",
  erbe: "Erbe",
  latticini: "Latticini",
  formaggi: "Formaggi",
  uova: "Uova",
  carne: "Carne",
  pesce: "Pesce",
  pane: "Pane",
  "pasta-riso": "Pasta e riso",
  dispensa: "Dispensa",
  conserve: "Conserve",
  bevande: "Bevande",
  surgelati: "Surgelati",
  dolci: "Dolci",
  condimenti: "Condimenti",
  altro: "Contenitori",
};

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** Limiti numerici, usati dal validatore e riportati in RICETTE.md. */
export const LIMITS = {
  heightCm: [0.3, 250],
  variation: [0, 1],
  tiltDeg: [-90, 90],
  density: [0.4, 2.5],
  lathe: { points: [3, 40], radius: [0, 4], y: [-4, 4], maxAspect: 3, segments: [12, 96] },
  box: { side: [0.05, 20], maxRatio: 30, bevel: [0, 0.5] },
  bag: { side: [0.05, 20], maxRatio: 30, pinch: [0.02, 0.3], wrinkle: [0, 1] },
  elongated: { points: [2, 12], radius: [0, 0.5], bend: [-1, 1], ratio: [0.4, 1.6], wobble: [0, 0.3] },
  leaf: { count: [3, 48], width: [0.15, 1.2], spread: [0, 1], curl: [-1, 1], frill: [0, 1], stalk: [0, 2] },
  cluster: { count: [3, 60], elementRadius: [0.03, 0.4], elongation: [0.7, 1.6], spread: [0.1, 1], stalk: [0, 0.6] },
  wedge: { radius: [0.3, 6], angleDeg: [10, 180], bulge: [0, 0.25] },
  stem: { length: [0.02, 0.5], thickness: [0.005, 0.08], bend: [-1, 1] },
  leafDetail: { count: [1, 5], length: [0.1, 0.8], width: [0.15, 0.8] },
  cap: { height: [0.01, 0.25], radius: [0.02, 1.5], offset: [-1, 1] },
  label: { band: [0, 1] },
} as const;

export interface StemDetail {
  /** Lunghezza del picciolo (frazione dell'altezza del corpo). */
  length: number;
  /** Raggio del picciolo alla base (frazione dell'altezza del corpo). */
  thickness: number;
  /** Curvatura, da -1 a 1. */
  bend?: number;
}

export interface LeafDetail {
  count: number;
  /** Lunghezza della foglia (frazione dell'altezza del corpo). */
  length: number;
  /** Larghezza / lunghezza della foglia. Predefinito 0.45. */
  width?: number;
}

export interface CapDetail {
  kind?: "screw" | "cork" | "lid";
  /** Altezza del tappo (frazione dell'altezza del corpo). Predefinito 0.05. */
  height?: number;
  /** Raggio del tappo. Predefinito: raggio dell'imboccatura. */
  radius?: number;
  /** Disegna il tappo nel colore segnale. */
  signal?: boolean;
  /** Solo per `box`: posizione sul piano superiore, da -1 a 1 per asse (x, z). */
  offset?: Vec2;
}

export interface LabelDetail {
  /** Inizio e fine della fascia, come frazioni dell'altezza del corpo (from < to). */
  from: number;
  to: number;
  signal?: boolean;
}

export interface RecipeDetails {
  stem?: StemDetail;
  leaf?: LeafDetail;
  cap?: CapDetail;
  label?: LabelDetail;
}

export interface HatchHints {
  /** Moltiplicatore della densità del tratto. Predefinito 1. */
  density?: number;
  /** Secondo tratteggio incrociato nelle zone scure. Predefinito true. */
  cross?: boolean;
}

export interface Pose {
  /** Inclinazione attorno all'asse z, in gradi. 90 = oggetto coricato. */
  tiltDeg?: number;
}

export interface LatheParams {
  /** Profilo [raggio, y] dal basso verso l'alto. */
  profile: readonly Vec2[];
  /** true: curva liscia che passa dai punti. false: segmenti retti con spigoli. Predefinito true. */
  smooth?: boolean;
  /** Divisioni radiali. Predefinito 56. */
  segments?: number;
}

export interface BoxParams {
  /** Larghezza, altezza, profondità (solo i rapporti contano). */
  size: Vec3;
  /** Raggio dello smusso come frazione del lato più corto. Predefinito 0 (spigoli vivi). */
  bevel?: number;
}

export interface BagParams {
  size: Vec3;
  /** Frazione dell'altezza occupata dalla saldatura piatta in testa e in fondo. Predefinito 0.08. */
  pinch?: number;
  /** Ampiezza delle pieghe casuali. Predefinito 0.3. */
  wrinkle?: number;
}

export interface ElongatedParams {
  /** Raggio lungo l'asse: [t, raggio], t da 0 (base) a 1 (cima), raggio relativo alla lunghezza. */
  radii: readonly Vec2[];
  /** Curvatura dell'asse, da -1 a 1. Predefinito 0. */
  bend?: number;
  /** Rapporto fra i due diametri della sezione. Predefinito 1. */
  ratio?: number;
  /** Irregolarità casuale della superficie. Predefinito 0.04. */
  wobble?: number;
}

export interface LeafParams {
  /** rosette: cespo che si apre dal centro. bunch: mazzo di steli con una foglia ciascuno. */
  layout: "rosette" | "bunch";
  count: number;
  /** Larghezza / lunghezza della foglia. */
  width: number;
  /** Apertura, da 0 (chiuso) a 1 (aperto). */
  spread: number;
  /** Curvatura della lamina, negativa = punte che cadono. Predefinito 0. */
  curl?: number;
  /** Ondulazione del bordo. Predefinito 0. */
  frill?: number;
  /** Solo bunch: lunghezza dello stelo / lunghezza della foglia. Predefinito 1. */
  stalk?: number;
}

export interface ClusterParams {
  /** hanging: grappolo appeso. heap: mucchietto. truss: rametto con frutti alternati. */
  layout: "hanging" | "heap" | "truss";
  count: number;
  /** Raggio di un elemento, relativo all'altezza del grappolo. */
  elementRadius: number;
  /** Altezza / larghezza di un elemento. Predefinito 1. */
  elongation?: number;
  /** Larghezza del grappolo. Predefinito 0.5. */
  spread?: number;
  /** Lunghezza del gambo in cima (hanging, truss). Predefinito 0.2. */
  stalk?: number;
}

export interface WedgeParams {
  /** Raggio del settore, relativo all'altezza (che vale 1). */
  radius: number;
  angleDeg: number;
  /** Rigonfiamento del bordo curvo. Predefinito 0.04. */
  bulge?: number;
  /** true: il bordo curvo è una parte a sé (crosta). Predefinito true. */
  rind?: boolean;
}

export interface RecipeBase {
  /** Identificativo: minuscole, cifre e trattini. */
  id: string;
  /** Nome in italiano. */
  name: string;
  category: Category;
  /** Altezza reale indicativa dell'oggetto nella posa del modello, in cm. */
  heightCm: number;
  details?: RecipeDetails;
  hatch?: HatchHints;
  pose?: Pose;
  /** Quanto i semi cambiano le proporzioni, da 0 a 1. Predefinito 1. */
  variation?: number;
}

export interface LatheRecipe extends RecipeBase {
  archetype: "lathe";
  params: LatheParams;
}
export interface BoxRecipe extends RecipeBase {
  archetype: "box";
  params: BoxParams;
}
export interface BagRecipe extends RecipeBase {
  archetype: "bag";
  params: BagParams;
}
export interface ElongatedRecipe extends RecipeBase {
  archetype: "elongated";
  params: ElongatedParams;
}
export interface LeafRecipe extends RecipeBase {
  archetype: "leaf";
  params: LeafParams;
}
export interface ClusterRecipe extends RecipeBase {
  archetype: "cluster";
  params: ClusterParams;
}
export interface WedgeRecipe extends RecipeBase {
  archetype: "wedge";
  params: WedgeParams;
}

export type Recipe =
  | LatheRecipe
  | BoxRecipe
  | BagRecipe
  | ElongatedRecipe
  | LeafRecipe
  | ClusterRecipe
  | WedgeRecipe;

/** Dettagli ammessi per ciascun archetipo. */
export const ALLOWED_DETAILS: Record<Archetype, readonly (keyof RecipeDetails)[]> = {
  lathe: ["stem", "leaf", "cap", "label"],
  box: ["cap", "label"],
  bag: [],
  elongated: ["stem", "leaf"],
  leaf: [],
  cluster: [],
  wedge: [],
};

export type ValidationResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

export class RecipeValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[], subject?: string) {
    super(`Ricetta${subject ? ` «${subject}»` : ""} non valida:\n- ${errors.join("\n- ")}`);
    this.name = "RecipeValidationError";
    this.errors = errors;
  }
}

type Obj = Record<string, unknown>;
type Range = readonly [number, number];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class Checker {
  readonly errors: string[] = [];

  add(path: string, message: string) {
    this.errors.push(`${path}: ${message}`);
  }

  keys(o: Obj, allowed: readonly string[], path: string) {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) {
        this.add(path ? `${path}.${k}` : k, `campo sconosciuto (ammessi: ${allowed.join(", ")})`);
      }
    }
  }

  num(v: unknown, path: string, [min, max]: Range, opts: { int?: boolean } = {}): number | undefined {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.add(path, `deve essere un numero (trovato ${describe(v)})`);
      return undefined;
    }
    if (opts.int && !Number.isInteger(v)) {
      this.add(path, `deve essere un intero (trovato ${v})`);
      return undefined;
    }
    if (v < min || v > max) {
      this.add(path, `deve essere compreso fra ${min} e ${max} (trovato ${v})`);
      return undefined;
    }
    return v;
  }

  optNum(o: Obj, key: string, path: string, range: Range, opts: { int?: boolean } = {}) {
    if (o[key] !== undefined) this.num(o[key], path ? `${path}.${key}` : key, range, opts);
  }

  optBool(o: Obj, key: string, path: string) {
    if (o[key] !== undefined && typeof o[key] !== "boolean") {
      this.add(`${path}.${key}`, `deve essere true o false (trovato ${describe(o[key])})`);
    }
  }

  obj(v: unknown, path: string): Obj | undefined {
    if (!isObj(v)) {
      this.add(path, `deve essere un oggetto (trovato ${describe(v)})`);
      return undefined;
    }
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T | undefined {
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
      this.add(path, `deve essere uno fra: ${values.join(", ")} (trovato ${describe(v)})`);
      return undefined;
    }
    return v as T;
  }

  pair(v: unknown, path: string, a: Range, b: Range): [number, number] | undefined {
    if (!Array.isArray(v) || v.length !== 2) {
      this.add(path, `deve essere una coppia [a, b] (trovato ${describe(v)})`);
      return undefined;
    }
    const x = this.num(v[0], `${path}[0]`, a);
    const y = this.num(v[1], `${path}[1]`, b);
    return x === undefined || y === undefined ? undefined : [x, y];
  }

  triple(v: unknown, path: string, range: Range, maxRatio: number) {
    if (!Array.isArray(v) || v.length !== 3) {
      this.add(path, `deve essere una terna [larghezza, altezza, profondità] (trovato ${describe(v)})`);
      return;
    }
    const nums = v.map((n, i) => this.num(n, `${path}[${i}]`, range));
    if (nums.every((n): n is number => n !== undefined)) {
      const ratio = Math.max(...nums) / Math.min(...nums);
      if (ratio > maxRatio) this.add(path, `il rapporto fra lato più lungo e più corto non può superare ${maxRatio} (trovato ${ratio.toFixed(1)})`);
    }
  }
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "un array";
  if (typeof v === "string") return `«${v.length > 30 ? `${v.slice(0, 30)}…` : v}»`;
  if (typeof v === "object") return "un oggetto";
  return String(v);
}

const BASE_KEYS = ["id", "name", "category", "archetype", "params", "heightCm", "details", "hatch", "pose", "variation"];

function checkParams(c: Checker, archetype: Archetype, raw: unknown) {
  const p = c.obj(raw, "params");
  if (!p) return;
  const L = LIMITS;
  switch (archetype) {
    case "lathe": {
      c.keys(p, ["profile", "smooth", "segments"], "params");
      c.optBool(p, "smooth", "params");
      c.optNum(p, "segments", "params", L.lathe.segments, { int: true });
      if (!Array.isArray(p.profile)) {
        c.add("params.profile", `deve essere un elenco di punti [raggio, y] (trovato ${describe(p.profile)})`);
        break;
      }
      const [minPts, maxPts] = L.lathe.points;
      if (p.profile.length < minPts || p.profile.length > maxPts) {
        c.add("params.profile", `servono da ${minPts} a ${maxPts} punti (trovati ${p.profile.length})`);
      }
      const pts: [number, number][] = [];
      p.profile.forEach((pt, i) => {
        const v = c.pair(pt, `params.profile[${i}]`, L.lathe.radius, L.lathe.y);
        if (v) pts.push(v);
      });
      if (pts.length === p.profile.length && pts.length >= 2) {
        const ys = pts.map((q) => q[1]);
        const height = Math.max(...ys) - Math.min(...ys);
        if (height < 1e-3) c.add("params.profile", "i punti devono avere altezze diverse");
        else if (Math.max(...pts.map((q) => q[0])) / height > L.lathe.maxAspect) {
          c.add("params.profile", `il raggio massimo non può superare ${L.lathe.maxAspect} volte l'altezza del profilo`);
        }
      }
      break;
    }
    case "box":
      c.keys(p, ["size", "bevel"], "params");
      c.triple(p.size, "params.size", L.box.side, L.box.maxRatio);
      c.optNum(p, "bevel", "params", L.box.bevel);
      break;
    case "bag":
      c.keys(p, ["size", "pinch", "wrinkle"], "params");
      c.triple(p.size, "params.size", L.bag.side, L.bag.maxRatio);
      c.optNum(p, "pinch", "params", L.bag.pinch);
      c.optNum(p, "wrinkle", "params", L.bag.wrinkle);
      break;
    case "elongated": {
      c.keys(p, ["radii", "bend", "ratio", "wobble"], "params");
      c.optNum(p, "bend", "params", L.elongated.bend);
      c.optNum(p, "ratio", "params", L.elongated.ratio);
      c.optNum(p, "wobble", "params", L.elongated.wobble);
      if (!Array.isArray(p.radii)) {
        c.add("params.radii", `deve essere un elenco di coppie [t, raggio] (trovato ${describe(p.radii)})`);
        break;
      }
      const [minPts, maxPts] = L.elongated.points;
      if (p.radii.length < minPts || p.radii.length > maxPts) {
        c.add("params.radii", `servono da ${minPts} a ${maxPts} punti (trovati ${p.radii.length})`);
      }
      const rs: [number, number][] = [];
      p.radii.forEach((pt, i) => {
        const v = c.pair(pt, `params.radii[${i}]`, [0, 1], L.elongated.radius);
        if (v) rs.push(v);
      });
      if (rs.length === p.radii.length && rs.length >= 2) {
        if (rs[0][0] !== 0 || rs[rs.length - 1][0] !== 1) c.add("params.radii", "il primo t deve valere 0 e l'ultimo 1");
        for (let i = 1; i < rs.length; i++) {
          if (rs[i][0] <= rs[i - 1][0]) c.add(`params.radii[${i}]`, "i valori di t devono essere strettamente crescenti");
        }
        if (Math.max(...rs.map((q) => q[1])) <= 0) c.add("params.radii", "almeno un raggio deve essere maggiore di 0");
      }
      break;
    }
    case "leaf":
      c.keys(p, ["layout", "count", "width", "spread", "curl", "frill", "stalk"], "params");
      c.oneOf(p.layout, "params.layout", ["rosette", "bunch"] as const);
      c.num(p.count, "params.count", L.leaf.count, { int: true });
      c.num(p.width, "params.width", L.leaf.width);
      c.num(p.spread, "params.spread", L.leaf.spread);
      c.optNum(p, "curl", "params", L.leaf.curl);
      c.optNum(p, "frill", "params", L.leaf.frill);
      c.optNum(p, "stalk", "params", L.leaf.stalk);
      break;
    case "cluster":
      c.keys(p, ["layout", "count", "elementRadius", "elongation", "spread", "stalk"], "params");
      c.oneOf(p.layout, "params.layout", ["hanging", "heap", "truss"] as const);
      c.num(p.count, "params.count", L.cluster.count, { int: true });
      c.num(p.elementRadius, "params.elementRadius", L.cluster.elementRadius);
      c.optNum(p, "elongation", "params", L.cluster.elongation);
      c.optNum(p, "spread", "params", L.cluster.spread);
      c.optNum(p, "stalk", "params", L.cluster.stalk);
      break;
    case "wedge":
      c.keys(p, ["radius", "angleDeg", "bulge", "rind"], "params");
      c.num(p.radius, "params.radius", L.wedge.radius);
      c.num(p.angleDeg, "params.angleDeg", L.wedge.angleDeg);
      c.optNum(p, "bulge", "params", L.wedge.bulge);
      c.optBool(p, "rind", "params");
      break;
  }
}

function checkDetails(c: Checker, archetype: Archetype, raw: unknown) {
  const d = c.obj(raw, "details");
  if (!d) return;
  const L = LIMITS;
  c.keys(d, ["stem", "leaf", "cap", "label"], "details");
  for (const key of Object.keys(d) as (keyof RecipeDetails)[]) {
    if (d[key] !== undefined && ["stem", "leaf", "cap", "label"].includes(key) && !ALLOWED_DETAILS[archetype].includes(key)) {
      const allowed = ALLOWED_DETAILS[archetype];
      c.add(`details.${key}`, `non ammesso per l'archetipo «${archetype}»${allowed.length ? ` (ammessi: ${allowed.join(", ")})` : " (nessun dettaglio ammesso)"}`);
    }
  }
  if (d.stem !== undefined) {
    const s = c.obj(d.stem, "details.stem");
    if (s) {
      c.keys(s, ["length", "thickness", "bend"], "details.stem");
      c.num(s.length, "details.stem.length", L.stem.length);
      c.num(s.thickness, "details.stem.thickness", L.stem.thickness);
      c.optNum(s, "bend", "details.stem", L.stem.bend);
    }
  }
  if (d.leaf !== undefined) {
    const s = c.obj(d.leaf, "details.leaf");
    if (s) {
      c.keys(s, ["count", "length", "width"], "details.leaf");
      c.num(s.count, "details.leaf.count", L.leafDetail.count, { int: true });
      c.num(s.length, "details.leaf.length", L.leafDetail.length);
      c.optNum(s, "width", "details.leaf", L.leafDetail.width);
    }
  }
  if (d.cap !== undefined) {
    const s = c.obj(d.cap, "details.cap");
    if (s) {
      c.keys(s, ["kind", "height", "radius", "signal", "offset"], "details.cap");
      if (s.kind !== undefined) c.oneOf(s.kind, "details.cap.kind", ["screw", "cork", "lid"] as const);
      c.optNum(s, "height", "details.cap", L.cap.height);
      c.optNum(s, "radius", "details.cap", L.cap.radius);
      c.optBool(s, "signal", "details.cap");
      if (s.offset !== undefined) {
        if (archetype !== "box") c.add("details.cap.offset", "ammesso solo per l'archetipo «box»");
        else c.pair(s.offset, "details.cap.offset", L.cap.offset, L.cap.offset);
      }
    }
  }
  if (d.label !== undefined) {
    const s = c.obj(d.label, "details.label");
    if (s) {
      c.keys(s, ["from", "to", "signal"], "details.label");
      const from = c.num(s.from, "details.label.from", L.label.band);
      const to = c.num(s.to, "details.label.to", L.label.band);
      if (from !== undefined && to !== undefined && to - from < 0.03) c.add("details.label", "«to» deve superare «from» di almeno 0.03");
      c.optBool(s, "signal", "details.label");
    }
  }
}

/** Controlla una ricetta arrivata da fuori (JSON, codice di un altro agente). Non lancia mai. */
export function validateRecipe(input: unknown): ValidationResult {
  const c = new Checker();
  if (!isObj(input)) return { ok: false, errors: [`ricetta: deve essere un oggetto (trovato ${describe(input)})`] };
  c.keys(input, BASE_KEYS, "");

  if (typeof input.id !== "string" || !ID_RE.test(input.id) || input.id.length > 48) {
    c.add("id", `deve essere minuscolo con cifre e trattini, al massimo 48 caratteri, es. «pera-abate» (trovato ${describe(input.id)})`);
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 60) {
    c.add("name", `deve essere un testo non vuoto di al massimo 60 caratteri (trovato ${describe(input.name)})`);
  }
  c.oneOf(input.category, "category", CATEGORIES);
  c.num(input.heightCm, "heightCm", LIMITS.heightCm);
  c.optNum(input, "variation", "", LIMITS.variation);
  if (input.hatch !== undefined) {
    const h = c.obj(input.hatch, "hatch");
    if (h) {
      c.keys(h, ["density", "cross"], "hatch");
      c.optNum(h, "density", "hatch", LIMITS.density);
      c.optBool(h, "cross", "hatch");
    }
  }
  if (input.pose !== undefined) {
    const h = c.obj(input.pose, "pose");
    if (h) {
      c.keys(h, ["tiltDeg"], "pose");
      c.optNum(h, "tiltDeg", "pose", LIMITS.tiltDeg);
    }
  }

  const archetype = c.oneOf(input.archetype, "archetype", ARCHETYPES);
  if (archetype) {
    if (input.params === undefined) c.add("params", "mancano i parametri dell'archetipo");
    else checkParams(c, archetype, input.params);
    if (input.details !== undefined) checkDetails(c, archetype, input.details);
  }

  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, recipe: input as unknown as Recipe };
}

/** Come `validateRecipe`, ma lancia `RecipeValidationError` e restituisce la ricetta tipizzata. */
export function parseRecipe(input: unknown): Recipe {
  const result = validateRecipe(input);
  if (!result.ok) {
    const id = isObj(input) && typeof input.id === "string" ? input.id : undefined;
    throw new RecipeValidationError(result.errors, id);
  }
  return result.recipe;
}
