// I testi dei fogli «Da cosa è fatto» dei nutrienti: dalle parti già calcolate (`core/nutrition/breakdown.ts`) alle
// righe del foglio comune. Logica pura; nessun giudizio, solo che cosa c'è e quanto è certo.
import type { Certainty } from "@/core/ledger";
import type { BreakdownPart, DayBreakdown, DayCount, NutrientKey, PeriodBreakdown } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import type { BreakdownRow, BreakdownSheetProps } from "../common/Breakdown";
import { MEAL_KIND_LABELS } from "../meals";
import { shownForAverage, shownParts, type ShownPart } from "./apportion";
import { NUTRIENT_INFO, formatNutrient, nutrientLabel } from "./labels";
import { missingMealsText, prepPortionText, startedMissing, type Averages, type Contributor } from "./prepare";
import { isPrepRef, type PrepPortionInfo } from "./prepPortion";

/** Il contenuto del foglio, senza `onClose`. */
export type BreakdownContent = Omit<BreakdownSheetProps, "onClose">;

const shortDateFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** «mar 17 nov» */
export function shortDate(date: string): string {
  return shortDateFormat.format(new Date(`${date}T12:00:00Z`)).replace(/[.,]/g, "").toLowerCase();
}

const dayLabel = (date: string, today: string) => (date === today ? "oggi" : shortDate(date));

/** `/app?voce=<id evento>`; una voce libera di un pasto aggiunge la sua posizione, `<id del pasto>-<posizione>`, come la riga in Oggi. */
export const voceHref = (eventId: string, itemIndex?: number) =>
  `/app?voce=${encodeURIComponent(itemIndex === undefined ? eventId : `${eventId}-${itemIndex}`)}`;
export const dayHref = (date: string) => `/app?giorno=${encodeURIComponent(date)}`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Un numero in unità della precisione del nutriente: 1082 → «1082 kcal», 3 di sale → «0,3 g». */
function formatUnits(key: NutrientKey, units: number): string {
  const digits = NUTRIENT_INFO[key].digits;
  return formatNutrient(key, units / 10 ** digits, digits);
}

/** Una riga ripartita: il suo numero, o «meno di 0,1 g» se il valore c'è ma sta sotto la precisione mostrata. */
function formatShown(key: NutrientKey, s: ShownPart): string {
  return s.under ? `meno di ${formatUnits(key, 1)}` : formatUnits(key, s.units);
}

/* ---------- un nutriente in un giorno ---------- */

function partLabel(p: BreakdownPart): string {
  // una stima fuori casa è «1 pz» per forma: la quantità non dice niente
  if (p.outOfHome || !p.quantity) return p.label;
  return `${p.label} · ${formatQuantity(p.quantity)}`;
}

function prepOf(p: BreakdownPart, prepInfo: ReadonlyMap<string, PrepPortionInfo>): PrepPortionInfo | undefined {
  return p.ref !== undefined && isPrepRef(p.ref) ? prepInfo.get(p.ref) : undefined;
}

function partHint(p: BreakdownPart, prepInfo: ReadonlyMap<string, PrepPortionInfo>, missing: boolean): string {
  const where = p.kind === "drink" ? "bevanda" : p.mealKind ? MEAL_KIND_LABELS[p.mealKind].toLowerCase() : "fuori dai pasti";
  const parts = [where];
  if (p.outOfHome) parts.push(missing ? "stima fuori casa: solo l'energia" : "stima fuori casa");
  const prep = prepOf(p, prepInfo);
  if (prep) parts.push(`porzione di «${prep.title}»`);
  return parts.join(" · ");
}

function partRow(p: BreakdownPart, index: number, shown: string | undefined, prepInfo: ReadonlyMap<string, PrepPortionInfo>): BreakdownRow {
  const missing = shown === undefined;
  return {
    id: `${p.eventId}:${p.itemIndex ?? ""}:${index}`,
    label: partLabel(p),
    value: shown ?? "senza dato",
    ...(!missing && p.certainty ? { certainty: p.certainty } : {}),
    hint: partHint(p, prepInfo, missing),
    href: voceHref(p.eventId, p.itemIndex),
  };
}

/** Le righe come si scrivono: ripartite perché la loro somma sia il totale mostrato. */
function shownRows(b: DayBreakdown): { total: number; parts: ShownPart[] } | undefined {
  if (b.total === undefined) return undefined;
  return shownParts(
    b.parts.map((p) => p.value ?? 0),
    b.total,
    NUTRIENT_INFO[b.nutrient].digits,
  );
}

