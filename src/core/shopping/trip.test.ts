import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import type { ShoppingLine } from "./common";
import {
  addOffList,
  checkItem,
  finishTrip,
  orderForStore,
  reconcile,
  startTrip,
  tripProgress,
  uncheckItem,
  type CompletedTrip,
} from "./trip";
import { at, ledger, seededRandom, shuffled } from "./test-helpers";

const line = (key: string, unit: ShoppingLine["unit"], quantity: number): ShoppingLine => ({
  id: `${key}|${unit}`,
  key,
  name: key,
  unit,
  quantity,
});

const LIST = [
  line("latte", "ml", 2000),
  line("pasta", "g", 1000),
  line("burro", "g", 250),
  line("uova", "pz", 6),
];

describe("spesa in corso", () => {
  it("spunta e deseleziona le voci, con un contatore dei progressi", () => {
    let trip = startTrip(LIST, { store: " Conad ", startedAt: at(28, 9) });
    expect(trip.store).toBe("Conad");
    expect(tripProgress(trip)).toEqual({ total: 4, checked: 0, remaining: 4 });
    trip = checkItem(trip, "latte|ml", at(28, 9));
    trip = checkItem(trip, "latte|ml", at(28, 11)); // idempotente: resta il primo istante
    trip = checkItem(trip, "pasta|g", at(28, 9));
    expect(trip.items.find((i) => i.id === "latte|ml")?.checkedAt).toBe(at(28, 9));
    expect(tripProgress(trip).checked).toBe(2);
    trip = uncheckItem(trip, "pasta|g");
    expect(tripProgress(trip).checked).toBe(1);
    expect(trip.items.find((i) => i.id === "pasta|g")?.checkedAt).toBeUndefined();
  });

  it("registra gli acquisti fuori lista senza duplicarli", () => {
    let trip = startTrip(LIST, { startedAt: at(28, 9) });
    expect(trip.store).toBeNull();
    trip = addOffList(trip, { id: "o1", name: "Biscotti ", addedAt: at(28, 9), priceCents: 250 });
    trip = addOffList(trip, { id: "o1", name: "Biscotti", addedAt: at(28, 9) });
    expect(trip.offList).toHaveLength(1);
    expect(trip.offList[0]).toMatchObject({ key: "biscotti", name: "Biscotti" });
    expect(() => addOffList(trip, { id: "o2", name: " ", addedAt: at(28, 9) })).toThrow();
    expect(() => startTrip(LIST, { startedAt: "oggi" })).toThrow();
  });

  it("non modifica lo stato di partenza", () => {
    const trip = startTrip(LIST, { startedAt: at(28, 9) });
    checkItem(trip, "latte|ml", at(28, 10));
    expect(trip.items.every((i) => i.checkedAt === undefined)).toBe(true);
  });
});

describe("ordine delle voci", () => {
  const history: CompletedTrip[] = [
    { store: "Conad", endedAt: at(7), order: ["pasta", "latte", "burro"] },
    { store: "conad", endedAt: at(14), order: ["pasta", "burro", "latte", "uova"] },
    { store: "Lidl", endedAt: at(15), order: ["uova", "latte"] },
  ];

  it("segue l'ordine di spunta delle spese precedenti in quel negozio", () => {
    const ordered = orderForStore(LIST, history, "Conad");
    expect(ordered.map((o) => o.item.key)).toEqual(["pasta", "latte", "burro", "uova"]);
    expect(ordered[0].position).toBe(0);
    expect(ordered[0].seenInTrips).toBe(2);
    expect(ordered[3]).toMatchObject({ seenInTrips: 1, position: 1 });
  });

  it("negozi diversi hanno ordini diversi", () => {
    expect(orderForStore(LIST, history, "Lidl").map((o) => o.item.key)).toEqual([
      "uova",
      "latte",
      "burro",
      "pasta",
    ]);
  });

  it("le voci mai spuntate vanno in fondo, in ordine alfabetico, senza posizione", () => {
    const ordered = orderForStore([...LIST, line("aceto", "ml", 500)], history, "Conad");
    const last = ordered[ordered.length - 1];
    expect(last.item.key).toBe("aceto");
    expect(last.position).toBeNull();
    expect(last.seenInTrips).toBe(0);
  });

  it("senza storia nel negozio o senza negozio: ordine alfabetico", () => {
    const expected = ["burro", "latte", "pasta", "uova"];
    expect(orderForStore(LIST, history, "Esselunga").map((o) => o.item.key)).toEqual(expected);
    expect(orderForStore(LIST, history, null).map((o) => o.item.key)).toEqual(expected);
  });

  it("non dipende dall'ordine in ingresso", () => {
    const a = orderForStore(LIST, history, "Conad").map((o) => o.item.key);
    const b = orderForStore([...LIST].reverse(), history, "Conad").map((o) => o.item.key);
    expect(b).toEqual(a);
  });

  it("l'ordine di una spesa conclusa è quello delle spunte, non quello della lista", () => {
    let trip = startTrip(LIST, { store: "Conad", startedAt: at(28, 9) });
    trip = checkItem(trip, "uova|pz", at(28, 9));
    trip = checkItem(trip, "latte|ml", at(28, 10));
    trip = checkItem(trip, "burro|g", at(28, 11));
    const { trip: done, record } = finishTrip(trip, at(28, 12));
    expect(record.order).toEqual(["uova", "latte", "burro"]);
    expect(done.endedAt).toBe(at(28, 12));
    expect(record.store).toBe("Conad");
  });
});

