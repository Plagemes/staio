import { describe, expect, it } from "vitest";
import { emptyRejections, emptyStockConfig, setMinimum } from "@/core/shopping";
import { day, ledger, milkLedger } from "@/core/shopping/test-helpers";
import { confirm, dismiss, forgetRejections, isDismissed, prune, reject, restore, setQuantity } from "./decisions";
import { buildShoppingView, type ViewInput } from "./view";
import { emptyDecisions } from "./settings";

const today = day(28);

function input(extra: Partial<ViewInput> = {}): ViewInput {
  return {
    today,
    pantry: milkLedger().pantry(),
    planNeeds: [],
    manual: [],
    pairs: [],
    stock: emptyStockConfig(),
    rejections: emptyRejections(),
    decisions: emptyDecisions(),
    budgetCents: null,
    ...extra,
  };
}

describe("vista della lista", () => {
  it("propone ciò che sta finendo, con la ragione in chiaro e il costo dall'ultimo prezzo", () => {
    const v = buildShoppingView(input());
    const milk = v.items.find((i) => i.name === "Latte");
    expect(milk).toBeDefined();
    expect(milk?.reasons[0]).toMatch(/^finisce (oggi|domani|tra \d+ giorni) \(stima dai tuoi consumi\)$/);
    expect(milk?.costCents).toBeGreaterThan(0);
    expect(milk?.costText).toMatch(/^circa /);
    expect(v.cost.pricedCount).toBe(1);
    expect(v.cost.unpricedCount).toBe(0);
    expect(v.cost.text).toMatch(/Costo stimato/);
    expect(v.dayText).toMatch(/Giorno consigliato \(stima\)/);
  });

  it("le voci senza prezzo non sono stimate: si contano", () => {
    const v = buildShoppingView(input({ manual: [{ id: "m1", product: "Sale", quantity: { value: 1, unit: "pz" }, addedAt: `${today}T08:00:00.000Z` }] }));
    const salt = v.items.find((i) => i.name === "Sale");
    expect(salt?.isManual).toBe(true);
    expect(salt?.confirmed).toBe(true);
    expect(salt?.costCents).toBeNull();
    expect(salt?.costText).toBe("nessun prezzo osservato");
    expect(salt?.manualIds).toEqual(["m1"]);
    expect(v.cost.unpricedCount).toBe(1);
    expect(v.cost.text).toMatch(/1 voce è senza prezzo e non è contata/);
  });

  it("usa la quantità scelta dall'utente e dice che è cambiata", () => {
    const base = buildShoppingView(input());
    const id = base.items[0].id;
    const v = buildShoppingView(input({ decisions: confirm(emptyDecisions(), id, 3000) }));
    expect(v.items[0].quantity).toBe(3000);
    expect(v.items[0].changed).toBe(3000 !== base.items[0].proposedQuantity);
    expect(v.items[0].confirmed).toBe(true);
  });

  it("una voce rifiutata esce dalla lista e il rifiuto viene ricordato", () => {
    const base = buildShoppingView(input());
    const item = base.items[0].item;
    const r = reject(emptyDecisions(), emptyRejections(), item, today);
    expect(r.memory.entries.length).toBeGreaterThan(0);
    const v = buildShoppingView(input({ decisions: r.decisions, rejections: r.memory }));
    expect(v.items.find((i) => i.id === item.id)).toBeUndefined();
    expect(isDismissed(r.decisions, item.id, today)).toBe(true);
    expect(isDismissed(r.decisions, item.id, day(36))).toBe(false);
    expect(forgetRejections(r.memory, item.id).entries).toHaveLength(0);
    expect(isDismissed(restore(r.decisions, item.id), item.id, today)).toBe(false);
  });

  it("sotto la scorta minima compare con la sua ragione", () => {
    const stock = setMinimum(emptyStockConfig(), "Pasta", "g", 500);
    const l = ledger();
    l.buy(0, "Pasta", 200, "g");
    const v = buildShoppingView(input({ pantry: l.pantry(), stock }));
    const pasta = v.items.find((i) => i.name === "Pasta");
    expect(pasta?.reasons[0]).toBe("sotto la scorta minima (ne hai 200 g, il minimo è 500 g)");
    expect(pasta?.forecastNote).toMatch(/Non so quando finirà/);
  });

  it("il tetto di spesa propone riduzioni, non le applica", () => {
    const v = buildShoppingView(input({ budgetCents: 1 }));
    expect(v.budget?.capCents).toBe(1);
    expect(v.budget?.adjustments.length).toBeGreaterThan(0);
    expect(v.items.length).toBeGreaterThan(0);
  });

  it("pulisce le scelte di voci che non esistono più", () => {
    let d = setQuantity(confirm(emptyDecisions(), "a|g", 100), "b|g", 5);
    d = dismiss(d, "c|g", today);
    const p = prune(d, new Set(["a|g"]), today);
    expect(Object.keys(p.confirmed)).toEqual(["a|g"]);
    expect(p.quantities).toEqual({ "a|g": 100 });
    expect(p.dismissed).toEqual({ "c|g": today });
    expect(prune(d, new Set(), day(40)).dismissed).toEqual({});
  });
});
