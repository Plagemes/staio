import { describe, expect, it } from "vitest";
import { deriveDiary, mealsWithPantry, voidMeal, type MealEvent, type MealWithPantry } from "@/core/diary";
import { consume, purchase, voidOf } from "@/core/diary/test-helpers";
import { validateAnyEvent, type AnyEvent } from "@/core/events";
import { derivePantry, type ConsumeEvent, type Lot } from "@/core/ledger";
import { buildAppendToMeal, buildRepeatMeal } from "./mealEdit";
import { buildMealEvents, type MealContext } from "./meals";

const YESTERDAY = "2026-11-15T12:00:00.000Z"; // 13:00 a Roma
const NOW = "2026-11-16T12:10:00.000Z";
const BOUGHT = "2026-11-10T09:00:00.000Z";
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const ctx = (now = NOW): MealContext => ({ now, deviceId: "d", idGenerator: () => `id-${++n}` });

// La confezione che scade dopo è stata comprata per prima: l'ordine di scadenza non è quello di acquisto.
const stock: AnyEvent[] = [
  purchase("p-late", BOUGHT, { lotId: "pasta-late", productRef: "Pasta", quantity: q(500), location: "dispensa", expiry: { date: "2027-03-01", kind: "best_before" } }),
  purchase("p-soon", "2026-11-11T09:00:00.000Z", { lotId: "pasta-soon", productRef: "Pasta", quantity: q(500), location: "dispensa", expiry: { date: "2026-12-01", kind: "best_before" } }),
  purchase("p-ins", BOUGHT, { lotId: "insalata", productRef: "Insalata", quantity: q(200), location: "frigo", expiry: { date: "2026-11-18", kind: "use_by" } }),
];

/** Gli alimenti che ci sono, da mangiare per primi quelli che scadono prima. */
function lotsOf(log: readonly AnyEvent[]): Lot[] {
  return derivePantry(log)
    .lots.filter((l) => l.remaining > 0)
    .sort((a, b) => (a.expiry?.date ?? "9999").localeCompare(b.expiry?.date ?? "9999"));
}
const lotNamed = (log: readonly AnyEvent[], lotId: string) => derivePantry(log).lots.find((l) => l.lotId === lotId) as Lot;
const remaining = (log: readonly AnyEvent[], lotId: string) => lotNamed(log, lotId).remaining;
const namesOf = (log: readonly AnyEvent[]) => new Map(derivePantry(log).lots.map((l) => [l.lotId, l.productRef]));
const mealsOf = (log: readonly AnyEvent[]) => mealsWithPantry(deriveDiary(log), log);
const valid = (events: readonly AnyEvent[]) => events.every((e) => validateAnyEvent(e).length === 0);

