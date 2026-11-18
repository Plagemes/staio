import { describe, expect, it } from "vitest";
import { createIdGenerator, derivePantry, type LedgerEvent, type PurchaseEvent } from "@/core/ledger";
import {
  buildExpiryEvents,
  expiryReviewRows,
  freshExpiryEstimate,
  labelKindFor,
  needsExpiryReview,
  shortcutDate,
  withExpiryChoices,
  type ExpiryChoice,
} from "./receiptExpiry";

const NOW = "2026-11-17T09:30:00.000Z";
let t = 1_790_000_000_000;
const ids = () => createIdGenerator({ now: () => t++, random: () => 0.5 });

function purchase(lotId: string, productRef: string, category: string, location: PurchaseEvent["location"] = "frigo", extra: Partial<PurchaseEvent> = {}): PurchaseEvent {
  return {
    id: `p-${lotId}`,
    type: "purchase",
    at: "2026-11-17T12:00:00.000Z",
    recordedAt: NOW,
    deviceId: "dev",
    schemaVersion: 1,
    certainty: "estimated",
    source: "receipt",
    lotId,
    productRef,
    category,
    quantity: { value: 500, unit: "g" },
    location,
    ...extra,
  };
}

describe("needsExpiryReview", () => {
  it("vale per carne, pesce, latticini freschi e verdura a foglia", () => {
    for (const c of ["red_meat_fresh", "ground_meat", "poultry", "fish_fresh", "cold_cuts_sliced", "milk_fresh", "cheese_fresh", "leafy_vegetables", "berries"]) {
      expect(needsExpiryReview(c, "frigo"), c).toBe(true);
    }
  });

  it("non vale per ciò che dura a lungo, per il freezer o per una categoria sconosciuta", () => {
    expect(needsExpiryReview("milk_uht", "frigo")).toBe(false);
    expect(needsExpiryReview("cheese_aged", "frigo")).toBe(false);
    expect(needsExpiryReview("root_vegetables", "dispensa")).toBe(false);
    expect(needsExpiryReview("poultry", "freezer")).toBe(false);
    expect(needsExpiryReview("boh", "frigo")).toBe(false);
    expect(needsExpiryReview(undefined, "frigo")).toBe(false);
  });
});

describe("expiryReviewRows", () => {
  const purchases = [
    purchase("a", "Petto di pollo", "poultry"),
    purchase("b", "Latte UHT", "milk_uht", "dispensa"),
    purchase("c", "Insalata", "leafy_vegetables"),
    purchase("d", "Mozzarella", "cheese_fresh", "frigo", { expiry: { date: "2026-11-20", kind: "use_by" } }),
  ];

  it("ha una riga per ogni deperibile senza data, con la stima già calcolata", () => {
    const rows = expiryReviewRows(purchases);
    expect(rows.map((r) => r.name)).toEqual(["Petto di pollo", "Insalata"]);
    expect(rows[0].estimate).toBe("2026-11-19");
    expect(rows[1].estimate).toBe("2026-11-21");
  });

  it("è vuota se non ci sono deperibili", () => {
    expect(expiryReviewRows([purchases[1]])).toEqual([]);
  });
});

describe("tasti rapidi", () => {
  it("danno la data a partire da oggi", () => {
    expect(shortcutDate("2026-11-17", 3)).toBe("2026-11-20");
    expect(shortcutDate("2026-11-17", 7)).toBe("2026-11-24");
  });
});

