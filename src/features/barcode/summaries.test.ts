import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { RESCAN_PAUSE_MS, checkPackLine, declaredAllergensLine, detailsSummary, ignoresRescan, valuesSummary } from "./summaries";

describe("declaredAllergensLine", () => {
  it("allergeni e tracce in una riga", () => {
    expect(declaredAllergensLine({ allergens: ["milk", "soybeans"], traces: ["nuts"] })).toBe("Contiene: latte, soia · Tracce: frutta a guscio");
  });

  it("solo allergeni", () => {
    expect(declaredAllergensLine({ allergens: ["milk"] })).toBe("Contiene: latte");
    expect(declaredAllergensLine({ allergens: ["milk"], traces: [] })).toBe("Contiene: latte");
  });

  it("elenco vuoto dichiarato: lo dice", () => {
    expect(declaredAllergensLine({ allergens: [] })).toBe("Contiene: nessun allergene dichiarato");
  });

  it("allergeni non indicati: non diventa «senza»", () => {
    expect(declaredAllergensLine({})).toBe("Allergeni non indicati: controlla sulla confezione.");
    expect(declaredAllergensLine({ traces: ["nuts"] })).toBe("Allergeni non indicati · Tracce: frutta a guscio");
  });
});

describe("checkPackLine", () => {
  it("solo per le schede scritte dall'utente, con il testo intero", () => {
    expect(checkPackLine("openfoodfacts")).toBeNull();
    expect(checkPackLine("manual")).toBe("Non è su Open Food Facts: i dati li hai scritti tu. Controlla sulla confezione.");
    expect(checkPackLine("label_photo")).toContain("Controlla sulla confezione.");
  });
});

describe("ignoresRescan", () => {
  const recent = { code: "8003170096165", at: 10_000 };

  it("ignora lo stesso codice subito dopo l'aggiunta", () => {
    expect(ignoresRescan(recent, "8003170096165", 10_000)).toBe(true);
    expect(ignoresRescan(recent, "8003170096165", 10_000 + RESCAN_PAUSE_MS - 1)).toBe(true);
  });

  it("dopo la pausa lo stesso codice vale di nuovo", () => {
    expect(ignoresRescan(recent, "8003170096165", 10_000 + RESCAN_PAUSE_MS)).toBe(false);
  });

  it("un altro codice vale subito", () => {
    expect(ignoresRescan(recent, "8000000000001", 10_001)).toBe(false);
  });

  it("senza un'aggiunta recente non ignora niente", () => {
    expect(ignoresRescan(null, "8003170096165", 10_000)).toBe(false);
  });
});

const normalize = (s: string) => s.replace(/\s/g, " ");

describe("detailsSummary", () => {
  it("senza pezzi e senza prezzo", () => {
    expect(detailsSummary({ category: "yogurt", expiryKind: "use_by" })).toBe("Yogurt · da consumare entro · senza pezzi · senza prezzo");
  });

  it("con pezzi e prezzo", () => {
    const text = detailsSummary({
      category: "bread_packaged",
      expiryKind: "best_before",
      pieces: { count: 2, each: 100 },
      unit: "g",
      priceText: "1,29",
    });
    expect(normalize(text)).toBe("Pane confezionato · preferibilmente entro · 2 pezzi da 100 g · 1,29 €");
  });

  it("i pezzi con il loro nome, al plurale", () => {
    expect(detailsSummary({ category: "bread_packaged", expiryKind: "best_before", pieces: { count: 3, each: 80, name: "piadina" }, unit: "g" })).toBe(
      "Pane confezionato · preferibilmente entro · 3 piadine da 80 g · senza prezzo",
    );
  });

  it("un pezzo solo vale come nessun pezzo", () => {
    expect(detailsSummary({ category: "yogurt", expiryKind: "use_by", pieces: { count: 1, each: 125 }, unit: "g" })).toContain("senza pezzi");
  });

  it("con la categoria già in vista non la ripete", () => {
    expect(detailsSummary({ category: "yogurt", categoryInView: true, expiryKind: "use_by" })).toBe("da consumare entro · senza pezzi · senza prezzo");
  });

  it("senza categoria lo dice", () => {
    expect(detailsSummary({ expiryKind: "best_before" })).toBe("senza categoria · preferibilmente entro · senza pezzi · senza prezzo");
  });

  it("un prezzo che non si legge non diventa un numero", () => {
    expect(detailsSummary({ category: "yogurt", expiryKind: "use_by", priceText: "tre euro" })).toBe(
      "Yogurt · da consumare entro · senza pezzi · prezzo da correggere",
    );
    expect(detailsSummary({ category: "yogurt", expiryKind: "use_by", priceText: "   " })).toContain("senza prezzo");
  });
});

const base: Product = { barcode: "8003170096165", fetchedAt: "2026-11-16T10:00:00.000Z", source: "openfoodfacts" };

describe("valuesSummary", () => {
  it("valori mancanti", () => {
    expect(valuesSummary(base)).toBe("valori mancanti");
    expect(valuesSummary({ ...base, nutrients: { per: "100g", certainty: "label" } })).toBe("valori mancanti");
  });

  it("da etichetta (Open Food Facts)", () => {
    expect(valuesSummary({ ...base, nutrients: { per: "100g", certainty: "label", energyKcal: 76.4, proteins: 10 } })).toBe(
      "76 kcal per 100 g · da etichetta",
    );
  });

  it("per 100 ml", () => {
    expect(valuesSummary({ ...base, nutrients: { per: "100ml", certainty: "label", energyKcal: 64 } })).toBe("64 kcal per 100 ml · da etichetta");
  });

  it("letti dalla foto", () => {
    const product: Product = {
      ...base,
      nutrients: { per: "100g", certainty: "label", energyKcal: 120 },
      labelPhoto: { readAt: "2026-11-16T10:00:00.000Z", nutrients: true },
    };
    expect(valuesSummary(product)).toBe("120 kcal per 100 g · letti dalla foto");
    expect(valuesSummary({ ...product, labelPhoto: { ...product.labelPhoto!, by: "photo" } })).toBe("120 kcal per 100 g · letti dalla foto");
  });

  it("inseriti da te", () => {
    const product: Product = {
      ...base,
      source: "manual",
      nutrients: { per: "100g", certainty: "label", energyKcal: 250 },
      labelPhoto: { readAt: "2026-11-16T10:00:00.000Z", by: "manual", nutrients: true },
    };
    expect(valuesSummary(product)).toBe("250 kcal per 100 g · inseriti da te");
  });

  it("senza energia dice comunque che i valori ci sono", () => {
    expect(valuesSummary({ ...base, nutrients: { per: "100g", certainty: "label", proteins: 3 } })).toBe("valori per 100 g · da etichetta");
  });
});
