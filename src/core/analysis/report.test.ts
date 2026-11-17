import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { discard, purchase, q, voidOf } from "../ledger/test-helpers";
import { water } from "../diary/test-helpers";
import type { ReferenceWithVariant } from "../nutrition";
import { buildReport, reportPeriod } from "./report";
import { analyze, at, dateOf, day, rng, shuffled, weighIn } from "./test-helpers";

// D0 è lunedì 2026-03-02: la prima settimana va dal giorno 0 al giorno 6.
describe("reportPeriod", () => {
  it("settimana da lunedì a domenica", () => {
    expect(reportPeriod("week", "2026-03-04")).toEqual({ kind: "week", from: "2026-03-02", to: "2026-03-08", days: 7 });
    expect(reportPeriod("week", "2026-03-08").from).toBe("2026-03-02");
    expect(reportPeriod("week", "2026-03-09").from).toBe("2026-03-09");
  });
  it("mese di calendario, anche febbraio e dicembre", () => {
    expect(reportPeriod("month", "2026-03-17")).toMatchObject({ from: "2026-03-01", to: "2026-03-31", days: 31 });
    expect(reportPeriod("month", "2026-02-10")).toMatchObject({ to: "2026-02-28", days: 28 });
    expect(reportPeriod("month", "2028-02-10")).toMatchObject({ to: "2028-02-29", days: 29 });
    expect(reportPeriod("month", "2026-12-05")).toMatchObject({ to: "2026-12-31" });
  });
});

const REFERENCES: ReferenceWithVariant[] = [
  {
    nutrient: "energyKcal",
    kind: "AI",
    ageMin: 18,
    amount: 2000,
    source: { body: "Test", document: "Valore finto", url: "https://example.invalid" },
  },
];

function buildWeek() {
  const events: unknown[] = [];
  for (let i = 0; i < 7; i++) {
    // Giorni 5 e 6 con vuoti.
    events.push(...day(i, i >= 5 ? { skip: ["dinner"] } : { kcal: 1800 }));
    if (i % 2 === 0) events.push(weighIn(i, 80 - i * 0.1));
  }
  events.push(water("w1", at(0, "10:00"), { ml: 500 }), water("w2", at(0, "15:00"), { ml: 750 }), water("w3", at(2, "10:00"), { ml: 250 }));
  events.push(
    purchase("p1", at(1, "10:00"), { lotId: "a", productRef: "Riso", quantity: q(1000), location: "dispensa", priceCents: 300 }),
    purchase("p2", at(2, "10:00"), { lotId: "b", productRef: "Pasta", quantity: q(500), location: "dispensa" }),
    purchase("p3", at(20, "10:00"), { lotId: "c", productRef: "Fuori periodo", quantity: q(500), location: "dispensa", priceCents: 999 }),
    purchase("p4", at(1, "11:00"), { lotId: "d", productRef: "Annullato", quantity: q(500), location: "dispensa", priceCents: 777 }),
    voidOf("v1", at(1, "12:00"), "p4"),
    discard("x1", at(3, "20:00"), { lotId: "a", quantity: q(250), reason: "expired" }),
    discard("x2", at(4, "20:00"), { lotId: "b", quantity: q(100), reason: "leftover" }),
    discard("x3", at(28, "20:00"), { lotId: "b", quantity: q(100), reason: "leftover" }),
  );
  return events;
}

