import { describe, expect, it } from "vitest";
import { deriveDiary } from "../diary";
import { meal, mood, water, weight } from "../diary/test-helpers";
import { derivePantry } from "../ledger";
import { consume, discard, move, purchase, q, voidOf } from "../ledger/test-helpers";
import { customPeriod, customPeriodProblem, reportPeriod } from "./report";
import { buildSummary } from "./summary";

const build = (events: unknown[], period = reportPeriod("month", "2026-03-10"), today?: string, timeZone = "UTC") =>
  buildSummary(
    period,
    { diary: deriveDiary(events, { timeZone }), pantry: derivePantry(events as never, {}) },
    today !== undefined ? { today } : {},
  );

const iso = (date: string, hhmm = "12:00") => `${date}T${hhmm}:00.000Z`;
let n = 0;
const id = (p: string) => `${p}${++n}`;
const dish = (date: string, title: string, kind: "lunch" | "dinner" = "lunch") =>
  meal(id("m"), iso(date), {
    mealId: id("meal"),
    kind,
    title,
    items: [{ name: "Riso", quantity: { value: 100, unit: "g" }, certainty: "measured" }],
  });

describe("buildSummary: periodo vuoto", () => {
  it("nessun dato: niente zeri, ogni parte dice che non è registrata", () => {
    const s = build([]);
    expect(s.recordedDays).toBe(0);
    for (const sec of [s.entered, s.eaten, s.topFoods, s.dishes, s.mood, s.waste.discards]) expect(sec.status).toBe("insufficient");
    expect(s.waste.saved).toBeUndefined();
    expect(s.comparison.status).toBe("insufficient");
  });
});

describe("buildSummary: contenuti", () => {
  const events: unknown[] = [
    purchase("p1", iso("2026-03-02"), { lotId: "a", productRef: "Riso", category: "cereali", quantity: q(1000), location: "dispensa", priceCents: 400 }),
    purchase("p2", iso("2026-03-03"), { lotId: "b", productRef: "Latte", category: "latticini", quantity: q(1000, "ml"), location: "frigo", expiry: { date: "2026-03-10", kind: "use_by" } }),
    purchase("p3", iso("2026-03-04"), { lotId: "c", productRef: "Annullato", quantity: q(500), location: "dispensa", priceCents: 999 }),
    voidOf("v1", iso("2026-03-04", "13:00"), "p3"),
    consume("c1", iso("2026-03-05"), { lotId: "a", quantity: q(250) }),
    consume("c2", iso("2026-03-06"), { lotId: "a", quantity: q(250) }),
    discard("d1", iso("2026-03-08"), { lotId: "b", quantity: q(200, "ml"), reason: "expired" }),
    discard("d2", iso("2026-03-09"), { lotId: "a", quantity: q(100), reason: "leftover" }),
    dish("2026-02-20", "Minestrone"),
    dish("2026-03-05", "Minestrone"),
    dish("2026-03-06", "Risotto"),
    dish("2026-03-07", "risotto", "dinner"),
    mood("mood1", iso("2026-03-05", "21:00"), { score: 4 }),
    mood("mood2", iso("2026-03-06", "21:00"), { score: 2 }),
  ];
  const s = build(events);

  it("entrato: gli acquisti annullati sono esclusi", () => {
    expect(s.entered.status).toBe("ok");
    if (s.entered.status === "ok") {
      expect(s.entered.quantities).toEqual([
        { unit: "g", value: 1000 },
        { unit: "ml", value: 1000 },
      ]);
      expect(s.entered.valueCents).toBe(400);
      expect(s.entered.withPrice).toBe(1);
      expect(s.entered.withoutPrice).toBe(1);
    }
  });
  it("mangiato: quantità dalla dispensa e dal diario, valore dove c'è il prezzo", () => {
    expect(s.eaten.status).toBe("ok");
    if (s.eaten.status === "ok") {
      // 500 g dalla dispensa e 300 g di voci libere dei tre piatti del periodo.
      expect(s.eaten.quantities).toEqual([{ unit: "g", value: 800 }]);
      expect(s.eaten.valueCents).toBe(200);
    }
  });
  it("alimenti più mangiati per giorni, nomi uniti senza badare alle maiuscole", () => {
    expect(s.topFoods.status === "ok" && s.topFoods.items[0]).toMatchObject({ name: "Riso", days: 3 });
  });
  it("piatti e ricette nuove: nuovo è ciò che non c'era prima del periodo", () => {
    expect(s.dishes.status).toBe("ok");
    if (s.dishes.status === "ok") {
      expect(s.dishes.cooked).toBe(3);
      expect(s.dishes.top[0]).toEqual({ title: "Risotto", count: 2 });
      expect(s.dishes.newTitles).toEqual(["Risotto"]);
    }
  });
  it("umore: con meno di 3 giorni non dà una media", () => {
    expect(s.mood.status).toBe("insufficient");
  });
  it("spreco: motivi presenti, categorie e valore", () => {
    const d = s.waste.discards;
    expect(d.status).toBe("ok");
    if (d.status === "ok") {
      expect(d.byReason.map((r) => r.reason).sort()).toEqual(["expired", "leftover"]);
      expect(d.byCategory.map((c) => c.category).sort()).toEqual(["cereali", "latticini"]);
      expect(d.valueCents).toBe(40);
      expect(d.withoutPrice).toBe(1);
    }
  });
  it("lotto scaduto e ancora in dispensa: si segnala, non è buttato", () => {
    expect(s.waste.expiredUnresolved).toBe(1);
  });
});

