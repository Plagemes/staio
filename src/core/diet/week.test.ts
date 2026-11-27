import { describe, expect, it } from "vitest";
import { addDays } from "../diary";
import type { FoodComposition } from "../nutrition";
import {
  FAKE_TABLES,
  fakeDay,
  foodLine,
  historyInput,
  lineClass,
  part,
} from "./test-helpers";
import type { DietHistoryInput, LineClass } from "./types";
import { buildDietHistory, buildWeekFrame, mondayOf } from "./week";

const WEEK = "2026-11-09"; // lunedì
const TODAY = "2026-11-18"; // mercoledì della settimana dopo

function frame(byDate: Record<string, LineClass[]>, today = TODAY, extra: Partial<DietHistoryInput> = {}, complete = true) {
  const days = Object.keys(byDate).map((d) => fakeDay(d, { complete, energyKcal: 2000 }));
  const input = historyInput(days, today, byDate, extra);
  return buildWeekFrame(days, mondayOf(Object.keys(byDate)[0] ?? WEEK), today, input, FAKE_TABLES);
}

describe("buildWeekFrame", () => {
  it("due voci di legumi nello stesso pasto sono un'occasione; le porzioni si sommano", () => {
    const f = frame({
      [WEEK]: [
        lineClass(WEEK, [part("legumes", { grams: 80, energyKcal: 100 })], { occasionKey: "m1" }),
        lineClass(WEEK, [part("legumes", { grams: 70, energyKcal: 90 })], { occasionKey: "m1" }),
        lineClass(WEEK, [part("legumes", { grams: 20, energyKcal: 30 })], { occasionKey: "m2" }),
      ],
    });
    expect(f.tallies.legumes).toMatchObject({ occasions: 2, grams: 170, gramsKnown: true, days: 1 });
    // m1: 150 g / 100 g → 1,5; m2: 0,2 → minimo 0,5.
    expect(f.tallies.legumes.servings).toBe(2);
    expect(f.rowTallies.legumes.servings).toBe(2);
  });

  it("senza grammi l'occasione vale 1 porzione, stimata", () => {
    const f = frame({ [WEEK]: [lineClass(WEEK, [part("fish", { energyKcal: 150 })])] });
    expect(f.tallies.fish).toMatchObject({ occasions: 1, servings: 1, gramsKnown: false, certainty: "estimated" });
  });

  it("una preparazione scomposta conta i gruppi degli ingredienti in un'unica occasione", () => {
    const prep = lineClass(
      WEEK,
      [
        part("legumes", { grams: 50, energyKcal: 170, prepId: "p1", basis: "prep", certainty: "estimated" }),
        part("refinedGrains", { grams: 40, energyKcal: 140, prepId: "p1", basis: "prep" }),
        part("oilsFats", { grams: 5, energyKcal: 45, prepId: "p1", basis: "prep" }),
      ],
      { occasionKey: "pranzo" },
    );
    const f = frame({ [WEEK]: [prep] });
    expect(f.tallies.legumes).toMatchObject({ occasions: 1, servings: 0.5, certainty: "estimated" });
    expect(f.tallies.refinedGrains.occasions).toBe(1);
    // senza portionKey la parte di cereali conta con la porzione del gruppo («grains»).
    expect(f.rowTallies.grains.occasions).toBe(1);
    expect(f.rowTallies.bread.occasions).toBe(0);
    expect(f.coverage).toMatchObject({ lines: 1, classifiedLines: 1, estimatedLines: 1, share: 1 });
  });

  it("le righe filtrano per portionKey", () => {
    const f = frame({
      [WEEK]: [lineClass(WEEK, [part("refinedGrains", { grams: 100, portionKey: "bread", energyKcal: 270 })])],
    });
    expect(f.rowTallies.bread.servings).toBe(1);
    expect(f.rowTallies.grains.servings).toBe(0);
  });

  it("fuori casa e voci non riconosciute riducono la copertura e finiscono tra le voci da controllare", () => {
    const f = frame({
      [WEEK]: [
        lineClass(WEEK, [part("vegetables", { grams: 200, energyKcal: 50 })], { lineKey: "a" }),
        lineClass(WEEK, [part("outOfHome", { energyKcal: 800, basis: "outOfHome", label: "Pizza fuori" })], {
          lineKey: "b",
        }),
        lineClass(WEEK, [part("unknown", { label: "Boh", basis: "none" })], { lineKey: "c" }),
        lineClass(WEEK, [part("mixedDish", { energyKcal: 400, label: "Lasagne" })], { lineKey: "d" }),
      ],
    });
    expect(f.coverage).toMatchObject({ lines: 4, classifiedLines: 1, energyKcal: 1250, classifiedKcal: 50 });
    expect(f.coverage.share).toBe(0.04);
    expect(f.gaps.map((g) => [g.lineKey, g.reason])).toEqual([
      ["b", "outOfHome"],
      ["d", "mixedDish"],
      ["c", "unknown"],
    ]);
    expect(f.gaps[0]).toMatchObject({ label: "Pizza fuori", energyKcal: 800, date: WEEK });
    const fish = f.indicators.find((i) => i.id === "group:fish");
    expect(fish).toMatchObject({ status: "insufficient" });
  });

  it("riga con parte senza quantità: «noQuantity» tra le voci da controllare", () => {
    const f = frame({ [WEEK]: [lineClass(WEEK, [part("fruit", { energyKcal: 60, label: "Mela" })], { lineKey: "x" })] });
    expect(f.gaps).toEqual([{ lineKey: "x", date: WEEK, label: "Mela", energyKcal: 60, reason: "noQuantity" }]);
  });

  it("i nutrienti per giorno usano solo i giorni completi", () => {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(WEEK, i));
    const days = dates.map((d, i) =>
      fakeDay(d, { complete: i < 5, energyKcal: 2000, saltG: i < 5 ? 4 : 20, fiberG: i < 5 ? 30 : 1 }),
    );
    const byDate = Object.fromEntries(
      dates.map((d) => [
        d,
        [lineClass(d, [part("sweets", { grams: 50, sugarsG: 25, energyKcal: 200, certainty: "estimated" })])],
      ]),
    );
    const f = buildWeekFrame(days, WEEK, TODAY, historyInput(days, TODAY, byDate), FAKE_TABLES);
    expect(f.completeDays).toBe(5);
    expect(f.daysWithData).toBe(7);
    expect(f.salt).toMatchObject({ average: 4, completeDays: 5, missingShare: 0, partial: false });
    expect(f.fiber.average).toBe(30);
    // 25 g × 4 kcal / 2000 kcal = 5%, solo dei giorni completi.
    expect(f.freeSugars).toMatchObject({ grams: 25, percentEnergy: 5, lowerBound: true, certainty: "estimated" });
    expect(f.indicators.find((i) => i.id === "freeSugars")?.status).toBe("atLeast");
  });

  it("giorno incompleto: non entra nei nutrienti, conta nei giorni con dati", () => {
    const f = frame({ [WEEK]: [lineClass(WEEK, [part("fruit", { grams: 150 })])] }, TODAY, {}, false);
    expect(f).toMatchObject({ daysWithData: 1, completeDays: 0 });
    expect(f.salt).toMatchObject({ completeDays: 0, partial: true });
    expect(f.salt.average).toBeUndefined();
    expect(f.freeSugars.percentEnergy).toBeUndefined();
  });

  it("settimana in corso: giorni fino a oggi, i giorni futuri non contano", () => {
    const today = "2026-11-18";
    const thisWeek = mondayOf(today);
    expect(thisWeek).toBe("2026-11-16");
    const byDate = {
      "2026-11-16": [lineClass("2026-11-16", [part("fish", { grams: 100 })])],
      "2026-11-20": [lineClass("2026-11-20", [part("fish", { grams: 100 })])],
    };
    const days = Object.keys(byDate).map((d) => fakeDay(d));
    const f = buildWeekFrame(days, thisWeek, today, historyInput(days, today, byDate), FAKE_TABLES);
    expect(f).toMatchObject({ inProgress: true, daysElapsed: 3, daysWithData: 1, weekEnd: "2026-11-22" });
    expect(f.tallies.fish.occasions).toBe(1);
  });

  it("molto lavorati: quota sulle kcal con livello noto", () => {
    const f = frame({
      [WEEK]: [
        lineClass(WEEK, [
          part("sweets", { energyKcal: 300, processing: { level: 4, certainty: "label", basis: "product" } }),
          part("vegetables", { energyKcal: 100, processing: { level: 1, certainty: "estimated", basis: "declared" } }),
          part("refinedGrains", { energyKcal: 100 }),
        ]),
      ],
    });
    expect(f.processed).toMatchObject({ nova4Kcal: 300, knownKcal: 400, totalKcal: 500, share: 0.75, coverage: 0.8, certainty: "estimated" });
  });

  it("varietà vegetale dagli alimenti della tabella; parziale se ci sono voci non associate", () => {
    const foods = new Map<string, FoodComposition>([
      ["mela", { id: "mela", name: "Mela", group: "frutta", basis: "g", per100: {}, source: { db: "x", id: "1", description: "" } }],
      ["pera", { id: "pera", name: "Pera", group: "frutta", basis: "g", per100: {}, source: { db: "x", id: "2", description: "" } }],
    ]);
    const days = [fakeDay(WEEK, { lines: [foodLine("e1", "mela"), foodLine("e2", "pera"), foodLine("e3", "mela")] })];
    const byDate = { [WEEK]: [lineClass(WEEK, [part("fruit", { grams: 100 })])] };
    const f = buildWeekFrame(days, WEEK, TODAY, historyInput(days, TODAY, byDate, { foods }), FAKE_TABLES);
    expect(f.plantVariety).toEqual({ count: 2, partial: false });
    const days2 = [fakeDay(WEEK, { lines: [foodLine("e1", "mela"), foodLine("e4", "sconosciuto")] })];
    const f2 = buildWeekFrame(days2, WEEK, TODAY, historyInput(days2, TODAY, byDate, { foods }), FAKE_TABLES);
    expect(f2.plantVariety).toEqual({ count: 1, partial: true });
  });

  it("un quadro senza dati ha copertura 0 e tutto insufficiente", () => {
    const f = buildWeekFrame([], WEEK, TODAY, historyInput([], TODAY, {}), FAKE_TABLES);
    expect(f.coverage.share).toBe(0);
    expect(f.daysWithData).toBe(0);
    expect(f.indicators.filter((i) => i.status !== "insufficient")).toEqual([]);
  });
});

