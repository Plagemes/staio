// Interrogazioni sui nutrienti: media, confronto con il riferimento, andamento, alimenti che contribuiscono.
// Contano solo i giorni tracciati per intero; un giorno senza il dato non vale zero.
import { compareWithReferences, type DayIntake, type IntakeLine, type ReferenceComparison, type ResolvedLine } from "../../nutrition";
import { NUTRIENT_INFO, formatNumber, formatWithUnit, plural, shortDate } from "../labels";
import { inRange } from "../period";
import type { QueryDef } from "../types";
import { insufficient, limitOf, limitParam, mean, noNutrition, normText, nutrientLabel, nutrientOf, nutrientParam, periodOf, periodParam, round, minSamples, worst } from "./kit";

const DAYS = (n: number) => plural(n, "giorno", "giorni");

const nutrientAverage: QueryDef = {
  name: "nutrient_average",
  description:
    "Media giornaliera di un nutriente nel periodo, calcolata solo sui giorni in cui colazione, pranzo e cena sono tracciati. Dice quanti giorni ci sono dietro e quanta parte del dato manca.",
  params: { nutrient: nutrientParam, period: periodParam() },
  result: "number",
  needsNutrition: true,
  caption: (p) => `${nutrientLabel(p)} · media al giorno`,
  run(p, ctx) {
    if (!ctx.intake) return noNutrition();
    const key = nutrientOf(p);
    const info = NUTRIENT_INFO[key];
    const period = periodOf(p, ctx);
    const inPeriod = ctx.intake.days.filter((d) => inRange(d.date, period));
    const complete = inPeriod.filter((d) => d.complete);
    const withData = complete.filter((d) => d.totals[key] !== undefined);
    const basis = `${plural(withData.length, "giorno tracciato per intero", "giorni tracciati per intero")} su ${period.days} (${period.label})`;
    const min = minSamples(period);
    if (withData.length < min) {
      return insufficient(
        `Dati insufficienti: servono almeno ${DAYS(min)} tracciati per intero con il dato di ${info.label.toLowerCase()}.`,
        basis,
      );
    }
    const totals = withData.map((d) => d.totals[key]!);
    const missing = mean(totals.map((t) => t.missingShare));
    return {
      kind: "number",
      value: round(mean(totals.map((t) => t.value))),
      unit: `${info.unit} al giorno`,
      digits: info.digits,
      certainty: worst(totals.map((t) => t.certainty)),
      basis,
      ...(totals.some((t) => t.partial)
        ? { note: `Per circa il ${formatNumber(missing * 100)}% di ciò che hai mangiato manca il dato: il valore può essere più basso del reale.` }
        : {}),
    };
  },
};

const REASONS: Record<string, string> = {
  few_complete_days: "giorni tracciati per intero",
  few_days_with_data: "giorni con il dato di questo nutriente",
};

