// Il modulo di scrittura di una ricetta: dallo stato dei campi (testi) ai campi di un evento, con gli errori
// accanto al campo giusto. Logica pura.
import {
  RECIPE_LIMITS,
  parseDurationText,
  type Quantity,
  type Recipe,
  type RecipeDraft,
  type RecipeEventFields,
  type RecipeIngredient,
  type RecipeStep,
  type RecipeTimes,
} from "@/core/recipes";
import { formatQuantity, parseQuantity } from "@/core/units";
import { NO_NUMBER, splitList } from "./common";

export interface IngredientRow {
  id: number;
  name: string;
  /** "200 g", "2", vuoto per «quanto basta». */
  quantityText: string;
  note: string;
  /** Alimento della tabella scelto dall'utente (facoltativo). */
  foodId?: string;
  /** «Nessuno di questi»: la riga si salva senza alimento scelto. */
  none?: boolean;
  /** Quantità di partenza e testo con cui è stata mostrata: se il testo non cambia, vale la quantità originale. */
  original?: { text: string; quantity: Quantity };
}

export interface StepRow {
  id: number;
  text: string;
  minutesText: string;
}

export interface RecipeForm {
  title: string;
  servingsText: string;
  ingredients: IngredientRow[];
  steps: StepRow[];
  prepText: string;
  cookText: string;
  totalText: string;
  equipmentText: string;
  tagsText: string;
  sourceUrl: string;
  sourceAuthor: string;
}

export interface FormErrors {
  title?: string;
  servings?: string;
  ingredients: Record<number, string>;
  steps: Record<number, string>;
  times: Partial<Record<"prep" | "cook" | "total", string>>;
  sourceUrl?: string;
  general?: string;
}

export const emptyErrors = (): FormErrors => ({ ingredients: {}, steps: {}, times: {} });

export function hasErrors(e: FormErrors): boolean {
  return (
    e.title !== undefined ||
    e.servings !== undefined ||
    e.sourceUrl !== undefined ||
    e.general !== undefined ||
    Object.keys(e.ingredients).length > 0 ||
    Object.keys(e.steps).length > 0 ||
    Object.keys(e.times).length > 0
  );
}

let counter = 1;
/** Identificativo di riga, solo per le chiavi di React: non entra mai nei dati. */
export const nextRowId = (): number => counter++;

export const emptyIngredient = (): IngredientRow => ({ id: nextRowId(), name: "", quantityText: "", note: "" });
export const emptyStep = (): StepRow => ({ id: nextRowId(), text: "", minutesText: "" });

export function emptyForm(): RecipeForm {
  return {
    title: "",
    servingsText: "4",
    ingredients: [emptyIngredient(), emptyIngredient(), emptyIngredient()],
    steps: [emptyStep()],
    prepText: "",
    cookText: "",
    totalText: "",
    equipmentText: "",
    tagsText: "",
    sourceUrl: "",
    sourceAuthor: "",
  };
}

const minutesToText = (m: number | undefined): string => (m === undefined ? "" : String(m));

function ingredientRow(ing: RecipeIngredient): IngredientRow {
  const text = ing.quantity ? formatQuantity(ing.quantity) : "";
  return {
    id: nextRowId(),
    name: ing.name,
    quantityText: text,
    note: ing.note ?? "",
    ...(ing.foodId ? { foodId: ing.foodId } : {}),
    ...(ing.quantity ? { original: { text, quantity: { ...ing.quantity } } } : {}),
  };
}

export function formFromRecipe(recipe: Recipe): RecipeForm {
  return {
    title: recipe.title,
    servingsText: String(recipe.servings).replace(".", ","),
    ingredients: recipe.ingredients.map(ingredientRow),
    steps: recipe.steps.map((s) => ({ id: nextRowId(), text: s.text, minutesText: minutesToText(s.durationMinutes) })),
    prepText: minutesToText(recipe.times?.prepMinutes),
    cookText: minutesToText(recipe.times?.cookMinutes),
    totalText: minutesToText(recipe.times?.totalMinutes),
    equipmentText: recipe.equipment.join(", "),
    tagsText: recipe.tags.join(", "),
    sourceUrl: recipe.origin?.url ?? "",
    sourceAuthor: recipe.origin?.author ?? "",
  };
}

