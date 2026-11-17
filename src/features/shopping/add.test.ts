import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { RecipeIngredient } from "@/core/recipes";
import { emptyRejections, emptyStockConfig } from "@/core/shopping";
import { day, ledger } from "@/core/shopping/test-helpers";
import { getSetting, setSetting, wipeAll } from "@/data";
import { addToShoppingList, addToShoppingListWithUndo, proposalFromShortfalls } from "../recipes/shopping";
import { addManualEntries } from "./add";
import { mergeManualItems } from "./manual";
import { SETTING_KEYS, emptyDecisions, isManualList } from "./settings";
import { buildShoppingView } from "./view";

const NOW = "2026-11-16T10:00:00.000Z";
let n = 0;
const id = () => `id${++n}`;

describe("unione delle voci", () => {
  it("somma stesso prodotto e unità, accoda il resto", () => {
    const first = mergeManualItems([], [{ product: "farina", quantity: { value: 0.5, unit: "kg" } }], NOW, id);
    const out = mergeManualItems(
      first,
      [
        { product: " Farina", quantity: { value: 200, unit: "g" } },
        { product: "Farina", quantity: { value: 1, unit: "pz" } },
        { product: "Olio", quantity: { value: 2, unit: "cucchiaio" } },
      ],
      NOW,
      id,
    );
    expect(out.map((m) => [m.product, m.quantity])).toEqual([
      ["Farina", { value: 700, unit: "g" }],
      ["Farina", { value: 1, unit: "pz" }],
      ["Olio", { value: 30, unit: "ml" }],
    ]);
    expect(first).toHaveLength(1);
    expect(first[0].quantity).toEqual({ value: 500, unit: "g" });
  });

  it("le voci senza quantità restano senza quantità, una sola per prodotto", () => {
    const out = mergeManualItems(
      [],
      [{ product: "Sale" }, { product: "sale" }, { product: "Pepe", quantity: { value: 1, unit: "pizzico" } }, { product: "Sale", quantity: { value: 1, unit: "pz" } }],
      NOW,
      id,
    );
    expect(out.map((m) => [m.product, m.quantity])).toEqual([
      ["Sale", undefined],
      ["Pepe", undefined],
      ["Sale", { value: 1, unit: "pz" }],
    ]);
  });
});

describe("aggiunta dalle ricette alla lista", () => {
  beforeEach(async () => {
    await wipeAll();
  });

  const shortfalls: RecipeIngredient[] = [{ name: "Farina", quantity: { value: 0.5, unit: "kg" } }, { name: "Basilico" }];

  it("scrive nella forma che la schermata legge, con le voci senza quantità, e si annulla", async () => {
    const proposal = proposalFromShortfalls(shortfalls);
    expect(proposal.entries).toHaveLength(2);
    const r = await addToShoppingListWithUndo(proposal.entries);
    expect(r).toMatchObject({ added: 2, withoutQuantity: 1 });
    const stored = await getSetting<unknown>(SETTING_KEYS.manual);
    expect(isManualList(stored)).toBe(true);
    if (!isManualList(stored)) return;
    expect(stored.map((m) => [m.product, m.quantity])).toEqual([
      ["Farina", { value: 500, unit: "g" }],
      ["Basilico", undefined],
    ]);

    const view = buildShoppingView({
      today: day(5),
      pantry: ledger().pantry(),
      planNeeds: [],
      manual: stored,
      pairs: [],
      stock: emptyStockConfig(),
      rejections: emptyRejections(),
      decisions: emptyDecisions(),
      budgetCents: null,
    });
    expect(view.items.map((i) => i.name)).toEqual(["Farina"]);
    expect(view.items[0].reasons).toEqual(["aggiunta da te"]);
    expect(view.noQuantity.map((i) => i.name)).toEqual(["Basilico"]);

    await r.undo();
    expect(await getSetting<unknown>(SETTING_KEYS.manual)).toEqual([]);
  });

  it("una seconda aggiunta somma le quantità e conta le voci", async () => {
    expect(await addToShoppingList(proposalFromShortfalls(shortfalls).entries)).toBe(2);
    expect(await addToShoppingList(proposalFromShortfalls([{ name: "farina", quantity: { value: 250, unit: "g" } }]).entries)).toBe(1);
    const stored = (await getSetting<unknown>(SETTING_KEYS.manual)) as Array<{ product: string; quantity?: { value: number } }>;
    expect(stored.find((m) => m.product === "Farina")?.quantity?.value).toBe(750);
    expect(stored).toHaveLength(2);
  });

  it("non scrive niente se non c'è niente da aggiungere", async () => {
    const r = await addManualEntries([{ product: "  " }]);
    expect(r.added).toBe(0);
    expect(await getSetting<unknown>(SETTING_KEYS.manual)).toBeUndefined();
  });

  it("riprende le voci scritte nella forma semplice di prima", async () => {
    await setSetting(SETTING_KEYS.manual, [{ product: "Latte", quantity: { value: 1000, unit: "ml" } }]);
    await addManualEntries([{ product: "Pane" }]);
    const stored = (await getSetting<unknown>(SETTING_KEYS.manual)) as Array<{ id: string; product: string }>;
    expect(stored.map((m) => m.product)).toEqual(["Latte", "Pane"]);
    expect(stored.every((m) => typeof m.id === "string")).toBe(true);
  });
});
