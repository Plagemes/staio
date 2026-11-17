import { describe, expect, it } from "vitest";
import { deriveDiary, habitsToPropose, mealsWithPantry, voidMeal } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { buildCaptureEvents } from "./capture";
import {
  buildMealEvents,
  buildMealFromHabit,
  buildUntrackedMeal,
  suggestMealKind,
  summarizeDay,
} from "./meals";

const NOW = "2026-11-16T07:30:00.000Z"; // 08:30 a Roma
const ctx = (now = NOW) => ({ now, deviceId: "d" });

function stock(): { events: AnyEvent[]; lots: Lot[] } {
  const add = (name: string, quantityText: string, category: string, location: "frigo" | "dispensa") => {
    const r = buildCaptureEvents(
      { name, quantityText, location, category, expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false },
      { now: "2026-11-15T10:00:00.000Z", deviceId: "d" },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.events;
  };
  const events: AnyEvent[] = [
    ...add("Latte", "1 l", "milk_fresh", "frigo"),
    ...add("Biscotti", "400 g", "snacks_dry", "dispensa"),
  ];
  return { events, lots: derivePantry(events.filter((e) => e.type === "purchase")).lots };
}

const lotNamed = (lots: Lot[], name: string) => lots.find((l) => l.productRef === name) as Lot;

describe("suggestMealKind", () => {
  it.each([
    ["2026-11-16T04:00:00.000Z", "breakfast"], // 05:00
    ["2026-11-16T08:00:00.000Z", "breakfast"], // 09:00
    ["2026-11-16T09:40:00.000Z", "lunch"], // 10:40
    ["2026-11-16T12:30:00.000Z", "lunch"], // 13:30
    ["2026-11-16T15:30:00.000Z", "snack"], // 16:30
    ["2026-11-16T19:00:00.000Z", "dinner"], // 20:00
    ["2026-11-16T22:30:00.000Z", "snack"], // 23:30
    ["2026-11-16T01:30:00.000Z", "snack"], // 02:30
  ])("%s -> %s", (at, kind) => {
    expect(suggestMealKind(at)).toBe(kind);
  });
});

describe("buildMealEvents", () => {
  it("un meal e un consume per alimento, con lo stesso mealId", () => {
    const { events, lots } = stock();
    const r = buildMealEvents(
      {
        kind: "breakfast",
        picks: [
          { lot: lotNamed(lots, "Latte"), choice: { kind: "text", text: "200 ml" } },
          { lot: lotNamed(lots, "Biscotti"), choice: { kind: "quarter" } },
        ],
        freeItems: [{ name: "Caffè", quantityText: "30 ml" }],
      },
      ctx(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const [meal, ...consumes] = r.events;
    expect(meal).toMatchObject({ type: "meal", kind: "breakfast", mealId: r.mealId, items: [{ name: "Caffè", certainty: "estimated" }] });
    expect(consumes).toHaveLength(2);
    expect(consumes.every((c) => c.type === "consume" && c.mealId === r.mealId)).toBe(true);
    expect(consumes[0]).toMatchObject({ quantity: { value: 200, unit: "ml" }, certainty: "measured" });
    expect(consumes[1]).toMatchObject({ quantity: { value: 100, unit: "g" }, certainty: "estimated" });

    const all = [...events, ...r.events];
    const linked = mealsWithPantry(deriveDiary(all), all);
    expect(linked).toHaveLength(1);
    expect(linked[0].date).toBe("2026-11-16");
    expect(linked[0].pantryConsumes).toHaveLength(2);
    expect(derivePantry(all.filter((e) => e.type !== "meal")).lots.find((l) => l.productRef === "Latte")?.remaining).toBe(800);
  });

  it("senza alimenti: errore generale", () => {
    const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "", quantityText: "" }] }, ctx());
    expect(!r.ok && r.errors.general).toMatch(/almeno un alimento/);
  });

  it("errori per voce: quantità oltre il rimasto e voce libera illeggibile", () => {
    const { lots } = stock();
    const lot = lotNamed(lots, "Latte");
    const r = buildMealEvents(
      {
        kind: "lunch",
        picks: [{ lot, choice: { kind: "text", text: "3 l" } }],
        freeItems: [{ name: "Pane", quantityText: "tanto" }, { name: "", quantityText: "2 pz" }],
      },
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.picks[lot.lotId]).toMatch(/restano solo/);
    expect(r.errors.free[0]).toBeTruthy();
    expect(r.errors.free[1]).toMatch(/come si chiama/);
  });

  it("si può salvare come pasto abituale con un nome", () => {
    const { events, lots } = stock();
    const r = buildMealEvents(
      {
        kind: "breakfast",
        picks: [{ lot: lotNamed(lots, "Latte"), choice: { kind: "text", text: "200 ml" } }],
        freeItems: [{ name: "Caffè", quantityText: "30 ml" }],
        saveHabitAs: "Solita colazione",
      },
      ctx(),
    );
    if (!r.ok) throw new Error("pasto");
    const diary = deriveDiary([...events, ...r.events]);
    expect(diary.habits).toHaveLength(1);
    expect(diary.habits[0]).toMatchObject({ title: "Solita colazione", kind: "breakfast", usualTime: "08:30" });
    expect(diary.habits[0].items.map((i) => i.name)).toEqual(["Latte", "Caffè"]);
  });

  it("annullare tutto il pasto toglie meal e consumi", () => {
    const { events, lots } = stock();
    const r = buildMealEvents(
      { kind: "dinner", picks: [{ lot: lotNamed(lots, "Latte"), choice: { kind: "all" } }], freeItems: [] },
      ctx("2026-11-16T19:00:00.000Z"),
    );
    if (!r.ok) throw new Error("pasto");
    const all = [...events, ...r.events];
    const undo = voidMeal(r.mealId, all, { deviceId: "d", now: () => "2026-11-16T19:01:00.000Z" });
    expect(undo).toHaveLength(2);
    const after = [...all, ...undo];
    expect(deriveDiary(after).days).toEqual([]);
    expect(derivePantry(after.filter((e) => e.type !== "meal")).lots.find((l) => l.productRef === "Latte")?.remaining).toBe(1000);
  });
});