/**
 * Bozza da un'importazione. Le porzioni restano vuote se la fonte non le dice: le scrive chi rivede,
 * senza un numero inventato che passi inosservato.
 */
export function formFromDraft(draft: RecipeDraft): RecipeForm {
  const form = emptyForm();
  return {
    ...form,
    title: draft.title?.trim() ?? "",
    servingsText: draft.servings !== undefined ? String(draft.servings) : "",
    ingredients:
      draft.ingredients.length > 0
        ? draft.ingredients.map((i) =>
            ingredientRow({
              name: i.name,
              ...(i.quantity ? { quantity: i.quantity } : {}),
              ...(i.note ? { note: i.note } : {}),
            }),
          )
        : form.ingredients,
    steps:
      draft.steps.length > 0
        ? draft.steps.map((s) => ({ id: nextRowId(), text: s.text, minutesText: minutesToText(s.durationMinutes) }))
        : form.steps,
    prepText: minutesToText(draft.times?.prepMinutes),
    cookText: minutesToText(draft.times?.cookMinutes),
    totalText: minutesToText(draft.times?.totalMinutes),
    equipmentText: (draft.equipment ?? []).join(", "),
    tagsText: (draft.tags ?? []).join(", "),
    sourceUrl: draft.origin?.url ?? "",
    sourceAuthor: draft.origin?.author ?? "",
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Quantità di una riga: vuoto vale «quanto basta». Un numero senza unità vale come pezzi. */
export function readIngredientQuantity(text: string): Parsed<Quantity | undefined> {
  const t = text.trim();
  if (t === "") return { ok: true, value: undefined };
  const parsed = parseQuantity(t);
  if (!parsed.ok || parsed.value.rest !== "") {
    return { ok: false, error: "Scrivi la quantità e l'unità, per esempio «200 g» o «2 cucchiai»." };
  }
  const q = parsed.value.quantity;
  if (!(q.value > 0) || !Number.isFinite(q.value)) return { ok: false, error: "La quantità deve essere maggiore di zero." };
  return { ok: true, value: q };
}

/** Minuti da un testo: "20", "20 min", "1 h 30". Vuoto = nessun valore. */
export function readMinutes(text: string): Parsed<number | undefined> {
  const t = text.trim();
  if (t === "") return { ok: true, value: undefined };
  let minutes: number | undefined;
  if (/^\d+$/.test(t)) minutes = Number(t);
  else minutes = parseDurationText(t);
  if (minutes === undefined || !(minutes > 0)) return { ok: false, error: "Scrivi i minuti, per esempio «20» o «1 h 30»." };
  if (minutes > RECIPE_LIMITS.minutesMax) return { ok: false, error: "Il tempo è troppo lungo." };
  return { ok: true, value: Math.round(minutes) };
}

export function readServings(text: string): Parsed<number> {
  const t = text.trim().replace(",", ".");
  if (t === "") return { ok: false, error: "Scrivi per quante porzioni." };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: NO_NUMBER };
  if (n > RECIPE_LIMITS.servingsMax) return { ok: false, error: "Sono troppe porzioni." };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return (u.protocol === "https:" || u.protocol === "http:") && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

export type BuildResult = { ok: true; fields: RecipeEventFields } | { ok: false; errors: FormErrors };

/**
 * Dai campi del modulo ai campi di un evento `recipe`. Le righe completamente vuote si saltano; una riga con la
 * sola quantità o la sola nota non è accettata. Serve almeno un ingrediente e un passo.
 */
export function buildRecipeFields(form: RecipeForm): BuildResult {
  const errors = emptyErrors();

  const title = form.title.replace(/\s+/g, " ").trim();
  if (title === "") errors.title = "Scrivi il titolo.";

  const servings = readServings(form.servingsText);
  if (!servings.ok) errors.servings = servings.error;

  const ingredients: RecipeIngredient[] = [];
  for (const row of form.ingredients) {
    const name = row.name.replace(/\s+/g, " ").trim();
    const note = row.note.replace(/\s+/g, " ").trim();
    if (name === "" && row.quantityText.trim() === "" && note === "") continue;
    if (name === "") {
      errors.ingredients[row.id] = "Scrivi come si chiama l'ingrediente.";
      continue;
    }
    let quantity: Quantity | undefined;
    if (row.original && row.quantityText === row.original.text) quantity = row.original.quantity;
    else {
      const q = readIngredientQuantity(row.quantityText);
      if (!q.ok) {
        errors.ingredients[row.id] = q.error;
        continue;
      }
      quantity = q.value;
    }
    ingredients.push({
      name: name.slice(0, 200),
      ...(quantity ? { quantity } : {}),
      ...(row.foodId ? { foodId: row.foodId } : {}),
      ...(note !== "" ? { note: note.slice(0, 200) } : {}),
    });
  }
  if (ingredients.length === 0 && Object.keys(errors.ingredients).length === 0) {
    errors.general = "Aggiungi almeno un ingrediente.";
  }

  const steps: RecipeStep[] = [];
  for (const row of form.steps) {
    const text = row.text.trim();
    if (text === "" && row.minutesText.trim() === "") continue;
    if (text === "") {
      errors.steps[row.id] = "Scrivi che cosa fare in questo passo.";
      continue;
    }
    const m = readMinutes(row.minutesText);
    if (!m.ok) {
      errors.steps[row.id] = m.error;
      continue;
    }
    steps.push({ text, ...(m.value !== undefined ? { durationMinutes: m.value } : {}) });
  }
  if (steps.length === 0 && Object.keys(errors.steps).length === 0 && errors.general === undefined) {
    errors.general = "Aggiungi almeno un passo.";
  }

  const times: RecipeTimes = {};
  for (const [key, field, text] of [
    ["prep", "prepMinutes", form.prepText],
    ["cook", "cookMinutes", form.cookText],
    ["total", "totalMinutes", form.totalText],
  ] as const) {
    const m = readMinutes(text);
    if (!m.ok) errors.times[key] = m.error;
    else if (m.value !== undefined) times[field] = m.value;
  }

  const url = form.sourceUrl.trim();
  if (url !== "" && !isHttpUrl(url)) errors.sourceUrl = "L'indirizzo deve cominciare con http:// o https://.";
  const author = form.sourceAuthor.replace(/\s+/g, " ").trim();

  if (hasErrors(errors)) return { ok: false, errors };

  const equipment = splitList(form.equipmentText);
  const tags = splitList(form.tagsText);
  const origin = { ...(url !== "" ? { url } : {}), ...(author !== "" ? { author: author.slice(0, 120) } : {}) };
  return {
    ok: true,
    fields: {
      title: title.slice(0, 160),
      servings: (servings as { ok: true; value: number }).value,
      ingredients,
      steps,
      ...(Object.keys(times).length > 0 ? { times } : {}),
      ...(equipment.length > 0 ? { equipment } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(origin).length > 0 ? { origin } : {}),
    },
  };
}

/** Un testo di una riga non riconosciuta, aggiunto come ingrediente o come passo. */
export function addLeftoverAsStep(form: RecipeForm, line: string): RecipeForm {
  const blank = form.steps.findIndex((s) => s.text.trim() === "" && s.minutesText.trim() === "");
  const row: StepRow = { id: nextRowId(), text: line, minutesText: "" };
  if (blank >= 0) return { ...form, steps: form.steps.map((s, i) => (i === blank ? { ...s, text: line } : s)) };
  return { ...form, steps: [...form.steps, row] };
}

export function addLeftoverAsIngredient(form: RecipeForm, line: string): RecipeForm {
  const blank = form.ingredients.findIndex((s) => s.name.trim() === "" && s.quantityText.trim() === "");
  if (blank >= 0) return { ...form, ingredients: form.ingredients.map((s, i) => (i === blank ? { ...s, name: line } : s)) };
  return { ...form, ingredients: [...form.ingredients, { id: nextRowId(), name: line, quantityText: "", note: "" }] };
}
