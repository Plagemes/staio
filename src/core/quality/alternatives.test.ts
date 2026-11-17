import { describe, expect, it } from "vitest";
import { bestUnitPrice, findAlternatives, type Candidate } from "./alternatives";
import { product, withNutrients } from "./test-helpers";

const CATS = ["snacks", "biscuits", "chocolate-biscuits"];
const FULL = { fat: 20, saturatedFat: 10, salt: 0.5 };

const reference: Candidate = {
  product: withNutrients("R", { ...FULL, sugars: 35 }, { name: "Riferimento", categories: CATS, nutriScore: "d", nova: 4 }),
  prices: [{ totalCents: 400, amount: 250, unit: "g", store: "Negozio A" }],
};

const cand = (barcode: string, sugars: number | undefined, extra: Parameters<typeof withNutrients>[2] = {}, n = FULL): Candidate => ({
  product: withNutrients(barcode, { ...n, ...(sugars !== undefined ? { sugars } : {}) }, { name: `Prodotto ${barcode}`, categories: CATS, nutriScore: "d", nova: 4, ...extra }),
});

describe("bestUnitPrice", () => {
  it("prende il prezzo per unità più basso e ignora le osservazioni non valide", () => {
    const p = bestUnitPrice([
      { totalCents: 300, amount: 300, unit: "g", store: "X" },
      { totalCents: 250, amount: 300, unit: "g", store: "Y" },
      { totalCents: 0, amount: 100, unit: "g" },
      { totalCents: 100, amount: 0, unit: "g" },
    ]);
    expect(p).toEqual({ cents: 833, per: "kg", store: "Y" });
  });

  it("millilitri in litri e pezzi", () => {
    expect(bestUnitPrice([{ totalCents: 120, amount: 500, unit: "ml" }])).toEqual({ cents: 240, per: "l" });
    expect(bestUnitPrice([{ totalCents: 300, amount: 6, unit: "pz" }])).toEqual({ cents: 50, per: "pz" });
  });

  it("senza osservazioni valide: nessun prezzo", () => {
    expect(bestUnitPrice(undefined)).toBeUndefined();
    expect(bestUnitPrice([])).toBeUndefined();
  });

  it("con un'unità richiesta ignora le altre", () => {
    expect(bestUnitPrice([{ totalCents: 120, amount: 500, unit: "ml" }], "kg")).toBeUndefined();
  });
});

