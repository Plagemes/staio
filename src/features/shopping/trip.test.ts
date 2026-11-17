import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { addOffList, buildPriceBook, checkItem, finishTrip, reconcile, startTrip, type ShoppingLine } from "@/core/shopping";
import { at, day, ledger } from "@/core/shopping/test-helpers";
import { appendHistory, buildPurchases, purchaseRows, reconcileView, shoppingOrder, tripTotals } from "./trip";
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
