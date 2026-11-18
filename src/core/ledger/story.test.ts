import { describe, expect, it } from "vitest";
import { derivePantry, type Lot, type PantryState } from "./derive";
import { buildLotStory } from "./story";
import { adjust, consume, declare, discard, move, open, purchase, q, updateLot, voidOf } from "./test-helpers";

const at = (day: string, hhmm = "09:00") => `2026-11-${day}T${hhmm}:00.000Z`;

const bought = purchase("p1", at("12", "08:00"), {
  lotId: "lot-1",
  productRef: "Petto di pollo",
  quantity: q(400),
  location: "frigo",
});

const lotOf = (events: unknown[]): Lot => derivePantry(events).lots[0];
const storyOf = (events: unknown[]) => buildLotStory(lotOf(events), events);

describe("storia di un alimento", () => {
  it("appena comprato: una riga, con la quantità di partenza", () => {
    const rows = storyOf([bought]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: "p1", kind: "bought", quantityDelta: 400, remainingAfter: 400, source: "manual" });
    expect(rows[0].at).toBe(at("12", "08:00"));
  });

  it("comprato, aperto, mangiato due volte: quattro righe, la più recente in cima, il rimasto scende", () => {
    const events = [
      bought,
      open("o1", at("14", "08:00"), { lotId: "lot-1" }),
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" }),
      consume("c2", at("15", "12:00"), { lotId: "lot-1", quantity: q(100) }),
    ];
    const rows = storyOf(events);
    expect(rows.map((r) => r.kind)).toEqual(["eaten", "eaten", "opened", "bought"]);
    expect(rows.map((r) => r.eventId)).toEqual(["c2", "c1", "o1", "p1"]);
    expect(rows.map((r) => r.remainingAfter)).toEqual([150, 250, 400, 400]);
    expect(rows[0].quantityDelta).toBe(-100);
    expect(rows[0].mealId).toBeUndefined();
    expect(rows[1]).toMatchObject({ quantityDelta: -150, mealId: "meal-1" });
  });

  it("un consumo annullato non compare", () => {
    const events = [
      bought,
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(150) }),
      consume("c2", at("15", "12:00"), { lotId: "lot-1", quantity: q(100) }),
      voidOf("v1", at("15", "12:05"), "c1"),
    ];
    const rows = storyOf(events);
    expect(rows.map((r) => r.eventId)).toEqual(["c2", "p1"]);
    expect(rows[0].remainingAfter).toBe(300);
  });

  it("un consumo corretto compare una volta sola, con la quantità che vale adesso", () => {
    const events = [
      bought,
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" }),
      voidOf("v1", at("15", "08:00"), "c1"),
      consume("c1b", at("14", "19:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-1", replaces: "c1", recordedAt: at("15", "08:00") }),
    ];
    const rows = storyOf(events);
    expect(rows.map((r) => r.eventId)).toEqual(["c1b", "p1"]);
    expect(rows[0]).toMatchObject({ quantityDelta: -100, remainingAfter: 300 });
  });

  it("due rami della stessa correzione contano uno solo", () => {
    const events = [
      bought,
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(150) }),
      voidOf("v1", at("15", "08:00"), "c1"),
      consume("ca", at("14", "19:00"), { lotId: "lot-1", quantity: q(100), replaces: "c1", recordedAt: at("15", "08:00") }),
      consume("cb", at("14", "19:00"), { lotId: "lot-1", quantity: q(120), replaces: "c1", recordedAt: at("15", "09:00") }),
    ];
    const rows = storyOf(events);
    expect(rows.filter((r) => r.kind === "eaten").map((r) => r.eventId)).toEqual(["cb"]);
  });

  it("quantità corretta con «Correggi» (un adjust): la riga dice quanto ne resta", () => {
    const events = [
      bought,
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(100) }),
      adjust("a1", at("16"), { lotId: "lot-1", remaining: q(250), certainty: "estimated" }),
    ];
    const [first] = storyOf(events);
    expect(first).toMatchObject({ kind: "adjusted", quantityDelta: -50, remainingAfter: 250, certainty: "estimated" });
  });

  it("quantità di partenza riscritta con lo stesso lotto: una sola riga «comprato», con la quantità nuova", () => {
    const events = [
      bought,
      voidOf("v1", at("12", "09:00"), "p1"),
      purchase("p2", at("12", "08:00"), {
        lotId: "lot-1",
        productRef: "Petto di pollo",
        quantity: q(500),
        location: "frigo",
        replaces: "p1",
        recordedAt: at("12", "09:00"),
      }),
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(100) }),
    ];
    const rows = storyOf(events);
    expect(rows.map((r) => r.kind)).toEqual(["eaten", "bought"]);
    expect(rows[1]).toMatchObject({ eventId: "p2", quantityDelta: 500, remainingAfter: 500 });
    expect(rows[0].remainingAfter).toBe(400);
  });

  it("un consumo che supera il rimasto: la quantità è quella davvero scalata", () => {
    const events = [
      bought,
      consume("c1", at("14", "19:00"), { lotId: "lot-1", quantity: q(300) }),
      consume("c2", at("15", "12:00"), { lotId: "lot-1", quantity: q(500) }),
    ];
    const [first] = storyOf(events);
    expect(first).toMatchObject({ kind: "eaten", quantityDelta: -100, remainingAfter: 0, clamped: true });
  });

  it("buttato (con il motivo), spostato (con il luogo) e dati corretti (con i campi)", () => {
    const events = [
      bought,
      move("m1", at("13"), { lotId: "lot-1", to: "freezer" }),
      discard("d1", at("15"), { lotId: "lot-1", quantity: q(100), reason: "expired" }),
      updateLot("u1", at("16"), {
        lotId: "lot-1",
        patch: { expiry: { date: "2027-01-10", kind: "best_before" }, productRef: "Petto di pollo bio" },
      }),
    ];
    const rows = storyOf(events);
    expect(rows.map((r) => r.kind)).toEqual(["corrected", "discarded", "moved", "bought"]);
    expect(rows[0].fields).toEqual(["productRef", "expiry"]);
    expect(rows[1]).toMatchObject({ reason: "expired", quantityDelta: -100, remainingAfter: 300 });
    expect(rows[2].to).toBe("freezer");
  });

  it("da scontrino, con prezzo e negozio", () => {
    const events = [
      purchase("p1", at("12", "08:00"), {
        lotId: "lot-1",
        productRef: "Latte",
        quantity: q(1000, "ml"),
        location: "frigo",
        priceCents: 189,
        store: "Conad",
        source: "receipt",
      }),
    ];
    expect(storyOf(events)[0]).toMatchObject({ kind: "bought", priceCents: 189, store: "Conad", source: "receipt" });
  });

  it("prezzo e negozio tolti con una correzione non compaiono più nella riga «comprato»", () => {
    const events = [
      purchase("p1", at("12", "08:00"), { lotId: "lot-1", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo", priceCents: 189, store: "Conad" }),
      updateLot("u1", at("13"), { lotId: "lot-1", patch: { priceCents: null, store: null } }),
    ];
    const bought = storyOf(events).find((r) => r.kind === "bought")!;
    expect(bought.priceCents).toBeUndefined();
    expect(bought.store).toBeUndefined();
  });

  it("dichiarato «già in casa»: nessun prezzo", () => {
    const events = [declare("d1", at("12"), { lotId: "lot-1", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" })];
    const rows = storyOf(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "declared", quantityDelta: 6, remainingAfter: 6 });
    expect(rows[0].priceCents).toBeUndefined();
  });

  it("un evento che non si trova nel registro dà comunque la riga, senza i campi in più", () => {
    const events = [bought, consume("c1", at("14"), { lotId: "lot-1", quantity: q(100), mealId: "meal-1" })];
    const rows = buildLotStory(lotOf(events), [bought]);
    expect(rows[0]).toMatchObject({ kind: "eaten", quantityDelta: -100 });
    expect(rows[0].mealId).toBeUndefined();
  });

  it("un tipo di evento che la storia non conosce si salta, senza errori", () => {
    const state: PantryState = derivePantry([bought, open("o1", at("14"), { lotId: "lot-1" })]);
    const lot = state.lots[0];
    const odd = { ...lot, history: [...lot.history, { eventId: "x1", type: "freeze", at: at("15"), certainty: "measured" }] } as unknown as Lot;
    const rows = buildLotStory(odd, [bought]);
    expect(rows.map((r) => r.eventId)).toEqual(["o1", "p1"]);
  });

  it("non legge in modo strano un registro con voci illeggibili", () => {
    const rows = buildLotStory(lotOf([bought]), [null, 3, "x", { id: 5 }, bought]);
    expect(rows).toHaveLength(1);
  });
});
