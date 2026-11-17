import { describe, expect, it } from "vitest";
import { checkPlanWeek, derivePlan, type EntryNutrients, type PlannedEntry } from "./index";
import { dayTypeEv, food, recipe, structureEv, targetsEv, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";
const W = "2026-03-09";

// Valori di prova per l'intera voce, scelti per i test (non sono dati nutrizionali reali).
const TABLE: Record<string, EntryNutrients> = {
  A: { ok: true, nutrients: { energyKcal: 800, proteinG: 40 }, certainty: "label", weight: 200 },
  B: { ok: true, nutrients: { energyKcal: 700, proteinG: 30, fiberG: 10 }, certainty: "estimated", weight: 300 },
  // Senza proteine: dato mancante per quel nutriente.
  C: { ok: true, nutrients: { energyKcal: 500 }, certainty: "estimated", weight: 100 },
  X: { ok: false, reason: "unknown_food", weight: 100 },
};

const nutrientsOf = (entry: PlannedEntry): EntryNutrients => {
  if (entry.item.kind === "food") return TABLE[entry.item.name] ?? { ok: false };
  return { ok: false, reason: "recipe_without_data" };
};

function planWith(entries: PlannedEntry[], extra: unknown[] = []) {
  return derivePlan([
    targetsEv("t1", T, "training", {
      energyKcal: { min: 2000, max: 2600 },
      proteinG: { min: 60 },
      fiberG: { min: 25 },
    }),
    targetsEv("t2", T, "rest", { energyKcal: { max: 1500 } }),
    dayTypeEv("d1", T, "2026-03-09", "training"),
    dayTypeEv("d2", T, "2026-03-10", "rest"),
    weekEv("w", T, W, entries),
    ...extra,
  ]);
}

describe("checkPlanWeek", () => {
  it("restituisce sempre i sette giorni, con gli stati dei giorni senza voci o senza obiettivi", () => {
    const state = planWith([food("2026-03-11", "lunch", "A", 1)]);
    const week = checkPlanWeek(state, W, nutrientsOf);
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15",
    ]);
    expect(week.days[0].status).toBe("no_plan");
    expect(week.days[2].status).toBe("no_targets"); // nessun tipo di giornata
    expect(week.days[2].dayType).toBeUndefined();
    expect(checkPlanWeek(planWith([]), "2026-03-16", nutrientsOf).days.every((d) => d.status === "no_plan")).toBe(true);
  });

  it("giorno senza obiettivi per il suo tipo di giornata", () => {
    const state = derivePlan([
      dayTypeEv("d", T, "2026-03-09", "boh"),
      weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1)]),
    ]);
    expect(checkPlanWeek(state, W, nutrientsOf).days[0]).toMatchObject({ status: "no_targets", dayType: "boh" });
  });

  it("dato completo: rispettato, sotto e sopra", () => {
    const state = planWith(
      [
        food("2026-03-09", "lunch", "A", 1),
        food("2026-03-09", "dinner", "B", 1),
        food("2026-03-10", "lunch", "A", 1),
        food("2026-03-10", "dinner", "A", 1),
      ],
      [],
    );
    const [mon, tue] = checkPlanWeek(state, W, nutrientsOf).days;
    const energy = mon.nutrients.find((n) => n.nutrient === "energyKcal")!;
    // A + B = 1500 kcal, ma l'obiettivo del giorno è 2000-2600: sotto, dato completo.
    expect(energy).toMatchObject({ status: "below", value: 1500, partial: false, missingShare: 0 });
    // Martedì: 1600 kcal contro un massimo di 1500: sopra.
    expect(tue.nutrients[0]).toMatchObject({ nutrient: "energyKcal", status: "above", value: 1600 });
    const inRange = checkPlanWeek(
      derivePlan([
        targetsEv("t", T, "x", { energyKcal: { min: 1400, max: 1600 } }),
        dayTypeEv("d", T, "2026-03-09", "x"),
        weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1), food("2026-03-09", "dinner", "B", 1)]),
      ]),
      W,
      nutrientsOf,
    ).days[0].nutrients[0];
    expect(inRange).toMatchObject({ status: "met", value: 1500 });
    expect(inRange.certainty).toBe("estimated");
  });

  it("il confine è incluso", () => {
    const state = derivePlan([
      targetsEv("t", T, "x", { energyKcal: { min: 800, max: 800 } }),
      dayTypeEv("d", T, "2026-03-09", "x"),
      weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1)]),
    ]);
    expect(checkPlanWeek(state, W, nutrientsOf).days[0].nutrients[0].status).toBe("met");
  });

  it("dato parziale: la quota mancante è dichiarata e lo stato non è mai un falso 'sotto'", () => {
    const state = planWith([
      food("2026-03-09", "lunch", "A", 1),
      food("2026-03-09", "dinner", "C", 1), // senza proteine
    ]);
    const mon = checkPlanWeek(state, W, nutrientsOf).days[0];
    const protein = mon.nutrients.find((n) => n.nutrient === "proteinG")!;
    // 40 g noti contro un minimo di 60: potrebbe esserci altro nella voce senza dato.
    expect(protein).toMatchObject({
      status: "undetermined",
      value: 40,
      partial: true,
      shareBy: "weight",
    });
    expect(protein.missingShare).toBeCloseTo(100 / 300, 6);
    const energy = mon.nutrients.find((n) => n.nutrient === "energyKcal")!;
    expect(energy).toMatchObject({ status: "below", value: 1300, partial: false, missingShare: 0 });
  });

  it("dato parziale ma già sopra il massimo: 'sopra' è certo; già sopra il minimo (solo minimo): 'met'", () => {
    const state = derivePlan([
      targetsEv("t", T, "x", { proteinG: { max: 30 }, energyKcal: { min: 700 } }),
      dayTypeEv("d", T, "2026-03-09", "x"),
      weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1), food("2026-03-09", "dinner", "C", 1)]),
    ]);
    const nutrients = checkPlanWeek(state, W, nutrientsOf).days[0].nutrients;
    expect(nutrients.find((n) => n.nutrient === "proteinG")).toMatchObject({ status: "above", partial: true });
    // energia: nessuna voce manca di energia, quindi è completa.
    expect(nutrients.find((n) => n.nutrient === "energyKcal")).toMatchObject({ status: "met", partial: false });

    const partialMin = derivePlan([
      targetsEv("t", T, "x", { proteinG: { min: 30 } }),
      dayTypeEv("d", T, "2026-03-09", "x"),
      weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1), food("2026-03-09", "dinner", "C", 1)]),
    ]);
    expect(checkPlanWeek(partialMin, W, nutrientsOf).days[0].nutrients[0]).toMatchObject({
      status: "met",
      partial: true,
    });
  });

  it("nutriente senza alcun dato: non calcolabile, quota mancante 1", () => {
    const state = planWith([food("2026-03-09", "lunch", "C", 1)]);
    const fiber = checkPlanWeek(state, W, nutrientsOf).days[0].nutrients.find((n) => n.nutrient === "fiberG")!;
    expect(fiber).toEqual({
      nutrient: "fiberG",
      target: { min: 25 },
      status: "not_computable",
      missingShare: 1,
      partial: true,
    });
  });

  it("voci non calcolabili contano come dato mancante e sono contate", () => {
    const state = planWith([
      food("2026-03-09", "lunch", "A", 1),
      food("2026-03-09", "dinner", "X", 1),
      recipe("2026-03-09", "snack", "r1", 1),
    ]);
    const mon = checkPlanWeek(state, W, nutrientsOf).days[0];
    expect(mon.notComputableEntries).toBe(2);
    const energy = mon.nutrients.find((n) => n.nutrient === "energyKcal")!;
    expect(energy.partial).toBe(true);
    expect(energy.value).toBe(800);
    expect(energy.missingShare).toBeGreaterThan(0.5);
    expect(energy.status).toBe("undetermined");
  });

  it("senza pesi la quota si conta sulle voci", () => {
    const state = derivePlan([
      targetsEv("t", T, "x", { energyKcal: { min: 100 } }),
      dayTypeEv("d", T, "2026-03-09", "x"),
      weekEv("w", T, W, [food("2026-03-09", "lunch", "A", 1), food("2026-03-09", "dinner", "A", 1)]),
    ]);
    const r = checkPlanWeek(state, W, (e) => ({ ...(nutrientsOf(e) as { ok: true; nutrients: object }), weight: undefined }) as EntryNutrients);
    expect(r.days[0].nutrients[0]).toMatchObject({ shareBy: "count", missingShare: 0 });
  });

  it("riassume gli esiti; settimana a cavallo di anno", () => {
    const state = derivePlan([
      targetsEv("t", T, "x", { energyKcal: { min: 100 } }),
      structureEv("s", T, { defaultDayType: "x" }),
      weekEv("w", T, "2025-12-29", [food("2026-01-01", "lunch", "A", 1), food("2025-12-31", "lunch", "A", 1)]),
    ]);
    const r = checkPlanWeek(state, "2025-12-29", nutrientsOf);
    expect(r.days.filter((d) => d.status === "checked").map((d) => d.date)).toEqual(["2025-12-31", "2026-01-01"]);
    expect(r.summary).toEqual({ met: 2, below: 0, above: 0, undetermined: 0, not_computable: 0 });
  });

  it("non dipende dall'ordine degli eventi", () => {
    const entries = [food("2026-03-09", "lunch", "A", 1), food("2026-03-09", "dinner", "B", 1)];
    const a = checkPlanWeek(planWith(entries), W, nutrientsOf);
    const b = checkPlanWeek(planWith([...entries].reverse()), W, nutrientsOf);
    expect(b).toEqual(a);
  });
});
