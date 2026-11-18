// Che cosa dice una riga richiusa di Oggi senza aprirla: il pasto, ciò che scade, i nutrienti, i movimenti. Funzioni pure.
import type { NutrientTotal } from "@/core/nutrition";
import type { PantryEntry } from "../lots";
import { expiryTagView } from "../lots";
import { formatNutrient } from "../nutrition/labels";
import type { DayNutritionView, NutrientCell } from "../nutrition/prepare";

/** In mezzo a una frase il nome comincia con la minuscola: «petto di pollo». Le sigle restano come sono. */
export const inSentence = (name: string): string => name.trim().replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());

const MAX_NAMES = 3;

/**
 * Il riepilogo di un pasto registrato: «8:10 · latte, pane, marmellata e altre 2 · ~420 kcal». Al massimo tre nomi;
 * l'energia solo se il calcolo dei nutrienti la dà per quel pasto, con la tilde se è una stima e «almeno» se a qualche
 * voce manca il dato.
 */
export function mealSummary(args: {
  time: string;
  /** «colazione», quando il titolo della riga è il nome del pasto e non dice il momento. */
  moment?: string;
  names: readonly string[];
  energy?: Pick<NutrientTotal, "value" | "certainty" | "partial">;
}): string {
  const names = args.names.map(inSentence).filter((n) => n !== "");
  const more = names.length - MAX_NAMES;
  const shown = names.slice(0, MAX_NAMES).join(", ") + (more === 1 ? " e un'altra" : more > 1 ? ` e altre ${more}` : "");
  const energy = args.energy
    ? `${args.energy.partial ? "almeno " : ""}${args.energy.certainty === "estimated" ? "~" : ""}${formatNutrient("energyKcal", args.energy.value)}`
    : "";
  return [args.time, args.moment ?? "", shown, energy].filter((part) => part !== "").join(" · ");
}

/**
 * Il riepilogo di «In scadenza»: «3 alimenti · petto di pollo, ~2 giorni»; con uno solo, «petto di pollo, ~2 giorni».
 * `first` è l'alimento che scade prima, `count` quante righe ci sono dentro.
 */
export function expiringSummary(first: PantryEntry, count: number): string {
  const tag = expiryTagView(first);
  const name = inSentence(first.lot.productRef);
  const one = tag ? `${name}, ${tag.estimated ? "~" : ""}${tag.text}` : name;
  return count > 1 ? `${count} alimenti · ${one}` : one;
}

const cellText = (cell: NutrientCell): string => `${cell.prefix}${cell.certainty === "estimated" ? "~" : ""}${cell.text}`;

/**
 * Il riepilogo di «Nutrienti»: «~241 kcal · ~45 g proteine», «per ora solo bevande: ~1 kcal», «niente da calcolare»;
 * «calcolo…» finché la vista non c'è.
 */
export function nutritionSummary(view: DayNutritionView | undefined): string {
  if (!view) return "calcolo…";
  if (view.drinksOnlyText) return inSentence(view.drinksOnlyText.replace(/\.$/, ""));
  if (view.empty) return "niente da calcolare";
  const protein = view.macros.find((m) => m.key === "proteinG");
  const parts = [...(view.energy ? [cellText(view.energy)] : []), ...(protein ? [`${cellText(protein)} proteine`] : [])];
  return parts.length > 0 ? parts.join(" · ") : "senza energia né proteine nelle voci riconosciute";
}

/** «6 movimenti», «1 movimento». */
export const movementsSummary = (count: number): string => (count === 1 ? "1 movimento" : `${count} movimenti`);

const REVIEW_NOTICE_TYPES: ReadonlySet<string> = new Set(["shopping", "plan"]);

/**
 * Gli avvisi che il riepilogo dice come «altri avvisi»: spesa e piano, tutti. Nessuno ripete le righe «Lista della
 * spesa: N voci» e «Nel piano, non fatti: N» («Spesa: serve X», «Da cucinare», «Piano della prossima settimana vuoto»
 * dicono altro), quindi nessuno si toglie per quelle. Scadenze e preparazioni non passano di qui perché il riepilogo ha
 * già la sua riga per loro, dagli stessi fatti.
 */
export function reviewNotices<T extends { type: string }>(notices: readonly T[]): T[] {
  return notices.filter((n) => REVIEW_NOTICE_TYPES.has(n.type));
}
