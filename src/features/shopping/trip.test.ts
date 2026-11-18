import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { addOffList, buildPriceBook, checkItem, finishTrip, reconcile, startTrip, type ShoppingLine } from "@/core/shopping";
import { at, day, ledger } from "@/core/shopping/test-helpers";
import {
  appendHistory,
  buildPurchases,
  buildPutAway,
  learnDefaults,
  linesOfTrip,
  markPutAway,
  missingOf,
  needsCheck,
  purchaseRows,
  putAwayMarks,
  putAwayRows,
  reconcileView,
  restoreDefaults,
  shoppingOrder,
  tripTotals,
  unmarkPutAway,
  withCategory,
  withoutPurchase,
} from "./trip";

const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};
import { isHistory, isTrip, isDecisions, isManualList, isRejectionMemory, isStockConfig, emptyDecisions, HISTORY_LIMIT } from "./settings";

const line = (name: string, quantity: number, unit: ShoppingLine["unit"] = "g"): ShoppingLine => ({ id: `${name.toLowerCase()}|${unit}`, key: name.toLowerCase(), name, unit, quantity });

function pantryWithPrices() {
  const l = ledger();
  l.buy(0, "Pasta", 500, "g", { price: 100, store: "Coop", category: "pasta_dry", location: "dispensa" });
  l.buy(0, "Latte", 1000, "ml", { price: 150, store: "Coop", category: "milk_fresh", location: "frigo" });
  return l.pantry();
}

