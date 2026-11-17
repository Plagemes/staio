import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { composeList, emptyRejections, rejectItem, rejectionWeight, type ListItem } from "./list";
import { emptyStockConfig, setMinimum } from "./stock";
import { day, ledger, milkLedger, seededRandom, shuffled } from "./test-helpers";

const TODAY = day(28);

function kinds(item: ListItem): string[] {
  return item.reasons.map((r) => r.kind);
}

describe("composizione della lista", () => {
  it("propone il latte in esaurimento con la ragione e la confezione abituale", () => {
    const list = composeList({ today: TODAY, pantry: milkLedger().pantry() });
    expect(list.items).toHaveLength(1);
    const [milk] = list.items;
    expect(milk).toMatchObject({ key: "latte", unit: "ml", stock: 80, packSize: 1000, quantity: 1000 });
    expect(kinds(milk)).toEqual(["running_out"]);
    expect(milk.reasons[0]).toMatchObject({ kind: "running_out", certainty: "estimated" });
    expect(milk.essentialQuantity).toBeGreaterThan(0);
    expect(milk.essentialQuantity).toBeLessThan(milk.quantity);
    expect(list.suppressed).toHaveLength(0);
  });

  it("non propone nulla se la dispensa copre l'orizzonte", () => {
    const l = milkLedger();
    l.buy(28, "Latte", 6000, "ml");
    expect(composeList({ today: TODAY, pantry: l.pantry() }).items).toHaveLength(0);
  });

  it("non indovina il consumo con storico insufficiente", () => {
    const l = ledger();
    const lot = l.buy(0, "Tonno", 400, "g");
    l.use(20, lot, 380, "g");
    const list = composeList({ today: TODAY, pantry: l.pantry() });
    expect(list.items).toHaveLength(0);
  });

  it("riunisce più ragioni nella stessa voce, che pesa di più", () => {
    const single = composeList({ today: TODAY, pantry: milkLedger().pantry() }).items[0];
    const list = composeList({
      today: TODAY,
      pantry: milkLedger().pantry(),
      stock: setMinimum(emptyStockConfig(), "latte", "ml", 500),
      manual: [{ product: "LATTE", quantity: { value: 1, unit: "l" } }],
    });
    expect(list.items).toHaveLength(1);
    expect(kinds(list.items[0])).toEqual(["manual", "below_minimum", "running_out"]);
    expect(list.items[0].priority).toBeGreaterThan(single.priority);
    expect(list.items[0].quantity).toBe(1000);
  });

  it("scorta minima: propone quanto manca anche senza storico", () => {
    const l = ledger();
    l.buy(0, "Riso", 300, "g");
    const list = composeList({
      today: TODAY,
      pantry: l.pantry(),
      stock: setMinimum(emptyStockConfig(), "Riso", "g", 1000),
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].reasons[0]).toMatchObject({ kind: "below_minimum", minimum: 1000, stock: 300 });
    // Mancano 700 g; la confezione abituale è da 300 g: 3 confezioni.
    expect(list.items[0].packSize).toBe(300);
    expect(list.items[0].quantity).toBe(900);
    expect(list.items[0].essentialQuantity).toBe(700);
  });

  it("piano: propone solo il fabbisogno non coperto, convertendo le unità", () => {
    const l = ledger();
    l.buy(0, "Pasta", 200, "g");
    const list = composeList({
      today: TODAY,
      pantry: l.pantry(),
      planNeeds: [
        { product: "pasta", quantity: { value: 0.3, unit: "kg" }, date: day(30) },
        { product: "Pasta", quantity: { value: 200, unit: "g" }, date: day(32) },
        { product: "Uova", quantity: { value: 4, unit: "pz" }, date: day(29) },
        { product: "Sale", quantity: { value: 5, unit: "g" }, date: day(10) },
      ],
    });
    const pasta = list.items.find((i) => i.key === "pasta");
    expect(pasta?.quantity).toBe(300);
    expect(pasta?.reasons[0]).toMatchObject({ kind: "plan", needed: 500, earliestDate: day(30) });
    expect(list.items.find((i) => i.key === "uova")?.quantity).toBe(4);
    expect(list.issues).toEqual([{ code: "plan_in_past", source: "plan", product: "Sale" }]);
  });

  it("piano coperto dalla dispensa: nessuna voce", () => {
    const l = ledger();
    l.buy(0, "Pasta", 1000, "g");
    const list = composeList({
      today: TODAY,
      pantry: l.pantry(),
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(30) }],
    });
    expect(list.items).toHaveLength(0);
  });

  it("piano oltre la data limite è ignorato", () => {
    const list = composeList(
      {
        today: TODAY,
        pantry: ledger().pantry(),
        planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(40) }],
      },
      { planUntil: day(35) },
    );
    expect(list.items).toHaveLength(0);
  });

  it("ingrediente che completa un alimento in scadenza", () => {
    const l = ledger();
    l.buy(20, "Basilico", 1, "pz");
    const m1 = l.buy(0, "Mozzarella", 125, "g");
    const m2 = l.buy(10, "Mozzarella", 125, "g");
    l.use(11, m1, 125, "g");
    l.use(12, m2, 125, "g");
    const list = composeList({
      today: TODAY,
      pantry: l.pantry(),
      pairs: [
        { ingredient: "Mozzarella", forProduct: "Pomodori", expiresOn: day(29) },
        { ingredient: "Pane", forProduct: "Pomodori", quantity: { value: 300, unit: "g" } },
        { ingredient: "Capperi", forProduct: "Pomodori" },
      ],
    });
    const moz = list.items.find((i) => i.key === "mozzarella");
    expect(moz?.quantity).toBe(125);
    expect(moz?.reasons[0]).toMatchObject({
      kind: "completes_expiring",
      forProduct: "Pomodori",
      expiresOn: day(29),
    });
    expect(list.items.find((i) => i.key === "pane")?.quantity).toBe(300);
    expect(list.items.find((i) => i.key === "capperi")).toBeUndefined();
    expect(list.issues).toEqual([{ code: "quantity_unknown", source: "pair", product: "Capperi" }]);
  });

  it("segnala gli ingressi non validi senza inventare", () => {
    const list = composeList({
      today: TODAY,
      pantry: ledger().pantry(),
      manual: [
        { product: "Pizzico di sale", quantity: { value: 1, unit: "pizzico" } },
        { product: "Acqua", quantity: { value: -2, unit: "l" } },
        { product: " ", quantity: { value: 2, unit: "l" } },
      ],
      planNeeds: [{ product: "Pasta", quantity: { value: 100, unit: "g" }, date: "domani" }],
    });
    expect(list.items).toHaveLength(0);
    expect(list.issues.map((i) => i.code).sort()).toEqual([
      "invalid_date",
      "invalid_product",
      "invalid_quantity",
      "invalid_quantity",
    ]);
  });

  it("segnala la scorta dello stesso prodotto in un'altra unità", () => {
    const l = ledger();
    l.buy(0, "Pomodori", 6, "pz");
    const list = composeList({
      today: TODAY,
      pantry: l.pantry(),
      manual: [{ product: "Pomodori", quantity: { value: 500, unit: "g" } }],
    });
    expect(list.items[0]).toMatchObject({ unit: "g", stock: 0, quantity: 500 });
    expect(list.items[0].stockInOtherUnits).toEqual([{ unit: "pz", quantity: 6 }]);
  });

  it("la quantità tiene conto della durata dell'alimento", () => {
    // Latte con scadenza a 3 giorni dall'acquisto: non si compra più di quanto dura.
    const l = ledger();
    for (let w = 0; w < 4; w++) {
      const lot = l.buy(w * 7, "Latte", 1000, "ml", { expiryDay: w * 7 + 3 });
      for (let d = 0; d < 7; d++) l.use(w * 7 + d, lot, 140, "ml");
    }
    const list = composeList({ today: TODAY, pantry: l.pantry() });
    const milk = list.items[0];
    expect(milk.notes).toContainEqual({ code: "shelf_life_cap", days: 3 });
    // 3 giorni a ~135 ml = ~405 ml; la confezione da 1 l non si finirebbe: si propone il necessario.
    expect(milk.notes.some((n) => n.code === "pack_exceeds_shelf_life")).toBe(true);
    expect(milk.quantity).toBeLessThan(1000);
    expect(milk.quantity).toBeGreaterThan(300);
  });

  it("la quantità tiene conto dello spreco passato: formato troppo grande e cautela", () => {
    const l = ledger();
    for (let k = 0; k < 4; k++) {
      const lot = l.buy(k * 10, "Insalata", 500, "g");
      l.use(k * 10 + 1, lot, 100, "g");
      l.toss(k * 10 + 5, lot, 400, "g");
    }
    const small = l.buy(36, "Insalata", 250, "g");
    l.use(37, small, 250, "g");
    const list = composeList({
      today: day(40),
      pantry: l.pantry(),
      stock: setMinimum(emptyStockConfig(), "Insalata", "g", 300),
    });
    const salad = list.items[0];
    expect(salad.packSize).toBe(250);
    expect(salad.notes.map((n) => n.code).sort()).toEqual(["format_too_big", "waste_caution"]);
    // Cautela: si arrotonda al più vicino (1 confezione), non per eccesso (2).
    expect(salad.quantity).toBe(250);
  });

  it("non dipende dall'ordine degli eventi né da quello degli ingressi", () => {
    const l = milkLedger();
    const input = {
      stock: setMinimum(emptyStockConfig(), "Riso", "g", 500),
      manual: [
        { product: "Caffè", quantity: { value: 250, unit: "g" as const } },
        { product: "Pane", quantity: { value: 1, unit: "pz" as const } },
      ],
      planNeeds: [
        { product: "Pasta", quantity: { value: 300, unit: "g" as const }, date: day(30) },
        { product: "Uova", quantity: { value: 6, unit: "pz" as const }, date: day(29) },
      ],
    };
    const reference = composeList({ today: TODAY, pantry: l.pantry(), ...input });
    for (let seed = 1; seed <= 5; seed++) {
      const rnd = seededRandom(seed);
      const list = composeList({
        today: TODAY,
        pantry: derivePantry(shuffled(l.events, rnd)),
        stock: input.stock,
        manual: shuffled(input.manual, rnd),
        planNeeds: shuffled(input.planNeeds, rnd),
      });
      expect(list).toEqual(reference);
    }
  });
});

