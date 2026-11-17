// La riga di stato sotto «Diario di oggi»: com'è messa la giornata fin qui, in una frase. Logica pura.
import type { DiaryDay } from "@/core/diary";
import { MEAL_KIND_LABELS, MOMENT_STARTS, momentsOf, type DeclarableKind } from "../meals";

const WITH_ARTICLE: Record<DeclarableKind, string> = { breakfast: "la colazione", lunch: "il pranzo", dinner: "la cena" };

function list(kinds: readonly DeclarableKind[]): string {
  const names = kinds.map((k) => MEAL_KIND_LABELS[k].toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Lo stato del giorno in una riga. Contano solo i momenti già cominciati (con `nowMinutes`, cioè oggi); senza, il
 * giorno è passato e contano tutti. Le bevande e l'acqua contano: con un tè segnato il giorno non è «niente». Un
 * momento vuoto non è un digiuno, e il testo non lo dice mai.
 */
export function dayStatusLine(day: DiaryDay | undefined, options: { nowMinutes?: number }): string {
  const { nowMinutes } = options;
  const past = nowMinutes === undefined;
  const moments = momentsOf(day);
  const started = moments.filter((m) => past || nowMinutes >= MOMENT_STARTS[m.kind]);

  const food = moments.some((m) => m.status !== "none") || (day?.meals.length ?? 0) > 0 || (day?.untrackedMeals.length ?? 0) > 0;
  const drinks = (day?.drinks.length ?? 0) > 0 || (day?.waterMl ?? 0) > 0;
  if (!food && !drinks) return past ? "Niente registrato in questo giorno." : "Ancora niente registrato oggi.";
  if (!food) return past ? "Solo bevande." : "Per ora solo bevande.";

  const missing = started.filter((m) => m.status === "none").map((m) => m.kind);
  if (missing.length === 1) return `Manca ${WITH_ARTICLE[missing[0]]}.`;
  if (missing.length > 1) return `Mancano ${list(missing)}.`;

  const untracked = started.filter((m) => m.status === "untracked").map((m) => m.kind);
  if (untracked.length > 0) return `Giornata dichiarata: ${list(untracked)} senza dettagli. Il totale è incompleto.`;
  return started.length < moments.length ? "Fin qui tutto registrato." : "Giornata completa.";
}

/** Il titolo della sezione: «Diario di oggi», oppure «Diario di lunedì 16» per un giorno passato. */
export function diaryTitle(date: string, today: string): string {
  if (date === today) return "Diario di oggi";
  const day = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  return `Diario di ${day}`;
}