/** La cena di ieri: 80 g di pasta dalla dispensa e una pizza scritta a mano. */
function withDinner(): { log: AnyEvent[]; mealId: string } {
  const r = buildMealEvents(
    { kind: "dinner", picks: [{ lot: lotNamed(stock, "pasta-soon"), choice: { kind: "text", text: "80 g" } }], freeItems: [{ name: "Pizza", quantityText: "1 pz" }] },
    ctx(YESTERDAY),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { log: [...stock, ...r.events], mealId: r.mealId };
}

describe("buildAppendToMeal", () => {
  it("15. un alimento della dispensa e una voce libera: un consumo con il mealId del pasto, un void e il pasto nuovo con la voce in più", () => {
    const { log, mealId } = withDinner();
    const r = buildAppendToMeal(
      {
        mealId,
        picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "text", text: "50 g" } }],
        freeItems: [{ name: "Pane", quantityText: "40 g" }],
        log,
      },
      ctx(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.events.map((e) => e.type)).toEqual(["void", "meal", "consume"]);
    expect(r.mealId).toBe(mealId);
    expect(r.message).toBe("Aggiunto a cena: Insalata, Pane.");
    const added = r.events[2] as ConsumeEvent;
    expect(added).toMatchObject({ lotId: "insalata", quantity: q(50), mealId, at: NOW });
    expect((r.events[1] as MealEvent).mealId).toBe(mealId);
    expect(valid(r.events)).toBe(true);
    expect(new Set(r.events.map((e) => e.recordedAt))).toEqual(new Set([NOW]));
    expect(new Set(r.events.map((e) => e.deviceId))).toEqual(new Set(["d"]));

    const all = [...log, ...r.events];
    const meals = mealsOf(all);
    expect(meals).toHaveLength(1);
    expect(meals[0].date).toBe("2026-11-15");
    expect(meals[0].at).toBe(YESTERDAY);
    expect(meals[0].items.map((i) => [i.name, i.quantity.value, i.certainty])).toEqual([["Pizza", 1, "estimated"], ["Pane", 40, "estimated"]]);
    expect(meals[0].pantryConsumes.map((c) => [c.lotId, c.quantity.value])).toEqual([["pasta-soon", 80], ["insalata", 50]]);
    expect(remaining(all, "insalata")).toBe(150);
    expect(remaining(all, "pasta-soon")).toBe(420);
    expect(deriveDiary(all).anomalies).toEqual([]);
  });

  it("solo un alimento della dispensa: basta il consumo, il pasto non si riscrive", () => {
    const { log, mealId } = withDinner();
    const r = buildAppendToMeal({ mealId, picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "all" } }], freeItems: [], log }, ctx());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.events.map((e) => e.type)).toEqual(["consume"]);
    expect(r.message).toBe("Aggiunto a cena: Insalata.");
    const all = [...log, ...r.events];
    expect(mealsOf(all)[0].pantryConsumes).toHaveLength(2);
    expect(remaining(all, "insalata")).toBe(0);
  });

  it("un alimento stimato aggiunto a un pasto misurato lo rende stimato, come in un pasto nuovo; uno misurato no", () => {
    const measured = buildMealEvents(
      { kind: "dinner", picks: [{ lot: lotNamed(stock, "pasta-soon"), choice: { kind: "text", text: "80 g" } }], freeItems: [] },
      ctx(YESTERDAY),
    );
    if (!measured.ok) throw new Error("atteso ok");
    const log = [...stock, ...measured.events];
    expect(mealsOf(log)[0].certainty).toBe("measured");

    const exact = buildAppendToMeal({ mealId: measured.mealId, picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "text", text: "50 g" } }], freeItems: [], log }, ctx());
    if (!exact.ok) throw new Error("atteso ok");
    expect(exact.events.map((e) => e.type)).toEqual(["consume"]);
    expect(mealsOf([...log, ...exact.events])[0].certainty).toBe("measured");

    const rough = buildAppendToMeal({ mealId: measured.mealId, picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "half" } }], freeItems: [], log }, ctx());
    if (!rough.ok) throw new Error("atteso ok");
    expect(rough.events.map((e) => e.type)).toEqual(["void", "meal", "consume"]);
    expect(valid(rough.events)).toBe(true);
    expect(new Set(rough.events.map((e) => e.recordedAt))).toEqual(new Set([NOW]));
    const after = mealsOf([...log, ...rough.events]);
    expect(after).toHaveLength(1);
    expect(after[0].certainty).toBe("estimated");
    expect(after[0].pantryConsumes.map((c) => [c.lotId, c.certainty])).toEqual([["pasta-soon", "measured"], ["insalata", "estimated"]]);
    expect(deriveDiary([...log, ...rough.events]).anomalies).toEqual([]);
  });

  it("solo voci libere, due volte di fila: la seconda parte dal pasto già riscritto", () => {
    const { log, mealId } = withDinner();
    const first = buildAppendToMeal({ mealId, picks: [], freeItems: [{ name: "Pane", quantityText: "40 g" }], log }, ctx());
    if (!first.ok) throw new Error("atteso ok");
    expect(first.events.map((e) => e.type)).toEqual(["void", "meal"]);
    const log1 = [...log, ...first.events];
    const second = buildAppendToMeal(
      { mealId, picks: [], freeItems: [{ name: "", quantityText: "" }, { name: "Mela", quantityText: "1" }], log: log1 },
      ctx("2026-11-16T12:11:00.000Z"),
    );
    if (!second.ok) throw new Error("atteso ok");
    const meals = mealsOf([...log1, ...second.events]);
    expect(meals).toHaveLength(1);
    expect(meals[0].items.map((i) => i.name)).toEqual(["Pizza", "Pane", "Mela"]);
    expect(meals[0].pantryConsumes).toHaveLength(1);
  });

  it("il testo elenca i primi tre e conta gli altri", () => {
    const { log, mealId } = withDinner();
    const r = buildAppendToMeal(
      { mealId, picks: [], freeItems: ["Pane", "Mela", "Noci", "Uva", "Kiwi"].map((name) => ({ name, quantityText: "1 pz" })), log },
      ctx(),
    );
    expect(r.ok && r.message).toBe("Aggiunto a cena: Pane, Mela, Noci e altri 2.");
  });

  it("il pasto non c'è più: errore generale, niente da scrivere", () => {
    const { log, mealId } = withDinner();
    const gone = [...log, ...voidMeal(mealId, log, { deviceId: "d", now: () => NOW })];
    const args = { picks: [], freeItems: [{ name: "Pane", quantityText: "40 g" }] };
    expect(buildAppendToMeal({ ...args, mealId, log: gone }, ctx())).toEqual({
      ok: false,
      errors: { picks: {}, free: {}, general: "Questo pasto non c'è più." },
    });
    expect(buildAppendToMeal({ ...args, mealId: "mai-visto", log }, ctx())).toMatchObject({ ok: false, errors: { general: "Questo pasto non c'è più." } });
  });

  it("niente scelto: errore generale", () => {
    const { log, mealId } = withDinner();
    for (const freeItems of [[], [{ name: " ", quantityText: "" }]]) {
      expect(buildAppendToMeal({ mealId, picks: [], freeItems, log }, ctx())).toEqual({
        ok: false,
        errors: { picks: {}, free: {}, general: "Scegli almeno un alimento." },
      });
    }
  });

  it("gli errori sono per alimento e per voce libera, come in un pasto nuovo, e non si scrive niente", () => {
    const { log, mealId } = withDinner();
    const r = buildAppendToMeal(
      {
        mealId,
        picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "text", text: "3 kg" } }],
        freeItems: [{ name: "Pane", quantityText: "tanto" }, { name: "", quantityText: "2 pz" }],
        log,
      },
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.picks.insalata).toMatch(/restano solo/);
    expect(r.errors.free[0]).toBeTruthy();
    expect(r.errors.free[1]).toMatch(/come si chiama/);
    expect(r.errors.general).toBeUndefined();
  });

  it("«Annulla» di tutti gli eventi riporta pasto e dispensa com'erano", () => {
    const { log, mealId } = withDinner();
    const r = buildAppendToMeal(
      { mealId, picks: [{ lot: lotNamed(log, "insalata"), choice: { kind: "text", text: "50 g" } }], freeItems: [{ name: "Pane", quantityText: "40 g" }], log },
      ctx(),
    );
    if (!r.ok) throw new Error("atteso ok");
    const all = [...log, ...r.events, ...r.events.map((e, i) => voidOf(`undo-${i}`, "2026-11-16T12:11:00.000Z", e.id))];
    // `removedLines` conta anche il consumo aggiunto e poi annullato (regola di `deriveDiary`): il resto è identico
    expect(mealsOf(all).map((m) => ({ ...m, removedLines: undefined }))).toEqual(mealsOf(log).map((m) => ({ ...m, removedLines: undefined })));
    expect(remaining(all, "insalata")).toBe(200);
  });
});

