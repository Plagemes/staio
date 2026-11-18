import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { consume, open, purchase, q } from "@/core/ledger/test-helpers";
import { resolveAmount } from "../actions";
import { evaluateLots } from "../lots";
import { buildMealEvents } from "../meals";
import {
  addFreeItem,
  addPantryItem,
  missingText,
  pickedFor,
  eatOrder,
  productKey,
  productRows,
  rowChoices,
  rowDetail,
  splitAmount,
  startingFrom,
  type PlateItem,
  type ProductRow,
} from "./plate";

const BOUGHT = "2026-11-10T09:00:00.000Z";
const NOW = "2026-11-16T10:00:00.000Z";

function rowsOf(events: LedgerEvent[]): ProductRow[] {
  const lots = derivePantry(events).lots.filter((l) => l.status === "active");
  return productRows(evaluateLots(lots, NOW));
}

// Tre mousse uguali, comprate in ordine diverso da quello di scadenza
const mousse: LedgerEvent[] = [
  purchase("m3", BOUGHT, { lotId: "mousse-late", productRef: "Mousse cacao", quantity: q(170), location: "frigo", expiry: { date: "2026-11-30", kind: "use_by" } }),
  purchase("m1", BOUGHT, { lotId: "mousse-soon", productRef: "Mousse cacao", quantity: q(170), location: "frigo", expiry: { date: "2026-11-19", kind: "use_by" } }),
  purchase("m2", BOUGHT, { lotId: "mousse-mid", productRef: "Mousse cacao", quantity: q(170), location: "frigo", expiry: { date: "2026-11-24", kind: "use_by" } }),
];

// Pasta: 50 g nella confezione aperta, 500 g in quella chiusa, con la stessa data
const pasta: LedgerEvent[] = [
  purchase("pa", BOUGHT, { lotId: "pasta-open", productRef: "Pasta", quantity: q(500), location: "dispensa", expiry: { date: "2027-03-01", kind: "best_before" } }),
  purchase("pb", BOUGHT, { lotId: "pasta-closed", productRef: "pasta", quantity: q(500), location: "dispensa", expiry: { date: "2027-03-01", kind: "best_before" } }),
  open("po", "2026-11-12T12:00:00.000Z", { lotId: "pasta-open" }),
  consume("pc", "2026-11-12T12:05:00.000Z", { lotId: "pasta-open", quantity: q(450) }),
];