describe("findAlternatives", () => {
  const A: Candidate = { ...cand("A", 20), prices: [{ totalCents: 300, amount: 300, unit: "g", store: "Negozio B" }] };
  const B = cand("B", 10, {}, { ...FULL, salt: 2 }); // meglio sugli zuccheri, peggio sul sale
  const C = cand("C", 1, { categories: ["snacks", "crackers"] }); // altra categoria
  const D = cand("D", undefined); // zuccheri non riportati
  const E = cand("E", 10, {}, { fat: 20, saturatedFat: 10, salt: 0.5 });
  const G = cand("G", 15, { nova: 3 });
  const same = { ...reference };

  it("solo candidati della stessa categoria, migliori sulla dimensione e non peggiori sulle altre", () => {
    const r = findAlternatives(reference, [A, B, C, D, E, G, same], "sugars");
    expect(r.status).toBe("ok");
    const codes = r.alternatives.map((a) => a.product.barcode);
    expect(codes).not.toContain("B");
    expect(codes).not.toContain("C");
    expect(codes).not.toContain("D");
    expect(codes).not.toContain("R");
    expect(codes.sort()).toEqual(["A", "E", "G"]);
  });

  it("ordinate per miglioramento sulla dimensione scelta", () => {
    const r = findAlternatives(reference, [A, G, E], "sugars");
    expect(r.alternatives.map((a) => a.product.barcode)).toEqual(["E", "G", "A"]);
    expect(r.alternatives[0]).toMatchObject({ before: "35 g per 100 g", after: "10 g per 100 g", dimension: "sugars" });
  });

  it("indica le dimensioni in cui è anche migliore e quelle non confrontabili", () => {
    const r = findAlternatives(reference, [G], "sugars");
    expect(r.alternatives[0].alsoBetter).toEqual(["nova"]);
    const onlySugars: Candidate = { product: withNutrients("H", { sugars: 5 }, { categories: CATS }) };
    const r2 = findAlternatives(reference, [onlySugars], "sugars");
    expect(r2.alternatives[0].notComparable).toEqual(expect.arrayContaining(["fat", "saturatedFat", "salt", "nutriScore", "nova"]));
    const text = r2.alternatives[0].explanation;
    expect(text).toContain("Non confrontabile");
    expect(text).not.toContain("senza peggiorare");
    expect(r2.alternatives[0].notComparableOn?.map((d) => d.dimension)).toEqual(expect.arrayContaining(["fat", "additives", "nova"]));
    expect(r2.alternatives[0].notComparableOn?.[0].reason).toContain("dato mancante");
  });

  it("prezzo per unità a confronto quando esiste", () => {
    const r = findAlternatives(reference, [A, E], "sugars");
    expect(r.referenceUnitPrice).toEqual({ cents: 1600, per: "kg", store: "Negozio A" });
    const a = r.alternatives.find((x) => x.product.barcode === "A");
    expect(a?.unitPrice).toEqual({ cents: 1000, per: "kg", store: "Negozio B" });
    expect(a?.priceDifferenceCents).toBe(-600);
    expect(a?.explanation).toContain("6 € in meno");
    const e = r.alternatives.find((x) => x.product.barcode === "E");
    expect(e?.unitPrice).toBeUndefined();
    expect(e?.priceDifferenceCents).toBeUndefined();
  });

  it("senza prezzi del prodotto il prezzo del candidato è solo mostrato", () => {
    const r = findAlternatives({ product: reference.product }, [A], "sugars");
    expect(r.alternatives[0].unitPrice?.cents).toBe(1000);
    expect(r.alternatives[0].priceDifferenceCents).toBeUndefined();
  });

  it("Nutri-Score e NOVA come dimensione scelta", () => {
    const better = cand("N", 35, { nutriScore: "b", nova: 3 });
    expect(findAlternatives(reference, [better], "nutriScore").alternatives[0].after).toBe("Nutri-Score B");
    expect(findAlternatives(reference, [better], "nova").alternatives[0].after).toBe("NOVA 3");
  });

  describe("non peggiore, davvero", () => {
    const FULL_DATA = { fat: 2, saturatedFat: 1, salt: 0.31 };
    const mk = (barcode: string, n: Parameters<typeof withNutrients>[1], extra: Parameters<typeof withNutrients>[2] = {}): Candidate => ({
      product: withNutrients(barcode, n, { name: "P" + barcode, categories: CATS, nutriScore: "b", nova: 3, additives: [], ...extra }),
    });
    const ref = mk("REF", { ...FULL_DATA, sugars: 30, energyKcal: 300, proteins: 6 });

    it("esempio del revisore: E171 ed E102 e sale cinque volte più alto nella stessa fascia non sono «senza peggiorare»", () => {
      const bad = mk("BAD", { ...FULL_DATA, salt: 1.5, sugars: 10, energyKcal: 300, proteins: 6 }, { additives: ["E171", "E102"] });
      const r = findAlternatives(ref, [bad], "sugars");
      expect(r.alternatives).toEqual([]);
      expect(r.emptyReason).toBe("none_better");
      const shown = findAlternatives(ref, [bad], "sugars", { allowWorse: true }).alternatives[0];
      expect(shown.worseOn?.map((d) => d.dimension).sort()).toEqual(["additives", "salt"]);
      expect(shown.worseOn?.find((d) => d.dimension === "additives")?.reason).toContain("E171, E102");
      expect(shown.worseOn?.find((d) => d.dimension === "salt")?.reason).toContain("stessa fascia");
      expect(shown.explanation).toContain("Peggiora:");
      expect(shown.explanation).not.toContain("senza peggiorare");
    });

    it("solo il sale più alto nella stessa fascia basta a scartare il candidato", () => {
      const saltier = mk("SALT", { ...FULL_DATA, salt: 1.5, sugars: 10 });
      expect(findAlternatives(ref, [saltier], "sugars").alternatives).toEqual([]);
    });

    it("solo un additivo con giudizio aggiunto basta a scartare il candidato, anche se il prodotto non ne ha", () => {
      const withColour = mk("COL", { ...FULL_DATA, sugars: 10 }, { additives: ["E110"] });
      expect(findAlternatives(ref, [withColour], "sugars").alternatives).toEqual([]);
      // additivi senza giudizio non bastano a scartare: sono solo numero
      const plain = mk("PLN", { ...FULL_DATA, sugars: 10 }, { additives: ["E330", "E322"] });
      const r = findAlternatives(ref, [plain], "sugars").alternatives[0];
      expect(r.worseOn).toEqual([]);
      expect(r.descriptive?.some((d) => d.dimension === "additives" && d.text.includes("da 0 a 2"))).toBe(true);
    });

    it("un aumento dentro la tolleranza dichiarata è accettato; la tolleranza si può cambiare", () => {
      const slightly = mk("SLT", { ...FULL_DATA, salt: 0.33, sugars: 10 });
      const ok = findAlternatives(ref, [slightly], "sugars").alternatives[0];
      expect(ok.worseOn).toEqual([]);
      expect(ok.notComparableOn).toEqual([]);
      expect(ok.explanation).toContain("senza peggiorare le altre dimensioni");
      expect(findAlternatives(ref, [slightly], "sugars", { valueTolerance: { relative: 0, absolute: 0 } }).alternatives).toEqual([]);
    });

    it("Nutri-Score o NOVA più alti nella stessa fascia sono peggiori", () => {
      const refTop = mk("TOP", { ...FULL_DATA, sugars: 30 }, { nutriScore: "a" });
      const lower = mk("LOW", { ...FULL_DATA, sugars: 10 }, { nutriScore: "b" });
      expect(findAlternatives(refTop, [lower], "sugars").alternatives).toEqual([]);
      const nova = mk("NV", { ...FULL_DATA, sugars: 10 }, { nova: 4 });
      expect(findAlternatives(ref, [nova], "sugars").alternatives).toEqual([]);
    });

    it("dati completi e nessun peggioramento: il testo lo dice; con una voce non confrontabile no", () => {
      const good = mk("GOOD", { ...FULL_DATA, sugars: 10, energyKcal: 300, proteins: 9 });
      const a = findAlternatives(ref, [good], "sugars").alternatives[0];
      expect(a.worseOn).toEqual([]);
      expect(a.notComparableOn).toEqual([]);
      expect(a.explanation).toContain("senza peggiorare le altre dimensioni");
      expect(a.descriptive?.[0]).toMatchObject({ dimension: "nutrientDensity" });
      expect(a.explanation).toContain("Solo descrittivo");
      const noAdditives = mk("NOA", { ...FULL_DATA, sugars: 10 }, { additives: undefined });
      const b = findAlternatives(ref, [noAdditives], "sugars").alternatives[0];
      expect(b.notComparableOn?.map((d) => d.dimension)).toEqual(["additives"]);
      expect(b.explanation).not.toContain("senza peggiorare");
    });
  });

  it("nessun candidato migliore: elenco vuoto, nulla di inventato, con il motivo", () => {
    const worse = cand("W", 40);
    expect(findAlternatives(reference, [worse], "sugars")).toMatchObject({ status: "ok", alternatives: [], emptyReason: "none_better" });
    expect(findAlternatives(reference, [B], "sugars")).toMatchObject({ alternatives: [], emptyReason: "none_better" });
    const none = findAlternatives(reference, [], "sugars");
    expect(none.alternatives).toEqual([]);
    expect(none.emptyReason).toBe("no_candidates_in_category");
    expect(none.emptyReasonText).toContain("nessuno della stessa categoria");
    expect(findAlternatives(reference, [C, same], "sugars").emptyReason).toBe("no_candidates_in_category");
    expect(findAlternatives(reference, [A], "sugars").emptyReason).toBeUndefined();
  });

  it("prodotto senza categorie", () => {
    const r = findAlternatives({ product: withNutrients("X", { sugars: 10 }) }, [A], "sugars");
    expect(r.status).toBe("no_category");
    expect(r.emptyReason).toBe("no_category");
    expect(r.alternatives).toEqual([]);
  });

  it("dimensione non valutabile per il prodotto: non si può dire che un altro sia migliore", () => {
    const noData: Candidate = { product: product("Y", { categories: CATS }) };
    const r = findAlternatives(noData, [A], "sugars");
    expect(r.status).toBe("not_assessable");
    expect(r.emptyReason).toBe("not_assessable");
    expect(r.alternatives).toEqual([]);
  });
});
