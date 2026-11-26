import { describe, expect, it } from "vitest";
import { CATCHUP_NOTE, buildCatchUpEvents, deriveDiary, mealsWithPantry, type CatchUpKind, type MealItem } from "@/core/diary";
import { consume, habit, meal, purchase } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry } from "@/core/ledger";
import type { Product } from "@/core/catalog";
import { computeIntake, createFoodMatcher, createResolver } from "@/core/nutrition";
import { FAKE_PRODUCT, FAKE_STATE_FOODS } from "@/core/nutrition/test-helpers";
import {
  chosenOption,
  defaultOption,
  pantryFoodsOfConsumes,
  freeItemsOf,
  isEstimate,
  momentOptions,
  optionText,
  splitWritten,
  toEntry,
  usualHabits,
  type CatchUpOption,
  type ChoiceSources,
} from "./choices";

const TZ = "Europe/Rome";
const TODAY = "2026-11-17";
const FIRST = "2026-11-14";
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });
const item = (name: string, value = 100): MealItem => ({ name, quantity: q(value), certainty: "measured" });

/** `foodIds`: dal consumo all'alimento della tabella con cui si erano calcolati i nutrienti. */
function sources(log: readonly AnyEvent[], history?: readonly number[], foodIds: Record<string, string> = {}): ChoiceSources {
  const diary = deriveDiary(log, { timeZone: TZ });
  const pantry = derivePantry(log);
  return {
    habits: diary.habits,
    meals: mealsWithPantry(diary, log),
    lotNames: new Map(pantry.lots.map((l) => [l.lotId, l.productRef])),
    energyHistory: () => history,
    foodOf: (id) => (foodIds[id] ? { foodId: foodIds[id] } : undefined),
    today: TODAY,
    firstDay: FIRST,
  };
}

const lunchAt = (date: string, id: string, f: { habitId?: string; items?: MealItem[] } = {}) =>
  meal(id, `${date}T12:00:00.000Z`, { mealId: `meal-${id}`, kind: "lunch", items: f.items ?? [item("Pasta")], ...(f.habitId ? { habitId: f.habitId } : {}) });

const types = (options: readonly CatchUpOption[]) => options.map((o) => o.type);

