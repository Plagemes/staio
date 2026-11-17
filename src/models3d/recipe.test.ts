import { describe, expect, it } from "vitest";
import { RecipeValidationError, parseRecipe, validateRecipe } from "./recipe";

const lathe = {
  id: "pera",
  name: "Pera",
  category: "frutta",
  archetype: "lathe",
  heightCm: 10,
  params: { profile: [[0, 0], [0.5, 0.4], [0.3, 0.8], [0, 1]] },
};

const errorsOf = (input: unknown) => {
  const r = validateRecipe(input);
  return r.ok ? [] : r.errors;
};

describe("validateRecipe", () => {
  it("accetta una ricetta valida per ogni archetipo", () => {
    const base = { id: "x", name: "X", category: "altro", heightCm: 5 };
    const valid = [
      lathe,
      { ...base, archetype: "box", params: { size: [1, 2, 1], bevel: 0.1 } },
      { ...base, archetype: "bag", params: { size: [1, 2, 0.5] } },
      { ...base, archetype: "elongated", params: { radii: [[0, 0], [1, 0.1]] } },
      { ...base, archetype: "leaf", params: { layout: "bunch", count: 8, width: 0.4, spread: 0.5 } },
      { ...base, archetype: "cluster", params: { layout: "heap", count: 8, elementRadius: 0.1 } },
      { ...base, archetype: "wedge", params: { radius: 1.5, angleDeg: 45 } },
    ];
    for (const r of valid) expect(errorsOf(r), r.archetype).toEqual([]);
  });

  it("rifiuta ciò che non è un oggetto", () => {
    expect(errorsOf(null)[0]).toContain("deve essere un oggetto");
    expect(errorsOf("pera")[0]).toContain("deve essere un oggetto");
  });

  it("segnala id, nome, categoria e archetipo errati con il percorso del campo", () => {
    const errors = errorsOf({ ...lathe, id: "Pera Abate", name: "", category: "frutti", archetype: "sfera" });
    expect(errors.some((e) => e.startsWith("id:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("name:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("category:") && e.includes("frutta"))).toBe(true);
    expect(errors.some((e) => e.startsWith("archetype:") && e.includes("lathe"))).toBe(true);
  });

  it("segnala numeri fuori limite con i limiti", () => {
    const errors = errorsOf({ ...lathe, heightCm: 900, variation: 2 });
    expect(errors).toContain("heightCm: deve essere compreso fra 0.3 e 250 (trovato 900)");
    expect(errors.some((e) => e.startsWith("variation:"))).toBe(true);
  });

  it("segnala i punti errati di un profilo", () => {
    const errors = errorsOf({ ...lathe, params: { profile: [[0, 0], [-1, 0.5], "x", [0, 1]] } });
    expect(errors.some((e) => e.startsWith("params.profile[1][0]:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("params.profile[2]:") && e.includes("coppia"))).toBe(true);
  });

  it("rifiuta campi sconosciuti (refusi)", () => {
    expect(errorsOf({ ...lathe, heigthCm: 3 }).some((e) => e.startsWith("heigthCm:") && e.includes("sconosciuto"))).toBe(true);
    expect(errorsOf({ ...lathe, params: { ...lathe.params, smoth: true } }).some((e) => e.startsWith("params.smoth:"))).toBe(true);
  });

  it("rifiuta dettagli non ammessi per l'archetipo", () => {
    const bag = { id: "s", name: "S", category: "altro", heightCm: 5, archetype: "bag", params: { size: [1, 2, 1] }, details: { cap: {} } };
    expect(errorsOf(bag).some((e) => e.startsWith("details.cap:") && e.includes("non ammesso"))).toBe(true);
  });

  it("controlla i dettagli", () => {
    const errors = errorsOf({ ...lathe, details: { label: { from: 0.8, to: 0.7 }, stem: { length: 1, thickness: 0.01 } } });
    expect(errors.some((e) => e.startsWith("details.label:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("details.stem.length:"))).toBe(true);
  });

  it("controlla le coerenze dei raggi di un oggetto allungato", () => {
    const base = { id: "c", name: "C", category: "verdura", heightCm: 5, archetype: "elongated" };
    expect(errorsOf({ ...base, params: { radii: [[0.1, 0.1], [1, 0.1]] } }).some((e) => e.includes("primo t"))).toBe(true);
    expect(errorsOf({ ...base, params: { radii: [[0, 0.1], [0.5, 0.1], [0.4, 0.1], [1, 0.1]] } }).some((e) => e.includes("crescenti"))).toBe(true);
  });

  it("rifiuta una terna con rapporto eccessivo", () => {
    const errors = errorsOf({ id: "b", name: "B", category: "altro", heightCm: 5, archetype: "box", params: { size: [20, 0.1, 1] } });
    expect(errors.some((e) => e.includes("rapporto"))).toBe(true);
  });

  it("segnala params mancante", () => {
    const { params, ...rest } = lathe;
    expect(params).toBeDefined();
    expect(errorsOf(rest)).toContain("params: mancano i parametri dell'archetipo");
  });
});

describe("parseRecipe", () => {
  it("restituisce la ricetta valida", () => {
    expect(parseRecipe(lathe).id).toBe("pera");
  });

  it("lancia con tutti i messaggi", () => {
    let caught: unknown;
    try {
      parseRecipe({ ...lathe, id: "A", heightCm: -1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RecipeValidationError);
    expect((caught as RecipeValidationError).errors).toHaveLength(2);
    expect((caught as Error).message).toContain("non valida");
  });
});
