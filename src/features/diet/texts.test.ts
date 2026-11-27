import { describe, expect, it } from "vitest";
import {
  ADVICE_RULE_IDS,
  CLASS_BASES,
  DIET_GROUPS,
  GROUP_ROW_IDS,
  INDICATOR_STATUSES,
  MEASURE_INDICATOR_IDS,
  SOURCE_IDS,
  UNCLASSIFIED,
  buildAdvice,
  computeOutcomes,
  targetFor,
  type Advice,
  type AdviceAction,
  type AdviceOutcome,
  type GuidelineRowId,
  type Indicator,
  type TargetView,
} from "@/core/diet";
import { CURRENT, LAST_CLOSED, TODAY, frame, history, ind, input, pantry, recipe } from "@/core/diet/advice/test-helpers";
import {
  actionLabel,
  addedToShoppingText,
  adviceFactText,
  adviceSourceText,
  basisText,
  briefingAdviceText,
  classSheetTitle,
  coverageText,
  dietReasonText,
  groupLabel,
  indicatorLabel,
  indicatorText,
  insufficientText,
  lineMarkLabel,
  lineMarkText,
  outcomeText,
  partClassText,
  plannedRowText,
  rowLabel,
  sourceDetail,
  sourceText,
  statusText,
  targetAmount,
  targetText,
  weekHeaderText,
  weekRangeText,
  whenText,
  CLASS_SHEET_RESET,
  CLASS_SHEET_SCOPE,
  DISMISSED_TEXT,
  ESTIMATE_NOTE,
  NOT_MEDICAL_TEXT,
  OUTCOMES_NOTE,
  levelNote,
  levelText,
} from "./texts";

const FORBIDDEN = /\b(devi|dovresti|sano|malsano|sicuro per te|compatibile|voto|punteggio|bravo|male)\b/i;

/** Consigli veri, dal motore, che coprono ogni regola e ogni tipo di azione. */
function sampleAdvice(): { advice: Advice[]; all: ReturnType<typeof history> } {
  const h = history({
    indicators: [
      ind("vegFruit", "below", 250),
      ind("group:legumes", "below", 1),
      ind("group:fish", "below", 0),
      ind("group:nutsSeeds", "below", 1, { certainty: "estimated" }),
      ind("wholeGrainShare", "below", 0.2),
      ind("fiber", "below", 15),
      ind("group:redMeat", "above", 4),
      ind("group:processedMeat", "occasional", 4),
      ind("group:sugaryDrinks", "occasional", 5),
      ind("salt", "above", 9),
      ind("freeSugars", "above", 14, { lowerBound: true, certainty: "estimated" }),
      ind("processedShare", "noTarget", 0.6, { certainty: "estimated" }),
    ],
  });
  const result = buildAdvice(
    input(h, {
      maxAdvice: 20,
      pantry: [pantry("Ceci", "legumes", "2026-11-28")],
      recipes: [recipe("r1", ["fish"], 0.8), recipe("r2", ["legumes", "vegetables"], 0.1)],
      alternatives: [
        { fromBarcode: "8000000000001", fromName: "Patatine", toBarcode: "8000000000002", toName: "Cracker", dimension: "salt", fromShare: 0.2 },
        { fromBarcode: "8000000000003", fromName: "Bibita", toBarcode: "8000000000004", toName: "Bibita zero", dimension: "sugars", fromShare: 0.1 },
      ],
    }),
  );
  return { advice: result.advice, all: h };
}

const ACTIONS: AdviceAction[] = [
  { kind: "cookWithPantry", foodName: "Ceci", lotIds: ["l1"], expiresOn: "2026-11-28" },
  { kind: "openRecipe", recipeId: "r1", title: "Pasta e lenticchie", inHomeShare: 0.6 },
  { kind: "addToPlan", recipeId: "r1", title: "Pasta e lenticchie", servings: 2 },
  { kind: "addToShopping", names: ["lenticchie", "pesce"] },
  { kind: "seeAlternative", fromBarcode: "1", fromName: "Patatine", toBarcode: "2", toName: "Cracker", dimension: "salt" },
  { kind: "openDetail", anchor: "consigli" },
];

const allTargets = (): TargetView[] => {
  const out: TargetView[] = [];
  for (const row of [...GROUP_ROW_IDS, "vegFruitTotal", "wholeGrainShare", "salt", "freeSugars", "fiber"] as GuidelineRowId[]) {
    for (const level of [1500, 2000, 2500] as const) {
      const t = targetFor(row, level);
      if (t) out.push(t);
    }
  }
  return out;
};