/** «Somma delle voci: 980 kcal.»: la somma delle righe come sono scritte, che è il totale mostrato; e quante voci non contano. */
export function dayCheckText(b: DayBreakdown): string | undefined {
  const shown = shownRows(b);
  if (!shown) return undefined;
  const sum = `Somma delle voci: ${formatUnits(b.nutrient, shown.parts.reduce((s, p) => s + p.units, 0))}.`;
  const n = b.missing.length;
  if (n === 0) return sum;
  return `${sum} ${n} ${plural(n, "voce senza valori non conta", "voci senza valori non contano")}: il totale è un minimo.`;
}

/** Perché il totale è una stima: le voci a occhio o da tabella generica, le stime fuori casa, le porzioni di preparazione. */
export function dayNoteText(b: DayBreakdown, certainty: Certainty | undefined, prepInfo: ReadonlyMap<string, PrepPortionInfo> = new Map()): string | undefined {
  const out: string[] = [];
  if (certainty === "estimated") {
    const n = b.parts.filter((p) => p.certainty === "estimated" && !p.outOfHome).length;
    if (n > 0) out.push(`È una stima: ${n} ${plural(n, "voce ha", "voci hanno")} la quantità a occhio o i valori da una tabella generica.`);
  }
  // solo dove la stima entra davvero nel totale: per gli altri nutrienti sta tra le voci senza dato
  const away = new Set(b.parts.filter((p) => p.outOfHome).map((p) => `${p.eventId}:${p.itemIndex ?? ""}`)).size;
  if (away === 1) out.push("Comprende una stima per un pasto fuori casa.");
  else if (away > 1) out.push(`Comprende le stime di ${away} pasti fuori casa.`);
  const seen = new Set<string>();
  for (const p of [...b.parts, ...b.missing]) {
    const prep = prepOf(p, prepInfo);
    if (!prep || seen.has(p.ref as string)) continue;
    seen.add(p.ref as string);
    if (prep.unresolved.length > 0 || prep.partial.length > 0) out.push(prepPortionText(prep));
  }
  return out.length > 0 ? out.join(" ") : undefined;
}

/** Il foglio di un nutriente in un giorno: «Energia di oggi». */
export function dayBreakdownContent(
  b: DayBreakdown,
  options: { partial: boolean; certainty: Certainty | undefined; prepInfo?: ReadonlyMap<string, PrepPortionInfo>; dayName?: string },
): BreakdownContent {
  const prepInfo = options.prepInfo ?? new Map<string, PrepPortionInfo>();
  const n = b.missing.length;
  const check = dayCheckText(b);
  const note = dayNoteText(b, options.certainty, prepInfo);
  const shown = shownRows(b);
  return {
    title: `${nutrientLabel(b.nutrient)} di ${options.dayName ?? "oggi"}`,
    total: shown ? formatUnits(b.nutrient, shown.total) : "nessun dato",
    ...(options.partial ? { totalPrefix: "almeno" } : {}),
    ...(options.certainty ? { totalCertainty: options.certainty } : {}),
    lead: "Quanto porta ogni voce registrata, dalla più grande.",
    rows: b.parts.map((p, i) => partRow(p, i, shown ? formatShown(b.nutrient, shown.parts[i]) : undefined, prepInfo)),
    ...(n > 0 ? { missingLabel: `Senza dato (${n}): non contano`, missing: b.missing.map((p, i) => partRow(p, i, undefined, prepInfo)) } : {}),
    ...(check ? { check } : {}),
    ...(note ? { note } : {}),
  };
}

/* ---------- giorni contati ---------- */

/** Oltre questo numero i giorni senza niente registrato stanno in una riga sola, in fondo. */
const NOTHING_GROUP_FROM = 4;

/** Perché un giorno non conta, in poche parole. Oggi, ciò che manca e non è ancora cominciato non è un motivo. */
export function notCountedText(d: Extract<DayCount, { counted: false }>, options: { today: string; nowMinutes?: number }): string {
  switch (d.why) {
    case "nothing":
      // anche un giorno con soli pesi o acqua: ciò che manca sono i pasti
      return "nessun pasto registrato";
    case "untracked_meals":
      return "un pasto senza dettagli";
    case "empty_meals":
      return "un pasto senza voci";
    case "missing_meals": {
      const isToday = d.date === options.today && options.nowMinutes !== undefined;
      const kinds = startedMissing(d.missingKinds ?? [], isToday ? options.nowMinutes : undefined);
      if (kinds.length > 0) return missingMealsText(kinds);
      return isToday ? "la giornata non è finita" : "mancano dei pasti";
    }
  }
}

/** «Giorni contati: 5 di 7»: il secondo numero è la durata del periodo. */
export const countedDaysText = (complete: number, periodDays: number): string => `Giorni contati: ${complete} di ${periodDays}`;