describe("buildExpiryEvents", () => {
  const ctx = { now: NOW, deviceId: "dev", idGenerator: ids() };
  const purchases = [purchase("a", "Petto di pollo", "poultry"), purchase("c", "Insalata", "leafy_vegetables")];

  it("scrive un updateLot per ogni scelta e niente per le altre", () => {
    const r = buildExpiryEvents(purchases, { a: { date: "2026-11-20", via: "shortcut" } }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    const e = r.events[0] as Extract<LedgerEvent, { type: "updateLot" }>;
    expect(e).toMatchObject({ type: "updateLot", lotId: "a", certainty: "estimated", source: "receipt", patch: { expiry: { date: "2026-11-20", kind: "estimated" } } });
  });

  it("una data stampata ha certezza label e il tipo della categoria", () => {
    const r = buildExpiryEvents(purchases, { a: { date: "2026-11-19", via: "label" }, c: { date: "2026-11-22", via: "label" } }, ctx);
    expect(r.ok && r.events.map((e) => (e.type === "updateLot" ? [e.certainty, e.patch.expiry?.kind] : null))).toEqual([
      ["label", "use_by"],
      ["label", "best_before"],
    ]);
    expect(labelKindFor("poultry")).toBe("use_by");
    expect(labelKindFor("leafy_vegetables")).toBe("best_before");
  });

  it("rifiuta una data non valida", () => {
    const r = buildExpiryEvents(purchases, { a: { date: "2026-13-40", via: "label" } }, ctx);
    expect(r).toEqual({ ok: false, errors: { a: "Scrivi una data valida." } });
  });
});

describe("freshExpiryEstimate", () => {
  it("dà la stessa stima della revisione per i freschi, niente per il resto", () => {
    expect(freshExpiryEstimate({ category: "poultry", location: "frigo", at: "2026-11-17T12:00:00.000Z" })).toBe("2026-11-19");
    expect(freshExpiryEstimate({ category: "milk_uht", location: "dispensa", at: "2026-11-17T12:00:00.000Z" })).toBeUndefined();
    expect(freshExpiryEstimate({ category: "poultry", location: "freezer", at: "2026-11-17T12:00:00.000Z" })).toBeUndefined();
    expect(freshExpiryEstimate({ category: "", location: "frigo", at: "2026-11-17T12:00:00.000Z" })).toBeUndefined();
  });
});

describe("withExpiryChoices", () => {
  const purchases = [
    purchase("a", "Petto di pollo", "poultry"),
    purchase("b", "Latte UHT", "milk_uht", "dispensa"),
    purchase("c", "Insalata", "leafy_vegetables"),
  ];

  it("un tasto rapido mette sull'acquisto una scadenza stimata", () => {
    const r = withExpiryChoices(purchases, { a: { date: "2026-11-20", via: "shortcut" } });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.purchases[0].expiry).toEqual({ date: "2026-11-20", kind: "estimated" });
    expect(r.purchases[0]).toMatchObject({ type: "purchase", lotId: "a", certainty: "estimated", source: "receipt" });
  });

  it("una data stampata ha il tipo della categoria", () => {
    const r = withExpiryChoices(purchases, { a: { date: "2026-11-19", via: "label" }, c: { date: "2026-11-22", via: "label" } });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.purchases.map((p) => p.expiry?.kind)).toEqual(["use_by", undefined, "best_before"]);
  });

  it("una data non valida ferma tutto e dice quale riga", () => {
    expect(withExpiryChoices(purchases, { a: { date: "2026-13-40", via: "label" } })).toEqual({ ok: false, errors: { a: "Scrivi una data valida." } });
  });

  it("senza scelte gli acquisti restano quelli, e la stima resta per categoria", () => {
    const r = withExpiryChoices(purchases, {});
    if (!r.ok) throw new Error("atteso ok");
    expect(r.purchases).toEqual(purchases);
    expect(r.purchases.every((p) => p.expiry === undefined)).toBe(true);
  });

  it("una data scelta vale anche se la riga non è più un fresco (categoria o luogo cambiati dopo)", () => {
    const r = withExpiryChoices(purchases, { b: { date: "2026-12-20", via: "label" } });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.purchases[1].expiry).toEqual({ date: "2026-12-20", kind: "best_before" });
    const frozen = withExpiryChoices([purchase("f", "Pollo", "poultry", "freezer")], { f: { date: "2026-11-20", via: "shortcut" } });
    expect(frozen.ok && frozen.purchases[0].expiry).toEqual({ date: "2026-11-20", kind: "estimated" });
  });

  it("una scadenza già sull'acquisto non si tocca", () => {
    const dated = purchase("d", "Mozzarella", "cheese_fresh", "frigo", { expiry: { date: "2026-11-20", kind: "use_by" } });
    const r = withExpiryChoices([dated], { d: { date: "2026-11-25", via: "label" } });
    expect(r.ok && r.purchases[0]).toBe(dated);
  });

  it("non cambia gli acquisti ricevuti", () => {
    const before = JSON.stringify(purchases);
    withExpiryChoices(purchases, { a: { date: "2026-11-20", via: "shortcut" }, c: { date: "2026-11-22", via: "label" } });
    expect(JSON.stringify(purchases)).toBe(before);
  });

  it("il lotto ha la stessa scadenza che darebbe buildExpiryEvents scritto dopo", () => {
    const choices: Record<string, ExpiryChoice> = { a: { date: "2026-11-20", via: "shortcut" }, c: { date: "2026-11-22", via: "label" } };
    const at = withExpiryChoices(purchases, choices);
    if (!at.ok) throw new Error("atteso ok");
    const after = buildExpiryEvents(purchases, choices, { now: NOW, deviceId: "dev", idGenerator: ids() });
    if (!after.ok) throw new Error("atteso ok");
    const oneWrite = derivePantry(at.purchases).lots;
    const twoWrites = derivePantry([...purchases, ...after.events]).lots;
    for (const lotId of ["a", "b", "c"]) {
      expect(oneWrite.find((l) => l.lotId === lotId)?.expiry, lotId).toEqual(twoWrites.find((l) => l.lotId === lotId)?.expiry);
    }
    expect(oneWrite.find((l) => l.lotId === "a")?.expiry).toEqual({ date: "2026-11-20", kind: "estimated" });
    expect(oneWrite.find((l) => l.lotId === "c")?.expiry).toEqual({ date: "2026-11-22", kind: "best_before" });
  });
});
