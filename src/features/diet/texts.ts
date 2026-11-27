// Tutte le frasi della qualità di ciò che mangi. Si dicono fatti, l'indicazione della fonte e un'opzione pratica:
// nessun giudizio, nessun numero riassuntivo, nessun parere medico. Le stime portano la tilde («~»); un valore
// con dati mancanti è un minimo («almeno»). Logica pura.
import {
  ADVICE_RULES,
  DIET_GROUP_LABEL,
  DIET_SOURCES,
  PROCESSING_LABEL,
  type Advice,
  type AdviceAction,
  type AdviceOutcome,
  type AdviceSource,
  type ClassBasis,
  type ClassPart,
  type Coverage,
  type DietGroup,
  type DietHistory,
  type GroupRowId,
  type Indicator,
  type IndicatorId,
  type InsufficientReason,
  type TargetView,
  type Unclassified,
  type WeekFrame,
} from "@/core/diet";
import { indicatorLabel, rowLabel } from "@/core/diet/labels";
import type { Certainty } from "@/core/ledger";
import type { LineMark } from "./inputs";

// ---------------------------------------------------------------------------------------------- forme

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Numero all'italiana, con al più `digits` decimali. */
export function num(value: number, digits = 1): string {
  let f = numberFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    numberFormats.set(digits, f);
  }
  return f.format(Number.isFinite(value) ? value : 0);
}

/** «~» per una stima, niente altrimenti. */
export const approx = (certainty: Certainty | undefined): string => (certainty === "estimated" ? "~" : "");

export const capitalize = (s: string): string => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

const many = (n: number, one: string, more: string): string => `${num(n)} ${Math.abs(n - 1) < 1e-9 ? one : more}`;

/** Elenco con «e» prima dell'ultimo: «legumi, pesce e frutta secca». */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** «17 nov». */
export function dayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`.trim();
}

/** «17–23 nov», «28 nov – 4 dic». */
export function weekRangeText(weekStart: string, weekEnd: string): string {
  if (weekStart.slice(0, 7) === weekEnd.slice(0, 7)) return `${Number(weekStart.slice(8, 10))}–${dayMonth(weekEnd)}`;
  return `${dayMonth(weekStart)} – ${dayMonth(weekEnd)}`;
}

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const mondayOf = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
};

/** La settimana di un fatto rispetto a oggi: «questa settimana finora», «la settimana scorsa», «nella settimana del 10 nov». */
export function whenText(weekStart: string, today: string): string {
  const current = mondayOf(today);
  if (weekStart === current) return "questa settimana finora";
  if (weekStart === addDays(current, -7)) return "la settimana scorsa";
  return `nella settimana del ${dayMonth(weekStart)}`;
}

// ---------------------------------------------------------------------------------------------- etichette

/** Nome del gruppo, minuscolo per stare in una frase. */
export function groupLabel(group: DietGroup | Unclassified): string {
  return DIET_GROUP_LABEL[group];
}

// I nomi delle righe e degli indicatori stanno in `core/diet/labels.ts` (un elenco solo, anche per le viste dell'assistente).
export { indicatorLabel, rowLabel };

const rowOf = (id: IndicatorId): GroupRowId | undefined => (id.startsWith("group:") ? (id.slice(6) as GroupRowId) : undefined);

// ---------------------------------------------------------------------------------------------- valori

const isCount = (ind: Pick<Indicator, "id" | "unit">): boolean => ind.unit === "count" && rowOf(ind.id) !== undefined;

/** Il conteggio delle occasioni di una riga «occasionale», dal quadro (volte, non porzioni). */
function occasionsOf(ind: Indicator, frame: Pick<WeekFrame, "rowTallies"> | undefined): number | undefined {
  const row = rowOf(ind.id);
  if (row && frame) return frame.rowTallies[row]?.occasions;
  return ind.value;
}

/** Il valore senza «almeno» né tilde: «3 porzioni al giorno», «1 volta», «22% dell'energia riconosciuta». */
function bareValue(ind: Indicator, value: number): string {
  if (isCount(ind)) return many(value, "volta", "volte");
  switch (ind.unit) {
    case "servingsPerWeek":
      return `${many(value, "porzione", "porzioni")} a settimana`;
    case "servingsPerDay":
      return `${many(value, "porzione", "porzioni")} al giorno`;
    case "gramsPerDay":
      return `${num(value, value < 10 ? 1 : 0)} g al giorno`;
    case "percentEnergy":
      return `${num(value)}% dell'energia`;
    case "share":
      return ind.id === "processedShare" ? `${num(value * 100, 0)}% dell'energia riconosciuta` : `${num(value * 100, 0)}% dei cereali`;
    case "count":
      return ind.id === "plantVariety" ? many(value, "vegetale diverso", "vegetali diversi") : num(value, 0);
  }
}

