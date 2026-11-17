import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { derivePantry } from "@/core/ledger";
import { buildCaptureEvents } from "../capture";
import {
  buildPackEvents,
  buildPackInputs,
  checkPackGroups,
  defaultExpiryKind,
  draftFromProduct,
  groupsTotal,
  inputFromDraft,
  packsConfirmationText,
  packsLabel,
  splitPackGroups,
} from "./directAdd";
import { loadRemembered, rememberChoice, type ChoiceStore } from "./memory";

const BUDINO: Product = {
  barcode: "8076800195057",
  name: "Budino",
  quantity: { text: "125 g", value: 125, unit: "g" },
  categories: ["puddings"],
  fetchedAt: "2026-11-17T08:00:00.000Z",
  source: "openfoodfacts",
};
const ctx = { now: "2026-11-17T08:00:00.000Z", deviceId: "d" };

describe("scadenza sulla scheda", () => {
  it("il tipo di data dipende dalla categoria", () => {
    expect(defaultExpiryKind("milk_fresh")).toBe("use_by");
    expect(defaultExpiryKind("pasta_dry")).toBe("best_before");
    expect(defaultExpiryKind(undefined)).toBe("best_before");
  });

  it("una data scritta senza tipo prende il tipo della categoria; senza data si salva con la stima", () => {
    const draft = draftFromProduct({ ...BUDINO, categories: ["fresh-milks"] });
    const withDate = buildCaptureEvents(inputFromDraft(draft, "frigo", { expiryDate: "2026-11-20" }), ctx);
    expect(withDate.ok && withDate.events[0]).toMatchObject({ expiry: { date: "2026-11-20", kind: "use_by" } });
    const without = buildCaptureEvents(inputFromDraft(draft, "frigo", { expiryKind: "use_by" }), ctx);
    expect(without.ok && without.events[0]).not.toHaveProperty("expiry");
  });
});

describe("più confezioni", () => {
  const draft = draftFromProduct(BUDINO);

  it("divide il totale in gruppi che sommano al totale", () => {
    expect(splitPackGroups(5)).toEqual([
      { count: 3, expiryDate: "" },
      { count: 2, expiryDate: "" },
    ]);
    expect(splitPackGroups(1, "2026-11-20")).toEqual([{ count: 1, expiryDate: "2026-11-20" }]);
    expect(groupsTotal(splitPackGroups(7))).toBe(7);
    expect(checkPackGroups(splitPackGroups(5), 5)).toBeNull();
    expect(checkPackGroups([{ count: 2, expiryDate: "" }], 5)).toMatch(/Mancano 3/);
    expect(checkPackGroups([{ count: 6, expiryDate: "" }], 5)).toMatch(/1 confezioni in più/);
  });

  it("scrive un lotto per confezione, in una sola lista, ognuno con la sua data", () => {
    const groups = [
      { count: 2, expiryDate: "2026-11-20" },
      { count: 3, expiryDate: "" },
    ];
    const result = buildPackEvents(buildPackInputs(draft, "frigo", {}, groups), ctx);
    if (!result.ok) throw new Error("build");
    expect(result.events).toHaveLength(5);
    expect(new Set(result.lotIds).size).toBe(5);
    const lots = derivePantry(result.events).lots;
    expect(lots).toHaveLength(5);
    expect(lots.filter((l) => l.expiry?.date === "2026-11-20")).toHaveLength(2);
    expect(lots.filter((l) => l.expiry === undefined)).toHaveLength(3);
    const text = packsConfirmationText(result.events, "2026-11-17");
    expect(text).toContain("5 × 125 g");
    expect(text).toContain("2 entro 20 nov 2026");
  });

  it("una lettura successiva con un'altra data aggiunge altri lotti, senza fusioni", () => {
    const first = buildPackEvents(buildPackInputs(draft, "frigo", {}, [{ count: 2, expiryDate: "2026-11-20" }]), ctx);
    const second = buildPackEvents(buildPackInputs(draft, "frigo", {}, [{ count: 3, expiryDate: "2026-11-28" }]), ctx);
    if (!first.ok || !second.ok) throw new Error("build");
    const lots = derivePantry([...first.events, ...second.events]).lots;
    expect(lots).toHaveLength(5);
    expect(new Set(lots.map((l) => l.expiry?.date))).toEqual(new Set(["2026-11-20", "2026-11-28"]));
  });

  it("se una confezione non è valida non si scrive niente", () => {
    const bad = buildPackEvents(buildPackInputs(draft, "frigo", {}, [{ count: 2, expiryDate: "2026-02-31" }]), ctx);
    expect(bad.ok).toBe(false);
  });

  it("etichetta del totale", () => {
    expect(packsLabel(3, "170 g")).toBe("3 × 170 g");
    expect(packsLabel(1, "170 g")).toBe("170 g");
  });
});

describe("memoria delle scelte", () => {
  const memory = (): ChoiceStore => {
    const map = new Map<string, unknown>();
    return { get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
  };
  const mousse = { barcode: "8000000000017", categories: ["dairies", "desserts", "mousses"] };

  it("riproporre categoria e luogo per lo stesso codice", async () => {
    const store = memory();
    await rememberChoice(mousse, { category: "yogurt", location: "frigo" }, store);
    expect(await loadRemembered(mousse, store)).toEqual({ kind: "barcode", category: "yogurt", location: "frigo" });
  });

  it("un prodotto simile eredita la categoria", async () => {
    const store = memory();
    await rememberChoice(mousse, { category: "ready_meals", location: "frigo" }, store);
    expect(await loadRemembered({ barcode: "8000000000024", categories: ["dairies", "desserts", "mousses"] }, store)).toEqual({
      kind: "similar",
      category: "ready_meals",
    });
    expect(await loadRemembered({ barcode: "8000000000031", categories: ["pastas"] }, store)).toBeUndefined();
  });

  it("ignora valori non validi", async () => {
    const store = memory();
    await store.set("barcode.choice.1", { category: "boh", location: "frigo" });
    expect(await loadRemembered({ barcode: "1" }, store)).toBeUndefined();
  });
});