describe("buildRepeatMeal", () => {
  /** Il pranzo di ieri: 80 g di pasta dalla dispensa e il pane scritto a mano. */
  function withLunch(): { log: AnyEvent[]; meal: MealWithPantry } {
    const r = buildMealEvents(
      { kind: "lunch", title: "Pasta al sugo", picks: [{ lot: lotNamed(stock, "pasta-soon"), choice: { kind: "text", text: "80 g" } }], freeItems: [{ name: "Pane", quantityText: "50 g" }] },
      ctx(YESTERDAY),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const log = [...stock, ...r.events];
    return { log, meal: mealsOf(log)[0] };
  }
  const repeat = (log: AnyEvent[], meal: MealWithPantry, kind?: "dinner") =>
    buildRepeatMeal({ meal, names: namesOf(log), lots: lotsOf(log), ...(kind ? { kind } : {}) }, ctx());

  it("16. con la pasta in casa: un consumo di 80 g dal lotto che scade prima, il pane copiato", () => {
    const { log, meal } = withLunch();
    const r = repeat(log, meal);
    expect(r.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    expect(r.missing).toEqual([]);
    expect(r.message).toBe("Registrato: pranzo come l'ultima volta (Pasta, Pane).");
    const [event, eaten] = r.events as [MealEvent, ConsumeEvent];
    expect(eaten).toMatchObject({ lotId: "pasta-soon", quantity: q(80), mealId: r.mealId, at: NOW, source: "manual" });
    // ripetere è supporre le stesse quantità: il consumo di ieri era misurato, quello ripetuto è una stima
    expect(meal.pantryConsumes[0].certainty).toBe("measured");
    expect([eaten.certainty, event.certainty]).toEqual(["estimated", "estimated"]);
    expect(event).toMatchObject({ kind: "lunch", title: "Pasta al sugo", at: NOW, source: "manual", items: [{ name: "Pane", quantity: q(50), certainty: "estimated" }] });
    expect(event.habitId).toBeUndefined();
    expect(r.mealId).toBe(event.mealId);
    expect(r.mealId).not.toBe(meal.mealId);
    expect(valid(r.events)).toBe(true);

    const all = [...log, ...r.events];
    const meals = mealsOf(all);
    expect(meals.map((m) => [m.date, m.kind])).toEqual([["2026-11-15", "lunch"], ["2026-11-16", "lunch"]]);
    expect(meals[1].pantryConsumes).toHaveLength(1);
    expect(remaining(all, "pasta-soon")).toBe(500 - 80 - 80);
    expect(remaining(all, "pasta-late")).toBe(500);
    expect(deriveDiary(all).anomalies).toEqual([]);
    expect(deriveDiary(all).habits).toEqual([]);
  });

  it("16. con la pasta finita: una voce libera stimata, e `missing` la nomina; il pane non manca, è solo copiato", () => {
    const { log, meal } = withLunch();
    const finished = [
      ...log,
      consume("x1", "2026-11-16T08:00:00.000Z", { lotId: "pasta-soon", quantity: q(420) }),
      consume("x2", "2026-11-16T08:00:00.000Z", { lotId: "pasta-late", quantity: q(500) }),
    ];
    const r = repeat(finished, meal);
    expect(r.events.map((e) => e.type)).toEqual(["meal"]);
    expect(r.missing).toEqual(["Pasta"]);
    expect(r.message).toBe("Registrato: pranzo come l'ultima volta (Pasta, Pane). Non ho trovato in dispensa: Pasta. L'ho segnato come stima.");
    expect((r.events[0] as MealEvent).items).toEqual([
      { name: "Pasta", quantity: q(80), certainty: "estimated" },
      { name: "Pane", quantity: q(50), certainty: "estimated" },
    ]);
    expect(r.events[0].certainty).toBe("estimated");
    expect(valid(r.events)).toBe(true);
  });

  it("17. l'alimento è diviso in due confezioni: 50 g dalla prima e 30 g dalla seconda", () => {
    const { log, meal } = withLunch();
    const low = [...log, consume("x1", "2026-11-16T08:00:00.000Z", { lotId: "pasta-soon", quantity: q(370) })];
    expect(remaining(low, "pasta-soon")).toBe(50);
    const r = repeat(low, meal);
    expect(r.missing).toEqual([]);
    const eaten = r.events.filter((e): e is ConsumeEvent => e.type === "consume");
    expect(eaten.map((c) => [c.lotId, c.quantity.value, c.mealId])).toEqual([["pasta-soon", 50, r.mealId], ["pasta-late", 30, r.mealId]]);
    const all = [...low, ...r.events];
    expect(remaining(all, "pasta-soon")).toBe(0);
    expect(remaining(all, "pasta-late")).toBe(470);
    expect(derivePantry(all).anomalies).toEqual([]);
  });

  it("sceglie da sé la confezione che scade prima, in qualunque ordine arrivino gli alimenti", () => {
    const { log, meal } = withLunch();
    const byPurchase = derivePantry(log).lots;
    expect(byPurchase.map((l) => l.lotId).indexOf("pasta-late")).toBeLessThan(byPurchase.map((l) => l.lotId).indexOf("pasta-soon"));
    for (const lots of [byPurchase, [...byPurchase].reverse()]) {
      const r = buildRepeatMeal({ meal, names: namesOf(log), lots }, ctx());
      expect(r.events.filter((e): e is ConsumeEvent => e.type === "consume").map((c) => [c.lotId, c.quantity.value])).toEqual([["pasta-soon", 80]]);
    }
  });

  it("un alimento di cui non si trova più il nome: lo dice tra le voci mancanti e lo segna come stima, senza perderlo", () => {
    const { log, meal } = withLunch();
    const r = buildRepeatMeal({ meal, names: new Map(), lots: [] }, ctx());
    expect(r.missing).toEqual(["Alimento senza nome"]);
    expect((r.events[0] as MealEvent).items).toEqual([
      { name: "Alimento senza nome", quantity: q(80), certainty: "estimated" },
      { name: "Pane", quantity: q(50), certainty: "estimated" },
    ]);
    expect(r.message).toBe("Registrato: pranzo come l'ultima volta (Alimento senza nome, Pane). Non ho trovato in dispensa: Alimento senza nome. L'ho segnato come stima.");
    expect(valid(r.events)).toBe(true);
    // se il nome manca nell'elenco ma l'alimento è ancora tra quelli passati, si prende da lì
    const known = buildRepeatMeal({ meal, names: new Map(), lots: derivePantry(log).lots }, ctx());
    expect(known.missing).toEqual([]);
    expect(known.events.map((e) => e.type)).toEqual(["meal", "consume"]);
  });

  it("ne resta meno di quanto serve: prende ciò che c'è, il resto è una stima", () => {
    const { log, meal } = withLunch();
    const low = [
      ...log,
      consume("x1", "2026-11-16T08:00:00.000Z", { lotId: "pasta-soon", quantity: q(370) }),
      consume("x2", "2026-11-16T08:00:00.000Z", { lotId: "pasta-late", quantity: q(490) }),
    ];
    const r = repeat(low, meal);
    expect(r.events.filter((e) => e.type === "consume").map((c) => (c as ConsumeEvent).quantity.value)).toEqual([50, 10]);
    expect((r.events[0] as MealEvent).items?.[0]).toEqual({ name: "Pasta", quantity: q(20), certainty: "estimated" });
    expect(r.missing).toEqual(["Pasta"]);
  });

  it("un pasto che allora prese da due confezioni si ripete come una voce sola", () => {
    const { log, meal } = withLunch();
    const split: MealWithPantry = {
      ...meal,
      pantryConsumes: [
        { ...meal.pantryConsumes[0], quantity: q(50) },
        { ...meal.pantryConsumes[0], id: "altro", lotId: "pasta-late", quantity: q(30) },
      ],
    };
    const r = buildRepeatMeal({ meal: split, names: namesOf(log), lots: [] }, ctx());
    expect((r.events[0] as MealEvent).items?.[0]).toEqual({ name: "Pasta", quantity: q(80), certainty: "estimated" });
    expect(r.missing).toEqual(["Pasta"]);
  });

  it("in un altro momento: il pasto nuovo è di quel momento, e il testo lo dice", () => {
    const { log, meal } = withLunch();
    const r = repeat(log, meal, "dinner");
    expect(r.events[0]).toMatchObject({ type: "meal", kind: "dinner" });
    expect(r.message).toBe("Registrato: cena come l'ultima volta (Pasta, Pane).");
  });

  it("più cose mancanti: il testo va al plurale", () => {
    const { log, meal } = withLunch();
    const two: MealWithPantry = { ...meal, pantryConsumes: [...meal.pantryConsumes, { ...meal.pantryConsumes[0], id: "altro", lotId: "insalata", quantity: q(60) }] };
    const r = buildRepeatMeal({ meal: two, names: namesOf(log), lots: [] }, ctx());
    expect(r.missing).toEqual(["Pasta", "Insalata"]);
    expect(r.message).toBe("Registrato: pranzo come l'ultima volta (Pasta, Insalata, Pane). Non ho trovato in dispensa: Pasta, Insalata. Li ho segnati come stima.");
  });

  it("senza titolo non ne inventa uno", () => {
    const { log, meal } = withLunch();
    const { title: _title, ...untitled } = meal;
    void _title;
    const r = repeat(log, untitled);
    expect((r.events[0] as MealEvent).title).toBeUndefined();
  });

  it("niente da ripetere: nessun evento", () => {
    const { log, meal } = withLunch();
    const empty: MealWithPantry = { ...meal, items: [], pantryConsumes: [] };
    expect(buildRepeatMeal({ meal: empty, names: namesOf(log), lots: lotsOf(log) }, ctx())).toEqual({
      events: [],
      mealId: "",
      missing: [],
      message: "Non c'è niente da ripetere.",
    });
  });
});
