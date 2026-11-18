// Dai risultati del motore ai dati pronti per le schermate: ordinamento, quote, testi di certezza e di parzialità.
// Linguaggio: assunzione rispetto a un riferimento, mai «carenza». Nessun obiettivo di energia.
import { addDays } from "@/core/diary";
import type { Certainty } from "@/core/ledger";
import {
  normalizeName,
  type DayIntake,
  type IntakeLine,
  type NutrientKey,
  type ReferenceComparison,
  type ReferenceKind,
  type FoodState,
  type ResolvedLine,
  type StatePreference,
  type UnresolvedLine,
} from "@/core/nutrition";
import type { MealKind } from "@/core/diary";
import { MAIN_MEALS, MEAL_KIND_LABELS, MOMENT_STARTS, type DeclarableKind } from "../meals";
import type { MealItemRef } from "./corrections";
import { isPrepRef, type PrepPortionInfo } from "./prepPortion";
import { NUTRIENT_INFO, OUT_OF_HOME_EXPLANATION, REFERENCE_KIND_LABELS, STATE_LABELS, formatNutrient, nutrientLabel, variantLabel } from "./labels";

/** Quota di dato mancante a parole: da qualunque valore maggiore di zero, mai arrotondata a niente. */
export function missingPercentText(share: number): string {
  if (!(share > 0)) return "0%";
  return share < 0.005 ? "meno dell'1%" : `${Math.round(share * 100)}%`;
}

/* ---------- giorno ---------- */

export interface NutrientCell {
  key: NutrientKey;
  label: string;
  /** Numero già formattato con l'unità, per esempio "550 kcal". */
  text: string;
  /** "almeno " se mancano dati in qualche voce (il valore è un minimo), altrimenti vuoto: va scritto fuori dalla stima. */
  prefix: string;
  value: number;
  /** Mancano dati in almeno una voce: il valore è un minimo. */
  partial: boolean;
  certainty: Certainty;
  /** Quota del totale per cui manca il dato, da 0 a 1. */
  missingShare: number;
}

export interface DayNutritionView {
  date: string;
  /** Niente da calcolare: nessuna voce con nutrienti in questo giorno. */
  empty: boolean;
  complete: boolean;
  /**
   * Nel giorno ci sono solo bevande e nessun pasto né consumo: invece della scheda intera basta una riga breve
   * («Per ora solo bevande: ~1 kcal»).
   */
  drinksOnlyText?: string;
  /** Frase per un giorno incompleto: il totale è parziale. */
  partialText?: string;
  /** "calcolato su 4 voci di 6", solo se qualche voce non ha dati. */
  coverageText?: string;
  /** "Dato mancante per: Energia 12%, Proteine 5%.": ogni nutriente con una quota mancante maggiore di zero. */
  missingText?: string;
  resolved: number;
  total: number;
  energy?: NutrientCell;
  macros: NutrientCell[];
  certainty?: Certainty;
}

const MACROS: readonly NutrientKey[] = ["proteinG", "carbsG", "sugarsG", "fatG", "saturatedFatG", "fiberG"];

function cell(day: DayIntake, key: NutrientKey): NutrientCell | undefined {
  const t = day.totals[key];
  if (!t) return undefined;
  const base = formatNutrient(key, t.value);
  return {
    key,
    label: nutrientLabel(key),
    text: base,
    prefix: t.partial ? "almeno " : "",
    value: t.value,
    partial: t.partial,
    certainty: t.certainty,
    missingShare: t.missingShare,
  };
}

function reasonsText(day: DayIntake): string {
  const parts: string[] = [];
  if (day.reasons.includes("untracked_meals")) parts.push("ci sono pasti segnati come non tracciati");
  if (day.reasons.includes("missing_meals")) {
    const missing = MAIN_MEALS.filter((k) => day.coverage.missing.includes(k)).map((k) => MEAL_KIND_LABELS[k].toLowerCase());
    parts.push(missing.length > 0 ? `mancano ${missing.join(", ")}` : "mancano dei pasti");
  }
  if (day.reasons.includes("empty_meals")) parts.push("un pasto è senza voci");
  return parts.join("; ");
}