describe("una riga per prodotto", () => {
  it("tre confezioni uguali sono una riga, dalla prima a scadere", () => {
    const rows = rowsOf(mousse);
    expect(rows).toHaveLength(1);
    expect(rows[0].entries.map((e) => e.lot.lotId)).toEqual(["mousse-soon", "mousse-mid", "mousse-late"]);
    expect(rows[0].total).toBe(510);
    expect(rowDetail(rows[0])).toMatch(/^3 confezioni da 170 g · la prima /);
  });

  it("nome con maiuscole diverse e una confezione aperta: una riga; a parità di scadenza prima l'aperta", () => {
    const rows = rowsOf(pasta);
    expect(rows).toHaveLength(1);
    expect(rows[0].entries.map((e) => e.lot.lotId)).toEqual(["pasta-open", "pasta-closed"]);
    expect(rows[0].total).toBe(550);
    expect(rowDetail(rows[0])).toMatch(/^550 g in 2 confezioni/);
  });

  it("un alimento solo: la quantità e la scadenza", () => {
    const rows = rowsOf([purchase("s", BOUGHT, { lotId: "spinaci", productRef: "Spinaci", quantity: q(150), location: "frigo", expiry: { date: "2026-11-20", kind: "use_by" } })]);
    expect(rowDetail(rows[0])).toBe("150 g · 4 giorni");
  });

  it("unità diverse restano righe diverse", () => {
    const rows = rowsOf([
      purchase("a", BOUGHT, { lotId: "a", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" }),
      purchase("b", BOUGHT, { lotId: "b", productRef: "Latte", quantity: q(2, "pz"), location: "frigo" }),
    ]);
    expect(rows.map((r) => r.unit)).toEqual(["ml", "pz"]);
    expect(rows[0].key).toBe(productKey({ productRef: "Latte", location: "frigo", unit: "ml" }));
  });

  it("l'ordine è quello della scadenza effettiva: un'aperta che scade dopo viene dopo", () => {
    const later = rowsOf([
      purchase("pa", BOUGHT, { lotId: "open-late", productRef: "Pasta", quantity: q(500), location: "dispensa", expiry: { date: "2027-06-01", kind: "best_before" } }),
      purchase("pb", BOUGHT, { lotId: "closed-soon", productRef: "Pasta", quantity: q(500), location: "dispensa", expiry: { date: "2027-03-01", kind: "best_before" } }),
      open("po", "2026-11-12T12:00:00.000Z", { lotId: "open-late" }),
      consume("pc", "2026-11-12T12:05:00.000Z", { lotId: "open-late", quantity: q(450) }),
    ]);
    expect(later[0].entries.map((e) => e.lot.lotId)).toEqual(["closed-soon", "open-late"]);
    expect(eatOrder(later[0].entries).map((e) => e.lot.lotId)).toEqual(["closed-soon", "open-late"]);
  });

  it("due prodotti con lo stesso nome e codici diversi: due righe, distinte dal codice; il pasto scala quello scelto", () => {
    const rows = rowsOf([
      purchase("y1", BOUGHT, { lotId: "yo-a", productRef: "Yogurt greco", barcode: "8000000000011", quantity: q(150), location: "frigo", expiry: { date: "2026-11-20", kind: "use_by" } }),
      purchase("y2", BOUGHT, { lotId: "yo-b", productRef: "Yogurt greco", barcode: "8000000000028", quantity: q(150), location: "frigo", expiry: { date: "2026-11-22", kind: "use_by" } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tell)).toEqual(["codice …0011", "codice …0028"]);
    expect(rowDetail(rows[1])).toBe("150 g · 6 giorni · codice …0028");
    const split = splitAmount(rows[1], { value: 150, estimated: false });
    expect(split.ok && split.picks.map((p) => p.lot.lotId)).toEqual(["yo-b"]);
    expect(splitAmount(rows[1], { value: 200, estimated: false })).toEqual({ ok: false, error: "Ne restano 150 g in tutto." });
  });

  it("il pane in freezer è una riga a parte: non si scala mai «a seguire» da quello in dispensa", () => {
    const rows = rowsOf([
      purchase("b1", BOUGHT, { lotId: "pane-dispensa", productRef: "Pane", quantity: q(500), location: "dispensa", expiry: { date: "2026-11-18", kind: "best_before" } }),
      open("bo", "2026-11-14T08:00:00.000Z", { lotId: "pane-dispensa" }),
      consume("bc", "2026-11-14T08:05:00.000Z", { lotId: "pane-dispensa", quantity: q(450) }),
      purchase("b2", BOUGHT, { lotId: "pane-freezer", productRef: "Pane", quantity: q(500), location: "freezer" }),
    ]);
    expect(rows.map((r) => [r.entries.map((e) => e.lot.lotId), r.tell])).toEqual([
      [["pane-dispensa"], "in dispensa"],
      [["pane-freezer"], "in freezer"],
    ]);
    expect(splitAmount(rows[0], { value: 80, estimated: false })).toEqual({ ok: false, error: "Ne restano 50 g in tutto." });
  });

  it("con ?lotto= si parte da quella confezione", () => {
    const row = rowsOf(mousse)[0];
    const fromLate = startingFrom(row, "mousse-late");
    expect(fromLate.entries.map((e) => e.lot.lotId)).toEqual(["mousse-late", "mousse-soon", "mousse-mid"]);
    const split = splitAmount(fromLate, { value: 170, estimated: false, optionId: "pack-one" });
    expect(split.ok && split.picks.map((p) => p.lot.lotId)).toEqual(["mousse-late"]);
    expect(startingFrom(row, undefined)).toBe(row);
    expect(startingFrom(row, "altro")).toBe(row);
  });
});

describe("quantità proposta", () => {
  it("2. tre confezioni uguali senza «Il solito»: nessuna scelta, mai «1 confezione»", () => {
    const row = rowsOf(mousse)[0];
    const choices = rowChoices(row);
    expect(choices.options.map((o) => o.id)).toEqual(["pack-one", "pack-all"]);
    expect(choices.initial).toBeNull();
  });

  it("3. pasta con «Il solito (80 g)»: la pastiglia c'è anche se nell'aperta ne restano 50, ed è la scelta di partenza", () => {
    const row = rowsOf(pasta)[0];
    const choices = rowChoices(row, { value: 80, unit: "g" });
    expect(choices.options[0]).toMatchObject({ id: "usual", value: 80 });
    expect(choices.initial).toEqual({ value: 80, estimated: false, optionId: "usual" });
    expect(choices.options.find((o) => o.id === "all")?.value).toBe(550);
  });

  it("4. alimento a pezzi: parte «Una piadina»", () => {
    const row = rowsOf([
      purchase("p", BOUGHT, { lotId: "piadine", productRef: "Piadine", quantity: q(200), location: "dispensa", pieces: { count: 2, each: 100, name: "piadina" } }),
    ])[0];
    expect(rowChoices(row).initial).toMatchObject({ value: 100, optionId: "pieces-1" });
  });

  it("5. senza porzione ricordata e senza pezzi: nessuna scelta, e la riga sopra il pulsante dice per che cosa", () => {
    const row = rowsOf([purchase("s", BOUGHT, { lotId: "spinaci", productRef: "Spinaci", quantity: q(150), location: "frigo" })])[0];
    expect(rowChoices(row).initial).toBeNull();
    expect(missingText(["Spinaci"])).toBe("Scegli quanto per: spinaci.");
    expect(missingText([])).toBe("");
  });

  it("«Il solito» uguale a tutto ciò che resta non parte già scelto", () => {
    const row = rowsOf([purchase("s", BOUGHT, { lotId: "spinaci", productRef: "Spinaci", quantity: q(150), location: "frigo" })])[0];
    expect(rowChoices(row, { value: 150, unit: "g" }).initial).toBeNull();
  });
});

describe("divisione tra le confezioni", () => {
  it("2. «1 confezione» di tre uguali: un consumo, dalla prima a scadere, che la finisce", () => {
    const row = rowsOf(mousse)[0];
    const one = rowChoices(row).options.find((o) => o.id === "pack-one");
    const split = splitAmount(row, { value: one!.value, estimated: false, optionId: "pack-one" });
    if (!split.ok) throw new Error(split.error);
    expect(split.picks.map((p) => [p.lot.lotId, p.choice])).toEqual([["mousse-soon", { kind: "all" }]]);
    expect(split.text).toBe("");
  });

  it("3. 80 g di pasta: 50 dalla confezione aperta (finita) e 30 dalla seguente; la somma è la quantità scelta", () => {
    const row = rowsOf(pasta)[0];
    const split = splitAmount(row, { value: 80, estimated: false, optionId: "usual" });
    if (!split.ok) throw new Error(split.error);
    expect(split.picks.map((p) => [p.lot.lotId, p.choice])).toEqual([
      ["pasta-open", { kind: "all" }],
      ["pasta-closed", { kind: "value", value: 30, estimated: false }],
    ]);
    expect(split.parts.reduce((s, p) => s + p.value, 0)).toBe(80);
    expect(split.text).toBe("50 g dalla confezione aperta, 30 g dalla seguente.");

    // il registro scrive due consumi e nessuna confezione va sotto zero
    const meal = buildMealEvents({ kind: "lunch", picks: split.picks, freeItems: [] }, { now: NOW, deviceId: "d" });
    if (!meal.ok) throw new Error(JSON.stringify(meal.errors));
    const consumes = meal.events.filter((e) => e.type === "consume");
    expect(consumes.map((c) => (c.type === "consume" ? [c.lotId, c.quantity.value] : []))).toEqual([
      ["pasta-open", 50],
      ["pasta-closed", 30],
    ]);
    const after = derivePantry([...pasta, ...(consumes as LedgerEvent[])]).lots;
    expect(after.find((l) => l.lotId === "pasta-open")?.remaining).toBe(0);
    expect(after.find((l) => l.lotId === "pasta-closed")?.remaining).toBe(470);
  });

  it("una stima che finisce una confezione resta una stima", () => {
    const row = rowsOf(pasta)[0];
    const split = splitAmount(row, { value: 80, estimated: true });
    if (!split.ok) throw new Error(split.error);
    expect(split.picks[0].choice).toEqual({ kind: "value", value: 50, estimated: true });
    expect(resolveAmount(split.picks[0].lot, split.picks[0].choice)).toMatchObject({ ok: true, certainty: "estimated" });
  });

  it("tre confezioni toccate: la prima, la seconda, la terza", () => {
    const row = rowsOf(mousse)[0];
    const split = splitAmount(row, { value: 400, estimated: false });
    if (!split.ok) throw new Error(split.error);
    expect(split.parts.map((p) => p.value)).toEqual([170, 170, 60]);
    expect(split.text).toBe("170 g dalla prima confezione, 170 g dalla seconda, 60 g dalla terza.");
  });

  it("«Tutte»: ogni confezione finita", () => {
    const row = rowsOf(mousse)[0];
    const split = splitAmount(row, { value: 510, estimated: false, optionId: "pack-all" });
    if (!split.ok) throw new Error(split.error);
    expect(split.picks.map((p) => p.choice.kind)).toEqual(["all", "all", "all"]);
  });

  it("6. più di tutto ciò che c'è: errore, niente da scrivere", () => {
    const row = rowsOf(mousse)[0];
    expect(splitAmount(row, { value: 600, estimated: false })).toEqual({ ok: false, error: "Ne restano 510 g in tutto." });
    expect(splitAmount(row, { value: 0, estimated: false }).ok).toBe(false);
  });
});

describe("il piatto", () => {
  const key = productKey({ productRef: "Petto di pollo", location: "frigo", unit: "g" });
  const frozen = productKey({ productRef: "Petto di pollo", location: "freezer", unit: "g" });

  it("8. la stessa cosa scelta due volte (da «Di solito» e dalla dispensa) è una riga sola", () => {
    let plate: PlateItem[] = [];
    plate = addPantryItem(plate, key, 1, { value: 150, estimated: false });
    plate = addPantryItem(plate, key, 2);
    expect(plate).toHaveLength(1);
    expect(plate[0]).toMatchObject({ id: 1, picked: { value: 150 } });
    // una voce libera con lo stesso nome non si aggiunge
    expect(addFreeItem(plate, "  petto  di POLLO ", "", 3)).toHaveLength(1);
    // lo stesso nome in freezer è un'altra riga: può starci anche lei
    expect(addPantryItem(plate, frozen, 4)).toHaveLength(2);
    // e una voce libera già nel piatto blocca la riga della dispensa con quel nome
    expect(addPantryItem(addFreeItem([], "Petto di pollo", "", 5), key, 6)).toHaveLength(1);
  });

  it("voci libere: nome ripulito, niente doppioni, niente nomi vuoti; il conto delle voci", () => {
    let plate: PlateItem[] = [];
    plate = addFreeItem(plate, "  pizza ", "", 1);
    plate = addFreeItem(plate, "Pizza", "1 pz", 2);
    plate = addFreeItem(plate, "   ", "", 3);
    plate = addPantryItem(plate, key, 4);
    expect(plate.map((i) => (i.kind === "free" ? i.name : i.key))).toEqual(["pizza", key]);
    expect(plate).toHaveLength(2);
  });

  it("una quantità da «Di solito»: la pastiglia uguale; mai tutto né «1 confezione»", () => {
    const pastaRow = rowsOf(pasta)[0];
    const choices = rowChoices(pastaRow, { value: 80, unit: "g" });
    expect(pickedFor(pastaRow, choices, { value: 80, unit: "g" })).toEqual({ value: 80, estimated: false, optionId: "usual" });
    expect(pickedFor(pastaRow, choices, { value: 120, unit: "g" })).toEqual({ value: 120, estimated: false });
    expect(pickedFor(pastaRow, choices, { value: 550, unit: "g" })).toBeUndefined();
    expect(pickedFor(pastaRow, choices, { value: 1, unit: "pz" })).toBeUndefined();
    const mousseRow = rowsOf(mousse)[0];
    expect(pickedFor(mousseRow, rowChoices(mousseRow), { value: 170, unit: "g" })).toBeUndefined();
  });
});