describe("buildSummary: salvato in freezer", () => {
  it("conta solo se congelato entro la scadenza e dice la quantità di allora", () => {
    const ev = [
      purchase("p1", iso("2026-03-02"), { lotId: "a", productRef: "Pollo", quantity: q(600), location: "frigo", expiry: { date: "2026-03-06", kind: "use_by" } }),
      consume("c1", iso("2026-03-04"), { lotId: "a", quantity: q(100) }),
      move("m1", iso("2026-03-05"), { lotId: "a", to: "freezer" }),
      purchase("p2", iso("2026-03-02"), { lotId: "b", productRef: "Tardi", quantity: q(300), location: "frigo", expiry: { date: "2026-03-03", kind: "use_by" } }),
      move("m2", iso("2026-03-05"), { lotId: "b", to: "freezer" }),
    ];
    const s = build(ev);
    expect(s.waste.saved).toMatchObject({ lots: 1, quantities: [{ unit: "g", value: 500 }] });
    expect(s.waste.expiredUnresolved).toBe(0);
  });
});

describe("buildSummary: periodo parziale", () => {
  it("i giorni a venire non si contano e la base lo dice", () => {
    const s = build([dish("2026-03-05", "Zuppa")], reportPeriod("month", "2026-03-10"), "2026-03-10");
    expect(s.period).toMatchObject({ partial: true, elapsedDays: 10, through: "2026-03-10" });
    expect(s.basis).toMatchObject({ periodDays: 10, usedDays: 1, partial: true });
  });
  it("un lotto con scadenza domani non è ancora scaduto", () => {
    const ev = [purchase("p1", iso("2026-03-02"), { lotId: "a", productRef: "Yogurt", quantity: q(125), location: "frigo", expiry: { date: "2026-03-11", kind: "use_by" } })];
    expect(build(ev, reportPeriod("month", "2026-03-10"), "2026-03-10").waste.expiredUnresolved).toBe(0);
    expect(build(ev, reportPeriod("month", "2026-03-10"), "2026-03-20").waste.expiredUnresolved).toBe(1);
  });
});

function twoMonths(prevDays: number, curDays: number): unknown[] {
  const ev: unknown[] = [];
  const day = (m: string, d: number) => `2026-${m}-${String(d).padStart(2, "0")}`;
  for (let d = 29 - prevDays; d <= 28; d++) {
    ev.push(water(id("w"), iso(day("02", d)), { ml: 1000 }), weight(id("kg"), iso(day("02", d), "07:00"), { kg: 80 }));
  }
  for (let d = 1; d <= curDays; d++) {
    ev.push(water(id("w"), iso(day("03", d)), { ml: 1500 }), weight(id("kg"), iso(day("03", d), "07:00"), { kg: 79 }));
  }
  return ev;
}

describe("buildSummary: confronto", () => {
  it("senza dati sufficienti nel precedente non si confronta, e dice perché", () => {
    const c = build(twoMonths(2, 20), customPeriod("2026-03-01", "2026-03-20")).comparison;
    expect(c.status).toBe("insufficient");
    if (c.status === "insufficient") {
      expect(c.minRecordedDays).toBe(10);
      expect(c.recordedDays).toEqual({ current: 20, previous: 2 });
    }
  });
  it("con dati in entrambi: stessa durata subito prima, differenze con il segno", () => {
    const c = build(twoMonths(20, 20), customPeriod("2026-03-01", "2026-03-20")).comparison;
    expect(c.status).toBe("ok");
    if (c.status === "ok") {
      expect(c.previous).toEqual({ from: "2026-02-09", to: "2026-02-28", days: 20 });
      expect(c.metrics.find((m) => m.id === "waterAvg")).toMatchObject({ current: 1500, previous: 1000, delta: 500 });
      expect(c.metrics.find((m) => m.id === "weightAvg")?.delta).toBe(-1);
      expect(c.metrics.find((m) => m.id === "wastedG")).toBeUndefined();
    }
  });
});

