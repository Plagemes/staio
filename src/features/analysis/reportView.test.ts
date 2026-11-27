import { describe, expect, it } from "vitest";
import { buildReport, reportPeriod } from "@/core/analysis";
import { analyze, dateOf, day, weighIn } from "@/core/analysis/test-helpers";
import { derivePantry } from "@/core/ledger";
import {
  canGoNext,
  mealsText,
  noRecordsView,
  nutrientsInsufficientView,
  periodTitle,
  shiftPeriod,
  trackingText,
  occurrencesText,
  partialNote,
  spendText,
  weightInsufficientView,
  weightReportText,
} from "./reportView";
import { basisText } from "./present";
import { dietReportLines } from "./reportView";

describe("periodi del rapporto", () => {
  const week = reportPeriod("week", "2026-03-04");
  const month = reportPeriod("month", "2026-03-17");

  it("titoli leggibili", () => {
    expect(periodTitle(week)).toBe("2 – 8 mar 2026");
    expect(periodTitle(reportPeriod("week", "2026-03-31"))).toBe("30 mar – 5 apr 2026");
    expect(periodTitle(month)).toBe("marzo 2026");
  });

  it("precedente e successivo, anche a cavallo di mese e di anno", () => {
    expect(shiftPeriod(week, -1)).toMatchObject({ from: "2026-02-23", to: "2026-03-01" });
    expect(shiftPeriod(week, 1)).toMatchObject({ from: "2026-03-09", to: "2026-03-15" });
    expect(shiftPeriod(month, -1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftPeriod(reportPeriod("month", "2026-12-10"), 1)).toMatchObject({ from: "2027-01-01", to: "2027-01-31" });
    expect(shiftPeriod(shiftPeriod(week, 1), -1)).toEqual(week);
  });

  it("non si va nel futuro", () => {
    expect(canGoNext(week, "2026-03-04")).toBe(false);
    expect(canGoNext(week, "2026-03-09")).toBe(true);
    expect(canGoNext(month, "2026-03-31")).toBe(false);
    expect(canGoNext(month, "2026-04-01")).toBe(true);
  });

  it("un periodo non finito conta solo i giorni trascorsi e lo dice", () => {
    const { diary, intakeDays } = analyze([...day(0), ...day(1)]);
    const r = buildReport("week", dateOf(0), { diary, pantry: derivePantry([]), intakeDays }, { today: dateOf(2) });
    expect(r.period.partial).toBe(true);
    expect(r.period.elapsedDays).toBe(3);
    expect(r.tracking.basis).toMatchObject({ partial: true, periodDays: 3, throughDate: dateOf(2) });
    expect(partialNote(r.period)).toMatch(/3 giorni trascorsi su 7/);
    expect(partialNote(r.period)).not.toMatch(/valgono come giorni non tracciati/);
    expect(trackingText(r.tracking)).toMatch(/2 giorni tracciati per intero su 3 trascorsi/);
    expect(basisText(r.tracking.basis, { used: "Giorni" })).toMatch(/su 3 trascorsi \(periodo non finito, contato fino al/);
  });

  it("un periodo finito non ha note", () => {
    const { diary, intakeDays } = analyze([...day(0)]);
    const r = buildReport("week", dateOf(0), { diary, pantry: derivePantry([]), intakeDays }, { today: dateOf(9) });
    expect(partialNote(r.period)).toBeUndefined();
    expect(trackingText(r.tracking)).toMatch(/su 7 del periodo/);
  });

  it("un periodo non ancora iniziato non conta niente", () => {
    const { diary, intakeDays } = analyze([...day(0)]);
    const r = buildReport("week", dateOf(7), { diary, pantry: derivePantry([]), intakeDays }, { today: dateOf(2) });
    expect(partialNote(r.period)).toMatch(/non è ancora iniziato/);
  });
});

describe("concordanza dei conteggi", () => {
  it("singolare e plurale", () => {
    expect(occurrencesText(5, "acquisto", "acquisti", 1)).toBe("5 acquisti in 1 giorno");
    expect(occurrencesText(1, "acquisto", "acquisti", 3)).toBe("1 acquisto in 3 giorni");
    expect(occurrencesText(1, "registrazione", "registrazioni", 1)).toBe("1 registrazione in 1 giorno");
  });

  it("senza nessun prezzo la spesa non è zero: è non nota", () => {
    const base = { status: "ok" as const, certainty: "measured" as const, basis: { periodDays: 7, usedDays: 1, excludedDays: 6, observations: 5 } };
    const none = spendText({ ...base, spentCents: 0, purchasesWithPrice: 0, purchasesWithoutPrice: 5 });
    expect(none).toEqual(["Spesa non nota: nessun acquisto ha il prezzo registrato (5 acquisti)."]);
    expect(none.join(" ")).not.toMatch(/0,00/);
    const one = spendText({ ...base, spentCents: 350, purchasesWithPrice: 1, purchasesWithoutPrice: 1 });
    expect(one[0]).toMatch(/su 1 acquisto con il prezzo registrato/);
    expect(one[1]).toMatch(/^1 acquisto senza prezzo: non è contato/);
  });
});

describe("testi delle sezioni", () => {
  function report() {
    const events: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      events.push(...day(i, i >= 5 ? { skip: ["dinner"] } : { kcal: 1800 }));
      if (i % 2 === 0) events.push(weighIn(i, 80 - i * 0.1));
    }
    const { diary, intakeDays } = analyze(events);
    return buildReport("week", dateOf(0), { diary, pantry: derivePantry([]), intakeDays });
  }

  it("giorni e pasti", () => {
    const r = report();
    expect(trackingText(r.tracking)).toMatch(/5 giorni tracciati per intero su 7/);
    expect(trackingText(r.tracking)).toMatch(/2 giorni con vuoti/);
    expect(mealsText(r.meals)).toMatch(/pasti tracciati/);
  });

  it("peso: due pesate singole, non una tendenza", () => {
    const r = report();
    expect(r.weight.status).toBe("ok");
    if (r.weight.status !== "ok") return;
    const lines = weightReportText(r.weight).join(" ");
    expect(lines).toMatch(/non una tendenza/);
    expect(lines).toMatch(/−0,6 kg/);
  });

  it("senza registrazioni non c'è uno zero ma «non registrato»", () => {
    const v = noRecordsView("l'acqua");
    expect(v.reasons[0]).toMatch(/Nessun dato registrato nel periodo per l'acqua/);
    expect(v.missing[0]).toMatch(/Non vuol dire zero/);
  });

  it("peso con poche pesate: quante ne mancano", () => {
    const { diary, intakeDays } = analyze([weighIn(0, 80), weighIn(1, 80)]);
    const r = buildReport("week", dateOf(0), { diary, pantry: derivePantry([]), intakeDays });
    expect(r.weight.status).toBe("insufficient");
    if (r.weight.status !== "insufficient") return;
    const v = weightInsufficientView(r.weight);
    expect(v.reasons[0]).toMatch(/2 pesate/);
    expect(v.missing[0]).toMatch(/Mancano ancora 1 pesata/);
    const none = buildReport("week", dateOf(30), { diary, pantry: derivePantry([]), intakeDays });
    if (none.weight.status === "insufficient") expect(weightInsufficientView(none.weight).reasons[0]).toMatch(/Nessun dato registrato/);
  });

  it("nutrienti con pochi giorni completi: quanti ne mancano", () => {
    expect(nutrientsInsufficientView(2).missing[0]).toMatch(/Mancano ancora 3 giorni/);
  });
});

describe("qualità di ciò che si mangia nel rapporto", () => {
  const FORBIDDEN = /(devi|dovresti|sano|malsano|sicuro per te|compatibile|voto|punteggio|bravo|male)/i;
  const base = { from: "2026-03-02", to: "2026-03-29" };

  it("riepilogo in parole", () => {
    const lines = dietReportLines({
      ...base,
      weeks: 4,
      sufficientWeeks: 3,
      indicators: [
        { id: "group:legumes", within: 2, below: 1, above: 0 },
        { id: "group:fish", within: 0, below: 0, above: 0 },
      ],
    });
    expect(lines).toEqual(["3 settimane su 4 con dati sufficienti · legumi: dentro l'indicazione in 2, sotto in 1."]);
    for (const l of lines ?? []) expect(l).not.toMatch(FORBIDDEN);
  });

  it("senza indicatori utili resta il conto delle settimane", () => {
    expect(dietReportLines({ ...base, weeks: 1, sufficientWeeks: 1, indicators: [] })).toEqual(["1 settimana su 1 con dati sufficienti."]);
  });

  it("dati insufficienti: una riga che lo dice", () => {
    const lines = dietReportLines({ ...base, weeks: 2, sufficientWeeks: 0, indicators: [] });
    expect(lines).toHaveLength(1);
    expect(lines?.[0]).toMatch(/^Dati insufficienti/);
    expect(lines?.[0]).not.toMatch(FORBIDDEN);
  });

  it("nessuna settimana: la sezione non c'è", () => {
    expect(dietReportLines({ ...base, weeks: 0, sufficientWeeks: 0, indicators: [] })).toBeUndefined();
  });
});
