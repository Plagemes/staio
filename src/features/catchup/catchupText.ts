// «Mettiamoci in pari»: tutti i testi calcolati, dalla riga di Oggi alla frase di «Ultime azioni». Funzioni pure.
import type { CatchUpEntry, MealKind } from "@/core/diary";
import { MEAL_KIND_LABELS } from "../meals";

export const CATCHUP_TITLE = "Mettiamoci in pari";
export const CATCHUP_EXPLAIN = 'Sono stime: non tolgono niente dalla dispensa. "Non ricordo" toglie il giorno dalle medie dei nutrienti.';
export const NOTHING_LEFT = "Questi giorni sono già nel diario.";
export const SAVE_ERROR = "Non sono riuscito a salvare sul telefono. Riprova.";
export const DISMISS_ERROR = "Non sono riuscito a ricordarlo. Riprova.";
export const SEE_IN_TODAY = "Vedi in Oggi";
/** Accanto alla scelta di un momento che scrive un pasto: è una supposizione. */
export const ESTIMATE_LABEL = "stima";

const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

const parts = (date: string): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** «lunedì 14»: il giorno di calendario, senza fuso (è già una data). */
export function dayName(date: string): string {
  const { year, month, day } = parts(date);
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${day}`;
}

/** «3 giorni senza niente nel diario · Mettiamoci in pari» */
export function catchUpLineText(days: number): string {
  return `${days} ${days === 1 ? "giorno" : "giorni"} senza niente nel diario · ${CATCHUP_TITLE}`;
}

/** «Lunedì 14 · 1 di 3» */
export function stepTitle(date: string, index: number, total: number): string {
  return `${capital(dayName(date))} · ${index + 1} di ${total}`;
}

/** «Il solito: Solito pranzo» */
export const habitLabel = (title: string): string => `Il solito: ${title.trim()}`;

/** «Come lunedì 13: pasta al pomodoro, insalata» */
export const repeatLabel = (date: string, names: string): string => (names === "" ? `Come ${dayName(date)}` : `Come ${dayName(date)}: ${names}`);

/** «Pranzo · Come lunedì 13: pasta al pomodoro, insalata» */
export const momentLine = (kind: MealKind, choice: string): string => `${MEAL_KIND_LABELS[kind]} · ${choice}`;

/** «pasta, insalata, mela e altri 2»: i nomi senza ripetizioni, al massimo tre, con la minuscola in mezzo alla frase. */
export function namesText(names: readonly string[]): string {
  const lower = names.map((n) => n.trim().replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase())).filter((n) => n !== "");
  const unique = [...new Set(lower)];
  const more = unique.length - 3;
  return unique.slice(0, 3).join(", ") + (more === 1 ? " e un altro" : more > 1 ? ` e altri ${more}` : "");
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * L'avviso dopo «Salva»: «Messo in pari: 3 giorni, 7 pasti, 2 saltati.». «Non ricordo» conta come pasto (mangiato,
 * senza dettagli); le parti a zero non si dicono.
 */
export function savedMessage(entries: readonly CatchUpEntry[]): string {
  const days = new Set(entries.map((e) => e.date)).size;
  const skipped = entries.filter((e) => e.choice.kind === "skipped").length;
  const meals = entries.length - skipped;
  const said = [counted(days, "giorno", "giorni")];
  if (meals > 0) said.push(counted(meals, "pasto", "pasti"));
  if (skipped > 0) said.push(counted(skipped, "saltato", "saltati"));
  return `Messo in pari: ${said.join(", ")}.`;
}

const joined = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;

/** «lunedì 14, pranzo e cena e martedì 15, colazione»: i momenti per giorno, in ordine. */
function momentsText(list: readonly Pick<CatchUpEntry, "date" | "kind">[]): string {
  const byDay = new Map<string, MealKind[]>();
  for (const e of [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const kinds = byDay.get(e.date) ?? [];
    if (!kinds.includes(e.kind)) kinds.push(e.kind);
    byDay.set(e.date, kinds);
  }
  const order: readonly MealKind[] = ["breakfast", "lunch", "dinner", "snack"];
  const said = [...byDay.entries()].map(([date, kinds]) => {
    const names = [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => MEAL_KIND_LABELS[k].toLowerCase());
    return `${dayName(date)}, ${joined(names)}`;
  });
  return capital(said.length === 1 ? said[0] : `${said.slice(0, -1).join(", ")} e ${said[said.length - 1]}`);
}

/**
 * Ciò che la rilettura ha trovato già scritto: «Lunedì 14, pranzo era già nel diario: l'ho lasciato com'era.»; più
 * momenti: «Lunedì 14, pranzo e cena e martedì 15, colazione erano già nel diario: li ho lasciati com'erano.».
 */
export function alreadyThereText(filled: readonly Pick<CatchUpEntry, "date" | "kind">[]): string {
  if (filled.length === 0) return "";
  return filled.length === 1
    ? `${momentsText(filled)} era già nel diario: l'ho lasciato com'era.`
    : `${momentsText(filled)} erano già nel diario: li ho lasciati com'erano.`;
}

/**
 * Ciò che l'archivio ha respinto in una scrittura entrata solo in parte: «Martedì 15, cena non è entrata nel diario:
 * riprova da Oggi.». Il resto è scritto e si annulla con «Annulla».
 */
export function rejectedText(rejected: readonly Pick<CatchUpEntry, "date" | "kind">[]): string {
  if (rejected.length === 0) return "";
  if (rejected.length > 1) return `${momentsText(rejected)} non sono entrati nel diario: riprova da Oggi.`;
  return `${momentsText(rejected)} non è ${rejected[0].kind === "lunch" ? "entrato" : "entrata"} nel diario: riprova da Oggi.`;
}

/** «14-16 nov», «30 ott-2 nov», «30 dic 2025-2 gen 2026»; un giorno solo: «lunedì 14». */
export function dayRangeText(dates: readonly string[]): string {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length === 0) return "";
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return dayName(first);
  const a = parts(first);
  const b = parts(last);
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month - 1]} ${a.year}-${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month - 1]}-${b.day} ${MONTHS[b.month - 1]}`;
  return `${a.day}-${b.day} ${MONTHS[b.month - 1]}`;
}

/** La riga di «Ultime azioni»: «Messo in pari: 14-16 nov», «Messo in pari: lunedì 14». */
export const catchUpOperationText = (dates: readonly string[]): string => `Messo in pari: ${dayRangeText(dates)}`;

/** Dove porta: il primo giorno, in Oggi. */
export const catchUpDayHref = (date: string): string => `/app?giorno=${encodeURIComponent(date)}`;
