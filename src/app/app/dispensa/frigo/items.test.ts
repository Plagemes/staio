import { describe, expect, it } from "vitest";
import { activeLots, derivePantry, type LedgerEvent } from "@/core/ledger";
import { buildCaptureEvents, type CaptureInput } from "@/features/capture";
import { evaluateLots } from "@/features/lots";
import { buildModel } from "@/models3d/generate";
import { layoutItems } from "@/models3d/fridge/layout";
import { furnitureSpec } from "@/models3d/fridge/furniture";
import { itemScale } from "@/models3d/fridge/layout";
import { validateRecipe } from "@/models3d/recipe";
import { sceneItemsFor } from "./items";

const NOW = "2026-11-16T10:00:00.000Z";
const base: CaptureInput = {
  name: "Petto di pollo",
  quantityText: "400 g",
  location: "frigo",
  category: "poultry",
  expiryKind: "use_by",
  expiryDate: "2026-11-17",
  priceText: "",
  alreadyHave: false,
};

function add(over: Partial<CaptureInput>, now = NOW): LedgerEvent[] {
  const r = buildCaptureEvents({ ...base, ...over }, { now, deviceId: "d" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

const events = [
  ...add({ name: "Latte fresco", quantityText: "1 l", category: "milk_fresh", expiryDate: "2026-11-17" }),
  ...add({ name: "Zucchine", quantityText: "500 g", category: "other_vegetables", expiryDate: "2026-12-10" }),
  ...add({ name: "Petto di pollo", category: "poultry", expiryDate: "2026-11-15" }),
  ...add({ name: "Gelato alla crema", quantityText: "500 g", category: "frozen_foods", location: "freezer", expiryKind: "none", expiryDate: "" }),
  ...add({ name: "Prodotto mai visto 77", quantityText: "3 pz", category: "snacks_dry", expiryKind: "none", expiryDate: "" }),
];

const entries = evaluateLots(activeLots(derivePantry(events)), NOW);
const inFridge = entries.filter((e) => e.lot.location === "frigo");

describe("sceneItemsFor", () => {
  const items = sceneItemsFor(inFridge);

  it("un alimento per lotto, con la priorità dell'ordine «da mangiare prima»", () => {
    expect(items).toHaveLength(inFridge.length);
    expect(items.map((i) => i.priority)).toEqual(items.map((_, i) => i));
    expect(items.map((i) => i.id)).toEqual(inFridge.map((e) => e.lot.lotId));
  });

  it("segna in rosso ciò che è scaduto o scade presto e non il resto", () => {
    const byName = new Map(items.map((i) => [i.name, i]));
    expect(byName.get("Petto di pollo")?.signal).toBe(true);
    expect(byName.get("Latte fresco")?.signal).toBe(true);
    expect(byName.get("Zucchine")?.signal).toBe(false);
  });

  it("sceglie un modello valido per ogni alimento, dal catalogo o dal ripiego", () => {
    for (const item of items) {
      expect(validateRecipe(item.recipe).ok, item.name).toBe(true);
      expect(buildModel(item.recipe, item.seed).parts.length).toBeGreaterThan(0);
    }
    expect(items.find((i) => i.name === "Zucchine")?.recipe.id).toBe("vd-zucchina");
  });

  it("le verdure preferiscono il cassetto, le bottiglie e i cartoni lo sportello", () => {
    expect(items.find((i) => i.name === "Zucchine")?.prefer).toBe("drawer");
    expect(items.find((i) => i.name === "Latte fresco")?.prefer).toBe("door");
    expect(items.find((i) => i.name === "Petto di pollo")?.prefer).toBeUndefined();
  });

  it("il seme dipende dalla ricetta e dal lotto, in modo stabile", () => {
    const again = sceneItemsFor(inFridge);
    expect(again.map((i) => i.seed)).toEqual(items.map((i) => i.seed));
    for (const i of items) expect(i.seed).toMatch(new RegExp(`^${i.recipe.id}:[01]$`));
  });

  it("il livello rimasto viene dal lotto", () => {
    const [first] = inFridge;
    const half = { ...first, lot: { ...first.lot, remaining: first.lot.initial / 2 } };
    expect(sceneItemsFor([half])[0].level).toBeCloseTo(0.5, 5);
    expect(sceneItemsFor([first])[0].level).toBeCloseTo(1, 5);
  });

  it("scrive per ogni alimento una frase con nome e scadenza, per chi non vede la scena", () => {
    for (const item of items) expect(item.caption).toContain(item.name);
    const [first] = inFridge;
    const undated = { ...first, lot: { ...first.lot, category: undefined, expiry: undefined }, expiry: undefined, urgency: undefined };
    const [plain] = sceneItemsFor([undated]);
    expect(plain.caption).toContain("senza data");
    expect(plain.signal).toBe(false);
    expect(validateRecipe(plain.recipe).ok).toBe(true);
    expect(items.find((i) => i.name === "Petto di pollo")?.caption).toMatch(/scadut/);
  });

  it("si dispone in un mobile: gli alimenti del frigo entrano tutti", () => {
    const sized = items.map((i) => {
      const model = buildModel(i.recipe, i.seed);
      return { i, size: itemScale(i.recipe.heightCm, model.size, i.level).size };
    });
    const result = layoutItems(
      furnitureSpec("fridge"),
      sized.map(({ i, size }) => ({ id: i.id, name: i.name, size, priority: i.priority, prefer: i.prefer })),
    );
    expect(result.hidden).toEqual([]);
    expect(result.placements).toHaveLength(items.length);
  });

  it("un elenco vuoto dà una scena vuota", () => {
    expect(sceneItemsFor([])).toEqual([]);
  });
});
