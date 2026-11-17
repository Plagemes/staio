// Dai risultati della verifica del piano ai testi per le schermate. Assunzioni contro obiettivi scelti
// dall'utente: nessun parere, il dato mancante è sempre dichiarato, "non determinabile" quando non basta.
import type { AdherenceWeek, ConstraintsResult, DayCheck, EntryResult, NutrientCheck, PlannedItem, TargetRange, UnverifiedItem } from "@/core/plan";
import { formatNutrient, nutrientLabel } from "../nutrition/labels";
import { missingPercentText } from "../nutrition/prepare";

export function targetText(target: TargetRange, nutrient: NutrientCheck["nutrient"]): string {
  const f = (v: number) => formatNutrient(nutrient, v);
  if (target.min !== undefined && target.max !== undefined) return `tra ${f(target.min)} e ${f(target.max)}`;
  if (target.min !== undefined) return `almeno ${f(target.min)}`;
  if (target.max !== undefined) return `al massimo ${f(target.max)}`;
  return "";
}

export type LineTone = "ok" | "attention" | "unknown";

export interface NutrientLineView {
  nutrient: NutrientCheck["nutrient"];
  label: string;
  target: string;
  /** "almeno 82 g" quando il dato è parziale, altrimenti "82 g". Vuoto se non calcolabile. */
  value: string;
  status: NutrientCheck["status"];
  statusText: string;
  tone: LineTone;
  /** "Manca il dato per il 14% del peso delle voci." */
  missingText?: string;
}

export function nutrientLine(n: NutrientCheck): NutrientLineView {
  const base = {
    nutrient: n.nutrient,
    label: nutrientLabel(n.nutrient),
    target: targetText(n.target, n.nutrient),
    value: n.value === undefined ? "" : `${n.partial ? "almeno " : ""}${formatNutrient(n.nutrient, n.value)}`,
    status: n.status,
  };
  const missing =
    n.missingShare > 0 && n.status !== "not_computable"
      ? `Manca il dato per ${missingPercentText(n.missingShare)} ${n.shareBy === "weight" ? "del peso" : "delle voci"}.`
      : undefined;
  const extra = missing ? { missingText: missing } : {};
  switch (n.status) {
    case "met":
      return {
        ...base,
        ...extra,
        tone: "ok",
        statusText: n.partial ? "Minimo già raggiunto con i dati che ci sono" : "Rispettato",
      };
    case "below":
      return { ...base, ...extra, tone: "attention", statusText: "Sotto il minimo" };
    case "above":
      return {
        ...base,
        ...extra,
        tone: "attention",
        statusText: n.partial ? "Sopra il massimo già con i dati che ci sono" : "Sopra il massimo",
      };
    case "undetermined":
      return { ...base, ...extra, tone: "unknown", statusText: "Non determinabile: il dato mancante impedisce di dirlo" };
    case "not_computable":
      return { ...base, tone: "unknown", statusText: "Non calcolabile: nessuna voce ha il dato" };
  }
}

export interface DayCheckView {
  date: string;
  dayType?: string;
  /** Il giorno non è verificabile: dice perché. */
  note?: string;
  lines: NutrientLineView[];
  /** Voci pianificate di cui non si sa calcolare alcun valore. */
  unknownEntries: number;
  /** Il giorno ha un piano e si è potuto confrontare con gli obiettivi. */
  checked: boolean;
  /** Obiettivi rispettati / numero di obiettivi, solo con dato che permette di dirlo. */
  met: number;
}

export function dayCheckView(day: DayCheck): DayCheckView {
  const common = { date: day.date, ...(day.dayType !== undefined ? { dayType: day.dayType } : {}) };
  if (day.status === "no_plan") return { ...common, lines: [], unknownEntries: 0, checked: false, met: 0 };
  if (day.status === "no_targets") {
    return {
      ...common,
      note:
        day.dayType === undefined
          ? "Scegli il tipo di giornata per confrontare il piano con i tuoi obiettivi."
          : `Non hai ancora scritto obiettivi per «${day.dayType}».`,
      lines: [],
      unknownEntries: 0,
      checked: false,
      met: 0,
    };
  }
  const lines = day.nutrients.map(nutrientLine);
  return {
    ...common,
    lines,
    unknownEntries: day.notComputableEntries,
    checked: true,
    met: lines.filter((l) => l.status === "met").length,
  };
}

