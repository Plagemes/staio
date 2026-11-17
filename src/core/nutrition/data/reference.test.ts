import { describe, expect, it } from "vitest";
import { NUTRIENT_KEYS, type ReferenceValue } from "../types";
import { REFERENCE_VALUES, type ReferenceEntry } from "./reference";

const entries = REFERENCE_VALUES as readonly ReferenceEntry[];

const label = (r: ReferenceEntry): string =>
  [r.nutrient, r.kind, r.sex ?? "both", r.variant ?? "", `${r.ageMin}-${r.ageMax ?? ""}`].join("|");

const sexesOverlap = (a: ReferenceValue, b: ReferenceValue): boolean =>
  a.sex === undefined || b.sex === undefined || a.sex === b.sex;

const agesOverlap = (a: ReferenceValue, b: ReferenceValue): boolean =>
  a.ageMin <= (b.ageMax ?? Infinity) && b.ageMin <= (a.ageMax ?? Infinity);

describe("valori di riferimento EFSA per adulti", () => {
  it("contiene valori", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("ogni voce ha una fonte con ente, documento e indirizzo preciso", () => {
    for (const r of entries) {
      expect(r.source.body.trim(), label(r)).not.toBe("");
      expect(r.source.document.trim(), label(r)).not.toBe("");
      const url = new URL(r.source.url);
      expect(url.protocol, label(r)).toBe("https:");
      expect(["efsa.europa.eu", "multimedia.efsa.europa.eu", "www.efsa.europa.eu", "onlinelibrary.wiley.com", "efsa.onlinelibrary.wiley.com"], label(r)).toContain(url.hostname);
      // Un indirizzo preciso punta a una pagina o a un documento, non alla radice del sito.
      expect(url.pathname.length, label(r)).toBeGreaterThan(1);
    }
  });

  it("usa solo nutrienti e tipi previsti dai tipi condivisi", () => {
    const kinds = new Set(["PRI", "AI", "UL", "RI"]);
    for (const r of entries) {
      expect(NUTRIENT_KEYS as readonly string[], label(r)).toContain(r.nutrient);
      expect(kinds.has(r.kind), label(r)).toBe(true);
    }
  });

  it("nessun valore negativo o non finito", () => {
    for (const r of entries) {
      if (r.amount !== undefined) {
        expect(Number.isFinite(r.amount), label(r)).toBe(true);
        expect(r.amount, label(r)).toBeGreaterThanOrEqual(0);
      }
      for (const v of [r.percentEnergy?.min, r.percentEnergy?.max]) {
        if (v !== undefined) {
          expect(Number.isFinite(v), label(r)).toBe(true);
          expect(v, label(r)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("riguarda solo adulti: nessuna fascia sotto i 18 anni", () => {
    for (const r of entries) {
      expect(r.ageMin, label(r)).toBeGreaterThanOrEqual(18);
      if (r.ageMax !== undefined) expect(r.ageMax, label(r)).toBeGreaterThanOrEqual(r.ageMin);
    }
  });

  it("fasce d'età non sovrapposte per lo stesso nutriente, tipo, sesso e variante", () => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.nutrient !== b.nutrient || a.kind !== b.kind) continue;
        if ((a.variant ?? "") !== (b.variant ?? "")) continue;
        if (!sexesOverlap(a, b)) continue;
        expect(agesOverlap(a, b), `${label(a)} si sovrappone a ${label(b)}`).toBe(false);
      }
    }
  });

  it("ogni UL con importo è maggiore del PRI o AI corrispondente", () => {
    let confronti = 0;
    for (const ul of entries.filter((r) => r.kind === "UL" && r.amount !== undefined)) {
      const baselines = entries.filter(
        (r) =>
          (r.kind === "PRI" || r.kind === "AI") &&
          r.amount !== undefined &&
          r.nutrient === ul.nutrient &&
          sexesOverlap(r, ul) &&
          agesOverlap(r, ul),
      );
      for (const base of baselines) {
        confronti++;
        expect(ul.amount, `${label(ul)} contro ${label(base)}`).toBeGreaterThan(base.amount as number);
      }
    }
    expect(confronti).toBeGreaterThan(0);
  });

  it("gli UL con importo valgono per l'assunzione totale; quelli limitati a una forma o fonte stanno solo in nota", () => {
    const uls = entries.filter((r) => r.kind === "UL");
    const conImporto = uls.filter((r) => r.amount !== undefined).map((r) => r.nutrient).sort();
    expect(conImporto).toEqual([
      "calciumMg",
      "iodineUg",
      "seleniumUg",
      "vitaminB6Mg",
      "vitaminDUg",
      "vitaminEMg",
      "zincMg",
    ]);
    // Valgono solo per una forma (retinolo preformato, acido nicotinico/nicotinamide) o una fonte
    // (integratori, aggiunte agli alimenti): confrontati con l'assunzione totale darebbero falsi superamenti.
    const soloNota: Record<string, RegExp> = {
      vitaminAUg: /preformata/,
      niacinMg: /forme libere/,
      magnesiumMg: /integratori/,
      folateUg: /aggiunti/,
      ironMg: /livello sicuro/,
    };
    for (const [nutrient, scope] of Object.entries(soloNota)) {
      const matches = uls.filter((r) => r.nutrient === nutrient);
      expect(matches.length, nutrient).toBe(1);
      expect(matches[0].amount, nutrient).toBeUndefined();
      expect(matches[0].note, nutrient).toMatch(scope);
      expect(matches[0].note, nutrient).toMatch(/\d/);
    }
  });

  it("gli intervalli RI sono percentuali dell'energia coerenti e senza importo", () => {
    const ranges = entries.filter((r) => r.kind === "RI");
    expect(ranges.map((r) => r.nutrient).sort()).toEqual(["carbsG", "fatG"]);
    for (const r of ranges) {
      const p = r.percentEnergy;
      expect(p, label(r)).toBeDefined();
      expect(r.amount, label(r)).toBeUndefined();
      expect(p?.min, label(r)).toBeDefined();
      expect(p?.max, label(r)).toBeDefined();
      expect(p?.min as number, label(r)).toBeLessThan(p?.max as number);
      expect(p?.max as number, label(r)).toBeLessThanOrEqual(100);
    }
  });

  it("le voci senza importo spiegano il perché nella nota", () => {
    for (const r of entries) {
      if (r.amount === undefined && r.percentEnergy === undefined) {
        expect(r.note?.trim().length ?? 0, label(r)).toBeGreaterThan(40);
      }
    }
  });

  it("i valori espressi per kg, per MJ o come raccomandazione qualitativa non hanno un importo inventato", () => {
    const senzaImporto = (nutrient: string, kind: string) =>
      entries.filter((r) => r.nutrient === nutrient && r.kind === kind).map((r) => r.amount);
    expect(senzaImporto("proteinG", "PRI")).toEqual([undefined]);
    expect(senzaImporto("thiaminMg", "PRI")).toEqual([undefined]);
    expect(senzaImporto("niacinMg", "PRI")).toEqual([undefined]);
    expect(senzaImporto("saturatedFatG", "UL")).toEqual([undefined]);
    expect(senzaImporto("sugarsG", "UL")).toEqual([undefined]);
    expect(senzaImporto("saltG", "AI")).toEqual([undefined]);
    expect(entries.find((r) => r.nutrient === "proteinG")?.note).toContain("0,83 g per kg");
  });

  it("l'acqua è in grammi (litri convertiti) e distinta per sesso", () => {
    const water = entries.filter((r) => r.nutrient === "waterG");
    expect(water.map((r) => r.sex).sort()).toEqual(["female", "male"]);
    for (const r of water) {
      expect(r.amount as number, label(r)).toBeGreaterThan(1000);
      expect(r.note, label(r)).toContain("1 L = 1000 g");
    }
  });

  it("calcio, ferro e zinco distinguono le fasce o le varianti che EFSA distingue", () => {
    const calcium = entries.filter((r) => r.nutrient === "calciumMg" && r.kind === "PRI");
    expect(calcium.map((r) => [r.ageMin, r.ageMax])).toEqual([
      [18, 24],
      [25, undefined],
    ]);
    const zinc = entries.filter((r) => r.nutrient === "zincMg" && r.kind === "PRI");
    expect(new Set(zinc.map((r) => r.variant)).size).toBe(4);
    const ironFemale = entries.filter((r) => r.nutrient === "ironMg" && r.kind === "PRI" && r.sex === "female");
    expect(ironFemale.map((r) => r.variant).sort()).toEqual(["postmenopausal", "premenopausal"]);
  });

  it("nessuna voce identica a un'altra", () => {
    const seen = new Set<string>();
    for (const r of entries) {
      const key = label(r);
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});