describe("riconciliazione", () => {
  function scenario() {
    const l = ledger();
    l.buy(28, "Latte", 2000, "ml", { price: 300, store: "Conad", hour: 10 }); // come da lista
    l.buy(28, "Pasta", 500, "g", { price: 100, store: "Conad", hour: 10 }); // in parte
    l.buy(28, "Uova", 10, "pz", { price: 300, store: "Conad", hour: 10 }); // più del previsto
    l.buy(28, "Biscotti", 300, "g", { price: 250, store: "Conad", hour: 10 }); // fuori lista, dichiarato
    l.buy(28, "Gelato", 1, "pz", { store: "Conad", hour: 11 }); // fuori lista, senza prezzo
    l.buy(28, "Burro", 250, "g", { price: 200, store: "Lidl", hour: 10 }); // altro negozio
    l.buy(20, "Burro", 250, "g", { price: 200, store: "Conad", hour: 10 }); // fuori finestra
    let trip = startTrip(LIST, { store: "Conad", startedAt: at(28, 9) });
    trip = checkItem(trip, "latte|ml", at(28, 9));
    trip = checkItem(trip, "burro|g", at(28, 9)); // spuntato ma non registrato
    trip = addOffList(trip, { id: "o1", name: "Biscotti", addedAt: at(28, 9) });
    return { l, trip: finishTrip(trip, at(28, 12)).trip };
  }

  it("distingue comprato, mancante e in più", () => {
    const { l, trip } = scenario();
    const r = reconcile(trip, l.pantry());
    expect(r.purchasesConsidered).toBe(5);
    expect(r.bought.map((b) => b.itemId)).toEqual(["latte|ml", "uova|pz"]);
    expect(r.missing.map((m) => m.itemId)).toEqual(["burro|g", "pasta|g"]);

    const uova = r.bought.find((b) => b.itemId === "uova|pz");
    expect(uova).toMatchObject({ purchased: 10, excess: 4 });
    const pasta = r.missing.find((m) => m.itemId === "pasta|g");
    expect(pasta).toMatchObject({ purchased: 500, shortBy: 500, partial: true });
    const burro = r.missing.find((m) => m.itemId === "burro|g");
    expect(burro).toMatchObject({ purchased: 0, shortBy: 250, partial: false, checked: true });
    expect(r.checkedNotRegistered).toEqual(["burro|g"]);
  });

  it("elenca gli acquisti fuori lista con il costo", () => {
    const { l, trip } = scenario();
    const r = reconcile(trip, l.pantry());
    expect(r.extra.map((e) => [e.name, e.costCents, e.declaredInTrip])).toEqual([
      ["Biscotti", 250, true],
      ["Gelato", null, false],
    ]);
    expect(r.extraCostCents).toBe(250);
    expect(r.extraUnpriced).toBe(1);
    expect(r.listSpentCents).toBe(300 + 100 + 300);
  });

  it("un'unità diversa risulta comprata ma non confrontabile", () => {
    const l = ledger();
    l.buy(28, "Pomodori", 6, "pz", { store: "Conad" });
    const trip = startTrip([line("pomodori", "g", 500)], { store: "Conad", startedAt: at(28, 9) });
    const r = reconcile(trip, l.pantry());
    expect(r.bought).toHaveLength(1);
    expect(r.bought[0]).toMatchObject({
      unitMismatch: true,
      purchasedOtherUnits: [{ unit: "pz", quantity: 6 }],
      shortBy: 0,
    });
    expect(r.extra).toHaveLength(0);
  });

  it("abbina per codice a barre anche con un nome diverso", () => {
    const l = ledger();
    l.buy(28, "Latte UHT intero", 1000, "ml", { barcode: "8001234567890", store: "Conad" });
    const item: ShoppingLine = { ...line("latte", "ml", 1000), barcode: "8001234567890" };
    const r = reconcile(startTrip([item], { store: "Conad", startedAt: at(28, 9) }), l.pantry());
    expect(r.bought.map((b) => b.itemId)).toEqual(["latte|ml"]);
    expect(r.extra).toHaveLength(0);
  });

  it("senza acquisti registrati tutto è mancante", () => {
    const trip = startTrip(LIST, { store: "Conad", startedAt: at(28, 9) });
    const r = reconcile(trip, ledger().pantry());
    expect(r.bought).toHaveLength(0);
    expect(r.missing).toHaveLength(4);
    expect(r.extra).toHaveLength(0);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const { l, trip } = scenario();
    const reference = reconcile(trip, l.pantry());
    for (let seed = 1; seed <= 5; seed++) {
      const state = derivePantry(shuffled(l.events, seededRandom(seed)));
      expect(reconcile(trip, state)).toEqual(reference);
    }
  });
});