/**
 * Il valore di un indicatore in parole, con «almeno» se è un minimo e la tilde se è una stima. Per le righe
 * «occasionali» si scrivono le volte del quadro (`rowTallies[riga].occasions`). Senza valore: «dati insufficienti».
 */
export function indicatorText(ind: Indicator, frame?: Pick<WeekFrame, "rowTallies">): string {
  const value = isCount(ind) ? occasionsOf(ind, frame) : ind.value;
  if (value === undefined || !Number.isFinite(value)) return "dati insufficienti";
  return `${ind.lowerBound ? "almeno " : ""}${approx(ind.certainty)}${bareValue(ind, value)}`;
}

const range = (t: Pick<TargetView, "min" | "max">): string | undefined =>
  t.min !== undefined && t.max !== undefined
    ? t.min === t.max
      ? num(t.min)
      : `${num(t.min)}–${num(t.max)}`
    : t.min !== undefined
      ? `almeno ${num(t.min)}`
      : t.max !== undefined
        ? `al massimo ${num(t.max)}`
        : undefined;

/** La sola quantità indicata, senza verbo: «2–4 porzioni a settimana», «un consumo occasionale», «al massimo 5 g al giorno». */
export function targetAmount(t: TargetView): string | undefined {
  const r = range(t);
  const top = t.max ?? t.min;
  const portions = (per: string) => (r ? `${r} ${top === 1 ? "porzione" : "porzioni"} ${per}` : undefined);
  switch (t.kind) {
    case "perDay":
    case "maxPerDay":
      return portions("al giorno");
    case "perWeek":
    case "maxPerWeek":
      return portions("a settimana");
    case "occasional":
      return "un consumo occasionale";
    case "notAdvised":
      return "di non consumarne";
    case "shareMin":
      return t.min !== undefined ? `almeno il ${num(t.min * 100, 0)}% dei cereali in forma integrale` : undefined;
    case "percentEnergyMax":
      return t.max !== undefined ? `meno del ${num(t.max)}% dell'energia` : undefined;
    case "gramsPerDayMin":
      return t.min !== undefined ? `almeno ${num(t.min)} g al giorno` : undefined;
    case "gramsPerDayMax":
      return t.max !== undefined ? `al massimo ${num(t.max)} g al giorno` : undefined;
  }
}

/** L'indicazione accanto al valore: «indicate 2–4 porzioni a settimana», «consumo occasionale secondo la fonte». */
export function targetText(t: TargetView | undefined): string | undefined {
  if (!t) return undefined;
  if (t.kind === "occasional") return "consumo occasionale secondo la fonte";
  if (t.kind === "notAdvised") return "la fonte non ne indica il consumo";
  const amount = targetAmount(t);
  if (!amount) return undefined;
  return t.kind === "perDay" || t.kind === "perWeek" || t.kind === "maxPerDay" || t.kind === "maxPerWeek" ? `indicate ${amount}` : `indicazione: ${amount}`;
}

// ---------------------------------------------------------------------------------------------- stato e copertura

/** «riconosciuto ~84% di ciò che hai mangiato». */
export function coverageText(coverage: Pick<Coverage, "share" | "estimatedLines" | "lines">): string {
  const estimated = coverage.estimatedLines > 0 ? "~" : "";
  return `riconosciuto ${estimated}${num(coverage.share * 100, 0)}% di ciò che hai mangiato`;
}

/** «Dati insufficienti: 3 giorni su 7». */
export function insufficientText(reason: InsufficientReason | undefined, frame?: Pick<WeekFrame, "daysWithData" | "daysElapsed" | "completeDays" | "coverage">): string {
  if (!frame) return "Dati insufficienti";
  switch (reason) {
    case "no_data":
      return "Dati insufficienti: nessun giorno registrato";
    case "few_complete_days":
      return `Dati insufficienti: ${many(frame.completeDays, "giorno registrato", "giorni registrati")} per intero su ${num(frame.daysElapsed)}`;
    case "low_coverage":
      return `Dati insufficienti: ${coverageText(frame.coverage)}`;
    case "few_days":
    default:
      return `Dati insufficienti: ${many(frame.daysWithData, "giorno", "giorni")} su ${num(frame.daysElapsed)}`;
  }
}

