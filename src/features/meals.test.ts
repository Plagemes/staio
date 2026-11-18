import { describe, expect, it } from "vitest";
import { deriveDiary, habitsToPropose, mealsWithPantry, voidMeal } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { validateAnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { OUT_OF_HOME_MIN_MEALS, estimateOutOfHome } from "@/core/nutrition";
import { buildCaptureEvents } from "./capture";
import { buildRepeatMeal } from "./mealEdit";
import {
  buildMealEvents,
  buildMealFromHabit,
  buildOutOfHomeMeal,
  buildUntrackedMeal,
  isOutOfHomeItem,
  outOfHomeBasisText,
  outOfHomeChoices,
  outOfHomeHint,
  outOfHomeName,
  outOfHomeSizeOf,
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

describe("pasto fuori casa", () => {
  const generic = (size: "light" | "normal" | "large", kind: "breakfast" | "lunch" | "dinner" | "snack" = "lunch") => estimateOutOfHome(kind, size, []);
  const personal = [600, 650, 700, 700, 750, 800];

  it("scrive un solo evento meal valido, con una voce stimata che porta la sola energia", () => {
    const built = buildOutOfHomeMeal({ kind: "lunch", size: "normal", estimate: generic("normal") }, ctx());
    expect(built.events).toHaveLength(1);
    const [event] = built.events;
    expect(validateAnyEvent(event)).toEqual([]);
    expect(event).toMatchObject({ type: "meal", kind: "lunch", certainty: "estimated", source: "manual", at: NOW, recordedAt: NOW, mealId: built.mealId });
    expect(event.type === "meal" && event.items).toEqual([
      { name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: 800 },
    ]);
  });

  it("il testo dice il momento, la taglia e che è una stima", () => {
    expect(buildOutOfHomeMeal({ kind: "lunch", size: "normal", estimate: generic("normal") }, ctx()).message).toBe(
      "Registrato: pranzo fuori casa, normale (~800 kcal, stima).",
    );
    expect(buildOutOfHomeMeal({ kind: "dinner", size: "large", estimate: estimateOutOfHome("dinner", "large", personal) }, ctx()).message).toBe(
      "Registrato: cena fuori casa, abbondante (~1050 kcal, stima).",
    );
    expect(buildOutOfHomeMeal({ kind: "snack", size: "light", estimate: generic("light", "snack") }, ctx()).message).toBe(
      "Registrato: spuntino fuori casa, leggero (~120 kcal, stima).",
    );
  });

  it("6. giorno passato: il pasto va in quel giorno all'ora indicata, e resta registrato adesso", () => {
    const mealAt = "2026-11-14T12:00:00.000Z"; // le 13:00 di due giorni prima, a Roma
    const built = buildOutOfHomeMeal({ kind: "lunch", size: "normal", estimate: generic("normal") }, { ...ctx(), mealAt });
    expect(built.events[0]).toMatchObject({ at: mealAt, recordedAt: NOW });
    const diary = deriveDiary(built.events);
    expect(diary.days.map((d) => d.date)).toEqual(["2026-11-14"]);
    expect(diary.days[0].meals[0]).toMatchObject({ kind: "lunch", certainty: "estimated" });
  });

  it("entra nel diario come un pasto registrato: il momento non è più un vuoto", () => {
    const built = buildOutOfHomeMeal({ kind: "lunch", size: "light", estimate: generic("light") }, ctx());
    const s = summarizeDay(deriveDiary(built.events).days[0]);
    expect(s.tracked).toEqual(["lunch"]);
    expect(s.untracked).toEqual([]);
  });

  it("le tre voci di «Altro», dalla più piccola, con la stima e da dove viene", () => {
    expect(outOfHomeChoices("lunch", []).map((c) => [c.id, c.label, c.hint])).toEqual([
      ["out-light", "Fuori casa · leggero", "~480 kcal, stima generica"],
      ["out-normal", "Fuori casa · normale", "~800 kcal, stima generica"],
      ["out-large", "Fuori casa · abbondante", "~1200 kcal, stima generica"],
    ]);
    expect(outOfHomeChoices("lunch", personal).map((c) => c.hint)).toEqual([
      "~420 kcal, stima dai tuoi pranzi",
      "~700 kcal, stima dai tuoi pranzi",
      "~1050 kcal, stima dai tuoi pranzi",
    ]);
    expect(outOfHomeHint("breakfast", estimateOutOfHome("breakfast", "normal", personal))).toBe("~700 kcal, stima dalle tue colazioni");
    expect(outOfHomeHint("dinner", estimateOutOfHome("dinner", "normal", personal))).toBe("~700 kcal, stima dalle tue cene");
    // spuntini da 150 a 250 kcal: la stima viene dai tuoi, ed è il loro valore di mezzo
    expect(outOfHomeHint("snack", estimateOutOfHome("snack", "normal", [150, 180, 200, 220, 250]))).toBe("~200 kcal, stima dai tuoi spuntini");
    // «spuntini» da 600–800 kcal: resta una stima dai tuoi, ma non oltre il doppio dei 200 kcal di riferimento
    expect(estimateOutOfHome("snack", "normal", personal)).toEqual({ energyKcal: 400, basis: "personal", meals: 6 });
    expect(outOfHomeHint("snack", estimateOutOfHome("snack", "normal", personal))).toBe("~400 kcal, stima dai tuoi spuntini");
    // e pranzi da 210 kcal non scendono sotto la metà degli 800 di riferimento
    expect(outOfHomeHint("lunch", estimateOutOfHome("lunch", "normal", [210, 210, 210, 210, 210]))).toBe("~400 kcal, stima dai tuoi pranzi");
    for (const choice of outOfHomeChoices("dinner", personal)) expect(choice.estimate).toEqual(estimateOutOfHome("dinner", choice.size, personal));
  });

  it("la riga che spiega la stima dice solo il conto", () => {
    expect(outOfHomeBasisText("lunch", "large", estimateOutOfHome("lunch", "large", personal))).toBe(
      "È una stima dai tuoi pranzi registrati, moltiplicata per 1,5.",
    );
    expect(outOfHomeBasisText("lunch", "light", estimateOutOfHome("lunch", "light", personal))).toBe(
      "È una stima dai tuoi pranzi registrati, moltiplicata per 0,6.",
    );
    expect(outOfHomeBasisText("dinner", "normal", estimateOutOfHome("dinner", "normal", personal))).toBe(
      "È una stima dalle tue cene registrate.",
    );
    expect(outOfHomeBasisText("lunch", "normal", generic("normal"))).toBe(
      "È una stima generica: una parte di 2000 kcal al giorno. Con cinque pranzi registrati userò i tuoi.",
    );
    expect(outOfHomeBasisText("breakfast", "large", generic("large", "breakfast"))).toBe(
      "È una stima generica: una parte di 2000 kcal al giorno. Con cinque colazioni registrate userò le tue.",
    );
    expect(outOfHomeBasisText("breakfast", "normal", estimateOutOfHome("breakfast", "normal", personal))).toBe("È una stima dalle tue colazioni registrate.");
    expect(outOfHomeBasisText("snack", "large", estimateOutOfHome("snack", "large", personal))).toBe("È una stima dai tuoi spuntini registrati, moltiplicata per 1,5.");
    // la parola «media» non c'è più: il valore personale è quello di mezzo, entro limiti
    for (const kind of ["breakfast", "lunch", "dinner", "snack"] as const) {
      for (const c of outOfHomeChoices(kind, personal)) expect(`${c.hint} ${outOfHomeBasisText(kind, c.size, c.estimate)}`).not.toMatch(/media/i);
    }
    expect(OUT_OF_HOME_MIN_MEALS).toBe(5);
  });

  it("nessun testo dà un giudizio", () => {
    const texts = (["breakfast", "lunch", "dinner", "snack"] as const).flatMap((kind) =>
      [[], personal].flatMap((history) =>
        outOfHomeChoices(kind, history).flatMap((c) => [
          c.label,
          c.hint,
          outOfHomeBasisText(kind, c.size, c.estimate),
          buildOutOfHomeMeal({ kind, size: c.size, estimate: c.estimate }, ctx()).message,
        ]),
      ),
    );
    for (const text of texts) expect(text).not.toMatch(/tropp|poco|dovrest|meglio|consigli/i);
  });

  it("la taglia si rilegge dal nome della voce", () => {
    expect(outOfHomeSizeOf(outOfHomeName("light"))).toBe("light");
    expect(outOfHomeSizeOf("Fuori casa · normale")).toBe("normal");
    expect(outOfHomeSizeOf("fuori casa ·  ABBONDANTE ")).toBe("large");
    expect(outOfHomeSizeOf("Pizza")).toBeUndefined();
    expect(isOutOfHomeItem({ energyKcal: 800 })).toBe(true);
    expect(isOutOfHomeItem({})).toBe(false);
  });

  it("14. «Come ieri» o «Ripeti adesso» copiano la voce con la sua energia, come stima", () => {
    const yesterday = buildOutOfHomeMeal(
      { kind: "lunch", size: "large", estimate: estimateOutOfHome("lunch", "large", personal) },
      { now: "2026-11-15T12:00:00.000Z", deviceId: "d" },
    );
    const source = mealsWithPantry(deriveDiary(yesterday.events), yesterday.events)[0];
    const repeated = buildRepeatMeal({ meal: source, names: new Map(), lots: [] }, ctx());
    expect(repeated.events).toHaveLength(1);
    const [event] = repeated.events;
    expect(validateAnyEvent(event)).toEqual([]);
    expect(event).toMatchObject({ type: "meal", kind: "lunch", certainty: "estimated", at: NOW });
    expect(event.type === "meal" && event.items).toEqual([
      { name: "Fuori casa · abbondante", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: 1050 },
    ]);
    expect(repeated.mealId).not.toBe(yesterday.mealId);
  });
});
