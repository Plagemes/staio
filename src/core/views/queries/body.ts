// Interrogazioni sul corpo: acqua, peso, umore, sintomi, giorni tracciati.
import { dateRange, dayCoverage, getDay, weightSeries } from "../../diary";
import { formatNumber, formatWithUnit, plural, shortDate } from "../labels";
import { inRange } from "../period";
import type { QueryDef } from "../types";
import { insufficient, mean, minSamples, periodOf, periodParam, round, worst } from "./kit";

const waterAverage: QueryDef = {
  name: "water_average",
  description: "Acqua bevuta in media al giorno nel periodo, sui soli giorni in cui è stata registrata dell'acqua.",
  params: { period: periodParam("last_7_days") },
  result: "number",
  needsNutrition: false,
  caption: () => "Acqua · media al giorno",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const days = ctx.diary.days.filter((d) => inRange(d.date, period) && d.waterMl > 0);
    const basis = `${plural(days.length, "giorno con acqua registrata", "giorni con acqua registrata")} su ${period.days} (${period.label})`;
    if (days.length < minSamples(period)) return insufficient("Dati insufficienti: servono più giorni con acqua registrata.", basis);
    return {
      kind: "number",
      value: Math.round(mean(days.map((d) => d.waterMl))),
      unit: "ml al giorno",
      digits: 0,
      certainty: worst(days.map((d) => d.waterCertainty)),
      basis,
      note: "I giorni senza acqua registrata non contano come zero.",
    };
  },
};

const waterDaily: QueryDef = {
  name: "water_daily",
  description: "Acqua bevuta giorno per giorno nel periodo. Per un grafico.",
  params: { period: periodParam("last_14_days") },
  result: "series",
  needsNutrition: false,
  caption: () => "Acqua · giorno per giorno",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const days = ctx.diary.days.filter((d) => inRange(d.date, period) && d.waterMl > 0);
    const basis = `${plural(days.length, "giorno con acqua registrata", "giorni con acqua registrata")} su ${period.days} (${period.label})`;
    if (days.length < 2) return insufficient("Dati insufficienti: servono almeno 2 giorni con acqua registrata.", basis);
    return {
      kind: "series",
      points: days.map((d) => ({ label: shortDate(d.date), value: d.waterMl })),
      unit: "ml",
      digits: 0,
      certainty: worst(days.map((d) => d.waterCertainty)),
      basis,
      note: "I giorni senza acqua registrata non compaiono.",
    };
  },
};

const weightLatest: QueryDef = {
  name: "weight_latest",
  description: "L'ultima pesata registrata e, se ce ne sono almeno due nel periodo, di quanto è cambiata.",
  params: { period: periodParam() },
  result: "number",
  needsNutrition: false,
  caption: () => "Peso",
  run(p, ctx) {
    const all = weightSeries(ctx.diary, { to: ctx.today });
    const last = all[all.length - 1];
    if (!last) return insufficient("Nessuna pesata registrata.");
    const period = periodOf(p, ctx);
    const inPeriod = all.filter((w) => inRange(w.date, period));
    let note: string | undefined;
    if (inPeriod.length >= 2) {
      const first = inPeriod[0];
      const diff = round(last.kg - first.kg, 1);
      note = `Nel periodo (${period.label}): ${diff > 0 ? "+" : ""}${formatNumber(diff, 1)} kg rispetto alla pesata del ${shortDate(first.date)}.`;
    }
    return { kind: "number", value: last.kg, unit: "kg", digits: 1, certainty: last.certainty, basis: `Pesata del ${shortDate(last.date)}`, ...(note ? { note } : {}) };
  },
};

const weightTrend: QueryDef = {
  name: "weight_trend",
  description: "Andamento del peso nel periodo, una pesata per giorno. Per un grafico.",
  params: { period: periodParam() },
  result: "series",
  needsNutrition: false,
  caption: () => "Peso nel tempo",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const pts = weightSeries(ctx.diary, { from: period.from, to: period.to });
    const basis = `${plural(pts.length, "pesata", "pesate")} (${period.label})`;
    if (pts.length < 2) return insufficient("Dati insufficienti: servono almeno 2 pesate nel periodo.", basis);
    return {
      kind: "series",
      points: pts.map((w) => ({ label: shortDate(w.date), value: w.kg })),
      unit: "kg",
      digits: 1,
      certainty: worst(pts.map((w) => w.certainty)),
      basis,
    };
  },
};

const SCORE_NOTE = "Punteggio da 1 (peggio) a 5 (meglio), scritto da te.";