describe("in negozio", () => {
  const started = `${day(10)}T09:00:00.000Z`;

  it("ordina come hai spuntato le altre volte in quel negozio e manda in fondo le spuntate", () => {
    let trip = startTrip([line("Pasta", 500), line("Latte", 1000, "ml"), line("Mele", 1000)], { store: "Coop", startedAt: started });
    const history = [{ store: "Coop", endedAt: at(3), order: ["mele", "latte", "pasta"] }];
    expect(shoppingOrder(trip, history).map((o) => o.item.key)).toEqual(["mele", "latte", "pasta"]);
    trip = checkItem(trip, "mele|g", `${day(10)}T09:05:00.000Z`);
    expect(shoppingOrder(trip, history).map((o) => o.item.key)).toEqual(["latte", "pasta", "mele"]);
    expect(shoppingOrder({ ...trip, store: null }, history).map((o) => o.item.key)).toEqual(["latte", "pasta", "mele"]);
  });

  it("stima il carrello solo con i prezzi osservati e conta le voci senza prezzo", () => {
    const book = buildPriceBook(pantryWithPrices());
    let trip = startTrip([line("Pasta", 1000), line("Mele", 1000)], { store: "Coop", startedAt: started });
    expect(tripTotals(trip, book).text).toMatch(/Lista intera, stima: .*1 voce senza prezzo/);
    trip = checkItem(trip, "pasta|g", started);
    trip = checkItem(trip, "mele|g", started);
    const t = tripTotals(trip, book);
    expect(t.cartCents).toBe(200);
    expect(t.cartPriced).toBe(1);
    expect(t.cartUnpriced).toBe(1);
    expect(t.text).toMatch(/Nel carrello, stima: .*1 voce senza prezzo non contata/);
    trip = addOffList(trip, { id: "o1", name: "Gelato", quantity: { value: 1, unit: "pz" }, priceCents: 300, addedAt: started });
    expect(tripTotals(trip, book).cartCents).toBe(500);
  });

  it("propone gli acquisti da registrare con categoria e luogo dell'ultimo acquisto, e chiede dove mancano", () => {
    const pantry = pantryWithPrices();
    let trip = startTrip([line("Pasta", 500), line("Mele", 1000)], { store: "Coop", startedAt: started });
    trip = checkItem(trip, "pasta|g", started);
    trip = checkItem(trip, "mele|g", started);
    trip = addOffList(trip, { id: "o1", name: "Gelato", addedAt: started });
    const rows = purchaseRows(trip, pantry);
    expect(rows.map((r) => [r.name, r.category, r.location])).toEqual([
      ["Mele", "", ""],
      ["Pasta", "pasta_dry", "dispensa"],
      ["Gelato", "", ""],
    ]);
    expect(rows[1].quantityText).toBe("500 g");
    const res = buildPurchases(rows, "Coop", { now: `${day(10)}T10:00:00.000Z`, deviceId: "d" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual([rows[0].id, rows[2].id].sort());
  });

  it("scrive gli acquisti nel negozio, e la riconciliazione li ritrova", () => {
    const pantry = pantryWithPrices();
    let trip = startTrip([line("Pasta", 500), line("Mele", 1000)], { store: "Coop", startedAt: started });
    trip = checkItem(trip, "pasta|g", started);
    trip = checkItem(trip, "mele|g", started);
    const rows = purchaseRows(trip, pantry).map((r) => ({
      ...r,
      category: r.category || "fruit_fresh",
      location: r.location || ("frigo" as const),
      priceText: r.name === "Pasta" ? "1,10" : "",
    }));
    const res = buildPurchases(rows, "Coop", { now: `${day(10)}T10:00:00.000Z`, deviceId: "d" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.every((e) => e.type === "purchase" && e.store === "Coop")).toBe(true);
    expect(res.message).toBe("Registrati 2 acquisti da Coop.");
    const after = derivePantry([...ledgerEvents(), ...res.events]);
    const { trip: done } = finishTrip(trip, `${day(10)}T10:30:00.000Z`);
    const view = reconcileView(reconcile(done, after), (id) => id);
    expect(view.boughtText).toBe("2 voci comprate come da lista, 0 da recuperare, 0 fuori lista.");
    expect(view.spentText).toMatch(/1,10/);
    expect(view.spentText).toMatch(/1 acquisto senza prezzo non contato/);
    expect(view.waiting).toBe(false);
  });

  it("senza acquisti registrati aspetta lo scontrino e dice cosa manca", () => {
    const trip = checkItem(startTrip([line("Pasta", 500)], { store: "Coop", startedAt: started }), "pasta|g", started);
    const view = reconcileView(reconcile(trip, derivePantry([])), (id) => id);
    expect(view.waiting).toBe(true);
    expect(view.missing[0]).toMatch(/Pasta: non comprato.*spuntato ma senza un acquisto registrato/);
    expect(view.notRegistered).toEqual(["pasta|g"]);
  });

  it("limita la storia dei viaggi", () => {
    let h: ReturnType<typeof appendHistory> = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = appendHistory(h, { store: "Coop", endedAt: at(i), order: [] });
    expect(h).toHaveLength(HISTORY_LIMIT);
  });
});

describe("Metti in dispensa: righe già compilate", () => {
  const started = `${day(10)}T09:00:00.000Z`;
  const noMemory = () => undefined;

  function checked(lines: ShoppingLine[]) {
    let trip = startTrip(lines, { store: "Coop", startedAt: started });
    for (const l of lines) trip = checkItem(trip, l.id, started);
    return finishTrip(trip, `${day(10)}T10:00:00.000Z`).trip;
  }

  it("le voci senza quantità della lista hanno la chiave del prodotto", () => {
    const lines = linesOfTrip([], [{ id: "pane|qb", name: "Pane" }]);
    expect(lines[0]).toMatchObject({ id: "pane|qb", key: "pane", quantity: 0 });
  });

  it("quantità dalla lista; luogo dalla memoria per nome, poi dall'ultimo lotto, poi dalla categoria", () => {
    const trip = checked([line("Pasta", 500), line("Latte", 1000, "ml"), line("Yogurt", 2, "pz")]);
    const memory = { pasta: { name: "Pasta", location: "freezer" as const, at: "x" } } as Record<string, { name: string; location?: "freezer"; at: string }>;
    const { pending } = putAwayRows(trip, pantryWithPrices(), (name) => memory[name.toLowerCase()]);
    const byName = Object.fromEntries(pending.map((r) => [r.name, r]));
    expect(byName.Pasta).toMatchObject({ quantityText: "500 g", category: "pasta_dry", categoryFrom: "lot", location: "freezer", locationFrom: "memory" });
    expect(byName.Latte).toMatchObject({ quantityText: "1 l", category: "milk_fresh", location: "frigo" });
    expect(missingOf(byName.Latte)).toEqual([]);
    expect(needsCheck(byName.Latte)).toBe(false);
  });

  it("una categoria che viene solo dal nome va controllata; dalla memoria no; senza categoria va scelta", () => {
    const trip = checked([line("Yogurt bianco", 2, "pz"), line("Tahina", 1, "pz"), line("Xqzw", 1, "pz")]);
    const memory = (name: string) => (name === "Tahina" ? { name, category: "canned_closed", at: "x" } : undefined);
    const { pending } = putAwayRows(trip, pantryWithPrices(), memory);
    const byName = Object.fromEntries(pending.map((r) => [r.name, r]));
    expect(byName["Yogurt bianco"]).toMatchObject({ categoryFrom: "name", locationFrom: "category" });
    expect(needsCheck(byName["Yogurt bianco"])).toBe(true);
    expect(byName.Tahina).toMatchObject({ category: "canned_closed", categoryFrom: "memory" });
    expect(needsCheck(byName.Tahina)).toBe(false);
    expect(byName.Xqzw.categoryFrom).toBe("none");
    expect(missingOf(byName.Xqzw)).toEqual(["category"]);
    // scelta la categoria a mano, non è più da controllare e il luogo proposto la segue
    const fixed = withCategory(byName.Xqzw, "frozen_foods");
    expect(fixed).toMatchObject({ category: "frozen_foods", categoryFrom: "chosen", location: "freezer", locationFrom: "category" });
    expect(needsCheck(fixed)).toBe(false);
  });

  it("una voce senza quantità ha la riga aperta che la chiede", () => {
    const trip = checked(linesOfTrip([], [{ id: "pane|qb", name: "Pane" }]));
    const [pane] = putAwayRows(trip, pantryWithPrices(), noMemory).pending;
    expect(pane.quantityText).toBe("");
    expect(missingOf(pane)).toContain("quantity");
  });

  it("scontrino del giorno della spesa, con l'ora della data letta e un altro nome del negozio: la voce non si ripropone, ma si vede", () => {
    const l = ledger();
    l.buy(10, "Latte", 1000, "ml", { store: "Coop · Via Roma", category: "milk_fresh", location: "frigo", hour: 12 });
    let trip = startTrip([line("Latte", 1000, "ml"), line("Mele", 1000)], { store: "Coop", startedAt: at(10, 17) });
    trip = checkItem(trip, "latte|ml", at(10, 17));
    trip = checkItem(trip, "mele|g", at(10, 17));
    trip = finishTrip(trip, at(10, 18)).trip;
    const state = putAwayRows(trip, l.pantry(), noMemory);
    expect(state.pending.map((r) => r.name)).toEqual(["Mele"]);
    expect(state.already.map((a) => [a.row.name, a.lot.store])).toEqual([["Latte", "Coop · Via Roma"]]);
  });

  it("un acquisto dello stesso prodotto qualche ora prima, nello stesso giorno: in «Già in dispensa», e si può aggiungere lo stesso", () => {
    const l = ledger();
    l.buy(10, "Pasta", 250, "g", { category: "pasta_dry", location: "dispensa", hour: 7 });
    const trip = checked([line("Pasta", 500), line("Mele", 1000)]);
    const state = putAwayRows(trip, l.pantry(), noMemory);
    expect(state.pending.map((r) => r.name)).toEqual(["Mele"]);
    expect(state.already[0].lot).toMatchObject({ quantity: 250, unit: "g", createdAt: at(10, 7) });
    const forced = putAwayRows(trip, l.pantry(), noMemory, { force: new Set(["pasta|g"]) });
    expect(forced.pending.map((r) => r.name).sort()).toEqual(["Mele", "Pasta"]);
    expect(forced.already).toEqual([]);
    // un acquisto di un altro giorno non conta
    const other = ledger();
    other.buy(9, "Pasta", 250, "g", { category: "pasta_dry", location: "dispensa" });
    expect(putAwayRows(trip, other.pantry(), noMemory).already).toEqual([]);
  });

  it("messa in dispensa più di sette giorni dopo: segnata, non si ripropone più; annullato l'acquisto, torna", () => {
    const trip = checked([line("Pasta", 500), line("Mele", 1000)]);
    const before = putAwayRows(trip, derivePantry([]), noMemory).pending.map((r) => ({ ...r, category: r.category || "fruit_fresh" }));
    const built = buildPutAway(before, trip.store, { now: at(19, 10), deviceId: "d", idGenerator: counter() });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.lots).sort()).toEqual(["mele|g", "pasta|g"]);
    const marked = markPutAway(trip, built.lots);
    const after = derivePantry(built.events);
    expect(putAwayRows(marked, after, noMemory)).toEqual({ pending: [], already: [] });
    // senza il segno, a nove giorni di distanza, la difesa del giorno non basterebbe
    expect(putAwayRows(trip, after, noMemory).pending).toHaveLength(2);
    // annullato l'acquisto il lotto sparisce: la voce torna da mettere in dispensa; «Annulla» toglie anche il segno
    expect(putAwayRows(marked, derivePantry([]), noMemory).pending).toHaveLength(2);
    const lots = Object.values(built.lots).flat();
    expect(putAwayMarks(unmarkPutAway(marked, lots))).toEqual({});
  });

  it("la memoria impara dalle righe scritte, e «Annulla» la riporta com'era", () => {
    const before = { pasta: { name: "Pasta", category: "pasta_dry", location: "dispensa", at: "2026-01-01T00:00:00.000Z" } };
    const rows = [
      { id: "a", name: "Pasta", quantityText: "500 g", priceText: "", category: "pasta_dry", location: "freezer" as const, fromList: true },
      { id: "b", name: "Mele", quantityText: "1 kg", priceText: "", category: "fruit_fresh", location: "frigo" as const, fromList: true },
    ];
    const learned = learnDefaults(before, rows, "2026-01-12T10:00:00.000Z");
    expect(learned.pasta.location).toBe("freezer");
    expect(learned.mele.category).toBe("fruit_fresh");
    const restored = restoreDefaults({ ...learned, pane: { name: "Pane", at: "x" } }, before, ["Pasta", "Mele"]);
    expect(restored).toEqual({ pasta: before.pasta, pane: { name: "Pane", at: "x" } });
  });

  it("«Togli» toglie la spunta o la voce fuori lista, e basta", () => {
    let trip = checked([line("Pasta", 500), line("Mele", 1000)]);
    trip = addOffList(trip, { id: "o1", name: "Gelato", addedAt: started });
    const a = withoutPurchase(trip, "mele|g");
    expect(a.items.find((i) => i.id === "mele|g")?.checkedAt).toBeUndefined();
    expect(a.items).toHaveLength(2);
    expect(withoutPurchase(trip, "o1").offList).toEqual([]);
    expect(withoutPurchase(trip, "nessuna")).toBe(trip);
  });
});

function ledgerEvents() {
  const l = ledger();
  l.buy(0, "Pasta", 500, "g", { price: 100, store: "Coop", category: "pasta_dry", location: "dispensa" });
  return l.events;
}

describe("controlli sulle impostazioni salvate", () => {
  it("accettano le forme giuste e rifiutano le altre", () => {
    expect(isHistory([{ store: null, endedAt: "x", order: ["a"] }])).toBe(true);
    expect(isHistory([{ store: 3 }])).toBe(false);
    expect(isTrip({ store: "Coop", startedAt: "x", items: [], offList: [] })).toBe(true);
    expect(isTrip({ store: "Coop", items: [] })).toBe(false);
    expect(isDecisions(emptyDecisions())).toBe(true);
    expect(isDecisions({ confirmed: { a: false }, quantities: {}, dismissed: {} })).toBe(false);
    expect(isManualList([{ id: "a", product: "Pane", addedAt: "x", quantity: { value: 1, unit: "pz" } }])).toBe(true);
    expect(isManualList([{ id: "a" }])).toBe(false);
    expect(isStockConfig({ minimums: [] })).toBe(true);
    expect(isRejectionMemory({ entries: [{ id: "a|g", key: "a", unit: "g", kind: "plan", dates: ["2026-01-01"] }] })).toBe(true);
    expect(isRejectionMemory({ entries: [{}] })).toBe(false);
  });
});