describe("buildReport", () => {
  it("riepilogo settimanale: ogni sezione con la sua base di dati", () => {
    const events = buildWeek();
    const { diary, intakeDays } = analyze(events);
    const pantry = derivePantry(events as never, {});
    const r = buildReport("week", dateOf(3), { diary, pantry, intakeDays });

    expect(r.period).toMatchObject({ from: dateOf(0), to: dateOf(6), days: 7 });
    expect(r.tracking).toMatchObject({ completeDays: 5, gapDays: 2, declaredDays: 0 });
    expect(r.tracking.basis).toMatchObject({ periodDays: 7, usedDays: 5, excludedDays: 2 });
    expect(r.tracking.completeShare).toBeCloseTo(5 / 7, 3);

    expect(r.meals).toMatchObject({ tracked: 19, untracked: 0, trackedPerCompleteDay: 3 });

    expect(r.water.status).toBe("ok");
    if (r.water.status === "ok") {
      expect(r.water.totalMl).toBe(1500);
      expect(r.water.daysLogged).toBe(2);
      // Si divide per i giorni con acqua registrata, non per i sette del periodo.
      expect(r.water.averageMlPerLoggedDay).toBe(750);
      expect(r.water.basis.excludedDays).toBe(5);
    }

    expect(r.weight.status).toBe("ok");
    if (r.weight.status === "ok") {
      expect(r.weight.weighIns).toBe(4);
      expect(r.weight.first.date).toBe(dateOf(0));
      expect(r.weight.last.date).toBe(dateOf(6));
      expect(r.weight.changeKg).toBeCloseTo(-0.6, 5);
    }

    expect(r.spend.status).toBe("ok");
    if (r.spend.status === "ok") {
      // Solo l'acquisto con il prezzo nel periodo; quello annullato e quello fuori periodo non contano.
      expect(r.spend.spentCents).toBe(300);
      expect(r.spend.purchasesWithPrice).toBe(1);
      expect(r.spend.purchasesWithoutPrice).toBe(1);
    }

    expect(r.waste.status).toBe("ok");
    if (r.waste.status === "ok") {
      expect(r.waste.items.map((i) => [i.reason, i.quantity])).toEqual([
        ["expired", 250],
        ["leftover", 100],
      ]);
      // 250 g su 1000 g di riso da 3 euro: 75 centesimi; il lotto senza prezzo non ha costo.
      expect(r.waste.costCents).toBe(75);
      expect(r.waste.discardsWithPrice).toBe(1);
      expect(r.waste.discardsWithoutPrice).toBe(1);
    }
    expect(r.nutrients).toBeUndefined();
  });

  it("nutrienti rispetto ai riferimenti passati: solo giorni completi, con soglia", () => {
    const events = buildWeek();
    const { diary, intakeDays } = analyze(events);
    const pantry = derivePantry(events as never, {});
    const profile = { sex: "female" as const, ageYears: 30 };
    const r = buildReport("week", dateOf(3), { diary, pantry, intakeDays, references: REFERENCES, profile });
    expect(r.nutrients?.status).toBe("ok");
    if (r.nutrients?.status === "ok") {
      expect(r.nutrients.completeDays).toBe(5);
      const c = r.nutrients.comparisons[0];
      expect(c.status).toBe("compared");
      if (c.status === "compared" && c.outcome.kind === "AI") expect(c.outcome.intake).toBe(1800);
    }
    const strict = buildReport("week", dateOf(3), { diary, pantry, intakeDays, references: REFERENCES, profile }, { minCompleteDays: 6 });
    expect(strict.nutrients?.status).toBe("insufficient");
    if (strict.nutrients?.status === "insufficient") {
      expect(strict.nutrients.message).toMatch(/Dati insufficienti/);
      expect(strict.nutrients).not.toHaveProperty("comparisons");
    }
  });

  it("settimana senza dati: ogni sezione dice che non c'è nulla, senza zeri inventati", () => {
    const { diary, intakeDays } = analyze([]);
    const r = buildReport("week", "2026-03-04", { diary, pantry: derivePantry([], {}), intakeDays });
    expect(r.tracking).toMatchObject({ completeDays: 0, gapDays: 7 });
    expect(r.meals.trackedPerCompleteDay).toBeUndefined();
    for (const s of [r.water, r.weight, r.spend, r.waste]) {
      expect(s.status).toBe("insufficient");
      if (s.status === "insufficient") expect(s.reasons).toEqual(["no_records"]);
    }
  });

  it("poche pesate: nessun numero di peso", () => {
    const events = [weighIn(0, 80), weighIn(1, 79.5)];
    const { diary, intakeDays } = analyze(events);
    const r = buildReport("week", dateOf(0), { diary, pantry: derivePantry([], {}), intakeDays });
    expect(r.weight.status === "insufficient" && r.weight.reasons).toEqual(["few_records"]);
  });

  it("riepilogo mensile e indipendenza dall'ordine degli eventi", () => {
    const events = buildWeek();
    const a = analyze(events);
    const b = analyze(shuffled(events, rng(12)));
    const pantryA = derivePantry(events as never, {});
    const pantryB = derivePantry(shuffled(events, rng(12)) as never, {});
    const ra = buildReport("month", "2026-03-15", { ...a, pantry: pantryA });
    const rb = buildReport("month", "2026-03-15", { ...b, pantry: pantryB });
    expect(ra.period.days).toBe(31);
    expect(rb).toEqual(ra);
    // Nel mese entrano anche gli acquisti e gli scarti dei giorni 20 e 28.
    if (ra.spend.status === "ok") expect(ra.spend.spentCents).toBe(1299);
    if (ra.waste.status === "ok") expect(ra.waste.items.find((i) => i.reason === "leftover")?.quantity).toBe(200);
  });

  it("periodo in corso: i giorni futuri non sono giorni con vuoti", () => {
    // Oggi è venerdì (giorno 4): i giorni 0-4 sono completi e gli ultimi due della settimana non sono ancora arrivati.
    const events: unknown[] = [];
    for (let i = 0; i < 5; i++) events.push(...day(i), weighIn(i, 80));
    const { diary, intakeDays } = analyze(events);
    const pantry = derivePantry([], {});
    const r = buildReport("week", dateOf(2), { diary, pantry, intakeDays }, { today: dateOf(4) });
    expect(r.period).toMatchObject({ days: 7, partial: true, through: dateOf(4), elapsedDays: 5 });
    expect(r.tracking).toMatchObject({ completeDays: 5, gapDays: 0 });
    expect(r.tracking.completeShare).toBe(1);
    expect(r.tracking.basis).toMatchObject({ periodDays: 5, usedDays: 5, excludedDays: 0, partial: true, throughDate: dateOf(4) });
    expect(r.weight.basis).toMatchObject({ periodDays: 5, partial: true, throughDate: dateOf(4) });
    expect(r.water.status === "insufficient" && r.water.basis).toMatchObject({ periodDays: 5, partial: true });

    // Un periodo concluso non è parziale; senza `today` nemmeno.
    const full = buildReport("week", dateOf(2), { diary, pantry, intakeDays }, { today: dateOf(9) });
    expect(full.period.partial).toBe(false);
    expect(full.tracking).toMatchObject({ gapDays: 2, completeDays: 5 });
    expect(full.tracking.basis.partial).toBeUndefined();
    expect(buildReport("week", dateOf(2), { diary, pantry, intakeDays }).period.partial).toBe(false);

    // Periodo non ancora iniziato: nessun giorno contato.
    const future = buildReport("week", dateOf(9), { diary, pantry, intakeDays }, { today: dateOf(4) });
    expect(future.period).toMatchObject({ partial: true, elapsedDays: 0 });
    expect(future.tracking).toMatchObject({ completeDays: 0, gapDays: 0, completeShare: 0 });
  });
});