describe("buildDietHistory", () => {
  function weekOfData(start: string, legumeGrams: number, byDate: Record<string, LineClass[]>) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      byDate[d] = [
        lineClass(d, [part("vegetables", { grams: 200, energyKcal: 50 })]),
        ...(i < 2 ? [lineClass(d, [part("legumes", { grams: legumeGrams / 2, energyKcal: 100 })])] : []),
      ];
    }
  }

  it("8 settimane chiuse più quella in corso, dalla più vecchia", () => {
    const h = buildDietHistory(historyInput([], TODAY, {}), FAKE_TABLES);
    expect(h.weeks).toHaveLength(9);
    expect(h.weeks[0].weekStart).toBe("2026-09-21");
    expect(h.weeks[8]).toMatchObject({ weekStart: "2026-11-16", inProgress: true });
    expect(h.weeks.slice(0, 8).every((w) => !w.inProgress)).toBe(true);
    expect(buildDietHistory(historyInput([], TODAY, {}, { weeks: 2 }), FAKE_TABLES).weeks).toHaveLength(5);
  });

  it("andamento sulle settimane chiuse, con le lacune a null", () => {
    const byDate: Record<string, LineClass[]> = {};
    const monday = mondayOf(TODAY);
    // Settimane da 8 a 1 fa; la 5 fa resta vuota (lacuna).
    for (let w = 8; w >= 1; w--) {
      if (w === 5) continue;
      weekOfData(addDays(monday, -7 * w), w > 4 ? 200 : 400, byDate);
    }
    const days = Object.keys(byDate)
      .sort()
      .map((d) => fakeDay(d, { energyKcal: 2000 }));
    const h = buildDietHistory(historyInput(days, TODAY, byDate), FAKE_TABLES);
    const trend = h.trends["group:legumes"];
    expect(trend?.values).toEqual([2, 2, 2, null, 4, 4, 4, 4]);
    expect(trend?.weeksWithData).toBe(7);
    expect(trend?.direction).toBe("up");
    expect(h.weeks[3].daysWithData).toBe(0);
  });

  it("daily: quota per giorno, anche oltre le settimane se richiesto (fino a 90 giorni)", () => {
    const old = "2026-08-25";
    const veryOld = "2026-07-01";
    const byDate = {
      [veryOld]: [lineClass(veryOld, [part("sweets", { energyKcal: 100, processing: { level: 4, certainty: "label", basis: "product" } })])],
      [old]: [lineClass(old, [part("sweets", { energyKcal: 100, processing: { level: 4, certainty: "label", basis: "product" } })])],
      [TODAY]: [lineClass(TODAY, [part("fruit", { energyKcal: 100 })])],
    };
    const days = Object.keys(byDate).sort().map((d) => fakeDay(d));
    const h = buildDietHistory(historyInput(days, TODAY, byDate), FAKE_TABLES);
    expect(Object.keys(h.daily)).toEqual([TODAY]);
    expect(h.daily[TODAY]).toEqual({ coverage: 0 });
    const h2 = buildDietHistory(historyInput(days, TODAY, byDate, { dailyFrom: "2026-01-01" }), FAKE_TABLES);
    expect(Object.keys(h2.daily).sort()).toEqual([old, TODAY]);
    expect(h2.daily[old]).toEqual({ processedShare: 1, coverage: 1 });
  });

  it("ogni giorno si classifica una volta sola", () => {
    const byDate: Record<string, LineClass[]> = {};
    weekOfData("2026-11-09", 200, byDate);
    const days = Object.keys(byDate).sort().map((d) => fakeDay(d));
    let calls = 0;
    const input = historyInput(days, TODAY, byDate, { dailyFrom: "2026-09-01" });
    const inner = input.classifier;
    input.classifier = { day: (d) => (calls++, inner.day(d)) };
    buildDietHistory(input, FAKE_TABLES);
    expect(calls).toBe(7);
  });
});
