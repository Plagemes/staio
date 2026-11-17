import { describe, expect, it } from "vitest";
import { deriveDiary, getDay, mealsWithPantry } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { derivePantry, activeLots, type Lot } from "@/core/ledger";
import { buildCaptureEvents } from "./capture";
import { evaluateLots } from "./lots";
import { TYPICAL_MEAL_TIME, amountChoiceOf, buildMealEvents, buildMealFromHabit } from "./meals";
import { pieceChoices } from "./pieces";

const NOW = "2026-11-17T12:30:00.000Z";

function stock(over: Record<string, unknown> = {}, now = "2026-11-17T08:00:00.000Z") {
  const r = buildCaptureEvents(
    {
      name: "Piadina",
      quantityText: "200 g",
      location: "dispensa",
      category: "bread_packaged",
      expiryKind: "none",
      expiryDate: "",
      priceText: "",
      alreadyHave: false,
      pieces: { count: 2, each: 100, name: "piadina" },
      ...over,
    },
    { now, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  return r.events as AnyEvent[];
}

const lotsOf = (events: AnyEvent[]): Lot[] => derivePantry(events.filter((e) => e.type === "purchase" || e.type === "declare" || e.type === "consume")).lots;

describe("pezzi nella registrazione del pasto", () => {
  const events = stock();
  const [lot] = lotsOf(events);

  it("le scelte per pezzi diventano la quantità del consumo", () => {
    const choice = amountChoiceOf("piece:pieces-1", "", lot);
    expect(choice).toEqual({ kind: "value", value: 100, estimated: false });
    const r = buildMealEvents({ kind: "lunch", picks: [{ lot, choice }], freeItems: [] }, { now: NOW, deviceId: "d" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const consume = r.events.find((e) => e.type === "consume");
    expect(consume).toMatchObject({ quantity: { value: 100, unit: "g" }, certainty: "measured", lotId: lot.lotId });
  });

  it("due pezzi sono tutta la confezione; mezzo pezzo resta una stima", () => {
    const two = amountChoiceOf("piece:pieces-2", "", lot);
    expect(two).toMatchObject({ kind: "value", value: 200 });
    const half = amountChoiceOf("piece:pieces-half", "", lot);
    expect(half).toEqual({ kind: "value", value: 50, estimated: true });
    const r = buildMealEvents({ kind: "lunch", picks: [{ lot, choice: half }], freeItems: [] }, { now: NOW, deviceId: "d" });
    if (!r.ok) throw new Error("ko");
    expect(r.events.find((e) => e.type === "consume")).toMatchObject({ quantity: { value: 50, unit: "g" }, certainty: "estimated" });
    // il pasto porta la certezza peggiore
    expect(r.events.find((e) => e.type === "meal")).toMatchObject({ certainty: "estimated" });
  });

  it("le scelte sono quelle di pieceChoices e non superano ciò che resta", () => {
    expect(pieceChoices(lot).map((c) => c.id)).toEqual(["pieces-1", "pieces-2", "pieces-half"]);
    const after = buildMealEvents(
      { kind: "lunch", picks: [{ lot, choice: amountChoiceOf("piece:pieces-1", "", lot) }], freeItems: [] },
      { now: NOW, deviceId: "d" },
    );
    if (!after.ok) throw new Error("ko");
    const [left] = lotsOf([...events, ...after.events]);
    expect(pieceChoices(left).map((c) => c.id)).toEqual(["pieces-1", "pieces-half"]);
  });

  it("una scelta che non esiste più chiede la quantità, non consuma tutto", () => {
    expect(amountChoiceOf("piece:pieces-9", "", lot)).toEqual({ kind: "text", text: "" });
    const r = buildMealEvents({ kind: "lunch", picks: [{ lot, choice: amountChoiceOf("piece:pieces-9", "", lot) }], freeItems: [] }, { now: NOW, deviceId: "d" });
    expect(r.ok).toBe(false);
  });

  it("le scelte di sempre (tutto, metà, scritta) non cambiano", () => {
    expect(amountChoiceOf("all", "", lot)).toEqual({ kind: "all" });
    expect(amountChoiceOf("half", "", lot)).toEqual({ kind: "half" });
    expect(amountChoiceOf("text", "80 g", lot)).toEqual({ kind: "text", text: "80 g" });
  });
});

describe("più confezioni dello stesso prodotto: prima quella che scade prima", () => {
  function twoPacks() {
    const late = stock({ name: "Yogurt", category: "yogurt", quantityText: "125 g", pieces: undefined, expiryKind: "use_by", expiryDate: "2026-11-25" });
    const soon = stock({ name: "Yogurt", category: "yogurt", quantityText: "125 g", pieces: undefined, expiryKind: "use_by", expiryDate: "2026-11-19" }, "2026-11-17T08:01:00.000Z");
    return [...late, ...soon];
  }

  it("il pasto abituale consuma la confezione con la scadenza più vicina, anche se è arrivata dopo", () => {
    const events = twoPacks();
    const lots = lotsOf(events);
    const soonLot = lots.find((l) => l.expiry?.date === "2026-11-19") as Lot;
    const ordered = evaluateLots(activeLots(derivePantry(events)), NOW).map((e) => e.lot);
    const built = buildMealFromHabit(
      { habitId: "h", title: "Yogurt", kind: "breakfast", items: [{ name: "Yogurt", quantity: { value: 125, unit: "g" }, certainty: "estimated" }] },
      ordered,
      { now: NOW, deviceId: "d" },
    );
    const consumes = built.events.filter((e) => e.type === "consume");
    expect(consumes).toHaveLength(1);
    expect(consumes[0]).toMatchObject({ lotId: soonLot.lotId });
  });

  it("un pasto abituale di 200 g riempie dalla prima confezione e continua con la seconda", () => {
    const events = twoPacks();
    const ordered = evaluateLots(activeLots(derivePantry(events)), NOW).map((e) => e.lot);
    const built = buildMealFromHabit(
      { habitId: "h", title: "Yogurt", kind: "breakfast", items: [{ name: "Yogurt", quantity: { value: 200, unit: "g" }, certainty: "estimated" }] },
      ordered,
      { now: NOW, deviceId: "d" },
    );
    const quantities = built.events.filter((e) => e.type === "consume").map((e) => (e as { quantity: { value: number } }).quantity.value);
    expect(quantities).toEqual([125, 75]);
  });
});

describe("pasto di un giorno passato", () => {
  const events = stock();
  const [lot] = lotsOf(events);
  // 13:00 a Roma del 14 novembre
  const mealAt = "2026-11-14T12:00:00.000Z";

  it("il pasto va nel giorno scelto, all'ora indicata; la dispensa si scala adesso", () => {
    const r = buildMealEvents(
      { kind: "lunch", picks: [{ lot, choice: amountChoiceOf("piece:pieces-1", "", lot) }], freeItems: [{ name: "Caffè", quantityText: "30 ml" }] },
      { now: NOW, deviceId: "d", mealAt },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.events.find((e) => e.type === "meal")).toMatchObject({ at: mealAt, recordedAt: NOW, kind: "lunch" });
    expect(r.events.find((e) => e.type === "consume")).toMatchObject({ at: NOW });

    const all = [...events, ...r.events];
    const diary = deriveDiary(all, { timeZone: "Europe/Rome" });
    expect(getDay(diary, "2026-11-14")?.meals).toHaveLength(1);
    expect(getDay(diary, "2026-11-17")?.meals ?? []).toHaveLength(0);
    const [m] = mealsWithPantry(diary, all);
    expect(m.date).toBe("2026-11-14");
    expect(m.pantryConsumes).toHaveLength(1);
    // la dispensa è scalata
    expect(lotsOf(all)[0].remaining).toBe(100);
  });

  it("senza giorno passato il pasto resta di adesso", () => {
    const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Caffè", quantityText: "30 ml" }] }, { now: NOW, deviceId: "d" });
    if (!r.ok) throw new Error("ko");
    expect(r.events.find((e) => e.type === "meal")).toMatchObject({ at: NOW });
  });

  it("le ore tipiche dei momenti", () => {
    expect(TYPICAL_MEAL_TIME).toEqual({ breakfast: "08:00", lunch: "13:00", dinner: "20:00", snack: "16:30" });
  });
});
