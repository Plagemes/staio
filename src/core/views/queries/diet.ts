// Interrogazioni sulla qualità di ciò che si mangia: frequenza dei gruppi, quota di prodotti molto lavorati, quadro di una settimana.
// Vengono dal quadro settimanale già calcolato (`ctx.diet`). Una settimana senza dati sufficienti è una lacuna, mai uno zero,
// e nessuna riga dà un voto: si dicono i fatti, l'indicazione della fonte e lo stato in parole.
import { MEASURE_LABEL, rowLabel } from "../../diet/labels";
import { GROUP_ROW_IDS, type DietHistory, type GroupRowId, type Indicator, type IndicatorId, type MeasureIndicatorId, type TargetView, type WeekFrame } from "../../diet/types";
import { formatNumber, plural, shortDate } from "../labels";
import type { InsufficientResult, ParamDef, Params, QueryDef, RowItem } from "../types";
import { insufficient, round, worst } from "./kit";

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Le righe e gli indicatori prendono il nome dall'elenco unico del modulo (`core/diet/labels.ts`), qui con la maiuscola;
// per due indicatori la vista dell'assistente usa una dicitura più lunga.
const GROUP_LABELS: Readonly<Record<GroupRowId, string>> = Object.fromEntries(
  GROUP_ROW_IDS.map((row) => [row, capitalize(rowLabel(row))]),
) as Record<GroupRowId, string>;

const MEASURE_OVERRIDES: Readonly<Partial<Record<MeasureIndicatorId, string>>> = {
  wholeGrainShare: "Quota di cereali integrali",
  freeSugars: "Zuccheri liberi (stima per difetto)",
};

const MEASURE_LABELS: Readonly<Record<MeasureIndicatorId, string>> = Object.fromEntries(
  (Object.keys(MEASURE_LABEL) as MeasureIndicatorId[]).map((id) => [id, MEASURE_OVERRIDES[id] ?? capitalize(MEASURE_LABEL[id])]),
) as Record<MeasureIndicatorId, string>;

const GROUP_IDS = Object.keys(GROUP_LABELS) as GroupRowId[];
const MAX_WEEKS = 8;

const groupParam: ParamDef = { kind: "enum", values: GROUP_IDS, description: "gruppo di alimenti (riga delle Linee guida)" };
const weeksParam: ParamDef = { kind: "int", min: 4, max: MAX_WEEKS, default: MAX_WEEKS, description: "quante settimane, fino a quella in corso" };

const noDiet = (): InsufficientResult =>
  insufficient("Dati insufficienti: il quadro di ciò che hai mangiato non è ancora pronto, o non ci sono ancora voci registrate.");

const indicatorLabel = (id: IndicatorId): string =>
  id.startsWith("group:") ? (GROUP_LABELS[id.slice(6) as GroupRowId] ?? id) : (MEASURE_LABELS[id as MeasureIndicatorId] ?? id);

const isGroup = (v: unknown): v is GroupRowId => typeof v === "string" && (GROUP_IDS as string[]).includes(v);

/** Le ultime settimane richieste, dalla più vecchia. */
const weeksOf = (p: Params, diet: DietHistory): WeekFrame[] => {
  const n = Math.round(Number(p.weeks));
  return diet.weeks.slice(-(Number.isFinite(n) ? Math.min(MAX_WEEKS, Math.max(4, n)) : MAX_WEEKS));
};

const weekLabel = (w: WeekFrame): string => `${shortDate(w.weekStart)}${w.inProgress ? " (in corso)" : ""}`;

const hasValue = (i: Indicator | undefined): i is Indicator & { value: number } =>
  i !== undefined && i.status !== "insufficient" && i.value !== undefined && Number.isFinite(i.value);