/** Lo stato in parole, mai solo un colore. */
export function statusText(ind: Indicator, frame?: Pick<WeekFrame, "daysWithData" | "daysElapsed" | "completeDays" | "coverage" | "rowTallies">): string {
  switch (ind.status) {
    case "within":
      return "dentro l'indicazione";
    case "below":
      return "sotto l'indicazione";
    case "above":
      return "sopra l'indicazione";
    case "atLeast": {
      const value = isCount(ind) ? occasionsOf(ind, frame) : ind.value;
      return value !== undefined ? `almeno ${num(value)}: settimana registrata in parte` : "settimana registrata in parte";
    }
    case "occasional":
      return "consumo occasionale secondo la fonte";
    case "noTarget":
      return "nessuna soglia ufficiale: solo il tuo andamento";
    case "insufficient":
      return insufficientText(ind.insufficient, frame);
  }
}

/** Intestazione della settimana: «17–23 nov · 5 giorni registrati su 7 · riconosciuto ~84% di ciò che hai mangiato». */
export function weekHeaderText(frame: WeekFrame): string {
  const days = `${many(frame.daysWithData, "giorno registrato", "giorni registrati")} su ${num(frame.daysElapsed)}`;
  const parts = [weekRangeText(frame.weekStart, frame.weekEnd), days];
  if (frame.coverage.lines > 0) parts.push(coverageText(frame.coverage));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------- fonti

const SOURCE_SHORT: Readonly<Record<AdviceSource, string>> = {
  "crea-lg-2018": "CREA, Linee guida per una sana alimentazione (rev. 2018)",
  "who-sugars-2015": "OMS, Guideline: Sugars intake for adults and children (2015)",
  "who-healthy-diet": "OMS, Healthy diet (2026)",
  "who-salt": "OMS, Salt reduction (2026)",
  "efsa-drv": "EFSA, valori di riferimento per la popolazione (2010)",
  "nova-fao-2019": "classificazione NOVA (FAO 2019, non verificata direttamente)",
  app: "scelta dell'app, non di una fonte esterna",
  ownTrend: "il tuo andamento nelle settimane precedenti",
};

/** «Fonte: CREA, Linee guida per una sana alimentazione (rev. 2018), Tab. 9.1, p. 132». */
export function sourceText(source: AdviceSource, where?: string): string {
  const name = SOURCE_SHORT[source];
  return `Fonte: ${where && source !== "ownTrend" && source !== "app" ? `${name}, ${where}` : name}`;
}

/** Il documento intero e l'indirizzo, per «Come è calcolato». */
export function sourceDetail(source: AdviceSource): { title: string; url?: string; verified: boolean } {
  if (source === "ownTrend") return { title: capitalize(SOURCE_SHORT.ownTrend), verified: true };
  const s = DIET_SOURCES[source];
  return { title: `${s.body}, ${s.document}`, ...(s.url ? { url: s.url } : {}), verified: s.verified };
}

/** Chi dà l'indicazione, come soggetto di una frase. */
const SOURCE_SUBJECT: Readonly<Record<AdviceSource, { who: string; plural: boolean }>> = {
  "crea-lg-2018": { who: "le Linee guida CREA", plural: true },
  "who-sugars-2015": { who: "l'OMS", plural: false },
  "who-healthy-diet": { who: "l'OMS", plural: false },
  "who-salt": { who: "l'OMS", plural: false },
  "efsa-drv": { who: "l'EFSA", plural: false },
  "nova-fao-2019": { who: "la classificazione NOVA", plural: false },
  app: { who: "l'app", plural: false },
  ownTrend: { who: "il tuo andamento", plural: false },
};

// ---------------------------------------------------------------------------------------------- consigli

const ruleOf = (id: Advice["ruleId"]) => ADVICE_RULES.find((r) => r.id === id);

const frameAt = (history: Pick<DietHistory, "weeks"> | undefined, weekStart: string): WeekFrame | undefined =>
  history?.weeks.find((w) => w.weekStart === weekStart);

/**
 * Il fatto di un consiglio, in una o due frasi: «Legumi: ~1 porzione a settimana la settimana scorsa; le Linee guida
 * CREA indicano 2–4 porzioni a settimana.» Più, se ci sono, l'andamento della settimana in corso e ciò che è nel piano.
 */
export function adviceFactText(advice: Advice, ctx: { today: string; history?: Pick<DietHistory, "weeks"> }): string {
  const ind = advice.fact.indicator;
  const frame = frameAt(ctx.history, advice.weekStart);
  const label = capitalize(indicatorLabel(ind.id));
  const value = indicatorText(ind, frame);
  const when = whenText(advice.weekStart, ctx.today);
  let text: string;
  if (advice.source === "ownTrend") {
    text = `${label}: ${value} ${when}, più del tuo solito nelle settimane precedenti. Non c'è una soglia ufficiale.`;
  } else {
    const subject = SOURCE_SUBJECT[advice.source];
    const amount = ind.target ? targetAmount(ind.target) : undefined;
    const verb = `${ind.target?.kind === "occasional" ? "ne " : ""}${subject.plural ? "indicano" : "indica"}`;
    text = amount ? `${label}: ${value} ${when}; ${subject.who} ${verb} ${amount}.` : `${label}: ${value} ${when}.`;
  }
  const progress = advice.fact.progress;
  if (progress && advice.weekStart !== advice.targetWeekStart && progress.value !== undefined) {
    const shown = isCount(ind) ? many(progress.value, "volta", "volte") : bareValue(ind, progress.value);
    text += ` Questa settimana finora: ${approx(ind.certainty)}${shown} in ${many(progress.daysElapsed, "giorno", "giorni")}.`;
  }
  if (advice.fact.planned !== undefined && advice.fact.planned > 0) {
    text += ` Nel piano di questa settimana: ${many(advice.fact.planned, "porzione", "porzioni")}.`;
  }
  return text;
}

/** La fonte di un consiglio: quella dell'indicazione, con il punto preciso se c'è. */
export function adviceSourceText(advice: Advice): string {
  return sourceText(advice.source, advice.fact.indicator.target?.where);
}

/** La riga del riepilogo di Oggi: il fatto più, se c'è, ciò che hai già in casa. */
export function briefingAdviceText(advice: Advice, ctx: { today: string; history?: Pick<DietHistory, "weeks"> }): string {
  const fact = adviceFactText(advice, ctx);
  const pantry = advice.actions.find((a): a is Extract<AdviceAction, { kind: "cookWithPantry" }> => a.kind === "cookWithPantry");
  return pantry ? `${fact} Hai ${pantry.foodName.toLowerCase()} in dispensa.` : fact;
}

/** Il testo del pulsante di un'azione: 2 tocchi al massimo da qui. */
export function actionLabel(action: AdviceAction): string {
  switch (action.kind) {
    case "cookWithPantry":
      return `Cosa cucinare con ${action.foodName.toLowerCase()}`;
    case "openRecipe":
      return `Apri la ricetta: ${action.title}`;
    case "addToPlan":
      return `Metti nel piano: ${action.title}`;
    case "addToShopping":
      return `Aggiungi alla spesa: ${listText(action.names)}`;
    case "seeAlternative":
      return `Vedi l'alternativa: ${action.toName}`;
    case "openDetail":
      return "Vedi il dettaglio";
  }
}

export const DISMISS_LABEL = "Lascia così";
export const UNDO_LABEL = "Annulla";
export const OPEN_SHOPPING_LABEL = "Apri la spesa";

/** L'avviso dopo «Aggiungi alla spesa». */
export const addedToShoppingText = (names: readonly string[]): string => `Aggiunto alla spesa: ${listText(names)}`;
/** L'avviso dopo «Lascia così». */
export const DISMISSED_TEXT = "Non lo riproporrò per questa settimana.";
export const SHOPPING_FAILED_TEXT = "Non sono riuscito ad aggiungerlo alla spesa. Riprova.";

// ---------------------------------------------------------------------------------------------- settimane passate

export const OUTCOMES_NOTE = "Sono confronti tra settimane: non sappiamo che cosa hai visto o fatto.";

const OUTCOME_RESULT: Readonly<Record<AdviceOutcome["result"], string>> = {
  moved: "Si è mosso nella direzione proposta.",
  same: "È rimasto più o meno uguale.",
  opposite: "Si è mosso nella direzione opposta.",
  insufficient: "La settimana dopo non ha dati sufficienti.",
};

/** «Settimana del 10 nov: legumi ~1 porzione a settimana; quella dopo 3. Si è mosso nella direzione proposta.» */
export function outcomeText(outcome: AdviceOutcome, history?: Pick<DietHistory, "weeks">): string {
  const rule = ruleOf(outcome.ruleId);
  const frame = frameAt(history, outcome.weekStart);
  const ind = rule ? (frame?.indicators.find((i) => i.id === rule.indicator) ?? undefined) : undefined;
  const id = ind?.id ?? rule?.indicator;
  const label = id ? indicatorLabel(id) : outcome.ruleId;
  const show = (v: number): string => {
    if (!ind) return num(v);
    if (isCount(ind) || rule?.id === "processedMeatOften" || rule?.id === "sweetsDrinksOften") return many(v, "volta", "volte");
    return `${approx(ind.certainty)}${bareValue(ind, v)}`;
  };
  const after = outcome.after !== undefined ? `; quella dopo ${show(outcome.after)}` : "";
  return `Settimana del ${dayMonth(outcome.weekStart)}: ${label} ${show(outcome.before)}${after}. ${OUTCOME_RESULT[outcome.result]}`;
}

// ---------------------------------------------------------------------------------------------- righe di Oggi

/** Sulla riga, dopo i nutrienti: «molto lavorato ~» (la tilde se è una stima). */
export function lineMarkText(mark: LineMark): string {
  return `${PROCESSING_LABEL[mark.level]}${mark.certainty === "estimated" ? " ~" : ""}`;
}

/** Per i lettori di schermo: niente tilde, la stima detta a parole. */
export function lineMarkLabel(mark: LineMark): string {
  const what = mark.fromPrep ? "in prevalenza molto lavorato" : PROCESSING_LABEL[mark.level];
  return mark.certainty === "estimated" ? `${what}, stima` : what;
}

const BASIS_TEXT: Readonly<Record<ClassBasis, string>> = {
  user: "Corretto da te.",
  product: "Dalla scheda del prodotto.",
  food: "Dall'alimento della tabella di composizione.",
  category: "Dedotto dal tipo di alimento in dispensa: puoi correggerlo.",
  name: "Dedotto dal nome: puoi correggerlo.",
  prep: "Dagli ingredienti della preparazione.",
  outOfHome: "Pasto fuori casa: non si scompone nei gruppi.",
  none: "Non riconosciuto: puoi correggerlo.",
};

/** Da dove viene il gruppo di una voce. */
export function basisText(basis: ClassBasis): string {
  return BASIS_TEXT[basis];
}

/** «Legumi ~ · non lavorato o poco ~»: gruppo e lavorazione di una parte, nella scheda della voce. */
export function partClassText(part: Pick<ClassPart, "group" | "certainty" | "processing">): string {
  const group = `${capitalize(groupLabel(part.group))}${part.certainty === "estimated" ? " ~" : ""}`;
  if (!part.processing) return group;
  return `${group} · ${PROCESSING_LABEL[part.processing.level]}${part.processing.certainty === "estimated" ? " ~" : ""}`;
}

/** Il titolo del foglio di correzione: «Come conto «Cracker integrali»». */
export const classSheetTitle = (name: string): string => `Come conto «${name}»`;
export const CLASS_SHEET_SCOPE = "Vale per tutte le voci con questo nome.";
export const CLASS_SHEET_RESET = "Torna alla stima";
export const classSavedText = (name: string): string => `Corretto: «${name}»`;

// ---------------------------------------------------------------------------------------------- piano

/** Il motivo «diet» di una proposta del piano: «Porta legumi e pesce». */
export function dietReasonText(groups: readonly DietGroup[]): string {
  return groups.length > 0 ? `Porta ${listText(groups.map(groupLabel))}` : "Porta ciò che manca nella settimana";
}

/** La riga del piano: «Nel piano di questa settimana: legumi 2 volte (indicate 2–4) · pesce 1 (indicate 2–3).» */
export function plannedRowText(items: readonly { group: DietGroup; entries: number; target?: TargetView }[]): string {
  if (items.length === 0) return "Nel piano di questa settimana non ci sono ancora voci con gruppi riconosciuti.";
  const parts = items.map((i) => {
    const r = i.target ? range(i.target) : undefined;
    return `${groupLabel(i.group)} ${many(i.entries, "volta", "volte")}${r ? ` (indicate ${r})` : ""}`;
  });
  return `Nel piano di questa settimana: ${parts.join(" · ")}.`;
}

// ---------------------------------------------------------------------------------------------- note fisse

export const NOT_MEDICAL_TEXT = "Confronto con le indicazioni delle Linee guida: non è un parere medico.";
export const ESTIMATE_NOTE = "La tilde (~) segna una stima: il gruppo o la quantità sono dedotti, non letti.";
export const levelNote = (level: number): string =>
  `Le quantità si leggono sul livello di esempio da ${num(level, 0)} kcal della Tab. 9.1: è una scelta dell'app, la fonte presenta 1500, 2000 e 2500 kcal come esempi.`;
export const levelText = (level: number): string => `Livello di esempio: ${num(level, 0)} kcal al giorno`;