describe("le scelte di un momento", () => {
  it("6. il pasto abituale usato cinque volte parte prima di quello usato una volta", () => {
    const log: AnyEvent[] = [
      habit("h-a", "2026-10-01T08:00:00.000Z", { habitId: "often", title: "Pasta e insalata", kind: "lunch", items: [item("Pasta"), item("Insalata")] }),
      habit("h-b", "2026-11-01T08:00:00.000Z", { habitId: "rare", title: "Riso", kind: "lunch", items: [item("Riso")] }),
      habit("h-c", "2026-11-02T08:00:00.000Z", { habitId: "other", title: "Terzo", kind: "lunch", items: [item("Pane")] }),
      ...["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map((d, i) => lunchAt(d, `o${i}`, { habitId: "often" })),
      lunchAt("2026-11-12", "r0", { habitId: "rare" }),
    ];
    const s = sources(log);
    expect(usualHabits(s, "lunch").map((h) => h.habitId)).toEqual(["often", "rare"]);
    const options = momentOptions(s, "lunch");
    expect(options[0].label).toBe("Il solito: Pasta e insalata");
    expect(options.filter((o) => o.type === "habit")).toHaveLength(2);
    expect(defaultOption(options).label).toBe("Il solito: Pasta e insalata");
    const entry = toEntry("2026-11-15", "lunch", defaultOption(options));
    expect(entry.choice).toEqual({
      kind: "meal",
      title: "Pasta e insalata",
      items: [
        { name: "Pasta", quantity: q(100), certainty: "estimated" },
        { name: "Insalata", quantity: q(100), certainty: "estimated" },
      ],
      habitId: "often",
      source: "habit",
    });
  });

  it("a pari uso parte il più usato di recente", () => {
    const log: AnyEvent[] = [
      habit("h-a", "2026-10-01T08:00:00.000Z", { habitId: "a", title: "A", kind: "lunch", items: [item("Pasta")] }),
      habit("h-b", "2026-10-01T08:00:00.000Z", { habitId: "b", title: "B", kind: "lunch", items: [item("Riso")] }),
      lunchAt("2026-11-05", "x1", { habitId: "a" }),
      lunchAt("2026-11-09", "x2", { habitId: "b" }),
    ];
    expect(usualHabits(sources(log), "lunch").map((h) => h.habitId)).toEqual(["b", "a"]);
  });

  it("7. nessun abituale, il pranzo dell'11 con due alimenti dalla dispensa e una voce libera: tre voci libere stimate", () => {
    const log: AnyEvent[] = [
      purchase("p1", "2026-11-01T08:00:00.000Z", { lotId: "lot-pasta", productRef: "Pasta al pomodoro", quantity: q(500), location: "dispensa" }),
      purchase("p2", "2026-11-01T08:00:00.000Z", { lotId: "lot-ins", productRef: "Insalata", quantity: q(200), location: "frigo" }),
      lunchAt("2026-11-11", "l11", { items: [item("Pane", 50)] }),
      consume("c1", "2026-11-11T12:00:00.000Z", { lotId: "lot-pasta", quantity: q(120), mealId: "meal-l11" }),
      consume("c2", "2026-11-11T12:00:00.000Z", { lotId: "lot-ins", quantity: q(80), mealId: "meal-l11" }),
      lunchAt("2026-10-20", "old"),
    ];
    const s = sources(log, undefined, { c1: "pasta-secca", c2: "insalata" });
    const options = momentOptions(s, "lunch");
    const first = defaultOption(options);
    expect(first.type).toBe("repeat");
    expect(first.label).toBe("Come mercoledì 11: pasta al pomodoro, insalata, pane");
    const entry = toEntry("2026-11-15", "lunch", first);
    expect(entry.choice).toEqual({
      kind: "meal",
      items: [
        { name: "Pasta al pomodoro", quantity: q(120), certainty: "estimated", foodId: "pasta-secca" },
        { name: "Insalata", quantity: q(80), certainty: "estimated", foodId: "insalata" },
        { name: "Pane", quantity: q(50), certainty: "estimated" },
      ],
      source: "manual",
    });
    const events = buildCatchUpEvents([entry], { deviceId: "d", now: "2026-11-17T09:00:00.000Z", timeZone: TZ, minutesOf: { breakfast: 480, lunch: 780, dinner: 1200, snack: 990 } });
    expect(events.map((e) => e.type)).toEqual(["meal"]);
  });

  it("le confezioni dello stesso alimento si sommano; senza nome, «Alimento senza nome»", () => {
    const log: AnyEvent[] = [
      purchase("p1", "2026-11-01T08:00:00.000Z", { lotId: "a", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" }),
      purchase("p2", "2026-11-01T08:00:00.000Z", { lotId: "b", productRef: "latte", quantity: q(1000, "ml"), location: "frigo" }),
      lunchAt("2026-11-11", "l", { items: [] }),
      consume("c1", "2026-11-11T12:00:00.000Z", { lotId: "a", quantity: q(100, "ml"), mealId: "meal-l" }),
      consume("c2", "2026-11-11T12:00:00.000Z", { lotId: "b", quantity: q(50, "ml"), mealId: "meal-l" }),
      consume("c3", "2026-11-11T12:00:00.000Z", { lotId: "gone", quantity: q(30), mealId: "meal-l" }),
    ];
    const s = sources(log, undefined, { c1: "latte-intero", c2: "latte-intero", c3: "pasta-secca" });
    const m = s.meals.find((x) => x.mealId === "meal-l");
    expect(m && freeItemsOf(m, s.lotNames, s.foodOf)).toEqual([
      { name: "Latte", quantity: q(150, "ml"), certainty: "estimated", foodId: "latte-intero" },
      { name: "Alimento senza nome", quantity: q(30), certainty: "estimated", foodId: "pasta-secca" },
    ]);
    // un alimento di cui non si sa con che cosa si era calcolato: il pasto non si ripete
    expect(m && freeItemsOf(m, s.lotNames, (id) => (id === "c3" ? undefined : { foodId: "latte-intero" }))).toBeUndefined();
  });

  it("si guarda solo nei 14 giorni prima del primo giorno vuoto", () => {
    expect(types(momentOptions(sources([lunchAt("2026-10-30", "too-old")]), "lunch"))).not.toContain("repeat");
    expect(types(momentOptions(sources([lunchAt("2026-10-31", "just")]), "lunch"))).toContain("repeat");
    // un pasto di un altro momento non vale
    expect(types(momentOptions(sources([lunchAt("2026-11-11", "l")]), "dinner"))).not.toContain("repeat");
  });

  it("8. né abituale né pasto prima: parte «Non ricordo»", () => {
    const options = momentOptions(sources([], [500, 600]), "dinner");
    expect(types(options)).toEqual(["out", "skipped", "unknown"]);
    expect(defaultOption(options).label).toBe("Non ricordo");
    expect(toEntry("2026-11-14", "dinner", defaultOption(options)).choice).toEqual({ kind: "unknown" });
  });

  it("la partenza non è mai «Fuori casa» né «Saltato»", () => {
    for (const log of [[], [lunchAt("2026-11-11", "l")]]) {
      for (const kind of ["breakfast", "lunch", "dinner"] as CatchUpKind[]) {
        const start = defaultOption(momentOptions(sources(log, [900, 900, 900, 900, 900]), kind));
        expect(["habit", "repeat", "unknown"]).toContain(start.type);
        expect(chosenOption(momentOptions(sources(log), kind), undefined).type).not.toMatch(/out|skipped/);
      }
    }
  });

  it("10. fuori casa con meno di cinque pasti: stima generica, scritta come voce stimata della sola energia", () => {
    const options = momentOptions(sources([], [700, 750]), "lunch");
    const out = options.find((o) => o.type === "out");
    expect(out?.type === "out" ? out.sizes.map((s) => s.hint) : []).toEqual(["~480 kcal, stima generica", "~800 kcal, stima generica", "~1200 kcal, stima generica"]);
    expect(out && optionText(out, "large")).toBe("Fuori casa · abbondante");
    expect(out && toEntry("2026-11-14", "lunch", out).choice).toEqual({
      kind: "meal",
      items: [{ name: "Fuori casa · normale", quantity: q(1, "pz"), certainty: "estimated", energyKcal: 800 }],
      source: "manual",
    });
    expect(out && toEntry("2026-11-14", "lunch", out, "light").choice).toMatchObject({ items: [{ name: "Fuori casa · leggero", energyKcal: 480 }] });
  });

  it("senza la storia dell'energia «Fuori casa» non c'è ancora", () => {
    expect(types(momentOptions(sources([]), "lunch"))).toEqual(["skipped", "unknown"]);
  });

  it("una scelta che non c'è più torna alla partenza", () => {
    const options = momentOptions(sources([lunchAt("2026-11-11", "l")]), "lunch");
    expect(chosenOption(options, { option: "skipped", size: "normal" }).type).toBe("skipped");
    expect(chosenOption(options, { option: "habit:gone", size: "normal" }).type).toBe("repeat");
  });

  it("15. nessuna scelta costruisce un consumo", () => {
    const log: AnyEvent[] = [
      purchase("p1", "2026-11-01T08:00:00.000Z", { lotId: "lot", productRef: "Pasta", quantity: q(500), location: "dispensa" }),
      habit("h", "2026-11-01T08:00:00.000Z", { habitId: "h", title: "Solito", kind: "lunch", items: [item("Pasta")] }),
      lunchAt("2026-11-11", "l"),
      consume("c1", "2026-11-11T12:00:00.000Z", { lotId: "lot", quantity: q(120), mealId: "meal-l" }),
    ];
    const options = momentOptions(sources(log, [800], { c1: "pasta-secca" }), "lunch");
    expect(types(options)).toEqual(["habit", "repeat", "out", "skipped", "unknown"]);
    expect(options.map(isEstimate)).toEqual([true, true, true, false, false]);
    const entries = options.map((o, i) => toEntry(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-13", "2026-11-12"][i], "lunch", o));
    const events = buildCatchUpEvents(entries, { deviceId: "d", now: "2026-11-17T09:00:00.000Z", timeZone: TZ, minutesOf: { breakfast: 480, lunch: 780, dinner: 1200, snack: 990 } });
    expect(events.map((e) => e.type as string)).not.toContain("consume");
  });

  it("i pasti scritti dal recupero non contano come uso del pasto abituale", () => {
    const log: AnyEvent[] = [
      habit("h-a", "2026-10-01T08:00:00.000Z", { habitId: "a", title: "A", kind: "lunch", items: [item("Pasta")] }),
      habit("h-b", "2026-10-01T08:00:00.000Z", { habitId: "b", title: "B", kind: "lunch", items: [item("Riso")] }),
      lunchAt("2026-11-02", "real", { habitId: "a" }),
      ...["2026-11-05", "2026-11-06"].map((d, i) => ({ ...lunchAt(d, `cu${i}`, { habitId: "b" }), note: CATCHUP_NOTE })),
    ];
    expect(usualHabits(sources(log), "lunch").map((h) => h.habitId)).toEqual(["a", "b"]);
  });
});

describe("«Come …» con gli alimenti della dispensa: gli stessi nutrienti di allora", () => {
  const minutesOf = { breakfast: 480, lunch: 780, dinner: 1200, snack: 990 };
  const recordWith = (log: readonly AnyEvent[], resolver: ReturnType<typeof createResolver>) => {
    const intake = computeIntake(log, resolver, { timeZone: TZ });
    const foods = pantryFoodsOfConsumes(intake, createFoodMatcher(FAKE_STATE_FOODS));
    return { intake, s: { ...sources(log), foodOf: (id: string) => foods.get(id) } };
  };

  it("pasta secca dalla dispensa: la voce ripetuta resta secca, con la stessa energia", () => {
    const resolver = createResolver({ foods: FAKE_STATE_FOODS });
    const log: AnyEvent[] = [
      purchase("p1", "2026-11-01T08:00:00.000Z", { lotId: "lot-pasta", productRef: "Spaghetti", quantity: q(500), location: "dispensa" }),
      lunchAt("2026-11-11", "l11", { items: [] }),
      consume("c1", "2026-11-11T12:00:00.000Z", { lotId: "lot-pasta", quantity: q(120), mealId: "meal-l11" }),
    ];
    const { intake, s } = recordWith(log, resolver);
    const before = intake.days.find((d) => d.date === "2026-11-11")?.meals[0].totals.energyKcal?.value;
    expect(before).toBe(420); // 120 g di pasta secca, 350 kcal/100 g (dati finti)
    const repeat = momentOptions(s, "lunch").find((o) => o.type === "repeat");
    expect(repeat).toBeDefined();
    const entry = toEntry("2026-11-14", "lunch", repeat as CatchUpOption);
    expect(entry.choice).toMatchObject({ items: [{ name: "Spaghetti", quantity: q(120), foodId: "pasta-secca-s", certainty: "estimated" }] });
    const events = buildCatchUpEvents([entry], { deviceId: "d", now: "2026-11-17T09:00:00.000Z", timeZone: TZ, minutesOf });
    const after = computeIntake([...log, ...events], resolver, { timeZone: TZ });
    const copied = after.days.find((d) => d.date === "2026-11-14")?.meals[0];
    expect(copied?.lines[0]).toMatchObject({ status: "ok", composition: { ref: "pasta-secca-s", state: "dried" } });
    expect(copied?.totals.energyKcal?.value).toBe(420);
    expect(events.map((e) => e.type as string)).not.toContain("consume");
  });

  const labelLog = (product: Product, grams = 100): AnyEvent[] => [
    purchase("p1", "2026-11-01T08:00:00.000Z", { lotId: "lot-x", productRef: product.barcode, quantity: q(500), location: "dispensa" }),
    lunchAt("2026-11-11", "l11", { items: [] }),
    consume("c1", "2026-11-11T12:00:00.000Z", { lotId: "lot-x", quantity: q(grams), mealId: "meal-l11" }),
  ];
  const labelResolver = (product: Product) => createResolver({ foods: FAKE_STATE_FOODS, productByRef: (ref) => (ref === product.barcode ? product : undefined) });

  it("valori d'etichetta: la voce prende l'alimento della tabella dal nome del prodotto, secco e non cotto", () => {
    const spaghetti: Product = { ...FAKE_PRODUCT, barcode: "8000000000001", name: "Spaghetti" };
    const log = labelLog(spaghetti, 120);
    const { intake, s } = recordWith(log, labelResolver(spaghetti));
    expect(intake.days[0].meals[0].lines[0]).toMatchObject({ status: "ok", composition: { origin: "label" } });
    const repeat = momentOptions(s, "lunch").find((o) => o.type === "repeat");
    expect(repeat).toBeDefined();
    const entry = toEntry("2026-11-14", "lunch", repeat as CatchUpOption);
    // il nome del prodotto, mai il codice a barre; una stima
    expect(entry.choice).toMatchObject({ items: [{ name: "Spaghetti", quantity: q(120), foodId: "pasta-secca-s", certainty: "estimated" }] });
    const events = buildCatchUpEvents([entry], { deviceId: "d", now: "2026-11-17T09:00:00.000Z", timeZone: TZ, minutesOf });
    const copied = computeIntake([...log, ...events], labelResolver(spaghetti), { timeZone: TZ }).days.find((d) => d.date === "2026-11-14")?.meals[0];
    expect(copied?.lines[0]).toMatchObject({ status: "ok", composition: { ref: "pasta-secca-s", state: "dried" } });
    expect(copied?.totals.energyKcal?.value).toBe(420);
  });

  it("valori d'etichetta di un prodotto cotto: non si prende la voce secca, «Come …» non si propone", () => {
    const ready: Product = { ...FAKE_PRODUCT, barcode: "8000000000002", name: "Pasta cotta" };
    const { s } = recordWith(labelLog(ready), labelResolver(ready));
    expect(types(momentOptions(s, "lunch"))).not.toContain("repeat");
  });

  it("valori d'etichetta di un prodotto senza nome: non si cerca dal codice a barre, «Come …» non si propone", () => {
    const { name: _unused, ...unnamed } = { ...FAKE_PRODUCT, barcode: "8000000000003" };
    void _unused;
    const { intake, s } = recordWith(labelLog(unnamed), labelResolver(unnamed));
    expect(intake.days[0].meals[0].lines[0]).toMatchObject({ status: "ok", composition: { origin: "label", name: "8000000000003" } });
    const options = momentOptions(s, "lunch");
    expect(types(options)).not.toContain("repeat");
    expect(defaultOption(options).type).toBe("unknown");
  });

  it("valori d'etichetta di un prodotto che la tabella non conosce: «Come …» non si propone", () => {
    const { s } = recordWith(labelLog(FAKE_PRODUCT), labelResolver(FAKE_PRODUCT));
    expect(types(momentOptions(s, "lunch"))).not.toContain("repeat");
  });
});

describe("una scrittura entrata solo in parte", () => {
  it("le voci entrate hanno i loro eventi; quelle respinte si dicono", () => {
    const entries = [
      toEntry("2026-11-14", "lunch", { id: "skipped", type: "skipped", label: "Saltato" }),
      toEntry("2026-11-15", "lunch", { id: "unknown", type: "unknown", label: "Non ricordo" }),
      toEntry("2026-11-16", "dinner", { id: "skipped", type: "skipped", label: "Saltato" }),
    ];
    const events = buildCatchUpEvents(entries, { deviceId: "d", now: "2026-11-17T09:00:00.000Z", timeZone: TZ, minutesOf: { breakfast: 480, lunch: 780, dinner: 1200, snack: 990 } });
    // un evento per voce, nello stesso ordine
    expect(events.map((e) => (e.type === "mealDeclaration" ? `${e.date} ${e.kind}` : ""))).toEqual(["2026-11-14 lunch", "2026-11-15 lunch", "2026-11-16 dinner"]);
    const split = splitWritten(entries, events, [1]);
    expect(split.entries.map((e) => e.date)).toEqual(["2026-11-14", "2026-11-16"]);
    expect(split.events).toEqual([events[0], events[2]]);
    expect(split.refused).toEqual([entries[1]]);
    expect(() => splitWritten(entries, events.slice(1), [])).toThrow();
  });
});