const moodAverage: QueryDef = {
  name: "mood_average",
  description: "Umore medio nel periodo, dai punteggi da 1 a 5 che l'utente ha scritto.",
  params: { period: periodParam() },
  result: "number",
  needsNutrition: false,
  caption: () => "Umore · media",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const moods = ctx.diary.days.filter((d) => inRange(d.date, period)).flatMap((d) => d.moods);
    const basis = `${plural(moods.length, "annotazione", "annotazioni")} (${period.label})`;
    if (moods.length < minSamples(period)) return insufficient("Dati insufficienti: servono più annotazioni dell'umore.", basis);
    return { kind: "number", value: round(mean(moods.map((m) => m.score)), 2), unit: "su 5", digits: 1, certainty: worst(moods.map((m) => m.certainty)), basis, note: SCORE_NOTE };
  },
};

const moodDaily: QueryDef = {
  name: "mood_daily",
  description: "Umore giorno per giorno nel periodo (media dei punteggi del giorno). Per un grafico.",
  params: { period: periodParam() },
  result: "series",
  needsNutrition: false,
  caption: () => "Umore nel tempo",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const days = ctx.diary.days.filter((d) => inRange(d.date, period) && d.moods.length > 0);
    const basis = `${plural(days.length, "giorno con umore annotato", "giorni con umore annotato")} su ${period.days} (${period.label})`;
    if (days.length < 2) return insufficient("Dati insufficienti: servono almeno 2 giorni con l'umore annotato.", basis);
    return {
      kind: "series",
      points: days.map((d) => ({ label: shortDate(d.date), value: round(mean(d.moods.map((m) => m.score)), 2) })),
      unit: "su 5",
      digits: 1,
      certainty: worst(days.flatMap((d) => d.moods.map((m) => m.certainty))),
      basis,
      note: SCORE_NOTE,
    };
  },
};

const KIND_LABELS = { digestion: "Digestione", energy: "Energia", sleep: "Sonno", other: "Altro" } as const;

const symptomsSummary: QueryDef = {
  name: "symptoms_summary",
  description: "Digestione, energia e sonno nel periodo: punteggio medio da 1 a 5 e numero di annotazioni per ciascuno.",
  params: { period: periodParam() },
  result: "rows",
  needsNutrition: false,
  caption: () => "Digestione, energia, sonno",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const symptoms = ctx.diary.days.filter((d) => inRange(d.date, period)).flatMap((d) => d.symptoms);
    const basis = `${plural(symptoms.length, "annotazione", "annotazioni")} (${period.label})`;
    if (symptoms.length === 0) return insufficient("Nessuna annotazione di digestione, energia o sonno nel periodo.", basis);
    const rows = (Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).flatMap((kind) => {
      const list = symptoms.filter((s) => s.kind === kind);
      if (list.length === 0) return [];
      return [
        {
          label: KIND_LABELS[kind],
          valueText: formatWithUnit(round(mean(list.map((s) => s.score)), 2), "su 5", 1),
          detail: plural(list.length, "annotazione", "annotazioni"),
          certainty: worst(list.map((s) => s.certainty)),
        },
      ];
    });
    return { kind: "rows", rows, basis, note: SCORE_NOTE };
  },
};

const trackedDays: QueryDef = {
  name: "tracked_days",
  description: "Quanti giorni del periodo hanno colazione, pranzo e cena tracciati, quanti hanno pasti dichiarati non tracciati e quanti hanno vuoti.",
  params: { period: periodParam() },
  result: "number",
  needsNutrition: false,
  caption: () => "Giorni tracciati",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const days = dateRange(period.from, period.to).map((date) => dayCoverage(getDay(ctx.diary, date), date));
    const complete = days.filter((d) => d.status === "complete").length;
    const declared = days.filter((d) => d.status === "declared").length;
    const gaps = days.length - complete - declared;
    return {
      kind: "number",
      value: complete,
      unit: complete === 1 ? "giorno tracciato per intero" : "giorni tracciati per intero",
      digits: 0,
      basis: `su ${period.days} del periodo (${period.label})`,
      note: `${plural(declared, "giorno ha pasti dichiarati non tracciati", "giorni hanno pasti dichiarati non tracciati")}; ${plural(gaps, "giorno ha vuoti", "giorni hanno vuoti")}.`,
    };
  },
};

export const BODY_QUERIES: readonly QueryDef[] = [waterAverage, waterDaily, weightLatest, weightTrend, moodAverage, moodDaily, symptomsSummary, trackedDays];