function describeComparison(c: ReferenceComparison, periodDays: number, periodLabel: string): ReturnType<QueryDef["run"]> {
  const info = NUTRIENT_INFO[c.nutrient];
  const basis = `${plural(c.daysWithData, "giorno tracciato per intero", "giorni tracciati per intero")} su ${periodDays} (${periodLabel})`;
  if (c.status === "insufficient_data") {
    return insufficient(
      `Dati insufficienti: servono almeno ${c.required} ${REASONS[c.reason]}, nel periodo ce ne sono ${c.reason === "few_complete_days" ? c.completeDays : c.daysWithData}.`,
      basis,
    );
  }
  if (c.status === "not_comparable") {
    const why: Record<string, string> = {
      no_amount: "Per questo nutriente il riferimento è solo una nota, senza un valore con cui confrontare.",
      no_energy_range: "Il riferimento non indica un intervallo di energia.",
      nutrient_without_energy: "Questo nutriente non porta energia: non si può esprimere come quota dell'energia.",
      no_energy: "L'energia registrata è nulla: non si può calcolare la quota.",
    };
    return insufficient(why[c.reason] ?? "Il confronto non è possibile.", basis);
  }
  const o = c.outcome;
  const source = `Fonte del riferimento: ${c.reference.source.body}.`;
  const missingNote = c.averageMissingShare >= 0.1 ? ` Per circa il ${formatNumber(c.averageMissingShare * 100)}% manca il dato: il valore può essere più basso del reale.` : "";
  const base = { kind: "number" as const, digits: 0, certainty: c.certainty, basis };
  if (o.kind === "PRI" || o.kind === "AI") {
    const kindText = o.kind === "PRI" ? "assunzione raccomandata" : "assunzione adeguata";
    return {
      ...base,
      value: round(o.coveredShare * 100),
      unit: "% del riferimento",
      note: `Assunzione media ${formatWithUnit(o.intake, info.unit, info.digits)} al giorno, contro ${formatWithUnit(o.referenceAmount, info.unit, info.digits)} di ${kindText}. ${source}${missingNote}`,
    };
  }
  if (o.kind === "UL") {
    return {
      ...base,
      value: round(o.ratio * 100),
      unit: "% del livello massimo",
      note: `Assunzione media ${formatWithUnit(o.intake, info.unit, info.digits)} al giorno, livello massimo di riferimento ${formatWithUnit(o.limit, info.unit, info.digits)}; ${plural(o.daysOver, "giorno", "giorni")} sopra. ${source}${missingNote}`,
    };
  }
  if (o.kind !== "RI") return insufficient("Il confronto non è possibile.", basis);
  const position = { below_range: "sotto l'intervallo", within_range: "dentro l'intervallo", above_range: "sopra l'intervallo" }[o.position];
  const range =
    o.min !== undefined && o.max !== undefined
      ? `da ${formatNumber(o.min)}% a ${formatNumber(o.max)}%`
      : o.min !== undefined
        ? `almeno ${formatNumber(o.min)}%`
        : `al massimo ${formatNumber(o.max ?? 0)}%`;
  return {
    ...base,
    value: round(o.percentOfEnergy),
    unit: "% dell'energia",
    note: `Intervallo di riferimento: ${range}; sei ${position}. ${source}${missingNote}`,
  };
}

const nutrientVsReference: QueryDef = {
  name: "nutrient_vs_reference",
  description:
    "Confronta l'assunzione media di un nutriente con il valore di riferimento per il profilo dell'utente (assunzione raccomandata o adeguata; con kind=upper_limit il livello massimo). Dà una quota del riferimento, non un giudizio. Serve il profilo e almeno 5 giorni tracciati per intero.",
  params: {
    nutrient: nutrientParam,
    period: periodParam(),
    kind: { kind: "enum", values: ["recommended", "upper_limit"], default: "recommended", description: "recommended = riferimento da raggiungere, upper_limit = livello massimo" },
  },
  result: "number",
  needsNutrition: true,
  caption: (p) => `${nutrientLabel(p)} · confronto con il riferimento`,
  run(p, ctx) {
    if (!ctx.intake || !ctx.references) return noNutrition();
    if (!ctx.profile) return insufficient("Per il confronto con i valori di riferimento serve il profilo (sesso ed età): si scrive nella pagina Nutrizione.");
    const key = nutrientOf(p);
    const period = periodOf(p, ctx);
    const comparisons = compareWithReferences(ctx.intake.days, ctx.references, ctx.profile, { from: period.from, to: period.to });
    const order = p.kind === "upper_limit" ? ["UL"] : ["PRI", "AI", "RI"];
    const found = order.map((k) => comparisons.find((c) => c.nutrient === key && c.kind === k)).find((c) => c !== undefined);
    if (!found) {
      return insufficient(
        p.kind === "upper_limit" ? "Per questo nutriente non c'è un livello massimo di riferimento." : "Per questo nutriente non c'è un valore di riferimento da raggiungere.",
      );
    }
    return describeComparison(found, period.days, period.label);
  },
};

