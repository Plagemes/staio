// Dalla didascalia o dalla lettura del video alla bozza di ricetta da confermare. Si riusa la bozza
// dell'importazione da testo: stessi campi, stessa schermata di revisione. Il link originale resta come fonte.
import type { VideoRecipe, VideoRecipeReading } from "@/core/ai/videoRecipeParse";
import { parseRecipeText, type ParsedIngredient } from "@/core/recipes";
import { draftFromText, draftIsEmpty, type ImportDraft } from "../recipes/importDraft";

/**
 * La didascalia contiene la ricetta? Sì se ha gli elenchi «Ingredienti» e «Preparazione» con almeno due righe di
 * ingredienti, oppure, senza intestazioni, se si leggono almeno tre ingredienti e due passi. Una frase di commento
 * o una serie di hashtag no: in quel caso si chiede il video o si lascia incollare il testo.
 */
export function captionHasRecipe(text: string): boolean {
  if (text.trim() === "") return false;
  const parsed = parseRecipeText(text);
  if (parsed.structured && parsed.ingredients.length >= 2) return true;
  return parsed.ingredients.length >= 3 && parsed.steps.length >= 2;
}

/** Bozza dal testo, con il link come fonte. Null se dal testo non esce niente. */
export function draftFromCaption(text: string, url?: string): ImportDraft | null {
  const draft = draftFromText(text, url ? { url } : {});
  return draftIsEmpty(draft) ? null : draft;
}

function ingredientRaw(name: string, quantity: { value: number; unit: string } | undefined, note?: string): string {
  const parts = [quantity ? `${quantity.value} ${quantity.unit}` : "", name, note ? `(${note})` : ""];
  return parts.filter((p) => p !== "").join(" ");
}

/** Bozza dalla ricetta letta da un video. Le quantità che mancano restano assenti. */
export function draftFromVideo(recipe: VideoRecipe, url?: string): ImportDraft {
  const ingredients: ParsedIngredient[] = recipe.ingredients.map((i) => ({
    raw: ingredientRaw(i.name, i.quantity, i.note),
    name: i.name,
    ...(i.quantity ? { quantity: i.quantity } : {}),
    ...(i.note ? { note: i.note } : {}),
    recognized: i.quantity !== undefined,
  }));
  return {
    ...(recipe.title ? { title: recipe.title } : {}),
    ...(recipe.servings !== undefined ? { servings: recipe.servings } : {}),
    ingredients,
    steps: recipe.steps,
    ...(recipe.times ? { times: recipe.times } : {}),
    ...(recipe.equipment.length > 0 ? { equipment: recipe.equipment } : {}),
    ...(url ? { origin: { url } } : {}),
    leftovers: [],
    via: "text",
  };
}

export interface VideoDraftResult {
  draft: ImportDraft;
  /** Avvisi (quantità tolte, risposta incompleta…) e punti incerti, in frasi per chi rivede. */
  notes: string[];
}

/** Bozza dalla lettura del modello, o null se il video non conteneva una ricetta leggibile. */
export function draftFromReading(reading: VideoRecipeReading, url?: string): VideoDraftResult | null {
  if (!reading.isRecipe || !reading.recipe) return null;
  const warnings = reading.problems.filter((p) => p.severity === "warning").map((p) => p.message);
  return { draft: draftFromVideo(reading.recipe, url), notes: [...warnings, ...reading.uncertain] };
}