/** Riga di sintesi del giorno: "2 obiettivi su 3 rispettati, 1 non determinabile". */
export function daySummaryText(view: DayCheckView): string {
  if (!view.checked) return view.note ?? "";
  const total = view.lines.length;
  const unknown = view.lines.filter((l) => l.tone === "unknown").length;
  const attention = view.lines.filter((l) => l.tone === "attention").length;
  const parts = [`${view.met} su ${total} ${total === 1 ? "obiettivo rispettato" : "obiettivi rispettati"}`];
  if (attention > 0) parts.push(`${attention} da rivedere`);
  if (unknown > 0) parts.push(`${unknown} non determinabil${unknown === 1 ? "e" : "i"}`);
  return parts.join(", ");
}

export interface ConstraintLine {
  kind: "violation" | "unverified";
  date: string;
  text: string;
}

const joinTerms = (terms: readonly string[]): string =>
  terms.length <= 1 ? (terms[0] ?? "un allergene") : `${terms.slice(0, -1).join(", ")} e ${terms[terms.length - 1]}`;

type Evidence = NonNullable<UnverifiedItem["evidence"]>[number];

const inPantry = (e: Evidence | undefined): string => (e && (e.origin === "linked" || e.origin === "product") ? ` (in dispensa: «${e.text}»)` : "");

/** Il motivo vero del dubbio per un ingrediente, con l'origine. */
function clauseOf(ingredient: string, e: Evidence | undefined): string {
  const what = `«${ingredient}»${inPantry(e)}`;
  switch (e?.reason) {
    case "generic":
      return `${what} è un ingrediente generico o composto`;
    case "gluten_free_claim":
      return `${what} è dichiarato senza glutine, ma va verificato in etichetta`;
    case "typo":
      return `${what}: forse intendevi «${e.term}»?`;
    case "unrecognized":
    default:
      return `non so cosa contiene ${what}`;
  }
}

/** Il dubbio detto per esteso: il piatto, l'ingrediente, il motivo vero e che cosa non si sa. */
function unverifiedText(u: UnverifiedItem, nameOfRef: (via: { kind: "recipe" | "prep"; id: string }) => string): string {
  const dish = u.via ? nameOfRef(u.via) : undefined;
  const ingredient = u.item?.name ?? "una voce";
  if (u.code === "uncertain_allergens") {
    const terms = u.terms ?? [];
    // un motivo solo per ingrediente: se è lo stesso per tutti gli allergeni, una frase; altrimenti una per motivo
    const byClause = new Map<string, string[]>();
    terms.forEach((t, i) => {
      const c = clauseOf(ingredient, u.evidence?.[i]);
      byClause.set(c, [...(byClause.get(c) ?? []), t]);
    });
    if (byClause.size === 0) byClause.set(clauseOf(ingredient, undefined), []);
    const parts = [...byClause].map(([c, ts]) => `${c}: potrebbe contenere ${joinTerms(ts)}`);
    return `${dish ? `${dish}: ` : ""}${parts.join("; ")}. Controlla l'etichetta.`;
  }
  if (u.code === "unknown_allergens") {
    return `Non so se «${ingredient}»${dish ? ` in ${dish}` : ""} contiene un allergene che hai indicato: non ho dati su questo alimento.`;
  }
  return dish ? `Non so quali ingredienti ha ${dish}: non l'ho potuto controllare.` : `${ingredient}: non l'ho potuto controllare.`;
}

