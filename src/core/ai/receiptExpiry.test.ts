import { describe, expect, it } from "vitest";
import { createIdGenerator, type LedgerEvent, type PurchaseEvent } from "@/core/ledger";
import { buildExpiryEvents, expiryReviewRows, labelKindFor, needsExpiryReview, shortcutDate } from "./receiptExpiry";

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