describe("pasto abituale con alimento mancante", () => {
  const habit = {
    habitId: "h1",
    title: "Solita colazione",
    kind: "breakfast" as const,
    items: [
      { name: "Latte", quantity: { value: 200, unit: "ml" as const }, certainty: "measured" as const },
      { name: "Fette biscottate", quantity: { value: 4, unit: "pz" as const }, certainty: "measured" as const },
    ],
  };

  it("registra comunque: ciò che manca diventa voce libera stimata e lo dice", () => {
    const { lots } = stock();
    const r = buildMealFromHabit(habit, lots, ctx());
    expect(r.missing).toEqual(["Fette biscottate"]);
    expect(r.message).toMatch(/Fette biscottate non è più in dispensa/);
    expect(r.message).toMatch(/voce libera stimata/);
    const [meal, ...consumes] = r.events;
    expect(meal).toMatchObject({ type: "meal", habitId: "h1", source: "habit", items: [{ name: "Fette biscottate", certainty: "estimated", quantity: { value: 4, unit: "pz" } }] });
    expect(consumes).toHaveLength(1);
    expect(consumes[0]).toMatchObject({ type: "consume", mealId: r.mealId, quantity: { value: 200, unit: "ml" } });
  });

  it("se ne resta meno, prende ciò che c'è e il resto è voce libera", () => {
    const { lots } = stock();
    const small = lots.map((l) => (l.productRef === "Latte" ? { ...l, remaining: 150 } : l));
    const r = buildMealFromHabit(habit, small, ctx());
    expect(r.missing).toContain("Latte");
    expect(r.events[1]).toMatchObject({ quantity: { value: 150, unit: "ml" } });
    expect(r.events[0]).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ name: "Latte", quantity: { value: 50, unit: "ml" } })]) });
  });

  it("tutto presente: nessun avviso", () => {
    const { lots } = stock();
    const r = buildMealFromHabit({ ...habit, items: [habit.items[0]] }, lots, ctx());
    expect(r.missing).toEqual([]);
    expect(r.message).toBe("Registrato: Solita colazione.");
  });

  it("la proposta compare all'ora giusta e sparisce dopo averla registrata", () => {
    const { events, lots } = stock();
    const first = buildMealEvents(
      { kind: "breakfast", picks: [{ lot: lotNamed(lots, "Latte"), choice: { kind: "all" } }], freeItems: [], saveHabitAs: "Solita colazione" },
      ctx("2026-11-14T07:30:00.000Z"),
    );
    if (!first.ok) throw new Error("pasto");
    const base = [...events, ...first.events];
    expect(habitsToPropose(deriveDiary(base), "2026-11-16T07:30:00.000Z").map((h) => h.title)).toEqual(["Solita colazione"]);
    expect(habitsToPropose(deriveDiary(base), "2026-11-16T14:00:00.000Z")).toEqual([]);

    const h = deriveDiary(base).habits[0];
    const done = buildMealFromHabit(h, lots, ctx("2026-11-16T07:30:00.000Z"));
    expect(habitsToPropose(deriveDiary([...base, ...done.events]), "2026-11-16T07:40:00.000Z")).toEqual([]);
  });
});

