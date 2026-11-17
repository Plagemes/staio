/**
 * Ripiego per i prodotti senza ricetta: sceglie sempre una ricetta valida.
 * Ordine: somiglianza di nome con il catalogo, poi tipo di confezione (e quantità),
 * poi categoria, poi forma generica.
 */
import { getRecipe, listRecipes } from "./catalog";
import { CATEGORIES, validateRecipe, type Category, type Recipe } from "./recipe";

export type FallbackSource = "catalog" | "packaging" | "category" | "generic";

export interface UnknownProduct {
  name: string;
  /** Categoria dell'app (slug come `bevande`) o etichetta libera come «Latte e derivati». */
  category?: string;
  /** Testo libero: «bottiglia», «brick», «in lattina», «vaschetta»... */
  packaging?: string;
  /** Quantità della singola confezione; stessa forma di `Quantity` del dominio. */
  quantity?: { value: number; unit: string };
}

export interface FallbackResult {
  recipe: Recipe;
  source: FallbackSource;
  /** Id della ricetta di base da cui deriva (uguale a `recipe.id`). */
  baseId: string;
  /** Spiegazione breve, per i log e per chi controlla le forme. */
  reason: string;
}

type PackKind = "bottle" | "brick" | "can" | "jar" | "tray" | "bag" | "pouch" | "box" | "tube";

const GENERIC_ID = "ct-scatola-cartone-alta";

// ---------- testo ----------

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function stem(w: string): string {
  if (w.length <= 3) return w;
  if (/[cg]h[ei]$/.test(w)) return w.slice(0, -2);
  return w.replace(/[aeio]$/, "");
}

const STOP = new Set(["di", "da", "in", "con", "per", "al", "alla", "del", "della", "dei", "delle", "nel", "nei", "nella", "il", "lo", "la", "le", "gli", "un", "una", "bio", "senza", "tipo", "gusto"]);

const UNIT_FACTOR: Record<string, number> = {
  mg: 0.001, g: 1, gr: 1, hg: 100, kg: 1000,
  ml: 1, cl: 10, dl: 100, l: 1000, lt: 1000, litro: 1000, litri: 1000,
};
const UNIT_RE = "kg|gr|mg|hg|g|ml|cl|dl|lt|litri|litro|l";
const MULTI_RE = new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RE})\\b`);
const SINGLE_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RE})\\b`);

/** Quantità in ml o g (1 ml ≈ 1 g) ricavata dal campo o dal nome; undefined se non c'è. */
function amountOf(product: UnknownProduct, foldedName: string): { amount?: number; rest: string } {
  const q = product.quantity;
  let rest = foldedName;
  const m = MULTI_RE.exec(foldedName) ?? SINGLE_RE.exec(foldedName);
  if (m) rest = foldedName.replace(m[0], " ");
  if (q && Number.isFinite(q.value) && q.value > 0) {
    const f = UNIT_FACTOR[fold(String(q.unit)).trim()];
    if (f) return { amount: q.value * f, rest };
  }
  if (m) {
    const [value, unit] = m.length === 4 ? [m[2], m[3]] : [m[1], m[2]];
    const n = parseFloat(value.replace(",", "."));
    if (n > 0 && UNIT_FACTOR[unit]) return { amount: n * UNIT_FACTOR[unit], rest };
  }
  return { rest };
}

function tokenize(text: string): string[] {
  return fold(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d/.test(w))
    .map(stem);
}

// ---------- confezioni ----------

const PACK_WORDS: [PackKind, string[]][] = [
  ["bottle", ["bottigl", "flacon", "pet", "borracc"]],
  ["brick", ["brick", "tetrapak", "tetra"]],
  ["can", ["lattin", "scatolett"]],
  ["jar", ["barattol", "vasett", "vas", "jar"]],
  ["tray", ["vaschett", "vassoi", "bacinell", "cestell"]],
  ["bag", ["sacchett", "sacc", "retin", "pacc", "flowpack"]],
  ["pouch", ["bust", "bustin", "pouch", "doypack"]],
  ["box", ["scatol", "astucc", "carton", "box"]],
  ["tube", ["tubett", "tub"]],
];

const EXACT_ONLY = new Set(["pet", "vas", "sacc", "tub", "bust", "box", "jar"]);

function packKindOf(token: string): PackKind | undefined {
  for (const [kind, words] of PACK_WORDS) {
    for (const w of words) {
      if (token === w || (!EXACT_ONLY.has(w) && w.length >= 5 && token.startsWith(w))) return kind;
    }
  }
  return undefined;
}