export function constraintLines(result: ConstraintsResult, nameOfRef: (via: { kind: "recipe" | "prep"; id: string }) => string): ConstraintLine[] {
  const out: ConstraintLine[] = [];
  for (const v of result.violations) {
    const via = v.via ? ` (da ${nameOfRef(v.via)})` : "";
    const e = v.evidence;
    const why =
      v.code === "allergen" && e ? (e.origin === "label" ? " Lo dice l'etichetta del prodotto in dispensa." : inPantry(e) !== "" ? ` Viene dalla dispensa: «${e.text}».` : e.reason === "typo" ? ` Forse intendevi «${e.term}»?` : "") : "";
    out.push({
      kind: "violation",
      date: v.date,
      text:
        v.code === "excluded_food"
          ? `${v.item.name}${via} è tra gli alimenti che hai escluso («${v.term}»).`
          : `${v.item.name}${via} sembra contenere ${v.term}, che hai indicato come allergene.${why}`,
    });
  }
  // più ingredienti incerti nello stesso piatto dello stesso pasto: oltre tre, una riga sola con l'elenco
  const doubtful = new Map<string, UnverifiedItem[]>();
  for (const u of result.unverified) {
    if (u.code !== "uncertain_allergens" || !u.via) {
      out.push({ kind: "unverified", date: u.date, text: unverifiedText(u, nameOfRef) });
      continue;
    }
    const key = `${u.date}|${u.meal}|${u.via.kind}:${u.via.id}`;
    doubtful.set(key, [...(doubtful.get(key) ?? []), u]);
  }
  for (const group of doubtful.values()) {
    const first = group[0] as UnverifiedItem;
    if (group.length <= 3) {
      for (const u of group) out.push({ kind: "unverified", date: u.date, text: unverifiedText(u, nameOfRef) });
      continue;
    }
    const names = group.slice(0, 4).map((u) => `«${u.item?.name ?? "una voce"}»`).join(", ");
    const terms = [...new Set(group.flatMap((u) => u.terms ?? []))];
    out.push({
      kind: "unverified",
      date: first.date,
      text: `${nameOfRef(first.via as NonNullable<UnverifiedItem["via"]>)}: non so cosa contengono ${names}${group.length > 4 ? ` e altri ${group.length - 4}` : ""} (nomi non riconosciuti o ingredienti generici): potrebbero contenere ${joinTerms(terms)}. Controlla le etichette.`,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === b.kind ? 0 : a.kind === "violation" ? -1 : 1));
}

/* ---------- pianificato contro reale ---------- */

export interface AdherenceRow {
  status: EntryResult["status"] | "extra";
  text: string;
}

export interface AdherenceDayView {
  date: string;
  rows: AdherenceRow[];
}

export interface AdherenceView {
  /** "5 rispettate, 1 sostituita, 0 saltate, 2 aggiunte". */
  totalsText: string;
  rateText?: string;
  excludedText: string;
  excludedCount: number;
  days: AdherenceDayView[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function adherenceView(week: AdherenceWeek, nameOf: (item: PlannedItem) => string): AdherenceView {
  const t = week.totals;
  const names = (r: EntryResult) => r.actual.map((a) => a.name).join(", ");
  const days: AdherenceDayView[] = week.days.map((d) => ({
    date: d.date,
    rows: [
      ...d.entries.map((e): AdherenceRow => {
        const planned = nameOf(e.planned);
        switch (e.status) {
          case "respected":
            return { status: e.status, text: `${planned}: rispettato${e.otherSlot ? ", ma in un altro pasto" : ""}.` };
          case "substituted":
            return { status: e.status, text: `${planned}: al suo posto hai mangiato ${names(e)}.` };
          case "skipped":
            return { status: e.status, text: `${planned}: non c'è tra ciò che hai registrato.` };
          case "unverifiable":
            return {
              status: e.status,
              text: `${planned}: non si può dire${e.reason === "unresolved_ref" ? " (non so di che ingredienti è fatto)" : " (pasto segnato come non tracciato)"}.`,
            };
        }
      }),
      ...d.extras.map((x): AdherenceRow => ({ status: "extra", text: `${x.name}: mangiato, non era nel piano.` })),
    ],
  }));
  const excludedPlanned = week.excluded.declared.length + week.excluded.gaps.length;
  const parts: string[] = [];
  if (week.excluded.gaps.length > 0) parts.push(`${plural(week.excluded.gaps.length, "giorno", "giorni")} con pasti non registrati`);
  if (week.excluded.declared.length > 0) parts.push(`${plural(week.excluded.declared.length, "giorno", "giorni")} con pasti segnati come non tracciati`);
  const excludedText =
    excludedPlanned === 0
      ? "Nessun giorno pianificato escluso."
      : `${plural(excludedPlanned, "giorno escluso", "giorni esclusi")} dal confronto, perché non tracciati per intero: ${parts.join(" e ")}. Un vuoto non vuol dire che hai saltato il pasto.`;
  return {
    totalsText: `${plural(t.respected, "rispettata", "rispettate")}, ${plural(t.substituted, "sostituita", "sostituite")}, ${plural(t.skipped, "saltata", "saltate")}, ${plural(t.extra, "aggiunta", "aggiunte")}${t.unverifiable > 0 ? `, ${plural(t.unverifiable, "non verificabile", "non verificabili")}` : ""}`,
    ...(week.rate !== undefined ? { rateText: `${Math.round(week.rate * 100)}% delle voci giudicabili rispettate` } : {}),
    excludedText,
    excludedCount: excludedPlanned,
    days,
  };
}
