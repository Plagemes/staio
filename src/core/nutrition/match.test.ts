import { describe, expect, it } from "vitest";
import { createFoodMatcher, matchFood, normalizeName } from "./match";
import { FAKE_FOODS, fakeFood } from "./test-helpers";

const idOf = (query: string, foods = FAKE_FOODS, options = {}) =>
  matchFood(query, foods, options)?.food.id;

describe("normalizeName", () => {
  it("toglie accenti, maiuscole, articoli e quantità", () => {
    expect(normalizeName("Caffè")).toBe(normalizeName("CAFFE"));
    expect(normalizeName("200 g di Petto di Pollo")).toBe(normalizeName("petto pollo"));
    expect(normalizeName("Un bicchiere d'acqua")).toBe(normalizeName("acqua"));
  });

  it("tiene le percentuali e i numeri finali, toglie i numeri iniziali", () => {
    expect(normalizeName("yogurt greco 0%")).toContain("0pct");
    expect(normalizeName("2 uova")).toBe(normalizeName("uova"));
    expect(normalizeName("farina 00")).toContain("00");
  });
});

describe("matchFood: corrispondenze", () => {
  it("trova il nome esatto con fiducia 1, ignorando maiuscole e accenti", () => {
    const m = matchFood("LATTE  intero", FAKE_FOODS);
    expect(m?.food.id).toBe("latte-intero");
    expect(m?.confidence).toBe(1);
    expect(m?.matchedOn).toBe("name");
  });

  it("ignora quantità e marche", () => {
    expect(idOf("latte intero 200 ml")).toBe("latte-intero");
    expect(idOf("Latte intero Granarolo")).toBe("latte-intero");
    expect(idOf("latte intero", FAKE_FOODS, { ignoreWords: ["MarcaX"] })).toBe("latte-intero");
    expect(idOf("latte intero marcax", FAKE_FOODS, { ignoreWords: ["MarcaX"] })).toBe("latte-intero");
  });

  it("gestisce plurali semplici e alias", () => {
    expect(idOf("mele")).toBe("mela");
    expect(idOf("2 uova")).toBe("uovo");
    expect(idOf("uovo")).toBe("uovo");
    const m = matchFood("uova", FAKE_FOODS);
    expect(m?.matchedOn).toBe("alias");
    expect(m?.matchedText).toBe("uova");
  });

  it("accetta una parola mancante se il resto è chiaro, con fiducia minore", () => {
    const foods = [fakeFood("p", "Petto di pollo crudo", {})];
    const m = matchFood("petto di pollo", foods);
    expect(m?.food.id).toBe("p");
    expect(m?.confidence).toBeGreaterThanOrEqual(0.75);
    expect(m?.confidence).toBeLessThan(1);
  });

  it("distingue le percentuali", () => {
    expect(idOf("yogurt greco 0%")).toBe("yogurt-greco-0");
    expect(idOf("Yogurt greco 5 %")).toBe("yogurt-greco-5");
    expect(idOf("yoghurt greco 0%")).toBe("yogurt-greco-0");
  });

  it("distingue farina 00 da farina 0, anche con la quantità", () => {
    expect(idOf("farina 00 500 g")).toBe("farina-00");
    expect(idOf("farina 0")).toBe("farina-0");
  });

  it("tollera un refuso su parole lunghe, con fiducia ridotta", () => {
    const m = matchFood("zuchine", FAKE_FOODS);
    expect(m?.food.id).toBe("zucchine");
    expect(m?.confidence).toBeLessThan(1);
  });
});

describe("matchFood: nessuna corrispondenza", () => {
  it("non confonde alimenti diversi", () => {
    expect(idOf("pesce")).toBeUndefined();
    expect(idOf("latte scremato")).toBe("latte-scremato");
    expect(idOf("latte parzialmente scremato")).toBeUndefined();
    expect(idOf("pasta integrale")).toBeUndefined();
    expect(idOf("prosciutto cotto")).toBe("prosciutto-cotto");
    expect(idOf("prosciutto")).toBeUndefined();
    expect(idOf("pollo arrosto")).toBeUndefined();
  });

  it("non trova nulla per query vuote o fatte solo di quantità", () => {
    expect(idOf("")).toBeUndefined();
    expect(idOf("200 g")).toBeUndefined();
    expect(idOf("di")).toBeUndefined();
  });

  it("non accetta un contrario dello stato (crudo/cotto)", () => {
    expect(idOf("petto di pollo cotto")).toBeUndefined();
  });

  it("sotto la soglia non dà nulla, sopra sì: la soglia è un parametro", () => {
    const foods = [fakeFood("li", "Latte intero", {})];
    expect(idOf("latte", foods)).toBeUndefined();
    const m = matchFood("latte", foods, { threshold: 0.6 });
    expect(m?.food.id).toBe("li");
    expect(m?.confidence).toBeCloseTo(0.667, 3);
    expect(idOf("latte", foods, { threshold: 0.9 })).toBeUndefined();
  });

  it("se due alimenti sono ugualmente plausibili non sceglie", () => {
    const matcher = createFoodMatcher(FAKE_FOODS, { threshold: 0.6 });
    const out = matcher.find("latte");
    expect(out.status).toBe("ambiguous");
    if (out.status === "ambiguous") {
      expect(out.candidates.map((c) => c.food.id).sort()).toEqual(["latte-intero", "latte-scremato"]);
    }
    expect(matcher.match("latte")).toBeUndefined();
  });

  it("due alimenti con lo stesso nome esatto sono ambigui", () => {
    const foods = [fakeFood("a", "Pane", {}), fakeFood("b", "Pane", {})];
    expect(createFoodMatcher(foods).find("pane").status).toBe("ambiguous");
  });

  it("riporta il migliore sotto soglia solo come informazione", () => {
    const out = createFoodMatcher(FAKE_FOODS).find("latte");
    expect(out.status).toBe("none");
    if (out.status === "none") expect(out.best?.confidence).toBeLessThan(0.75);
  });
});
