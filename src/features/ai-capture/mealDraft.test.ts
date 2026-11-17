import { describe, expect, it } from "vitest";
import { parseMealPhrase } from "@/core/ai/mealPhraseParse";
import { parsePlatePhoto } from "@/core/ai/platePhotoParse";
import { deriveDiary, mealsWithPantry, validateDiaryEvent } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { derivePantry, validateEvent, type Lot } from "@/core/ledger";
import { buildCaptureEvents } from "../capture";
import { evaluateLots } from "../lots";
import { buildDraftMealEvents, certaintyWord, newFreeRow, rowIssue, rowsFromPhrase, rowsFromPlate, type DraftRow } from "./mealDraft";
import { recentMealsFor, toPantryTarget } from "./pantryRefs";

const NOW = "2026-11-17T07:30:00.000Z"; // 08:30 a Roma
const ctx = { now: NOW, deviceId: "d" };

function add(name: string, quantityText: string, category: string, location: "frigo" | "dispensa") {
  const r = buildCaptureEvents(
    { name, quantityText, location, category, expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false },
    { now: "2026-11-15T10:00:00.000Z", deviceId: "d" },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

const events: AnyEvent[] = [
  ...add("Uova", "6 uova", "eggs", "frigo"),
  ...add("Pane casereccio", "400 g", "bread_fresh", "dispensa"),
  ...add("Latte intero", "1 l", "milk_fresh", "frigo"),
];
const pantry = derivePantry(events.filter((e) => e.type === "purchase"));
const target = toPantryTarget(evaluateLots(pantry.lots, NOW));
const lotsById = new Map(pantry.lots.map((l) => [l.lotId, l]));
const idOf = (name: string) => target.refs.find((r) => r.name === name)!.id;
const lotOf = (name: string): Lot => target.lotsById.get(idOf(name))!;

const phrase = (obj: unknown) => parseMealPhrase(JSON.stringify(obj), target.refs);

describe("toPantryTarget", () => {
  it("un id corto per ogni lotto, mai l'id vero, e la mappa per tornare indietro", () => {
    expect(target.refs).toHaveLength(3);
    expect(target.refs.map((r) => r.id)).toEqual(["A1", "A2", "A3"]);
    for (const ref of target.refs) {
      expect(ref.id).not.toBe(target.lotsById.get(ref.id)!.lotId);
      expect(target.idByLotId.get(target.lotsById.get(ref.id)!.lotId)).toBe(ref.id);
    }
  });
  it("rispetta il limite e dice quanti sono rimasti fuori", () => {
    const limited = toPantryTarget(evaluateLots(pantry.lots, NOW), 2);
    expect(limited.refs).toHaveLength(2);
    expect(limited.omitted).toBe(1);
  });
  it("lotti finiti non vengono mandati", () => {
    const finished = pantry.lots.map((l) => ({ ...l, status: "finished" as const, remaining: 0 }));
    expect(toPantryTarget(evaluateLots(finished, NOW)).refs).toEqual([]);
  });
});

describe("righe da una frase", () => {
  it("le voci di dispensa riferiscono il lotto vero, quelle libere no; sono incluse, con la quantità scritta", () => {
    const draft = phrase({ kind: "breakfast", items: [{ id: idOf("Uova"), quantity: 2, unit: "pz", confidence: 0.9 }, { id: idOf("Pane casereccio"), quantity: 30, unit: "g", confidence: 0.6 }], free: [{ name: "Caffè", quantity: 30, unit: "ml", confidence: 0.8 }] });
    const rows = rowsFromPhrase(draft, target);
    expect(rows.map((r) => [r.name, r.lotId === undefined ? "libera" : "lotto", r.amountText, r.include])).toEqual([
      ["Uova", "lotto", "2 pz", true],
      ["Pane casereccio", "lotto", "30 g", true],
      ["Caffè", "libera", "30 ml", true],
    ]);
    expect(rows[0].lotId).toBe(lotOf("Uova").lotId);
  });
  it("un id inventato non diventa mai una riga", () => {
    const rows = rowsFromPhrase(phrase({ items: [{ id: "A99", quantity: 2, unit: "pz" }, { id: "lot-1", quantity: 1 }], free: [] }), target);
    expect(rows).toEqual([]);
  });
});

describe("righe da una foto: regola della soglia", () => {
  const draft = parsePlatePhoto(
    JSON.stringify({
      items: [
        { name: "uova", id: idOf("Uova"), quantity: 2, unit: "pz", min: 1, max: 3, confidence: 0.9 },
        { name: "salsa", quantity: 30, unit: "ml", min: 10, max: 50, confidence: 0.4 },
      ],
    }),
    target.refs,
  );
  const rows = rowsFromPlate(draft, target);

  it("sotto soglia la riga è una domanda e parte non inclusa; sopra è inclusa", () => {
    expect(rows.map((r) => [r.question, r.include])).toEqual([[false, true], [true, false]]);
  });
  it("ogni quantità da foto porta il suo intervallo", () => {
    expect(rows[0].photo?.range).toEqual({ min: 1, max: 3, derived: false });
    expect(rows[1].photo?.range.min).toBeLessThanOrEqual(30);
  });
  it("una domanda non confermata non entra nel pasto", () => {
    const built = buildDraftMealEvents({ kind: "lunch", rows, lotsById, source: "photo" }, ctx);
    if (!built.ok) throw new Error(JSON.stringify(built));
    expect(built.events.filter((e) => e.type === "consume")).toHaveLength(1);
    const meal = built.events[0];
    expect(meal.type === "meal" && meal.items).toBeFalsy();
  });
  it("confermata dall'utente (inclusa) entra, come voce libera stimata", () => {
    const confirmed = rows.map((r) => (r.question ? { ...r, include: true } : r));
    const built = buildDraftMealEvents({ kind: "lunch", rows: confirmed, lotsById, source: "photo" }, ctx);
    if (!built.ok) throw new Error(JSON.stringify(built));
    const meal = built.events[0];
    expect(meal.type === "meal" && meal.items?.[0]).toMatchObject({ name: "salsa", quantity: { value: 30, unit: "ml" }, certainty: "estimated" });
  });
});

describe("buildDraftMealEvents: composizione degli eventi", () => {
  const rows: DraftRow[] = [
    { key: "a", lotId: lotOf("Uova").lotId, name: "Uova", amountText: "2 pz", include: true, confidence: 0.9, question: false },
    { key: "b", lotId: lotOf("Pane casereccio").lotId, name: "Pane casereccio", amountText: "30 g", include: true, confidence: 0.6, question: false },
    { key: "c", name: "Caffè", amountText: "30 ml", foodId: "caffe-espresso", include: true, confidence: 0.8, question: false },
  ];

  it("un meal e un consume per lotto, con lo stesso mealId, come i pasti normali", () => {
    const built = buildDraftMealEvents({ kind: "breakfast", rows, lotsById, source: "voice" }, ctx);
    if (!built.ok) throw new Error(JSON.stringify(built));
    const [meal, ...consumes] = built.events;
    expect(meal).toMatchObject({ type: "meal", kind: "breakfast", mealId: built.mealId, items: [{ name: "Caffè", foodId: "caffe-espresso" }] });
    expect(consumes).toHaveLength(2);
    expect(consumes.every((c) => c.type === "consume" && c.mealId === built.mealId)).toBe(true);
    expect(consumes[0]).toMatchObject({ lotId: lotOf("Uova").lotId, quantity: { value: 2, unit: "pz" } });
  });

  it("fonte voice o photo e certezza estimated su ogni evento, anche sui consumi che altrove sarebbero «measured»", () => {
    for (const source of ["voice", "photo"] as const) {
      const built = buildDraftMealEvents({ kind: "breakfast", rows, lotsById, source }, ctx);
      if (!built.ok) throw new Error(JSON.stringify(built));
      for (const e of built.events) {
        expect(e.source).toBe(source);
        expect(e.certainty).toBe("estimated");
        if (e.type === "consume") expect(validateEvent(e)).toEqual([]);
        if (e.type === "meal") expect(validateDiaryEvent(e)).toEqual([]);
      }
    }
  });

  it("i consumi scalano davvero la dispensa e il pasto si lega ai consumi", () => {
    const built = buildDraftMealEvents({ kind: "breakfast", rows, lotsById, source: "voice" }, ctx);
    if (!built.ok) throw new Error(JSON.stringify(built));
    const all = [...events, ...built.events];
    const linked = mealsWithPantry(deriveDiary(all), all);
    expect(linked).toHaveLength(1);
    expect(linked[0].pantryConsumes).toHaveLength(2);
    expect(derivePantry(all.filter((e) => e.type !== "meal")).lots.find((l) => l.productRef === "Uova")?.remaining).toBe(4);
  });

  it("le righe non incluse non scrivono niente", () => {
    const built = buildDraftMealEvents({ kind: "snack", rows: rows.map((r) => ({ ...r, include: r.key === "c" })), lotsById, source: "voice" }, ctx);
    if (!built.ok) throw new Error(JSON.stringify(built));
    expect(built.events).toHaveLength(1);
  });

  it("senza righe incluse: errore generale, nessun evento", () => {
    const built = buildDraftMealEvents({ kind: "snack", rows: rows.map((r) => ({ ...r, include: false })), lotsById, source: "voice" }, ctx);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.general).toMatch(/almeno un alimento/);
  });

  it("più di quanto resta, quantità illeggibile o mancante: errore sulla riga, nessun evento", () => {
    const bad = rows.map((r) => (r.key === "a" ? { ...r, amountText: "50 pz" } : r.key === "b" ? { ...r, amountText: "" } : { ...r, amountText: "tanto" }));
    const built = buildDraftMealEvents({ kind: "breakfast", rows: bad, lotsById, source: "voice" }, ctx);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(Object.keys(built.rowErrors).sort()).toEqual(["a", "b", "c"]);
  });

  it("un'unità diversa da quella del lotto è un errore sulla riga", () => {
    const wrongUnit = rows.map((r) => (r.key === "a" ? { ...r, amountText: "200 g" } : r));
    const built = buildDraftMealEvents({ kind: "breakfast", rows: wrongUnit, lotsById, source: "voice" }, ctx);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.rowErrors.a).toMatch(/pezzi|pz/i);
  });

  it("lo stesso lotto in due righe e un lotto sparito sono errori, non eventi", () => {
    const twice = [...rows, { ...rows[0], key: "d" }];
    const dup = buildDraftMealEvents({ kind: "breakfast", rows: twice, lotsById, source: "voice" }, ctx);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.rowErrors.d).toMatch(/due volte/);
    const gone = buildDraftMealEvents({ kind: "breakfast", rows: [{ ...rows[0], lotId: "lot-inesistente" }], lotsById, source: "voice" }, ctx);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.rowErrors.a).toMatch(/non è più/);
  });

  it("un id inventato dal modello non può far scrivere un evento su un lotto che non esiste", () => {
    const rowsFromBad = rowsFromPhrase(phrase({ items: [{ id: "A42", quantity: 2, unit: "pz" }], free: [] }), target);
    const built = buildDraftMealEvents({ kind: "snack", rows: rowsFromBad, lotsById, source: "voice" }, ctx);
    expect(built.ok).toBe(false);
  });

  it("voce libera senza nome ma con quantità: errore sulla riga", () => {
    const built = buildDraftMealEvents({ kind: "snack", rows: [{ ...newFreeRow(), amountText: "30 g" }], lotsById, source: "voice" }, ctx);
    expect(built.ok).toBe(false);
  });
});