const qualityGroupFrequency: QueryDef = {
  name: "quality_group_frequency",
  description:
    "Quante porzioni a settimana di un gruppo di alimenti (legumi, pesce, verdura...) nelle ultime settimane. Una settimana con dati insufficienti resta vuota, non vale zero. Dice cosa si è mangiato, non se è giusto: l'indicazione delle Linee guida sta nel quadro della settimana.",
  params: { group: groupParam, weeks: weeksParam },
  result: "series",
  needsNutrition: true,
  caption: (p) => `${isGroup(p.group) ? GROUP_LABELS[p.group] : "Gruppo"} · porzioni a settimana`,
  run(p, ctx) {
    if (!ctx.diet) return noDiet();
    if (!isGroup(p.group)) return insufficient("Questo gruppo di alimenti non è nell'elenco.");
    const weeks = weeksOf(p, ctx.diet);
    if (weeks.length === 0) return noDiet();
    const id: IndicatorId = `group:${p.group}`;
    const found = weeks.map((w) => {
      const ind = w.indicators.find((i) => i.id === id);
      return hasValue(ind) ? { ind, week: w } : undefined;
    });
    const points = weeks.map((w, i) => {
      const f = found[i];
      return { label: weekLabel(w), value: f ? round(f.ind.value, 2) : null };
    });
    const used = found.filter((x): x is NonNullable<typeof x> => x !== undefined);
    const basis = `${plural(used.length, "settimana con dati sufficienti", "settimane con dati sufficienti")} su ${weeks.length}`;
    if (used.length === 0) return insufficient("Dati insufficienti: nessuna settimana ha abbastanza giorni registrati e riconosciuti per questo gruppo.", basis);
    const partial = used.some((x) => x.ind.lowerBound || x.week.inProgress);
    return {
      kind: "series",
      points,
      unit: used[0].ind.unit === "servingsPerDay" ? "porzioni al giorno" : "porzioni a settimana",
      digits: 1,
      certainty: worst(used.map((x) => x.ind.certainty)),
      basis,
      note: `Le settimane lasciate vuote non hanno dati sufficienti.${partial ? " Dove la settimana è in corso o registrata solo in parte il valore è un minimo: ciò che manca dal registro non è contato." : ""}`,
    };
  },
};

const qualityProcessedShare: QueryDef = {
  name: "quality_processed_share",
  description:
    "Quota dell'energia che viene da prodotti molto lavorati (livello 4 della classificazione NOVA) nelle ultime settimane. Conta solo l'energia di cui si conosce il livello di lavorazione, e la copertura è nella nota. Non ha una soglia ufficiale: serve a vedere l'andamento.",
  params: { weeks: weeksParam },
  result: "series",
  needsNutrition: true,
  caption: () => "Prodotti molto lavorati · quota dell'energia riconosciuta",
  run(p, ctx) {
    if (!ctx.diet) return noDiet();
    const weeks = weeksOf(p, ctx.diet);
    if (weeks.length === 0) return noDiet();
    const ok = weeks.map((w) => {
      const ind = w.indicators.find((i) => i.id === "processedShare");
      return ind !== undefined && ind.status !== "insufficient" && w.processed.share !== undefined ? w.processed : undefined;
    });
    const points = weeks.map((w, i) => {
      const share = ok[i]?.share;
      return { label: weekLabel(w), value: share !== undefined ? round(share * 100, 1) : null };
    });
    const used = ok.filter((x): x is NonNullable<typeof x> => x !== undefined);
    const basis = `${plural(used.length, "settimana con dati sufficienti", "settimane con dati sufficienti")} su ${weeks.length}`;
    if (used.length === 0) return insufficient("Dati insufficienti: nessuna settimana ha abbastanza energia con il livello di lavorazione noto.", basis);
    const coverage = used.reduce((s, x) => s + x.coverage, 0) / used.length;
    const certainty = worst(used.map((x) => x.certainty));
    return {
      kind: "series",
      points,
      unit: "% dell'energia",
      digits: 0,
      certainty,
      basis,
      note: `Il livello di lavorazione è noto per circa il ${formatNumber(coverage * 100)}% dell'energia: la quota si riferisce solo a quella parte. Per gli alimenti generici è una stima.`,
    };
  },
};

function targetText(t: TargetView | undefined): string | undefined {
  if (!t) return undefined;
  const per = (unit: string): string =>
    t.min !== undefined && t.max !== undefined
      ? `da ${formatNumber(t.min)} a ${formatNumber(t.max)} ${unit}`
      : t.min !== undefined
        ? `almeno ${formatNumber(t.min)} ${unit}`
        : t.max !== undefined
          ? `al massimo ${formatNumber(t.max)} ${unit}`
          : "";
  switch (t.kind) {
    case "perDay":
    case "maxPerDay":
      return per("al giorno") || undefined;
    case "perWeek":
    case "maxPerWeek":
      return per("a settimana") || undefined;
    case "occasional":
      return "consumo occasionale secondo la fonte";
    case "notAdvised":
      return "consumo non indicato dalla fonte";
    case "shareMin":
      return t.min !== undefined ? `quota indicata: almeno ${formatNumber(t.min * 100)}%` : undefined;
    case "percentEnergyMax":
      return t.max !== undefined ? `al massimo ${formatNumber(t.max)}% dell'energia` : undefined;
    case "gramsPerDayMin":
      return t.min !== undefined ? `almeno ${formatNumber(t.min)} g al giorno` : undefined;
    case "gramsPerDayMax":
      return t.max !== undefined ? `al massimo ${formatNumber(t.max)} g al giorno` : undefined;
    default:
      return undefined;
  }
}