const nutrientDaily: QueryDef = {
  name: "nutrient_daily",
  description: "Andamento giorno per giorno di un nutriente nel periodo, sui soli giorni tracciati per intero. Per un grafico.",
  params: { nutrient: nutrientParam, period: periodParam() },
  result: "series",
  needsNutrition: true,
  caption: (p) => `${nutrientLabel(p)} · giorno per giorno`,
  run(p, ctx) {
    if (!ctx.intake) return noNutrition();
    const key = nutrientOf(p);
    const info = NUTRIENT_INFO[key];
    const period = periodOf(p, ctx);
    const days = ctx.intake.days.filter((d) => inRange(d.date, period) && d.complete && d.totals[key] !== undefined);
    const basis = `${plural(days.length, "giorno tracciato per intero", "giorni tracciati per intero")} su ${period.days} (${period.label})`;
    if (days.length < 2) return insufficient("Dati insufficienti: servono almeno 2 giorni tracciati per intero per disegnare un andamento.", basis);
    return {
      kind: "series",
      points: days.map((d) => ({ label: shortDate(d.date), value: round(d.totals[key]!.value) })),
      unit: info.unit,
      digits: info.digits,
      certainty: worst(days.map((d) => d.totals[key]!.certainty)),
      basis,
      note: "I giorni non tracciati per intero non compaiono.",
    };
  },
};

function linesOf(day: DayIntake): IntakeLine[] {
  return [...day.meals.flatMap((m) => m.lines), ...day.standalone];
}

const topFoods: QueryDef = {
  name: "top_foods_for_nutrient",
  description:
    "Gli alimenti che contribuiscono di più a un nutriente nel periodo (sui giorni tracciati per intero), con la loro quota sul totale.",
  params: { nutrient: nutrientParam, period: periodParam(), limit: limitParam() },
  result: "rows",
  needsNutrition: true,
  caption: (p) => `${nutrientLabel(p)} · da quali alimenti viene`,
  run(p, ctx) {
    if (!ctx.intake) return noNutrition();
    const key = nutrientOf(p);
    const info = NUTRIENT_INFO[key];
    const period = periodOf(p, ctx);
    const days = ctx.intake.days.filter((d) => inRange(d.date, period) && d.complete);
    const basis = `${plural(days.length, "giorno tracciato per intero", "giorni tracciati per intero")} su ${period.days} (${period.label})`;
    const sums = new Map<string, { name: string; value: number; certainty: ResolvedLine["certainty"][] }>();
    let total = 0;
    let unresolved = 0;
    let outOfHome = 0;
    for (const day of days) {
      for (const line of linesOf(day)) {
        if (line.status !== "ok") {
          unresolved += 1;
          continue;
        }
        // Una stima «fuori casa» non è un alimento: di quel pasto non si sa che cosa c'era. Si dice a parte.
        if (line.outOfHome === true) {
          outOfHome += 1;
          continue;
        }
        const v = line.nutrients[key];
        if (typeof v !== "number" || v <= 0) continue;
        const id = normText(line.label) || line.label;
        const cur = sums.get(id) ?? { name: line.label, value: 0, certainty: [] };
        cur.value += v;
        cur.certainty.push(line.certainty);
        sums.set(id, cur);
        total += v;
      }
    }
    const notes = [
      ...(unresolved > 0 ? [`${plural(unresolved, "voce non riconosciuta non è contata", "voci non riconosciute non sono contate")}.`] : []),
      ...(outOfHome > 0
        ? [`${plural(outOfHome, "pasto fuori casa stimato non è tra gli alimenti", "pasti fuori casa stimati non sono tra gli alimenti")}: di quei pasti non si conosce il contenuto, e le quote riguardano solo il resto.`]
        : []),
    ];
    if (days.length === 0 || sums.size === 0) {
      return insufficient(
        `Dati insufficienti: nessuna voce tracciata per intero con il dato di ${info.label.toLowerCase()}.${outOfHome > 0 ? ` ${notes[notes.length - 1]}` : ""}`,
        basis,
      );
    }
    const rows = [...sums.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, limitOf(p))
      .map((s) => ({
        label: s.name,
        valueText: formatWithUnit(round(s.value), info.unit, info.digits),
        share: s.value / total,
        detail: `${formatNumber((s.value / total) * 100)}% del totale`,
        certainty: worst(s.certainty),
      }));
    return {
      kind: "rows",
      rows,
      basis,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  },
};

export const NUTRITION_QUERIES: readonly QueryDef[] = [nutrientAverage, nutrientVsReference, nutrientDaily, topFoods];
