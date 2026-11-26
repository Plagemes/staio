// Testi della scheda ricetta: la riga di stato, i riassunti delle sezioni richiuse e il testo da condividere. Logica pura.
import type { Recipe } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { formatMinutes, formatServings } from "./common";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** «hai 6 ingredienti su 8», o «hai tutto». Vuoto se la ricetta non ha ingredienti. */
export function haveText(args: { total: number; missing: number; pending: number }): string | undefined {
  if (args.total <= 0) return undefined;
  if (args.missing === 0 && args.pending === 0) return "hai tutto";
  const have = Math.max(0, args.total - args.missing - args.pending);
  return `hai ${plural(have, "ingrediente", "ingredienti")} su ${args.total}`;
}

/** «35 min · 2 porzioni · hai 6 ingredienti su 8». Senza tempo, senza quella parte. */
export function statusLine(args: { minutes?: number; servings: number; have?: string }): string {
  return [args.minutes !== undefined ? formatMinutes(args.minutes) : undefined, formatServings(args.servings), args.have]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

/** «7 passi · 35 min». */
export function stepsSummary(steps: number, minutes: number | undefined): string {
  const base = plural(steps, "passo", "passi");
  return minutes !== undefined ? `${base} · ${formatMinutes(minutes)}` : base;
}

/** «3 volte · ultima il 2 nov», o «Non ancora cucinata». `lastDay` è già scritto («2 nov»). */
export function cookedSummary(times: number, lastDay: string | undefined): string {
  if (times <= 0) return "Non ancora cucinata";
  return `${plural(times, "volta", "volte")}${lastDay ? ` · ultima il ${lastDay}` : ""}`;
}

/** Titolo, porzioni, ingredienti e passi in testo semplice. Niente indirizzi verso l'app. */
export function shareText(recipe: Pick<Recipe, "title" | "servings" | "ingredients" | "steps">, servings = recipe.servings): string {
  const lines: string[] = [recipe.title, formatServings(servings), ""];
  if (recipe.ingredients.length > 0) {
    lines.push("Ingredienti");
    for (const ing of recipe.ingredients) {
      lines.push(`- ${ing.quantity ? `${formatQuantity(ing.quantity)} ` : ""}${ing.name}${ing.note ? ` (${ing.note})` : ""}`);
    }
    lines.push("");
  }
  if (recipe.steps.length > 0) {
    lines.push("Passi");
    recipe.steps.forEach((step, i) => lines.push(`${i + 1}. ${step.text}`));
  }
  return lines.join("\n").trim();
}

export const SHARE_COPIED = "Ricetta copiata: incollala dove vuoi.";
export const SHARE_FAILED = "Non riesco a condividerla da qui.";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** Condivide con il telefono; se non si può, copia lo stesso testo negli appunti. Chiudere il foglio di condivisione non è un errore. */
export async function shareRecipe(
  payload: { title: string; text: string },
  env: {
    share?: (data: { title: string; text: string }) => Promise<void>;
    copy?: (text: string) => Promise<void>;
  },
): Promise<ShareOutcome> {
  if (env.share) {
    try {
      await env.share(payload);
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
    }
  }
  if (env.copy) {
    try {
      await env.copy(payload.text);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}