/** Tipi di confezione nominati in un testo, nell'ordine in cui compaiono. */
function packKindOfText(text: string): PackKind[] {
  const kinds: PackKind[] = [];
  for (const raw of fold(text).replace(/[^a-z0-9]+/g, " ").split(" ")) {
    // «latta» e «latte» hanno la stessa radice: la latta si riconosce solo dalla parola intera
    const kind = raw === "latta" ? "can" : raw ? packKindOf(stem(raw)) : undefined;
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

const hasGlass = (text: string) => /\bvetro\b/.test(fold(text));

/** Parole che nei nomi del catalogo non identificano il prodotto ma la confezione o la taglia. */
const NON_CORE = new Set([
  "confezion", "pacc", "vetr", "plastic", "carton", "cart", "sottovuot", "squeez", "piatt", "panett", "tavolett",
  "pil", "blocc", "pall", "medaglion", "cubett", "spicchi", "tranc",
  "grand", "piccol", "medi", "alt", "bass", "singol", "larg", "sottil", "lung", "inter", "fresc", "quadrat",
]);

// ---------- categorie ----------

const CATEGORY_KEYWORDS: [string, Category][] = [
  ["surgel", "surgelati"], ["gelat", "surgelati"], ["frut", "frutta"], ["verdur", "verdura"], ["ortagg", "verdura"],
  ["insalat", "verdura"], ["erb", "erbe"], ["arom", "erbe"], ["formagg", "formaggi"], ["latt", "latticini"],
  ["yogurt", "latticini"], ["uov", "uova"], ["carn", "carne"], ["salum", "carne"], ["pesc", "pesce"], ["pan", "pane"],
  ["forno", "pane"], ["pasta", "pasta-riso"], ["riso", "pasta-riso"], ["conserv", "conserve"], ["scatolam", "conserve"],
  ["bevand", "bevande"], ["acqua", "bevande"], ["succ", "bevande"], ["dolc", "dolci"], ["snack", "dolci"],
  ["biscott", "dolci"], ["condim", "condimenti"], ["olio", "condimenti"], ["spezie", "condimenti"], ["salse", "condimenti"],
  ["dispens", "dispensa"],
];

/** Parole del nome che indicano da sole la categoria, usate se l'app non ne dà una. */
const NAME_CATEGORY: Record<string, Category> = {
  vino: "bevande", birra: "bevande", prosecco: "bevande", spumante: "bevande", aranciata: "bevande", limonata: "bevande", cola: "bevande",
};

function categoryFromName(foldedName: string): Category | undefined {
  for (const w of foldedName.split(/[^a-z0-9]+/)) if (NAME_CATEGORY[w]) return NAME_CATEGORY[w];
  return undefined;
}

function categoryOf(raw?: string): Category | undefined {
  if (!raw) return undefined;
  const f = fold(raw).trim();
  const exact = CATEGORIES.find((c) => c === f);
  if (exact) return exact === "altro" ? undefined : exact;
  const words = f.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [key, cat] of CATEGORY_KEYWORDS) if (words.some((w) => w.startsWith(key))) return cat;
  return undefined;
}

const GROUPS: Category[][] = [
  ["frutta", "verdura", "erbe"],
  ["latticini", "formaggi", "uova"],
  ["carne", "pesce"],
  ["pane", "dolci", "pasta-riso"],
  ["dispensa", "conserve", "condimenti", "surgelati"],
  ["bevande"],
];
const compatible = (a: Category, b: Category) => a === b || a === "altro" || b === "altro" || GROUPS.some((g) => g.includes(a) && g.includes(b));

type CategoryShape = { recipe: string } | { kind: PackKind; glass?: boolean };
const CATEGORY_SHAPES: Record<Category, CategoryShape> = {
  frutta: { recipe: "mela" },
  verdura: { recipe: "vd-zucchina" },
  erbe: { recipe: "er-prezzemolo" },
  latticini: { recipe: "lt-latte-brick" },
  formaggi: { recipe: "spicchio-parmigiano" },
  uova: { recipe: "lt-uova-confezione-6" },
  carne: { kind: "tray" },
  pesce: { kind: "tray" },
  pane: { recipe: "fo-pagnotta" },
  "pasta-riso": { recipe: "pacco-pasta" },
  dispensa: { kind: "box" },
  conserve: { kind: "jar" },
  bevande: { kind: "bottle" },
  surgelati: { kind: "pouch" },
  dolci: { kind: "box" },
  condimenti: { kind: "bottle", glass: true },
  altro: { kind: "box" },
};

// ---------- forme generiche per confezione ----------

interface Size {
  id: string;
  /** Quantità massima (ml o g) per cui si sceglie questa forma. */
  max: number;
  /** Quantità di riferimento della forma, per adattarne l'altezza. */
  ref: number;
}

const SIZES: Record<PackKind, Size[]> = {
  bottle: [
    { id: "ct-bottiglia-plastica-piccola", max: 700, ref: 500 },
    { id: "ct-bottiglia-plastica-media", max: 1250, ref: 1000 },
    { id: "ct-bottiglia-plastica-grande", max: Infinity, ref: 2000 },
  ],
  brick: [
    { id: "ct-brick-piccolo", max: 400, ref: 200 },
    { id: "ct-brick-grande", max: Infinity, ref: 1000 },
  ],
  can: [
    { id: "ct-lattina-bassa", max: 200, ref: 160 },
    { id: "ct-lattina-alta", max: Infinity, ref: 400 },
  ],
  jar: [
    { id: "ct-barattolo-vetro-piccolo", max: 300, ref: 200 },
    { id: "ct-barattolo-vetro-grande", max: Infinity, ref: 700 },
  ],
  tray: [
    { id: "ct-vaschetta-bassa", max: 400, ref: 250 },
    { id: "ct-vaschetta-alta", max: Infinity, ref: 800 },
  ],
  bag: [{ id: "ct-sacchetto", max: Infinity, ref: 500 }],
  pouch: [{ id: "ct-busta-piatta", max: Infinity, ref: 100 }],
  box: [
    { id: "ct-scatola-cartone-bassa", max: 250, ref: 150 },
    { id: "ct-scatola-cartone-alta", max: Infinity, ref: 500 },
  ],
  tube: [{ id: "ct-tubetto", max: Infinity, ref: 100 }],
};

/** Forma usata quando la quantità non si conosce. */
const DEFAULT_SIZE: Record<PackKind, string> = {
  bottle: "ct-bottiglia-plastica-media",
  brick: "ct-brick-grande",
  can: "ct-lattina-alta",
  jar: "ct-barattolo-vetro-piccolo",
  tray: "ct-vaschetta-bassa",
  bag: "ct-sacchetto",
  pouch: "ct-busta-piatta",
  box: "ct-scatola-cartone-alta",
  tube: "ct-tubetto",
};

function shapeRecipe(kind: PackKind, amount: number | undefined, glass: boolean): Recipe | undefined {
  let size: Size | undefined;
  if (kind === "bottle" && glass) size = { id: "ct-bottiglia-vetro", max: Infinity, ref: 750 };
  else if (amount !== undefined) size = SIZES[kind].find((s) => amount <= s.max);
  const id = size?.id ?? DEFAULT_SIZE[kind];
  const base = getRecipe(id);
  if (!base) return undefined;
  if (!size || amount === undefined) return base;
  const [lo, hi] = kind === "bag" ? [0.6, 1.4] : [0.7, 1.3];
  const k = Math.min(hi, Math.max(lo, Math.cbrt(amount / size.ref)));
  return { ...base, heightCm: Math.round(base.heightCm * k * 2) / 2 };
}

// ---------- somiglianza con il catalogo ----------

interface Entry {
  recipe: Recipe;
  core: string[];
  kinds: PackKind[];
  glass: boolean;
  large: boolean;
  small: boolean;
}

let index: { count: number; entries: Entry[]; idf: Map<string, number> } | undefined;

function buildIndex() {
  const recipes = listRecipes().filter((r) => !r.id.startsWith("ct-"));
  const entries: Entry[] = [];
  const df = new Map<string, number>();
  for (const recipe of recipes) {
    const tokens = tokenize(recipe.name);
    const core = [...new Set(tokens.filter((t) => !NON_CORE.has(t) && !packKindOf(t)))];
    if (core.length === 0) continue;
    for (const t of core) df.set(t, (df.get(t) ?? 0) + 1);
    entries.push({
      recipe,
      core,
      kinds: packKindOfText(recipe.name),
      glass: hasGlass(recipe.name),
      large: tokens.includes("grand"),
      small: tokens.includes("piccol") || tokens.includes("singol"),
    });
  }
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + recipes.length / n));
  index = { count: listRecipes().length, entries, idf };
  return index;
}

