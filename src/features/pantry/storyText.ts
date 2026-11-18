// I testi della storia di un alimento: una riga per evento e il riepilogo della riga richiusa. Solo funzioni pure.
import type { DiaryMeal, DiaryState, MealKind } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { LotStoryRow, Unit } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { dayOf, formatCalendarDate, formatPrice, formatTime } from "../format";
import { DISCARD_REASON_LABELS, LOCATION_LABELS } from "../labels";

export interface StoryLine {
  key: string;
  /** «12 nov», o «14 nov, 20:10» per ciò che è stato mangiato. */
  when: string;
  text: string;
  /** La voce del diario a cui porta la riga, se ce n'è una. */
  href?: string;
  /** La quantità della riga è una stima (il testo porta già la tilde). */
  estimated: boolean;
}

export interface StoryContext {
  unit: Unit;
  diary: DiaryState | undefined;
  timeZone: string;
  /** L'istante di adesso: serve solo a scrivere l'anno delle date di un anno diverso. */
  now?: string;
}

const MEAL_PHRASE: Record<MealKind, string> = {
  breakfast: "a colazione",
  lunch: "a pranzo",
  dinner: "a cena",
  snack: "come spuntino",
};

/** I nomi dei campi che una correzione può cambiare, nell'ordine in cui si elencano. */
const FIELD_NAMES: Record<string, string> = {
  productRef: "nome",
  category: "categoria",
  barcode: "codice a barre",
  expiry: "scadenza",
  priceCents: "prezzo",
  store: "negozio",
};

const lower = (s: string): string => (s === "" ? s : s[0].toLowerCase() + s.slice(1));
const capital = (s: string): string => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

/** «12 nov»; l'anno c'è solo se è diverso da quello di `now`. */
function dayText(day: string, now: string | undefined, timeZone: string): string {
  const text = formatCalendarDate(day);
  const sameYear = now === undefined || day.slice(0, 4) === dayOf(now, timeZone).slice(0, 4);
  return sameYear ? text.replace(/\s\d{4}$/, "") : text;
}

function mealsById(diary: DiaryState | undefined): Map<string, DiaryMeal> {
  const out = new Map<string, DiaryMeal>();
  for (const day of diary?.days ?? []) for (const meal of day.meals) if (!out.has(meal.mealId)) out.set(meal.mealId, meal);
  return out;
}

function lineOf(row: LotStoryRow, ctx: StoryContext, meals: ReadonlyMap<string, DiaryMeal>): StoryLine {
  const { unit, timeZone, now } = ctx;
  const estimated = row.certainty === "estimated";
  const amount = (value: number | undefined): string | undefined =>
    value === undefined ? undefined : formatQuantity({ value: Math.abs(value), unit }, { estimated });
  const day = dayText(dayOf(row.at, timeZone), now, timeZone);
  const line = (when: string, text: string, extra: Partial<StoryLine> = {}): StoryLine => ({ key: row.eventId, when, text, estimated: false, ...extra });

  switch (row.kind) {
    case "bought": {
      const parts = [`Comprato: ${amount(row.quantityDelta) ?? "?"}`];
      if (row.priceCents !== undefined) parts.push(formatPrice(row.priceCents));
      if (row.store !== undefined) parts.push(row.store);
      return line(day, parts.join(" · "), { estimated });
    }
    case "declared":
      return line(day, `Già in casa: ${amount(row.quantityDelta) ?? "?"}`, { estimated });
    case "eaten": {
      const meal = row.mealId !== undefined ? meals.get(row.mealId) : undefined;
      const at = meal?.at ?? row.at;
      const title = meal?.title?.trim();
      const head = meal ? `Mangiato ${MEAL_PHRASE[meal.kind]}${title ? ` (${title})` : ""}` : "Mangiato";
      return line(`${dayText(dayOf(at, timeZone), now, timeZone)}, ${formatTime(at, timeZone)}`, `${head}: ${amount(row.quantityDelta) ?? "?"}`, {
        href: `/app?voce=${encodeURIComponent(row.eventId)}`,
        estimated,
      });
    }
    case "discarded": {
      const reason = row.reason !== undefined ? ` (${lower(DISCARD_REASON_LABELS[row.reason])})` : "";
      return line(day, `Buttato: ${amount(row.quantityDelta) ?? "?"}${reason}`, { estimated });
    }
    case "gifted":
      return line(day, `Regalato: ${amount(row.quantityDelta) ?? "?"}`, { estimated });
    case "opened":
      return line(day, "Aperto");
    case "moved":
      return line(day, row.to !== undefined ? `Spostato in ${lower(LOCATION_LABELS[row.to])}` : "Spostato");
    case "adjusted": {
      const left = row.remainingAfter;
      const text = left === undefined ? "Corretto" : left <= 0 ? "Corretto: non ne resta niente" : `Corretto: ne restano ${amount(left)}`;
      return line(day, text, { estimated });
    }
    case "corrected": {
      const names = (row.fields ?? []).flatMap((f) => (FIELD_NAMES[f] ? [FIELD_NAMES[f]] : []));
      return line(day, names.length > 0 ? `Corretto: ${names.join(", ")}` : "Corretto");
    }
  }
}