const WITH_ARTICLE: Record<DeclarableKind, string> = { breakfast: "la colazione", lunch: "il pranzo", dinner: "la cena" };

function kindList(kinds: readonly DeclarableKind[]): string {
  const names = kinds.map((k) => MEAL_KIND_LABELS[k].toLowerCase());
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

const isDeclarable = (k: MealKind): k is DeclarableKind => k === "breakfast" || k === "lunch" || k === "dinner";

/**
 * I pasti principali che mancano e sono già cominciati, con la stessa regola dello stato del giorno
 * (`today/dayStatus.ts`, `MOMENT_STARTS`): senza `nowMinutes` il giorno è passato e contano tutti.
 */
export function startedMissing(missing: readonly MealKind[], nowMinutes?: number): DeclarableKind[] {
  return MAIN_MEALS.filter(isDeclarable).filter((k) => missing.includes(k) && (nowMinutes === undefined || nowMinutes >= MOMENT_STARTS[k]));
}

/** «manca il pranzo», «mancano colazione e pranzo»; vuoto se non manca niente. */
export function missingMealsText(kinds: readonly DeclarableKind[]): string {
  if (kinds.length === 0) return "";
  return kinds.length === 1 ? `manca ${WITH_ARTICLE[kinds[0]]}` : `mancano ${kindList(kinds)}`;
}

/** Il motivo per cui il totale di oggi è parziale, contando solo i momenti già cominciati. */
function reasonsTextToday(day: DayIntake, nowMinutes: number): string {
  const parts: string[] = [];
  if (day.reasons.includes("untracked_meals")) parts.push("ci sono pasti segnati come non tracciati");
  const missing = missingMealsText(startedMissing(day.coverage.missing, nowMinutes));
  if (missing) parts.push(missing);
  if (day.reasons.includes("empty_meals")) parts.push("un pasto è senza voci");
  return parts.length > 0 ? parts.join("; ") : "la giornata non è finita";
}

function linesOf(day: DayIntake): IntakeLine[] {
  return [...day.meals.flatMap((m) => m.lines), ...day.standalone];
}

/**
 * Energia e macronutrienti di una giornata, ognuno con la sua certezza; dice se il totale è parziale. Con `nowMinutes`
 * (il giorno è oggi) la frase sul totale parziale conta solo i momenti già cominciati, come lo stato del giorno.
 */
export function dayNutritionView(day: DayIntake | undefined, date: string, options: { nowMinutes?: number } = {}): DayNutritionView {
  if (!day) return { date, empty: true, complete: false, resolved: 0, total: 0, macros: [] };
  const lines = linesOf(day);
  const resolved = lines.filter((l) => l.status === "ok").length;
  const energy = cell(day, "energyKcal");
  const macros = MACROS.flatMap((k) => {
    const c = cell(day, k);
    return c ? [c] : [];
  });
  const empty = energy === undefined && macros.length === 0;
  const missingCells = [...(energy ? [energy] : []), ...macros].filter((c) => c.missingShare > 0);
  const drinksOnly = day.meals.length === 0 && day.standalone.length === 0 && day.drinks.length > 0;
  const drinksOnlyText = drinksOnly
    ? `Per ora solo bevande${energy ? `: ${energy.prefix}${energy.certainty === "estimated" ? "~" : ""}${energy.text}` : ""}.`
    : undefined;
  return {
    date,
    ...(drinksOnlyText ? { drinksOnlyText } : {}),
    empty,
    complete: day.complete,
    ...(day.complete
      ? {}
      : { partialText: `Totale parziale: ${options.nowMinutes === undefined ? reasonsText(day) : reasonsTextToday(day, options.nowMinutes)}.` }),
    ...(resolved < lines.length ? { coverageText: `calcolato su ${resolved} ${resolved === 1 ? "voce" : "voci"} di ${lines.length}` } : {}),
    ...(missingCells.length > 0 ? { missingText: `Dato mancante per: ${missingCells.map((c) => `${c.label.toLowerCase()} ${missingPercentText(c.missingShare)}`).join(", ")}.` } : {}),
    resolved,
    total: lines.length,
    ...(energy ? { energy } : {}),
    macros,
    ...(day.certainty !== undefined ? { certainty: day.certainty } : {}),
  };
}

/* ---------- confronto con i riferimenti ---------- */

export interface ComparisonRow {
  /** `nutriente:tipo` */
  id: string;
  nutrient: NutrientKey;
  label: string;
  refKind: ReferenceKind;
  refKindLabel: string;
  kind: "compared" | "note" | "insufficient";
  /** Riga principale, per esempio "72% del riferimento". */
  headline: string;
  detail: string;
  /** Quota coperta per la barra, da 0 a 1,5 (oltre si taglia); assente se non ha senso. */
  share?: number;
  /** Quanto è lontano dal riferimento (per l'ordine): più alto = più lontano. */
  distance: number;
  certainty?: Certainty;
  /** Nota del valore di riferimento. */
  note?: string;
  /** Variante predefinita applicata: dillo e porta al profilo. */
  defaultVariantText?: string;
  /** Il totale è parziale: manca il dato in una parte delle voci, quindi il numero è un minimo. */
  partial?: boolean;
  /** Quota di dato mancante in breve, da mostrare anche a riga chiusa. */
  missingShort?: string;
  /** La stessa, spiegata, per la riga aperta. */
  missingText?: string;
}

export interface Averages {
  value: number;
  days: number;
  partial: boolean;
  certainty: Certainty;
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function inPeriod(days: readonly DayIntake[], from?: string, to?: string): DayIntake[] {
  return days.filter((d) => (from === undefined || d.date >= from) && (to === undefined || d.date <= to));
}

/** Media giornaliera di un nutriente sui giorni completi del periodo che ne hanno il dato. */
export function averageIntake(days: readonly DayIntake[], key: NutrientKey): Averages | undefined {
  const withData = days.filter((d) => d.complete && d.totals[key] !== undefined);
  if (withData.length === 0) return undefined;
  const worse = (a: Certainty, b: Certainty): Certainty => (a === "estimated" || b === "estimated" ? "estimated" : a === "label" || b === "label" ? "label" : "measured");
  let certainty: Certainty = "measured";
  for (const d of withData) certainty = worse(certainty, d.totals[key]?.certainty ?? "estimated");
  return {
    value: Math.round(mean(withData.map((d) => d.totals[key]?.value ?? 0)) * 1e6) / 1e6,
    days: withData.length,
    partial: withData.some((d) => d.totals[key]?.partial),
    certainty,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const noteStart = (note: string | undefined, max = 180): string | undefined => {
  if (!note) return undefined;
  if (note.length <= max) return note;
  const cut = note.slice(0, max);
  const dot = cut.lastIndexOf(". ");
  return `${dot > 40 ? cut.slice(0, dot + 1) : cut.trimEnd()}…`;
};

function position(p: "below_range" | "within_range" | "above_range"): string {
  return p === "within_range" ? "dentro l'intervallo" : p === "below_range" ? "sotto l'intervallo" : "sopra l'intervallo";
}

function defaultVariantText(c: ReferenceComparison): string | undefined {
  if (c.variant?.how !== "default" || c.variant.applied === undefined) return undefined;
  return `Variante predefinita: ${variantLabel(c.variant.applied)}. Scegli la tua nel profilo.`;
}

function rowFor(c: ReferenceComparison, days: readonly DayIntake[]): ComparisonRow {
  const info = NUTRIENT_INFO[c.nutrient];
  const base = {
    id: `${c.nutrient}:${c.kind}`,
    nutrient: c.nutrient,
    label: info.label,
    refKind: c.kind,
    refKindLabel: REFERENCE_KIND_LABELS[c.kind],
    ...(c.note ? { note: noteStart(c.note, 280) } : {}),
    ...(defaultVariantText(c) ? { defaultVariantText: defaultVariantText(c) } : {}),
  };

  // Un riferimento che è solo una nota (grassi saturi, zuccheri, sale): niente soglia inventata.
  const onlyNote = c.kind !== "RI" && (c.reference.amount === undefined || !(c.reference.amount > 0));
  // con troppo pochi giorni completi risponde il motore, come per ogni altra riga: nessuna media nostra
  if (onlyNote && c.status !== "insufficient_data") {
    const avg = averageIntake(days, c.nutrient);
    return {
      ...base,
      kind: "note",
      headline: avg ? `Assunto: ${avg.partial ? "almeno " : ""}${formatNutrient(c.nutrient, avg.value)} al giorno` : "Nessun dato calcolato",
      detail: avg
        ? `Media su ${avg.days} ${avg.days === 1 ? "giorno completo" : "giorni completi"}. Per questo nutriente il riferimento è solo una nota, senza una soglia numerica.`
        : "Per questo nutriente il riferimento è solo una nota, senza una soglia numerica.",
      distance: 0,
      ...(avg ? { certainty: avg.certainty } : {}),
      ...(c.note ? { note: c.note } : {}),
    };
  }

  if (c.status === "insufficient_data") {
    const detail =
      c.reason === "few_complete_days"
        ? `Servono almeno ${c.required} giorni completi: ne hai ${c.completeDays}, ne mancano ${Math.max(0, c.required - c.completeDays)}.`
        : `Servono almeno ${c.required} giorni completi con il dato di questo nutriente: ne hai ${c.daysWithData}.`;
    return {
      ...base,
      kind: "insufficient",
      headline: "Dati insufficienti",
      detail,
      distance: 0,
      ...(onlyNote && c.note ? { note: c.note } : {}),
    };
  }
  if (c.status === "not_comparable") {
    return { ...base, kind: "insufficient", headline: "Non confrontabile", detail: "Con i dati che ho non so esprimere questo confronto.", distance: 0 };
  }

  const partial = c.averageMissingShare > 0;
  const common = {
    ...base,
    kind: "compared" as const,
    certainty: c.certainty,
    ...(partial
      ? {
          partial: true,
          missingShort: `dato mancante ${missingPercentText(c.averageMissingShare)}`,
          missingText: `Per ${missingPercentText(c.averageMissingShare)} della quantità non ho il dato di questo nutriente: il numero è un minimo.`,
        }
      : {}),
  };
  const least = partial ? "almeno " : "";
  const o = c.outcome;
  if (o.kind === "RI") {
    const range = o.min !== undefined && o.max !== undefined ? `${o.min}-${o.max}%` : o.min !== undefined ? `almeno ${o.min}%` : `fino a ${o.max}%`;
    const gap = o.position === "below_range" ? (o.min ?? 0) - o.percentOfEnergy : o.position === "above_range" ? o.percentOfEnergy - (o.max ?? 0) : 0;
    return {
      ...common,
      headline: `${least}${Math.round(o.percentOfEnergy)}% dell'energia`,
      detail: `Intervallo di riferimento ${range} dell'energia: ${position(o.position)}.`,
      distance: Math.max(0, gap) / 100,
    };
  }
  if (o.kind === "UL") {
    return {
      ...common,
      headline: o.exceeds ? `${least}${least ? "sopra" : "Sopra"} il livello massimo di riferimento` : `${least}${pct(o.ratio)} del livello massimo di riferimento`,
      detail: `Media ${formatNutrient(c.nutrient, o.intake)} al giorno, livello massimo ${formatNutrient(c.nutrient, o.limit)}.${o.daysOver > 0 ? ` In ${o.daysOver} ${o.daysOver === 1 ? "giorno" : "giorni"} il singolo giorno lo supera.` : ""}`,
      share: Math.min(1.5, o.ratio),
      distance: o.exceeds ? o.ratio - 1 : 0,
    };
  }
  return {
    ...common,
    headline: `${least}${pct(o.coveredShare)} del riferimento`,
    detail: `Media ${formatNutrient(c.nutrient, o.intake)} al giorno su ${c.daysWithData} giorni completi; riferimento ${formatNutrient(c.nutrient, o.referenceAmount)} (${REFERENCE_KIND_LABELS[o.kind]}).`,
    share: Math.min(1.5, o.coveredShare),
    distance: Math.abs(1 - o.coveredShare),
  };
}

export interface NutritionRows {
  compared: ComparisonRow[];
  notes: ComparisonRow[];
  insufficient: ComparisonRow[];
}

const byLabel = (a: ComparisonRow, b: ComparisonRow) => a.label.localeCompare(b.label, "it") || a.id.localeCompare(b.id);

/**
 * Righe per la schermata: i confronti ordinati dal più lontano dal riferimento, poi le note, poi i
 * dati insufficienti. `days` serve per mostrare l'assunzione dove il riferimento è solo una nota.
 */
export function buildNutritionRows(comparisons: readonly ReferenceComparison[], days: readonly DayIntake[]): NutritionRows {
  const rows = comparisons.map((c) => rowFor(c, days));
  return {
    compared: rows.filter((r) => r.kind === "compared").sort((a, b) => b.distance - a.distance || byLabel(a, b)),
    notes: rows.filter((r) => r.kind === "note").sort(byLabel),
    insufficient: rows.filter((r) => r.kind === "insufficient").sort(byLabel),
  };
}

/** I giorni completi (quelli che entrano nelle medie) con almeno un pasto fuori casa stimato. */
export function outOfHomeDayCount(days: readonly DayIntake[]): number {
  return days.filter((d) => d.complete && linesOf(d).some((l) => l.status === "ok" && l.outOfHome === true)).length;
}

/**
 * La frase che accompagna il conto dei giorni completi quando tra loro ci sono pasti fuori casa: contano, come stima
 * della sola energia. Assente se non ce ne sono.
 */
export function outOfHomeDaysText(count: number): string | undefined {
  if (!(count > 0)) return undefined;
  const which = count === 1 ? "In 1 di questi giorni" : `In ${count} di questi giorni`;
  return `${which} c'è un pasto fuori casa: conta con una stima della sola energia, e per gli altri nutrienti il dato manca (i numeri con «almeno» sono un minimo).`;
}

/** Periodo di `n` giorni che finisce oggi, estremi inclusi. */
export function periodOf(today: string, n: number): { from: string; to: string } {
  return { from: addDays(today, -(n - 1)), to: today };
}

/* ---------- porzioni di preparazioni ---------- */

/**
 * Frase per una porzione calcolata dagli ingredienti: è una stima, e se per qualche ingrediente manca il dato
 * (o un nutriente è parziale) lo dice, con la quota mancante.
 */
export function prepPortionText(info: PrepPortionInfo): string {
  const base = `Porzione di «${info.title}»: calcolata dagli ingredienti, è una stima.`;
  const parts: string[] = [];
  if (info.unresolved.length > 0) {
    const names = info.unresolved.slice(0, 3).join(", ") + (info.unresolved.length > 3 ? "…" : "");
    parts.push(`Non ho il dato di ${info.unresolved.length} ${info.unresolved.length === 1 ? "ingrediente" : "ingredienti"} su ${info.ingredientCount} (${names})`);
  }
  if (info.partial.length > 0) {
    const shown = info.partial.slice(0, 2).map((p) => `${nutrientLabel(p.key).toLowerCase()} manca per ${missingPercentText(p.missingShare)}`).join(", ");
    parts.push(`${info.partial.length === 1 ? "un nutriente è" : `${info.partial.length} nutrienti sono`} un minimo, non un totale (${shown}${info.partial.length > 2 ? "…" : ""})`);
  }
  return parts.length === 0 ? base : `${base} ${parts.join("; ")}.`;
}

/**
 * Segna come parziali i nutrienti dei giorni che contengono porzioni di preparazione con dato mancante: il motore
 * vede la porzione come un alimento completo, ma qui si sa che il valore è un minimo. La quota mancante aggiunta è
 * quella della porzione divisa per le voci che portano quel nutriente nel giorno (una stima, dichiarata come tale).
 */
export function markPrepPartials(days: readonly DayIntake[], prepInfo: ReadonlyMap<string, PrepPortionInfo>): DayIntake[] {
  if (prepInfo.size === 0) return [...days];
  return days.map((day) => {
    const extra = new Map<NutrientKey, number>();
    const seen = new Set<string>();
    for (const line of linesOf(day)) {
      if (line.status !== "ok") continue;
      const ref = line.composition.ref;
      const info = isPrepRef(ref) ? prepInfo.get(ref) : undefined;
      if (!info || info.partial.length === 0) continue;
      // ogni riga conta: due porzioni della stessa preparazione sono due righe
      const lineId = `${line.eventId}:${line.itemIndex ?? ""}`;
      if (seen.has(lineId)) continue;
      seen.add(lineId);
      for (const p of info.partial) {
        const t = day.totals[p.key];
        if (!t) continue;
        extra.set(p.key, (extra.get(p.key) ?? 0) + p.missingShare / Math.max(1, t.count));
      }
    }
    if (extra.size === 0) return day;
    const totals = { ...day.totals };
    for (const [key, add] of extra) {
      const t = totals[key];
      if (!t) continue;
      totals[key] = { ...t, partial: true, missingShare: Math.min(1, Math.round((t.missingShare + add) * 1e6) / 1e6) };
    }
    return { ...day, totals };
  });
}

/** Le note sulle porzioni di preparazione che compaiono in un giorno e non sono complete. */
export function prepNotes(day: DayIntake | undefined, prepInfo: ReadonlyMap<string, PrepPortionInfo>): string[] {
  if (!day) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of linesOf(day)) {
    if (line.status !== "ok") continue;
    const ref = line.composition.ref;
    if (!isPrepRef(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const info = prepInfo.get(ref);
    if (info && (info.unresolved.length > 0 || info.partial.length > 0)) out.push(prepPortionText(info));
  }
  return out;
}

/* ---------- da dove viene un nutriente ---------- */

/**
 * Frase sullo stato assunto per una voce ("calcolato come «Pasta cotta», cotto"). Se lo stato preferito per
 * quel contesto non esisteva nella tabella lo dice. Vuota per i prodotti da codice a barre, che non hanno stato.
 */
export function stateText(
  matchedName: string,
  state?: FoodState,
  preference?: StatePreference,
  selection?: "explicit" | "name" | "product",
): string | undefined {
  if (selection === "explicit") return `Alimento scelto da te: «${matchedName}»${state ? ` (${STATE_LABELS[state]})` : ""}.`;
  if (!state) return undefined;
  if (preference && !preference.honored && preference.preferred.length > 0) {
    const wanted = preference.preferred.map((s) => STATE_LABELS[s]).join(" o ");
    return `Cercavo un alimento ${wanted}, ma nella tabella non c'è: ho usato «${matchedName}» (${STATE_LABELS[state]}).`;
  }
  return `Calcolato come «${matchedName}» (${STATE_LABELS[state]}).`;
}

/** Le voci di un pasto (e se ce n'è una di dispensa) dietro a un nome: servono a correggere l'alimento. */
export interface LineRefs {
  mealRefs: MealItemRef[];
  /** Almeno una voce è un consumo di dispensa: per quelle vale la scelta ricordata per nome. */
  pantry: boolean;
}

function refsOf(line: IntakeLine): LineRefs {
  return line.kind === "mealItem" && line.itemIndex !== undefined
    ? { mealRefs: [{ eventId: line.eventId, itemIndex: line.itemIndex }], pantry: false }
    : { mealRefs: [], pantry: line.kind === "pantry" };
}

function addRefs(into: LineRefs, line: IntakeLine): void {
  const r = refsOf(line);
  into.mealRefs.push(...r.mealRefs);
  into.pantry = into.pantry || r.pantry;
}

export interface Contributor extends LineRefs {
  /** Nome normalizzato: chiave per ricordare una correzione dell'alimento. */
  key: string;
  name: string;
  /** Identificativo dell'alimento della tabella a cui è stato associato (o il codice del prodotto). */
  ref?: string;
  /** Stato assunto e frase per mostrarlo; `stateHonored` falso se lo stato preferito non esisteva. */
  state?: FoodState;
  stateText?: string;
  stateHonored?: boolean;
  /** A che cosa è stato associato (nome nella tabella o prodotto). */
  matchedName: string;
  /** È la stima di un pasto fuori casa: non c'è un alimento da cambiare. */
  outOfHome?: true;
  value: number;
  /** Quota sul totale dei contributi, da 0 a 1. */
  share: number;
}

/** Gli alimenti che hanno portato di più un nutriente nei giorni completi del periodo. */
export function topContributors(
  days: readonly DayIntake[],
  key: NutrientKey,
  limit = 5,
  prepInfo: ReadonlyMap<string, PrepPortionInfo> = new Map(),
): Contributor[] {
  const sums = new Map<string, Contributor>();
  let total = 0;
  for (const day of days) {
    if (!day.complete) continue;
    for (const line of linesOf(day)) {
      if (line.status !== "ok") continue;
      const v = (line as ResolvedLine).nutrients[key];
      if (typeof v !== "number" || v <= 0) continue;
      const id = normalizeName(line.label) || line.label;
      const cur = sums.get(id);
      total += v;
      if (cur) {
        cur.value += v;
        addRefs(cur, line);
      }
      else if (line.outOfHome === true) {
        // una stima fuori casa non ha un alimento dietro: porta il suo segno e nessuna voce da correggere
        sums.set(id, { key: id, name: line.label, matchedName: line.label, stateText: OUT_OF_HOME_EXPLANATION, outOfHome: true, value: v, share: 0, mealRefs: [], pantry: false });
      }
      else {
        const { state, statePreference } = line.composition;
        const prep = isPrepRef(line.composition.ref) ? prepInfo.get(line.composition.ref) : undefined;
        const text = prep ? prepPortionText(prep) : stateText(line.composition.name, state, statePreference, line.composition.selection);
        sums.set(id, {
          key: id,
          name: line.label,
          ...(line.composition.ref !== undefined ? { ref: line.composition.ref } : {}),
          matchedName: line.composition.name,
          ...(state ? { state } : {}),
          ...(text ? { stateText: text } : {}),
          ...(statePreference ? { stateHonored: statePreference.honored } : {}),
          value: v,
          share: 0,
          ...refsOf(line),
        });
      }
    }
  }
  return [...sums.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((c) => ({ ...c, value: Math.round(c.value * 1e6) / 1e6, share: total > 0 ? c.value / total : 0 }));
}

/* ---------- voci non riconosciute ---------- */

export interface UnresolvedGroup extends LineRefs {
  /** Chiave per ricordare la scelta: il nome normalizzato. */
  key: string;
  /** Perché la voce non è risolta, dal motore: nessun dato, oppure c'è solo la voce secca e il pasto intende il cotto. */
  reason: "no_composition" | "missing_cooked_entry";
  /** Il messaggio del motore, se c'è. */
  message?: string;
  label: string;
  count: number;
  lastDate: string;
}

/** Voci senza alcun dato di composizione (da collegare a mano), raggruppate per nome. */
export function unresolvedGroups(days: readonly DayIntake[]): UnresolvedGroup[] {
  const groups = new Map<string, UnresolvedGroup>();
  for (const day of days) {
    for (const line of linesOf(day)) {
      if (line.status !== "unresolved") continue;
      const { reason, message } = line as UnresolvedLine;
      if (reason !== "no_composition" && reason !== "missing_cooked_entry") continue;
      const key = normalizeName(line.label) || line.label;
      const cur = groups.get(key);
      if (cur) {
        cur.count += 1;
        addRefs(cur, line);
        if (day.date > cur.lastDate) cur.lastDate = day.date;
      } else groups.set(key, { key, reason, ...(message ? { message } : {}), label: line.label, count: 1, lastDate: day.date, ...refsOf(line) });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.label.localeCompare(b.label, "it"));
}

/** Voci che hanno una composizione ma una quantità non convertibile (per esempio pezzi senza peso noto). */
export function notComputableCount(days: readonly DayIntake[]): number {
  let n = 0;
  for (const day of days) for (const l of linesOf(day)) if (l.status === "unresolved" && l.reason !== "no_composition" && l.reason !== "missing_cooked_entry" && l.reason !== "unknown_lot") n += 1;
  return n;
}