function matchCatalog(
  product: string[],
  kinds: PackKind[],
  glass: boolean,
  amount: number | undefined,
  category: Category | undefined,
): { recipe: Recipe; score: number } | undefined {
  // l'indice si ricostruisce se il registro è cambiato
  const idx = index && index.count === listRecipes().length ? index : buildIndex();
  let best: { recipe: Recipe; key: number[] } | undefined;
  for (const e of idx.entries) {
    let got = 0;
    let total = 0;
    let matched = 0;
    for (const t of e.core) {
      const w = idx.idf.get(t) ?? 1;
      total += w;
      if (product.includes(t)) {
        got += w;
        matched++;
      }
    }
    if (matched === 0) continue;
    let score = got / total;
    if (category && !compatible(category, e.recipe.category)) score *= 0.5;
    if (score < 0.6) continue;
    const pack = kinds.length === 0 || e.kinds.length === 0 ? 0 : e.kinds.some((k) => kinds.includes(k)) ? 1 : -1;
    const glassTie = glass === e.glass ? 0 : -1;
    const sizeTie = amount === undefined ? 0 : (e.large && amount >= 1000) || (e.small && amount < 1000) ? 1 : (e.large && amount < 1000) || (e.small && amount >= 1000) ? -1 : 0;
    const key = [Math.round(score * 1000), matched, pack, glassTie, sizeTie];
    if (!best || compare(key, best.key) > 0) best = { recipe: e.recipe, key };
  }
  return best ? { recipe: best.recipe, score: best.key[0] / 1000 } : undefined;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------- funzione pubblica ----------

function result(recipe: Recipe, source: FallbackSource, reason: string): FallbackResult {
  return { recipe, source, baseId: recipe.id, reason };
}

/** Sceglie una ricetta per un prodotto sconosciuto. Non lancia mai e restituisce sempre una ricetta valida. */
export function recipeForUnknown(product: UnknownProduct): FallbackResult {
  const name = typeof product?.name === "string" ? product.name : "";
  const foldedName = fold(name);
  const { amount, rest } = amountOf(product ?? { name }, foldedName);
  const category = categoryOf(typeof product?.category === "string" ? product.category : undefined) ?? categoryFromName(foldedName);
  const packagingText = typeof product?.packaging === "string" ? product.packaging : "";

  // il campo esplicito vince sulle parole del nome
  const fieldKinds = packKindOfText(packagingText);
  const nameKinds = packKindOfText(rest);
  const kinds = [...fieldKinds, ...nameKinds.filter((k) => !fieldKinds.includes(k))];
  const glass = hasGlass(packagingText) || hasGlass(rest) || /\b(vino|spumante|prosecco)\b/.test(foldedName);

  const attempts: (() => FallbackResult | undefined)[] = [
    () => {
      const hit = matchCatalog(tokenize(rest + " " + packagingText), kinds, glass, amount, category);
      return hit && result(hit.recipe, "catalog", `nome simile a «${hit.recipe.name}»`);
    },
    () => {
      if (kinds.length === 0) return undefined;
      const recipe = shapeRecipe(kinds[0], amount, glass);
      return recipe && result(recipe, "packaging", `confezione ${kinds[0]}${amount !== undefined ? `, ${Math.round(amount)} ml/g` : ""}`);
    },
    () => {
      if (!category) return undefined;
      const shape = CATEGORY_SHAPES[category];
      const recipe = "recipe" in shape ? getRecipe(shape.recipe) : shapeRecipe(shape.kind, amount, shape.glass === true || glass);
      return recipe && result(recipe, "category", `forma tipica della categoria ${category}`);
    },
    () => {
      const recipe = shapeRecipe("box", amount, false) ?? getRecipe(GENERIC_ID);
      return recipe && result(recipe, "generic", "nessun indizio: scatola generica");
    },
  ];

  for (const attempt of attempts) {
    const found = attempt();
    if (found && validateRecipe(found.recipe).ok) return found;
  }
  // il catalogo non contiene nemmeno la scatola generica: ricetta minima in linea
  const minimal: Recipe = {
    id: GENERIC_ID,
    name: "Scatola",
    category: "altro",
    archetype: "box",
    heightCm: 15,
    params: { size: [1, 1.6, 0.7], bevel: 0.05 },
  };
  return result(minimal, "generic", "ricetta minima di emergenza");
}