function valueText(i: Indicator): string {
  if (i.value === undefined) return "dati insufficienti";
  const v = i.value;
  const body =
    i.unit === "servingsPerWeek"
      ? `${formatNumber(v, 1)} porzioni a settimana`
      : i.unit === "servingsPerDay"
        ? `${formatNumber(v, 1)} porzioni al giorno`
        : i.unit === "gramsPerDay"
          ? `${formatNumber(v)} g al giorno`
          : i.unit === "percentEnergy"
            ? `${formatNumber(v, 1)}% dell'energia`
            : i.unit === "share"
              ? `${formatNumber(v * 100)}%`
              : formatNumber(v);
  return i.lowerBound ? `almeno ${body}` : body;
}

const INSUFFICIENT_TEXT = {
  no_data: "nessun dato registrato",
  few_days: "pochi giorni registrati",
  few_complete_days: "pochi giorni registrati per intero",
  low_coverage: "troppo poco di ciò che hai mangiato è riconosciuto",
} as const;

/** Lo stato in parole, mai solo un colore o un numero. */
function statusText(i: Indicator): string {
  const target = targetText(i.target);
  const withTarget = (s: string): string => (target ? `${s} (${target})` : s);
  switch (i.status) {
    case "within":
      return withTarget("dentro l'indicazione");
    case "below":
      return withTarget("sotto l'indicazione");
    case "above":
      return withTarget("sopra l'indicazione");
    case "atLeast":
      return withTarget("settimana registrata in parte: è un minimo");
    case "occasional":
      return "consumo occasionale secondo la fonte";
    case "noTarget":
      return "nessuna soglia ufficiale: solo il tuo andamento";
    default:
      return `dati insufficienti${i.insufficient ? `: ${INSUFFICIENT_TEXT[i.insufficient]}` : ""}`;
  }
}

const qualityWeekOverview: QueryDef = {
  name: "quality_week_overview",
  description:
    "Quadro di una settimana di ciò che si è mangiato: per ogni indicatore (gruppi di alimenti, verdura e frutta, sale, fibre, zuccheri liberi, prodotti molto lavorati, varietà di vegetali) il valore, l'indicazione delle Linee guida dove c'è e lo stato in parole. 0 = la settimana in corso, 1 = la scorsa, fino a 7.",
  params: { week: { kind: "int", min: 0, max: MAX_WEEKS - 1, default: 0, description: "quante settimane fa (0 = in corso)" } },
  result: "rows",
  needsNutrition: true,
  caption: (p) => {
    const n = Number(p.week);
    return n === 0 ? "Questa settimana · quadro degli indicatori" : `${n === 1 ? "1 settimana" : `${n} settimane`} fa · quadro degli indicatori`;
  },
  run(p, ctx) {
    if (!ctx.diet) return noDiet();
    const back = Math.round(Number(p.week));
    const frame = Number.isFinite(back) && back >= 0 ? ctx.diet.weeks[ctx.diet.weeks.length - 1 - back] : undefined;
    if (!frame) return insufficient("Dati insufficienti: non ho il quadro di quella settimana.");
    const basis = `${plural(frame.daysWithData, "giorno registrato", "giorni registrati")} su ${frame.daysElapsed}${frame.inProgress ? " (settimana in corso)" : ""}, riconosciuto circa il ${formatNumber(frame.coverage.share * 100)}% di ciò che hai mangiato (${shortDate(frame.weekStart)}–${shortDate(frame.weekEnd)})`;
    if (frame.daysWithData === 0) return insufficient("Dati insufficienti: in quella settimana non c'è nessun giorno registrato.", basis);
    const rows: RowItem[] = frame.indicators.map((i) => ({
      label: indicatorLabel(i.id),
      valueText: valueText(i),
      detail: statusText(i),
      certainty: i.certainty,
    }));
    return {
      kind: "rows",
      rows,
      basis,
      note: "Confronto con le indicazioni delle Linee guida, non un parere medico. Le stime sono segnate come tali; ciò che non è riconosciuto non entra nei conti.",
    };
  },
};

export const QUALITY_QUERIES: readonly QueryDef[] = [qualityGroupFrequency, qualityProcessedShare, qualityWeekOverview];
