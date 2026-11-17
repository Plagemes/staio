import { describe, expect, it } from "vitest";
import { SHELF_LIFE, canFreeze, effectiveExpiry, isFoodCategory, lotExpiry, lotToExpiryItem, usableDaysAfterOpening, type ExpiryItem, type LotLike } from "./index";

const NOW = "2026-11-17";

function item(over: Partial<ExpiryItem> = {}): ExpiryItem {
  return {
    id: "x",
    labelDateType: "none",
    purchaseDate: "2026-11-08",
    openedDate: "2026-11-10",
    location: "frigo",
    category: "yogurt", // dopo l'apertura: 4 giorni
    ...over,
  };
}

describe("durata dopo l'apertura dal prodotto: può solo accorciare", () => {
  it("senza il dato resta la stima per categoria", () => {
    expect(SHELF_LIFE.yogurt.afterOpeningDays).toBe(4);
    expect(effectiveExpiry(item(), NOW)).toEqual({ date: "2026-11-14", basis: "opened", nature: "safety", certainty: "estimated" });
  });

  it("un dato più breve della categoria vale, come stima, e dice da dove viene", () => {
    expect(effectiveExpiry(item({ daysAfterOpening: 2 }), NOW)).toEqual({
      date: "2026-11-12",
      basis: "opened",
      nature: "safety",
      certainty: "estimated",
      openedFrom: "product",
    });
  });

  it("un dato più lungo, o uguale, non allunga: vale la categoria", () => {
    for (const days of [4, 10, 365]) {
      expect(effectiveExpiry(item({ daysAfterOpening: days }), NOW)).toEqual(effectiveExpiry(item(), NOW));
    }
  });

  it("scatola aperta con 12 mesi e preferibilmente entro nel 2028: valgono i giorni della categoria", () => {
    const e = effectiveExpiry(
      item({ category: "canned_closed", location: "dispensa", labelDateType: "best_before", labelDate: "2028-01-01", daysAfterOpening: 365 }),
      NOW,
    );
    expect(SHELF_LIFE.canned_closed.afterOpeningDays).toBe(3);
    expect(e).toMatchObject({ date: "2026-11-13", basis: "opened", nature: "safety", certainty: "estimated", qualityDate: "2028-01-01" });
  });

  it("carne fresca con da consumare entro fra 28 giorni e 365 dopo l'apertura: valgono i giorni della categoria", () => {
    const e = effectiveExpiry(
      item({ category: "red_meat_fresh", labelDateType: "use_by", labelDate: "2026-12-08", daysAfterOpening: 365 }),
      NOW,
    );
    expect(e).toMatchObject({ date: "2026-11-12", basis: "opened", certainty: "estimated" });
  });

  it("pesto con preferibilmente entro fra due mesi e 365: resta il limite di sicurezza dopo l'apertura, mai l'etichetta di qualità", () => {
    const e = effectiveExpiry(
      item({ category: "sauces_preserves_opened", labelDateType: "best_before", labelDate: "2027-01-10", daysAfterOpening: 365 }),
      NOW,
    );
    expect(e).toMatchObject({ date: "2026-11-15", basis: "opened", nature: "safety", certainty: "estimated", qualityDate: "2027-01-10" });
  });

  it("la data stampata più vicina vale ancora", () => {
    const e = effectiveExpiry(item({ daysAfterOpening: 3, labelDateType: "use_by", labelDate: "2026-11-11" }), NOW);
    expect(e).toMatchObject({ date: "2026-11-11", basis: "label", nature: "safety" });
  });

  it("valori non usabili si ignorano e vale la stima", () => {
    for (const bad of [0, -3, 2.5, Number.NaN, Infinity, 99999, null, undefined]) {
      expect(effectiveExpiry(item({ daysAfterOpening: bad as number | null | undefined }), NOW)).toEqual(effectiveExpiry(item(), NOW));
    }
    expect(usableDaysAfterOpening(30)).toBe(30);
    expect(usableDaysAfterOpening(0)).toBeUndefined();
  });

  it("non cambia nulla se la confezione è chiusa, in freezer o scongelata", () => {
    const closed = item({ openedDate: null });
    expect(effectiveExpiry({ ...closed, daysAfterOpening: 1 }, NOW)).toEqual(effectiveExpiry(closed, NOW));
    const frozen = item({ location: "freezer", frozenDate: "2026-11-11" });
    expect(effectiveExpiry({ ...frozen, daysAfterOpening: 1 }, NOW)).toEqual(effectiveExpiry(frozen, NOW));
    const thawed = item({ thawedDate: "2026-11-12" });
    expect(effectiveExpiry({ ...thawed, daysAfterOpening: 1 }, NOW)).toEqual(effectiveExpiry(thawed, NOW));
  });
});

describe("da lotto a voce di scadenza", () => {
  const lot: LotLike = {
    lotId: "L1",
    category: "yogurt",
    expiry: { date: "2026-11-30", kind: "best_before" },
    createdAt: "2026-11-08T09:00:00.000Z",
    openedAt: "2026-11-10T09:00:00.000Z",
    location: "frigo",
    daysAfterOpening: 2,
  };

  it("porta con sé date, luogo e durata del prodotto", () => {
    expect(lotToExpiryItem(lot)).toEqual({
      id: "L1",
      labelDateType: "best_before",
      labelDate: "2026-11-30",
      purchaseDate: "2026-11-08",
      openedDate: "2026-11-10",
      daysAfterOpening: 2,
      location: "frigo",
      frozenDate: null,
      thawedDate: null,
      category: "yogurt",
    });
    expect(lotExpiry(lot, NOW)).toMatchObject({ date: "2026-11-12", basis: "opened", certainty: "estimated", openedFrom: "product" });
  });

  it("senza categoria nota ripiega sulla data in etichetta; senza nemmeno quella, niente", () => {
    expect(lotToExpiryItem({ ...lot, category: undefined })).toBeNull();
    expect(lotToExpiryItem({ ...lot, category: "boh" })).toBeNull();
    expect(lotExpiry({ ...lot, category: "boh" }, NOW)).toEqual({ date: "2026-11-30", basis: "label", nature: "quality", certainty: "label" });
    expect(lotExpiry({ ...lot, category: "boh", expiry: undefined }, NOW)).toBeUndefined();
    expect(isFoodCategory("yogurt")).toBe(true);
    expect(isFoodCategory("boh")).toBe(false);
  });

  it("una data del lotto illeggibile ripiega sulla data in etichetta", () => {
    expect(lotToExpiryItem({ ...lot, createdAt: "non è una data" })).toBeNull();
    expect(lotExpiry({ ...lot, createdAt: "non è una data" }, NOW)).toMatchObject({ date: "2026-11-30", basis: "label" });
  });
});

describe("canFreeze", () => {
  it("si ricava dalla tabella: sotto i due mesi in freezer non si propone", () => {
    expect(canFreeze("poultry")).toBe(true);
    expect(canFreeze("bread_fresh")).toBe(true);
    expect(canFreeze("beverages")).toBe(false);
  });

  it("uova, verdure a foglia, surgelati e scatolame non si propongono", () => {
    for (const c of ["eggs", "leafy_vegetables", "frozen_foods", "canned_closed"] as const) expect(canFreeze(c), c).toBe(false);
  });
});