describe("rowIssue", () => {
  const lot = lotOf("Pane casereccio");
  const base: DraftRow = { key: "x", lotId: lot.lotId, name: lot.productRef, amountText: "30 g", include: true, confidence: 1, question: false };
  it("segnala subito ciò che non va, senza scrivere", () => {
    expect(rowIssue(base, lotsById)).toBeUndefined();
    expect(rowIssue({ ...base, amountText: "" }, lotsById)).toBe("Scrivi quanto.");
    expect(rowIssue({ ...base, amountText: "5 kg" }, lotsById)).toMatch(/restano solo/);
    expect(rowIssue({ ...base, lotId: "boh" }, lotsById)).toMatch(/non è più/);
    expect(rowIssue({ ...newFreeRow(), name: "Tè", amountText: "200 ml" }, lotsById)).toBeUndefined();
    expect(rowIssue({ ...newFreeRow(), name: "Tè", amountText: "" }, lotsById)).toBeDefined();
  });
});

describe("pasti recenti per «come ieri»", () => {
  it("compatti, con id corto solo se il lotto è ancora in dispensa e nome anche se è finito", () => {
    const yesterday = "2026-11-16T12:00:00.000Z";
    const built = buildDraftMealEvents(
      {
        kind: "lunch",
        rows: [
          { key: "a", lotId: lotOf("Pane casereccio").lotId, name: "Pane", amountText: "50 g", include: true, confidence: 1, question: false },
          { key: "b", name: "Insalata", amountText: "100 g", include: true, confidence: 1, question: false },
        ],
        lotsById,
        source: "voice",
      },
      { now: yesterday, deviceId: "d" },
    );
    if (!built.ok) throw new Error(JSON.stringify(built));
    const all = [...events, ...built.events];
    const meals = mealsWithPantry(deriveDiary(all), all);
    const recent = recentMealsFor(meals, pantry.lots, target, "2026-11-17");
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ date: "2026-11-16", kind: "lunch" });
    expect(recent[0].items).toEqual([
      { name: "Pane casereccio", quantity: { value: 50, unit: "g" }, pantryId: idOf("Pane casereccio") },
      { name: "Insalata", quantity: { value: 100, unit: "g" } },
    ]);
    expect(recentMealsFor(meals, pantry.lots, { idByLotId: new Map() }, "2026-11-17")[0].items[0].pantryId).toBeUndefined();
    expect(recentMealsFor(meals, pantry.lots, target, "2026-12-30")).toEqual([]);
  });
});

describe("certaintyWord", () => {
  it("parole e percentuale", () => {
    expect(certaintyWord(0.9)).toBe("alta (90%)");
    expect(certaintyWord(0.55)).toBe("media (55%)");
    expect(certaintyWord(0.2)).toBe("bassa (20%)");
  });
});