/** Il foglio «Giorni contati»: un giorno per riga, dal più recente, con il motivo di chi non conta. */
export function countedDaysContent(p: PeriodBreakdown, options: { today: string; nowMinutes?: number; note?: string }): BreakdownContent {
  const nothing = p.days.filter((d) => !d.counted && d.why === "nothing");
  const grouped = nothing.length >= NOTHING_GROUP_FROM;
  const rows: BreakdownRow[] = [];
  for (const d of p.days) {
    if (grouped && !d.counted && d.why === "nothing") continue;
    rows.push({
      id: d.date,
      label: dayLabel(d.date, options.today),
      value: d.counted ? "contato" : "non contato",
      ...(d.counted ? (d.outOfHome ? { hint: "con una stima fuori casa" } : {}) : { hint: notCountedText(d, options) }),
      href: dayHref(d.date),
    });
  }
  if (grouped) rows.push({ id: "nothing", label: `${nothing.length} giorni senza pasti registrati`, value: "non contati", muted: true });
  return {
    title: "Giorni contati",
    total: `${p.complete} di ${p.days.length}`,
    lead: "Contano solo i giorni con colazione, pranzo e cena tracciati.",
    rows,
    ...(options.note ? { note: options.note } : {}),
  };
}

/* ---------- una media ---------- */

/** «Media di 4 giorni con il dato (dei 5 contati, su 7).»: «contati» ha un solo significato, quello in cima alla schermata. */
export function averageCheckText(withData: number, complete: number, periodDays: number): string {
  const of = complete === 1 ? "l'unico contato" : `dei ${complete} contati`;
  return `Media di ${withData} ${plural(withData, "giorno", "giorni")} con il dato (${of}, su ${periodDays}).`;
}

/** Il foglio di una media: i giorni contati con il loro valore, le voci che pesano di più, i giorni senza il dato. */
export function averageContent(
  p: PeriodBreakdown,
  avg: Averages,
  options: { today: string; contributors: readonly Contributor[] },
): BreakdownContent {
  const key = p.nutrient;
  const n = p.days.length;
  const counted = p.days.flatMap((d) => (d.counted ? [d] : []));
  const withValue = counted.filter((d) => d.value !== undefined);
  const without = counted.filter((d) => d.value === undefined);
  // le righe ripartite: la loro media, come sono scritte, è la media mostrata
  const shown = shownForAverage(
    withValue.map((d) => d.value as number),
    avg.value,
    NUTRIENT_INFO[key].digits,
  );
  const notes: string[] = [];
  if (avg.certainty === "estimated") notes.push("È una stima: nei giorni contati ci sono quantità a occhio o valori da una tabella generica.");
  if (avg.partial) notes.push("Con «almeno»: in alcuni giorni una parte delle voci non ha il dato, quindi la media è un minimo.");
  if (key === "energyKcal" && withValue.some((d) => d.outOfHome)) notes.push("Comprende stime per pasti fuori casa.");
  return {
    title: `${nutrientLabel(key)}, media dei giorni contati`,
    total: formatUnits(key, shown.average),
    ...(avg.partial ? { totalPrefix: "almeno" } : {}),
    totalCertainty: avg.certainty,
    lead: "Media al giorno sui giorni contati che hanno questo valore.",
    rows: withValue.map((d, i) => {
      const hints = [...(d.partial ? ["è un minimo: alcune voci senza dato"] : []), ...(d.outOfHome ? ["con una stima fuori casa"] : [])];
      return {
        id: d.date,
        label: dayLabel(d.date, options.today),
        value: formatShown(key, shown.parts[i]),
        ...(d.certainty ? { certainty: d.certainty } : {}),
        ...(hints.length > 0 ? { hint: hints.join(" · ") } : {}),
        href: dayHref(d.date),
      };
    }),
    ...(options.contributors.length > 0
      ? {
          extra: {
            label: "Le voci che pesano di più",
            rows: options.contributors.map((c) => ({
              id: c.key,
              label: c.name,
              value: `${Math.round(c.share * 100)}%`,
              hint: `${formatNutrient(key, c.value)} nel periodo${c.outOfHome ? " · stima fuori casa" : ""}`,
            })),
          },
        }
      : {}),
    ...(without.length > 0
      ? {
          missingLabel: `Senza dato (${without.length}): non contano`,
          missing: without.map((d) => ({ id: d.date, label: dayLabel(d.date, options.today), value: "senza dato", hint: "nessuna voce con questo valore", href: dayHref(d.date) })),
        }
      : {}),
    check: averageCheckText(p.counted, p.complete, n),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}
