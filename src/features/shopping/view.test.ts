import { describe, expect, it } from "vitest";
import { emptyRejections, emptyStockConfig, setMinimum } from "@/core/shopping";
import { day, ledger, milkLedger } from "@/core/shopping/test-helpers";
import { confirm, dismiss, forgetRejections, isDismissed, prune, reject, restore, setQuantity } from "./decisions";
import { buildShoppingView, nearFoods, type ViewInput } from "./view";
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

  it("una proposta tolta da poco non sparisce: sta tra le sospese finché non scade o torna", () => {
    const base = buildShoppingView(input());
    const item = base.items[0].item;
    expect(base.dismissed).toEqual([]);
    const r = reject(emptyDecisions(), emptyRejections(), item, today);
    const after = buildShoppingView(input({ decisions: r.decisions, rejections: r.memory }));
    expect(after.dismissed.map((v) => v.id)).toEqual([item.id]);
    const back = buildShoppingView(input({ decisions: restore(r.decisions, item.id), rejections: r.memory }));
    expect(back.dismissed).toEqual([]);
    expect(back.items.find((i) => i.id === item.id)).toBeDefined();
    const later = buildShoppingView({ ...input({ decisions: r.decisions, rejections: r.memory }), today: day(40) });
    expect(later.dismissed.find((v) => v.id === item.id)).toBeUndefined();
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

describe("alimenti in casa dal nome vicino", () => {
  const manualMilk = { id: "m1", product: "Latte", quantity: { value: 1000, unit: "ml" as const }, addedAt: `${today}T08:00:00.000Z` };

  function textFor(l: ReturnType<typeof ledger>, name = "Latte"): string | undefined {
    const v = buildShoppingView(input({ pantry: l.pantry(), manual: [{ ...manualMilk, product: name }] }));
    return v.items.find((i) => i.name.toLowerCase() === name.toLowerCase())?.stockText;
  }

  it("«Latte» in lista e «Latte intero» in casa: lo dice, e dice quanto", () => {
    const l = ledger();
    l.buy(20, "Latte intero", 1000, "ml");
    expect(textFor(l)).toBe("In casa hai: latte intero, 1 l");
  });

  it("con la scorta esatta resta «In casa: …» e i vicini non si nominano", () => {
    const l = ledger();
    l.buy(20, "Latte", 1000, "ml");
    l.buy(20, "Latte intero", 500, "ml");
    expect(textFor(l)).toBe("In casa: 1 l");
  });

  it("senza niente di vicino: «Non ne hai in casa»", () => {
    const l = ledger();
    l.buy(20, "Lattuga", 300, "g");
    l.buy(20, "Pane", 500, "g");
    expect(textFor(l)).toBe("Non ne hai in casa");
  });

  it("al massimo due, in ordine di scadenza", () => {
    const l = ledger();
    l.buy(20, "Latte di soia", 500, "ml", { expiryDay: 60 });
    l.buy(20, "Latte intero", 1000, "ml", { expiryDay: 30 });
    l.buy(20, "Latte di avena", 750, "ml", { expiryDay: 90 });
    expect(textFor(l)).toBe("In casa hai: latte intero, 1 l; latte di soia, 0,5 l");
  });

  it("la quantità proposta non cambia", () => {
    const l = ledger();
    const without = buildShoppingView(input({ pantry: l.pantry(), manual: [manualMilk] })).items.find((i) => i.name === "Latte");
    l.buy(20, "Latte intero", 1000, "ml");
    const withNear = buildShoppingView(input({ pantry: l.pantry(), manual: [manualMilk] })).items.find((i) => i.name === "Latte");
    expect(withNear?.quantity).toBe(without?.quantity);
    expect(withNear?.reasons).toEqual(without?.reasons);
  });

  describe("nearFoods", () => {
    const key = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const near = (l: ReturnType<typeof ledger>, name: string) => nearFoods(l.pantry(), { key: key(name), name }, today).map((n) => n.name);

    it("maiuscole e accenti non contano", () => {
      const l = ledger();
      l.buy(20, "CAFFÈ in grani", 250, "g");
      expect(near(l, "caffe")).toEqual(["CAFFÈ in grani"]);
    });

    it("parole intere: «latte» trova «cioccolato al latte», «pane» non trova «panettone»", () => {
      const l = ledger();
      l.buy(20, "Cioccolato al latte", 100, "g");
      l.buy(20, "Panettone", 750, "g");
      l.buy(20, "Pane integrale", 400, "g");
      expect(near(l, "Latte")).toEqual(["Cioccolato al latte"]);
      expect(near(l, "Pane")).toEqual(["Pane integrale"]);
    });

    it("tutte le parole della voce devono esserci, in qualunque ordine", () => {
      const l = ledger();
      l.buy(20, "Latte intero fresco", 1000, "ml");
      l.buy(20, "Latte di soia", 500, "ml");
      expect(near(l, "Fresco latte")).toEqual(["Latte intero fresco"]);
    });

    it("l'alimento finito o scaduto non conta; lo stesso alimento in più confezioni si somma", () => {
      const l = ledger();
      const first = l.buy(20, "Latte intero", 1000, "ml");
      l.use(21, first, 1000, "ml");
      l.buy(22, "Latte di soia", 500, "ml");
      l.buy(22, "Latte di soia", 500, "ml");
      const found = nearFoods(l.pantry(), { key: "latte", name: "Latte" }, today);
      expect(found).toEqual([{ name: "Latte di soia", value: 1000, unit: "ml" }]);
    });
  });
});