describe("rifiuti", () => {
  const milkItem = () => composeList({ today: TODAY, pantry: milkLedger().pantry() }).items[0];

  it("un rifiuto abbassa la priorità di quella proposta senza toccare la memoria di partenza", () => {
    const before = milkItem();
    const memory = rejectItem(emptyRejections(), before, TODAY);
    expect(memory.entries).toHaveLength(1);
    expect(emptyRejections().entries).toHaveLength(0);
    const after = composeList({ today: TODAY, pantry: milkLedger().pantry(), rejections: memory })
      .items[0];
    expect(after.priority).toBeLessThan(before.priority);
    expect(after.reasons[0].rejections).toBeCloseTo(1, 2);
    expect(after.reasons[0].strength).toBeCloseTo(before.reasons[0].strength / 2, 2);
    expect(after.quantity).toBe(before.quantity);
  });

  it("rifiuti ripetuti sospendono la voce, ma restano visibili", () => {
    let memory = emptyRejections();
    memory = rejectItem(memory, milkItem(), day(27));
    memory = rejectItem(memory, milkItem(), TODAY);
    const list = composeList({ today: TODAY, pantry: milkLedger().pantry(), rejections: memory });
    expect(list.items).toHaveLength(0);
    expect(list.suppressed).toHaveLength(1);
    expect(list.suppressed[0].key).toBe("latte");
  });

  it("il rifiuto vale per la ragione: lo stesso prodotto richiesto da un piano torna forte", () => {
    let memory = emptyRejections();
    memory = rejectItem(memory, milkItem(), day(27));
    memory = rejectItem(memory, milkItem(), TODAY);
    const list = composeList({
      today: TODAY,
      pantry: milkLedger().pantry(),
      rejections: memory,
      planNeeds: [{ product: "Latte", quantity: { value: 1000, unit: "ml" }, date: day(29) }],
    });
    expect(list.suppressed).toHaveLength(0);
    expect(kinds(list.items[0])).toEqual(["plan", "running_out"]);
    expect(list.items[0].reasons[0].rejections).toBe(0);
  });

  it("le voci del piano non vengono mai sospese, solo penalizzate", () => {
    const base = composeList({
      today: TODAY,
      pantry: ledger().pantry(),
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(30) }],
    });
    let memory = emptyRejections();
    for (let i = 0; i < 6; i++) memory = rejectItem(memory, base.items[0], TODAY);
    const list = composeList({
      today: TODAY,
      pantry: ledger().pantry(),
      planNeeds: [{ product: "Pasta", quantity: { value: 500, unit: "g" }, date: day(30) }],
      rejections: memory,
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].priority).toBeLessThan(base.items[0].priority);
  });

  it("una voce aggiunta a mano non lascia traccia nella memoria dei rifiuti", () => {
    const list = composeList({
      today: TODAY,
      pantry: ledger().pantry(),
      manual: [{ product: "Caffè", quantity: { value: 250, unit: "g" } }],
    });
    expect(rejectItem(emptyRejections(), list.items[0], TODAY).entries).toHaveLength(0);
  });

  it("i rifiuti vecchi pesano meno", () => {
    const memory = rejectItem(emptyRejections(), milkItem(), day(-32));
    const w = rejectionWeight(memory, "latte|ml", "running_out", TODAY, 60);
    expect(w).toBeCloseTo(0.5, 2);
    expect(rejectionWeight(memory, "latte|ml", "plan", TODAY)).toBe(0);
    expect(() => rejectItem(emptyRejections(), milkItem(), "ieri")).toThrow();
  });
});