describe("buildSummary: calendario", () => {
  it("mese a cavallo del cambio d'ora: il giorno è quello locale, senza duplicati", () => {
    // Europe/Rome passa all'ora legale il 29 marzo 2026. 28/03 22:30 UTC = 23:30 del 28; 29/03 22:30 UTC = 00:30 del 30 (CEST);
    // 31/03 22:30 UTC = 00:30 del 1 aprile: fuori da marzo.
    const ev = [
      meal("a", "2026-03-28T22:30:00.000Z", { mealId: "ma", kind: "dinner", title: "Sera", items: [] }),
      meal("b", "2026-03-29T22:30:00.000Z", { mealId: "mb", kind: "dinner", title: "Sera", items: [] }),
      water("w", "2026-03-31T22:30:00.000Z", { ml: 300 }),
    ];
    const march = build(ev, reportPeriod("month", "2026-03-10"), undefined, "Europe/Rome");
    expect(march.period.days).toBe(31);
    expect(march.recordedDays).toBe(2);
    const april = build(ev, reportPeriod("month", "2026-04-10"), undefined, "Europe/Rome");
    expect(april.recordedDays).toBe(1);
  });
  it("anno bisestile: 366 giorni e il 29 febbraio c'è", () => {
    const y = reportPeriod("year", "2028-06-01");
    expect(y).toMatchObject({ from: "2028-01-01", to: "2028-12-31", days: 366 });
    const s = build([dish("2028-02-29", "Torta")], y);
    expect(s.basis).toMatchObject({ periodDays: 366, usedDays: 1 });
    expect(s.dishes.status).toBe("ok");
    expect(reportPeriod("year", "2027-06-01").days).toBe(365);
  });
  it("intervallo non valido: nessun periodo", () => {
    expect(customPeriod("2026-03-10", "2026-03-01")).toBeUndefined();
    expect(customPeriod("2026-02-30", "2026-03-01")).toBeUndefined();
  });
});

describe("customPeriod: limiti", () => {
  it("oltre 366 giorni o con date impossibili non calcola nulla", () => {
    const t = Date.now();
    expect(customPeriod("2026-01-01", "9999-12-31")).toBeUndefined();
    expect(customPeriod("0000-01-01", "9999-12-31")).toBeUndefined();
    expect(customPeriod("", "2026-01-01")).toBeUndefined();
    expect(customPeriod("2026-13-01", "2026-14-01")).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(200);
    expect(customPeriodProblem("2026-03-10", "2026-03-01")).toBe("inverted");
    expect(customPeriodProblem("2026-01-01", "2026-12-31")).toBeUndefined();
    expect(customPeriodProblem("2027-01-01", "2028-01-02")).toBe("too_long");
    expect(customPeriod("2028-01-01", "2028-12-31")?.days).toBe(366);
  });
});

describe("buildSummary: pasti fuori casa stimati", () => {
  const out = (date: string, kcal = 800) =>
    meal(id("m"), iso(date), {
      mealId: id("meal"),
      kind: "lunch",
      certainty: "estimated",
      items: [{ name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: kcal }],
    });

  it("non compaiono tra gli alimenti né nelle quantità mangiate: si contano a parte", () => {
    const s = build([out("2026-03-03"), out("2026-03-04"), out("2026-03-05"), dish("2026-03-06", "Risotto")]);
    expect(s.outOfHomeMeals).toBe(3);
    if (s.topFoods.status !== "ok" || s.eaten.status !== "ok") throw new Error("atteso ok");
    expect(s.topFoods.items.map((f) => f.name)).toEqual(["Riso"]);
    expect(s.topFoods.distinct).toBe(1);
    // solo i 100 g di riso: nessun «pezzo» per le stime
    expect(s.eaten.quantities).toEqual([expect.objectContaining({ unit: "g", value: 100 })]);
    if (s.dishes.status !== "ok") throw new Error("atteso ok");
    expect(s.dishes.top.map((d) => d.title)).toEqual(["Risotto"]);
  });

  it("un periodo fatto solo di pasti fuori casa non ha alimenti mangiati, ma il conto c'è", () => {
    const s = build([out("2026-03-03"), out("2026-03-04")]);
    expect(s.outOfHomeMeals).toBe(2);
    expect(s.topFoods.status).toBe("insufficient");
    expect(s.eaten.status).toBe("insufficient");
    expect(s.recordedDays).toBe(2);
    expect(build([dish("2026-03-06", "Risotto")]).outOfHomeMeals).toBe(0);
  });
});
