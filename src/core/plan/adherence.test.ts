import { describe, expect, it } from "vitest";
import { deriveDiary, type MealItem, type MealKind } from "../diary";
import { meal, untracked } from "../diary/test-helpers";
import { consume } from "../ledger/test-helpers";
import { compareWeek, derivePlan, getAdherenceDay, type ExpandRef, type LotRef } from "./index";
import { food, prepEntry, recipe, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";
const W = "2026-03-09";

const HOURS: Record<MealKind, string> = {
  breakfast: "06:30",
  lunch: "11:30",
  dinner: "18:30",
  snack: "14:30",
};

const item = (name: string, value = 100, foodId?: string): MealItem => ({
  name,
  quantity: { value, unit: "g" },
  certainty: "estimated",
  ...(foodId ? { foodId } : {}),
});

let counter = 0;
const diaryMeal = (date: string, kind: MealKind, items: MealItem[], mealId = `m${++counter}`) =>
  meal(`ev-${mealId}`, `${date}T${HOURS[kind]}:00.000Z`, { mealId, kind, items });

/** Tre pasti principali tracciati, con le voci indicate per tipo. */
function fullDay(date: string, items: Partial<Record<MealKind, MealItem[]>> = {}) {
  return (["breakfast", "lunch", "dinner"] as const).map((kind) =>
    diaryMeal(date, kind, items[kind] ?? [item("Altro")]),
  );
}

const plan = (entries: Parameters<typeof weekEv>[3], weekStart = W) =>
  derivePlan([weekEv("w", T, weekStart, entries)]);

describe("compareWeek", () => {
  it("rispettato, sostituito, saltato e in più nello stesso giorno", () => {
    const state = plan([
      food("2026-03-09", "breakfast", "Yogurt", 125),
      food("2026-03-09", "lunch", "Riso", 80),
      food("2026-03-09", "lunch", "Pollo", 100),
      food("2026-03-09", "dinner", "Pesce", 150),
      food("2026-03-09", "dinner", "Insalata", 100),
    ]);
    const diary = deriveDiary(
      fullDay("2026-03-09", {
        breakfast: [item("yogurt", 125)],
        lunch: [item("Riso", 160), item("Pizza")], // pollo non c'è, c'è pizza al suo posto... ma anche il riso
        dinner: [item("Pesce", 150), item("Gelato")], // l'insalata manca, c'è il gelato
      }),
    );
    const week = compareWeek(state, W, diary);
    const day = getAdherenceDay(week, "2026-03-09")!;
    const byName = Object.fromEntries(
      day.entries.map((e) => [e.planned.kind === "food" ? e.planned.name : "", e]),
    );
    expect(byName.Yogurt.status).toBe("respected");
    expect(byName.Riso.status).toBe("respected");
    expect(byName.Riso.quantityRatio).toBe(2);
    expect(byName.Pollo.status).toBe("substituted");
    expect(byName.Pollo.actual.map((a) => a.name)).toEqual(["Pizza"]);
    expect(byName.Pesce.status).toBe("respected");
    expect(byName.Insalata.status).toBe("substituted");
    expect(day.extras).toEqual([]);
    expect(day.counts).toEqual({ respected: 3, substituted: 2, skipped: 0, extra: 0, unverifiable: 0 });
  });

  it("saltato: nel pasto non c'è nulla al suo posto; in più: voci non previste", () => {
    const state = plan([
      food("2026-03-09", "breakfast", "Yogurt", 125),
      food("2026-03-09", "lunch", "Riso", 80),
      food("2026-03-09", "lunch", "Pollo", 100),
    ]);
    const diary = deriveDiary(
      fullDay("2026-03-09", {
        breakfast: [item("Yogurt")],
        lunch: [item("Riso")],
        dinner: [item("Pasta"), item("Vino")],
      }),
    );
    const day = getAdherenceDay(compareWeek(state, W, diary), "2026-03-09")!;
    expect(day.entries.map((e) => e.status)).toEqual(["respected", "respected", "skipped"]);
    expect(day.extras.map((e) => [e.meal, e.name])).toEqual([
      ["dinner", "Pasta"],
      ["dinner", "Vino"],
    ]);
    expect(day.counts).toMatchObject({ respected: 2, skipped: 1, extra: 2 });
  });

  it("un pasto del piano mangiato in un altro pasto dello stesso giorno è rispettato con otherSlot", () => {
    const state = plan([food("2026-03-09", "lunch", "Riso", 80)]);
    const diary = deriveDiary(fullDay("2026-03-09", { dinner: [item("Riso")] }));
    const e = getAdherenceDay(compareWeek(state, W, diary), "2026-03-09")!.entries[0];
    expect(e).toMatchObject({ status: "respected", otherSlot: true });
  });

  it("riconosce gli alimenti per identificativo di tabella o per nome normalizzato", () => {
    const state = plan([
      food("2026-03-09", "lunch", "Pasta di semola", 80, "g", "pasta-semola-secca"),
      food("2026-03-09", "dinner", "  PESCE  ", 80),
    ]);
    const diary = deriveDiary(
      fullDay("2026-03-09", {
        lunch: [item("spaghetti", 80, "pasta-semola-secca")],
        dinner: [item("pesce")],
      }),
    );
    const day = getAdherenceDay(compareWeek(state, W, diary), "2026-03-09")!;
    expect(day.entries.map((e) => e.status)).toEqual(["respected", "respected"]);
  });

  it("esclude e conta a parte i giorni con vuoti, dichiarati e senza voci pianificate", () => {
    const state = plan([
      food("2026-03-09", "lunch", "Riso", 80), // completo
      food("2026-03-10", "lunch", "Riso", 80), // vuoti
      food("2026-03-11", "lunch", "Riso", 80), // dichiarato
      food("2026-03-12", "lunch", "Riso", 80), // nessun dato nel diario
    ]);
    const diary = deriveDiary([
      ...fullDay("2026-03-09", { lunch: [item("Riso")] }),
      diaryMeal("2026-03-10", "lunch", [item("Riso")]),
      diaryMeal("2026-03-11", "breakfast", [item("Caffè")]),
      diaryMeal("2026-03-11", "lunch", [item("Riso")]),
      untracked("u1", "2026-03-11T18:30:00.000Z", { kind: "dinner" }),
      ...fullDay("2026-03-13"),
    ]);
    const week = compareWeek(state, W, diary);
    expect(week.days.map((d) => d.date)).toEqual(["2026-03-09"]);
    expect(week.excluded).toEqual({
      declared: ["2026-03-11"],
      gaps: ["2026-03-10", "2026-03-12"],
      unplanned: ["2026-03-13", "2026-03-14", "2026-03-15"],
    });
    expect(week.totals).toMatchObject({ respected: 1, skipped: 0 });
    expect(week.rate).toBe(1);
  });

  it("i giorni con vuoti non producono mai 'saltato'", () => {
    const state = plan([food("2026-03-10", "lunch", "Riso", 80)]);
    const diary = deriveDiary([diaryMeal("2026-03-10", "dinner", [item("Pasta")])]);
    const week = compareWeek(state, W, diary);
    expect(week.totals).toEqual({ respected: 0, substituted: 0, skipped: 0, extra: 0, unverifiable: 0 });
    expect(week.rate).toBeUndefined();
    expect(week.excluded.gaps).toEqual(["2026-03-10"]);
  });

  it("uno spuntino pianificato con uno spuntino dichiarato non tracciato è non verificabile", () => {
    const state = plan([food("2026-03-09", "snack", "Frutta", 150)]);
    const diary = deriveDiary([
      ...fullDay("2026-03-09"),
      untracked("u", "2026-03-09T14:30:00.000Z", { kind: "snack" }),
    ]);
    const e = getAdherenceDay(compareWeek(state, W, diary), "2026-03-09")!.entries[0];
    expect(e).toMatchObject({ status: "unverifiable", reason: "untracked_meal" });
    // Senza lo spuntino dichiarato, lo spuntino mancante è un salto.
    const noDecl = compareWeek(state, W, deriveDiary(fullDay("2026-03-09")));
    expect(getAdherenceDay(noDecl, "2026-03-09")!.entries[0].status).toBe("skipped");
  });

  it("ricette: rispettate solo se tutti gli ingredienti ci sono; senza espansione non verificabili", () => {
    const expand: ExpandRef = (ref) =>
      ref.id === "ragu"
        ? [
            { name: "Carne", quantity: { value: 100, unit: "g" } },
            { name: "Passata", quantity: { value: 100, unit: "g" } },
          ]
        : undefined;
    const state = plan([
      recipe("2026-03-09", "lunch", "ragu", 1),
      recipe("2026-03-09", "dinner", "ragu", 1),
      recipe("2026-03-10", "lunch", "ragu", 1),
    ]);
    const diary = deriveDiary([
      ...fullDay("2026-03-09", { lunch: [item("carne"), item("passata")], dinner: [item("carne")] }),
      ...fullDay("2026-03-10"),
    ]);
    const week = compareWeek(state, W, diary, { expand });
    const d9 = getAdherenceDay(week, "2026-03-09")!;
    expect(d9.entries.map((e) => e.status)).toEqual(["respected", "substituted"]);
    const noExpand = compareWeek(state, W, diary);
    const d10 = getAdherenceDay(noExpand, "2026-03-10")!;
    expect(d10.entries[0]).toMatchObject({ status: "unverifiable", reason: "unresolved_ref" });
    // Le voci del pasto con una ricetta non verificabile non diventano "in più".
    expect(d10.extras.filter((x) => x.meal === "lunch")).toEqual([]);
  });

  it("preparazioni: riconosciute dai consumi di dispensa dei lotti di porzioni", () => {
    const state = plan([
      prepEntry("2026-03-09", "lunch", "zuppa", 1),
      prepEntry("2026-03-09", "dinner", "zuppa", 1),
    ]);
    const events = [
      diaryMeal("2026-03-09", "breakfast", [item("Caffè")]),
      diaryMeal("2026-03-09", "lunch", [], "lunch-1"),
      diaryMeal("2026-03-09", "dinner", [item("Pane")], "dinner-1"),
      consume("c1", "2026-03-09T11:30:00.000Z", {
        lotId: "lot-zuppa",
        quantity: { value: 1, unit: "pz" },
        mealId: "lunch-1",
      }),
    ];
    const lots = new Map<string, LotRef>([["lot-zuppa", { productRef: "Zuppa", prepId: "zuppa" }]]);
    const diary = deriveDiary(events);
    const week = compareWeek(state, W, diary, { events, lots });
    const day = getAdherenceDay(week, "2026-03-09")!;
    expect(day.entries[0]).toMatchObject({ status: "respected" });
    expect(day.entries[0].actual[0]).toMatchObject({ from: "pantry", lotId: "lot-zuppa" });
    // A cena la porzione non c'è e al suo posto c'è il pane.
    expect(day.entries[1].status).toBe("substituted");
    // Senza registro né lotti, il consumo non si vede: il pranzo è vuoto e la voce è saltata.
    const blind = getAdherenceDay(compareWeek(state, W, diary), "2026-03-09")!;
    expect(blind.entries.map((e) => e.status)).toEqual(["skipped", "substituted"]);
  });

  it("un consumo annullato non conta", () => {
    const state = plan([prepEntry("2026-03-09", "lunch", "zuppa", 1)]);
    const events = [
      ...fullDay("2026-03-09", { dinner: [item("Pane")] }).filter((e) => (e as { kind: string }).kind !== "lunch"),
      diaryMeal("2026-03-09", "lunch", [], "lunch-1"),
      consume("c1", "2026-03-09T11:30:00.000Z", {
        lotId: "lot-zuppa",
        quantity: { value: 1, unit: "pz" },
        mealId: "lunch-1",
      }),
      { id: "v1", type: "void", at: "2026-03-09T12:00:00.000Z", recordedAt: "2026-03-09T12:00:00.000Z", deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", targetEventId: "c1" },
    ];
    const lots = new Map<string, LotRef>([["lot-zuppa", { productRef: "Zuppa", prepId: "zuppa" }]]);
    const week = compareWeek(state, W, deriveDiary(events), { events, lots });
    expect(getAdherenceDay(week, "2026-03-09")!.entries[0].status).toBe("skipped");
  });

  it("settimana a cavallo di mese e di anno", () => {
    const state = plan(
      [food("2025-12-31", "dinner", "Lenticchie", 80), food("2026-01-01", "lunch", "Lenticchie", 80)],
      "2025-12-29",
    );
    const diary = deriveDiary([
      ...fullDay("2025-12-31", { dinner: [item("Lenticchie")] }),
      ...fullDay("2026-01-01", { lunch: [item("Pasta")] }),
    ]);
    const week = compareWeek(state, "2025-12-29", diary);
    expect(week.days.map((d) => [d.date, d.entries[0].status])).toEqual([
      ["2025-12-31", "respected"],
      ["2026-01-01", "substituted"],
    ]);
    expect(week.rate).toBe(0.5);
  });

  it("settimana non pianificata: tutti i giorni sono 'senza piano'", () => {
    const week = compareWeek(derivePlan([]), W, deriveDiary([]));
    expect(week.days).toEqual([]);
    expect(week.excluded.unplanned).toHaveLength(7);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const entries = [food("2026-03-09", "lunch", "Riso", 80), food("2026-03-09", "dinner", "Pesce", 80)];
    const events = fullDay("2026-03-09", { lunch: [item("Riso")], dinner: [item("Pasta")] });
    const a = compareWeek(plan(entries), W, deriveDiary(events));
    const b = compareWeek(plan([...entries].reverse()), W, deriveDiary([...events].reverse()));
    expect(b).toEqual(a);
  });
});