function lastOf(rows: readonly LotStoryRow[], test: (row: LotStoryRow) => boolean): LotStoryRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (test(rows[i])) return rows[i];
  return undefined;
}

/** Le righe della storia nell'ordine in cui arrivano (la più recente per prima). */
export function storyLines(rows: readonly LotStoryRow[], ctx: StoryContext): StoryLine[] {
  const meals = mealsById(ctx.diary);
  return rows.map((row) => lineOf(row, ctx, meals));
}

/**
 * Il riepilogo della riga richiusa: «Comprato il 12 nov · aperto il 14 · mangiato 2 volte».
 * Le righe vanno dalla più recente: la prima apertura è l'ultima «aperto» dell'elenco.
 */
export function storySummary(rows: readonly LotStoryRow[], ctx: { timeZone?: string; now?: string } = {}): string {
  const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const { now } = ctx;
  const parts: string[] = [];

  const entry = lastOf(rows, (r) => r.kind === "bought" || r.kind === "declared");
  const entryDay = entry ? dayOf(entry.at, timeZone) : undefined;
  if (entry && entryDay) parts.push(`${entry.kind === "bought" ? "comprato il" : "in casa dal"} ${dayText(entryDay, now, timeZone)}`);

  const opened = lastOf(rows, (r) => r.kind === "opened");
  if (opened) {
    const day = dayOf(opened.at, timeZone);
    // nello stesso mese dell'ingresso basta il giorno: «aperto il 14»
    parts.push(`aperto il ${entryDay && day.slice(0, 7) === entryDay.slice(0, 7) ? String(Number(day.slice(8))) : dayText(day, now, timeZone)}`);
  }

  const eaten = rows.filter((r) => r.kind === "eaten").length;
  if (eaten > 0) parts.push(eaten === 1 ? "mangiato una volta" : `mangiato ${eaten} volte`);

  const discarded = rows.filter((r) => r.kind === "discarded");
  if (discarded.length > 0) {
    const thrown = discarded.reduce((sum, r) => sum + Math.abs(r.quantityDelta ?? 0), 0);
    const initial = entry?.quantityDelta;
    parts.push(initial !== undefined && thrown >= initial - 1e-9 ? "buttato" : "buttato in parte");
  }

  const moved = rows.find((r) => r.kind === "moved");
  if (moved) parts.push(moved.to !== undefined ? `spostato in ${lower(LOCATION_LABELS[moved.to])}` : "spostato");

  if (rows.some((r) => r.kind === "adjusted" || r.kind === "corrected")) parts.push("corretto");

  return capital(parts.join(" · "));
}