describe("pasto non tracciato", () => {
  it("scrive untrackedMeal con il tipo dato", () => {
    const r = buildUntrackedMeal("lunch", ctx());
    expect(r.events[0]).toMatchObject({ type: "untrackedMeal", kind: "lunch" });
    expect(r.message).toMatch(/pranzo/);
  });
});

describe("summarizeDay", () => {
  const meal = (kind: "breakfast" | "lunch" | "dinner" | "snack", at = "2026-11-16T07:30:00.000Z") => {
    const r = buildMealEvents({ kind, picks: [], freeItems: [{ name: "Cosa", quantityText: "1 pz" }] }, ctx(at));
    if (!r.ok) throw new Error("pasto");
    return r.events;
  };
  const untracked = (kind: "breakfast" | "lunch" | "dinner" | "snack") => buildUntrackedMeal(kind, ctx()).events;
  const dayOf = (events: AnyEvent[]) => deriveDiary(events).days[0];

  it("niente: ancora niente registrato", () => {
    const s = summarizeDay(undefined);
    expect(s.status).toBe("gaps");
    expect(s.text).toBe("Ancora niente registrato oggi.");
  });

  it("colazione, pranzo e cena tracciati: completa", () => {
    const s = summarizeDay(dayOf([...meal("breakfast"), ...meal("lunch"), ...meal("dinner")]));
    expect(s.status).toBe("complete");
  });

  it("uno solo non tracciato: dichiarata", () => {
    const s = summarizeDay(dayOf([...meal("breakfast"), ...untracked("lunch"), ...meal("dinner")]));
    expect(s.status).toBe("declared");
    expect(s.text).toMatch(/pranzo è segnato come non tracciato/);
  });

  it("gli spuntini non contano per completare il giorno", () => {
    const s = summarizeDay(dayOf([...meal("breakfast"), ...meal("lunch"), ...meal("snack"), ...meal("snack")]));
    expect(s.status).toBe("gaps");
    expect(s.missing).toEqual(["dinner"]);
    expect(s.text).toMatch(/mancano cena/);
    expect(s.text).toMatch(/non vuol dire che hai saltato/);
  });

  it("più vuoti si elencano in italiano", () => {
    const s = summarizeDay(dayOf([...meal("snack")]));
    expect(s.text).toMatch(/mancano colazione, pranzo e cena/);
  });
});