describe("testi: nessuna parola di giudizio, nessun parere medico", () => {
  it("ogni funzione, su quadri e consigli finti, non usa parole vietate", () => {
    const { advice, all } = sampleAdvice();
    const texts: string[] = [];
    const ctx = { today: TODAY, history: all };
    for (const a of advice) {
      texts.push(adviceFactText(a, ctx), briefingAdviceText(a, ctx), adviceSourceText(a));
      for (const act of a.actions) texts.push(actionLabel(act));
    }
    for (const act of ACTIONS) texts.push(actionLabel(act));
    for (const g of [...DIET_GROUPS, ...UNCLASSIFIED]) texts.push(groupLabel(g));
    for (const r of GROUP_ROW_IDS) texts.push(rowLabel(r), indicatorLabel(`group:${r}`));
    for (const m of MEASURE_INDICATOR_IDS) texts.push(indicatorLabel(m));
    for (const t of allTargets()) texts.push(targetText(t) ?? "", targetAmount(t) ?? "");
    for (const w of all.weeks) {
      texts.push(weekHeaderText(w), coverageText(w.coverage));
      for (const i of w.indicators) {
        texts.push(indicatorText(i, w));
        for (const status of INDICATOR_STATUSES) {
          for (const reason of [undefined, "no_data", "few_days", "few_complete_days", "low_coverage"] as const) {
            texts.push(statusText({ ...i, status, ...(reason ? { insufficient: reason } : {}) }, w));
            texts.push(insufficientText(reason, w));
          }
        }
      }
    }
    const outcomes: AdviceOutcome[] = [
      ...computeOutcomes(all),
      ...ADVICE_RULE_IDS.flatMap((ruleId) =>
        (["moved", "same", "opposite", "insufficient"] as const).map((result) => ({ ruleId, weekStart: LAST_CLOSED, nextWeekStart: CURRENT, before: 1, after: 3, result })),
      ),
    ];
    for (const o of outcomes) texts.push(outcomeText(o, all), outcomeText(o));
    for (const b of CLASS_BASES) texts.push(basisText(b));
    for (const certainty of ["measured", "label", "estimated"] as const) {
      for (const fromPrep of [true, false]) texts.push(lineMarkText({ level: 4, certainty, fromPrep }), lineMarkLabel({ level: 4, certainty, fromPrep }));
      texts.push(partClassText({ group: "legumes", certainty, processing: { level: 1, certainty, basis: "declared" } }));
    }
    for (const s of [...SOURCE_IDS, "ownTrend"] as const) {
      texts.push(sourceText(s, "Tab. 9.1, p. 132"), sourceDetail(s).title);
    }
    texts.push(
      dietReasonText(["legumes", "fish"]),
      dietReasonText([]),
      plannedRowText([{ group: "legumes", entries: 2, target: { kind: "perWeek", min: 2, max: 4, row: "legumes", source: "crea-lg-2018", where: "t" } }]),
      plannedRowText([]),
      addedToShoppingText(["lenticchie"]),
      classSheetTitle("Cracker integrali"),
      CLASS_SHEET_SCOPE,
      CLASS_SHEET_RESET,
      DISMISSED_TEXT,
      ESTIMATE_NOTE,
      NOT_MEDICAL_TEXT,
      OUTCOMES_NOTE,
      levelNote(2000),
      levelText(2000),
      whenText(LAST_CLOSED, TODAY),
      whenText(CURRENT, TODAY),
      whenText("2026-11-02", TODAY),
    );
    expect(advice.length).toBeGreaterThanOrEqual(8);
    expect(texts.length).toBeGreaterThan(500);
    for (const t of texts) {
      expect(t, t).not.toMatch(FORBIDDEN);
      expect(t, "nessun segnaposto rimasto").not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("il titolo ufficiale della fonte resta com'è: «sana» non è una parola vietata", () => {
    const t = sourceText("crea-lg-2018", "Tab. 9.1, p. 132");
    expect(t).toBe("Fonte: CREA, Linee guida per una sana alimentazione (rev. 2018), Tab. 9.1, p. 132");
    expect(t).not.toMatch(FORBIDDEN);
  });
});

describe("testi: forme", () => {
  it("le righe occasionali dicono le volte del quadro, non il valore dell'indicatore", () => {
    const w = frame({ weekStart: LAST_CLOSED, rowOccasions: { processedMeat: 3 } });
    const i: Indicator = ind("group:processedMeat", "occasional", 99, { unit: "count" });
    expect(indicatorText(i, w)).toBe("3 volte");
    expect(indicatorText({ ...i }, frame({ weekStart: LAST_CLOSED, rowOccasions: { processedMeat: 1 } }))).toBe("1 volta");
  });

  it("stima con la tilde, minimo con «almeno», niente valore: dati insufficienti", () => {
    expect(indicatorText(ind("group:legumes", "within", 3, { certainty: "estimated" }))).toBe("~3 porzioni a settimana");
    expect(indicatorText(ind("freeSugars", "above", 12.5, { lowerBound: true, certainty: "estimated" }))).toBe("almeno ~12,5% dell'energia");
    expect(indicatorText(ind("processedShare", "noTarget", 0.22, { certainty: "estimated" }))).toBe("~22% dell'energia riconosciuta");
    expect(indicatorText(ind("group:legumes", "insufficient"))).toBe("dati insufficienti");
  });

  it("indicazioni e stati in parole", () => {
    const legumes: TargetView = { kind: "perWeek", min: 2, max: 4, row: "legumes", source: "crea-lg-2018", where: "t" };
    expect(targetText(legumes)).toBe("indicate 2–4 porzioni a settimana");
    expect(targetText({ ...legumes, kind: "maxPerWeek", min: undefined, max: 1 })).toBe("indicate al massimo 1 porzione a settimana");
    expect(targetText({ ...legumes, kind: "occasional", min: undefined, max: undefined })).toBe("consumo occasionale secondo la fonte");
    const w = frame({ weekStart: LAST_CLOSED, daysWithData: 3, daysElapsed: 7 });
    expect(statusText(ind("group:legumes", "insufficient", undefined, { insufficient: "few_days" }), w)).toBe("Dati insufficienti: 3 giorni su 7");
    expect(statusText(ind("group:legumes", "atLeast", 1), w)).toBe("almeno 1: settimana registrata in parte");
    expect(statusText(ind("processedShare", "noTarget", 0.2), w)).toBe("nessuna soglia ufficiale: solo il tuo andamento");
  });

  it("intestazione della settimana e intervallo di date", () => {
    expect(weekRangeText("2026-11-17", "2026-11-23")).toBe("17–23 nov");
    expect(weekRangeText("2026-11-30", "2026-12-06")).toBe("30 nov – 6 dic");
    const w = frame({ weekStart: "2026-11-16", daysWithData: 5, coverage: 0.84 });
    expect(weekHeaderText(w)).toBe("16–22 nov · 5 giorni registrati su 7 · riconosciuto ~84% di ciò che hai mangiato");
  });

  it("il fatto di un consiglio: dato, settimana, chi lo indica; e la riga del riepilogo con la dispensa", () => {
    const h = history({ indicators: [ind("group:legumes", "below", 1)] });
    const a = buildAdvice(input(h, { pantry: [pantry("Ceci", "legumes")] })).advice.find((x) => x.ruleId === "legumesLow");
    expect(a).toBeDefined();
    const ctx = { today: TODAY, history: h };
    expect(adviceFactText(a as Advice, ctx)).toMatch(/^Legumi: 1 porzione a settimana la settimana scorsa; le Linee guida CREA indicano 2–4 porzioni a settimana\./);
    expect(briefingAdviceText(a as Advice, ctx)).toMatch(/Hai ceci in dispensa\.$/);
    expect(adviceSourceText(a as Advice)).toBe("Fonte: CREA, Linee guida per una sana alimentazione (rev. 2018), t");
  });

  it("le righe occasionali nel fatto: «ne indicano un consumo occasionale»", () => {
    const h = history({ indicators: [ind("group:processedMeat", "occasional", 4, { unit: "count", target: { kind: "occasional", row: "processedMeat", source: "crea-lg-2018", where: "Tab. 9.3" } })] });
    const a = buildAdvice(input(h)).advice.find((x) => x.ruleId === "processedMeatOften") as Advice;
    expect(a).toBeDefined();
    expect(adviceFactText(a, { today: TODAY, history: h })).toMatch(/^Carni trasformate: 4 volte la settimana scorsa; le Linee guida CREA ne indicano un consumo occasionale\./);
  });

  it("azioni, segni delle righe, origine della classificazione", () => {
    expect(ACTIONS.map(actionLabel)).toEqual([
      "Cosa cucinare con ceci",
      "Apri la ricetta: Pasta e lenticchie",
      "Metti nel piano: Pasta e lenticchie",
      "Aggiungi alla spesa: lenticchie e pesce",
      "Vedi l'alternativa: Cracker",
      "Vedi il dettaglio",
    ]);
    expect(lineMarkText({ level: 4, certainty: "estimated", fromPrep: false })).toBe("molto lavorato ~");
    expect(lineMarkText({ level: 4, certainty: "label", fromPrep: false })).toBe("molto lavorato");
    expect(partClassText({ group: "legumes", certainty: "estimated", processing: { level: 1, certainty: "estimated", basis: "declared" } })).toBe(
      "Legumi ~ · non lavorato o poco ~",
    );
    expect(basisText("name")).toBe("Dedotto dal nome: puoi correggerlo.");
    expect(dietReasonText(["legumes"])).toBe("Porta legumi");
  });

  it("esiti delle settimane passate", () => {
    const o: AdviceOutcome = { ruleId: "legumesLow", weekStart: "2026-11-09", nextWeekStart: "2026-11-16", before: 1, after: 3, result: "moved" };
    expect(outcomeText(o)).toBe("Settimana del 9 nov: legumi 1; quella dopo 3. Si è mosso nella direzione proposta.");
    const h = history({}, { closedWeeks: 4 });
    const withFrame = outcomeText({ ...o, weekStart: h.weeks[1].weekStart }, h);
    expect(withFrame).toMatch(/legumi 1 porzione a settimana; quella dopo 3 porzioni a settimana\./);
  });
});
