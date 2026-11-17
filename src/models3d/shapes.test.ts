import { describe, expect, it } from "vitest";
import { buildModel, type Model } from "./generate";
import { validateRecipe, type Recipe } from "./recipe";

const base = { id: "n", name: "Nuova", category: "verdura", heightCm: 10 } as const;
const verts = (m: Model, name: string) => m.parts.find((p) => p.name === name)?.geometry.getAttribute("position").count ?? 0;
const errorsOf = (r: unknown) => {
  const res = validateRecipe(r);
  return res.ok ? [] : res.errors;
};

describe("florets (broccolo, cavolfiore)", () => {
  const recipe = (params: object): Recipe => ({ ...base, archetype: "florets", params: { count: 24, ...params } }) as Recipe;

  it("più cimette, più geometria", () => {
    expect(verts(buildModel(recipe({ count: 36 })), "florets")).toBeGreaterThan(verts(buildModel(recipe({ count: 12 })), "florets"));
  });

  it("ha gambo e testa; le foglie avvolgenti solo se richieste", () => {
    const plain = buildModel(recipe({}));
    expect(plain.parts.map((p) => p.name)).toEqual(["florets", "stalk"]);
    const wrapped = buildModel(recipe({ wrap: 4 }));
    const wrap = wrapped.parts.find((p) => p.name === "wrap");
    expect(wrap?.doubleSided).toBe(true);
    expect(wrap?.lines).not.toBeNull();
  });

  it("una testa piatta è più larga che alta, una a cupola meno", () => {
    const flat = buildModel(recipe({ dome: 0, stalk: 0.1 }));
    const domed = buildModel(recipe({ dome: 1, stalk: 0.1 }));
    expect(flat.size[0]).toBeGreaterThan(domed.size[0]);
  });

  it("la rugosità cambia la superficie", () => {
    const pos = (m: Model) => Array.from(m.parts[0].geometry.getAttribute("position").array);
    expect(pos(buildModel(recipe({ bump: 0 }), "s"))).not.toEqual(pos(buildModel(recipe({ bump: 1 }), "s")));
  });

  it("valida i limiti", () => {
    expect(errorsOf(recipe({ count: 5 })).some((e) => e.startsWith("params.count:"))).toBe(true);
    expect(errorsOf(recipe({ wrap: 9 })).some((e) => e.startsWith("params.wrap:"))).toBe(true);
    expect(errorsOf(recipe({ wrap: 1.5 })).some((e) => e.includes("intero"))).toBe(true);
    expect(errorsOf(recipe({ foglie: 2 })).some((e) => e.includes("sconosciuto"))).toBe(true);
  });
});

describe("slice (anguria, melone)", () => {
  const recipe = (params: object): Recipe => ({ ...base, category: "frutta", archetype: "slice", params }) as Recipe;

  it("è una mezzaluna in piedi: larga il doppio dell'altezza, con la buccia a parte", () => {
    const m = buildModel(recipe({}), "s");
    expect(m.parts.map((p) => p.name)).toEqual(["flesh", "rind"]);
    expect(m.size[0]).toBeGreaterThan(1.8);
    expect(m.size[0]).toBeLessThan(2.2);
    expect(m.parts.find((p) => p.name === "flesh")?.lines).not.toBeNull();
  });

  it("senza buccia è una parte sola e senza linea", () => {
    const m = buildModel(recipe({ rind: false }), "s");
    expect(m.parts.map((p) => p.name)).toEqual(["flesh"]);
    expect(m.parts[0].lines).toBeNull();
  });

  it("lo spessore e l'arco cambiano le proporzioni", () => {
    expect(buildModel(recipe({ thickness: 0.8 }), "s").size[2]).toBeGreaterThan(buildModel(recipe({ thickness: 0.1 }), "s").size[2] * 3);
    expect(buildModel(recipe({ arcDeg: 90 }), "s").size[0]).toBeLessThan(buildModel(recipe({ arcDeg: 180 }), "s").size[0] * 0.8);
  });

  it("i semini compaiono solo se richiesti", () => {
    expect(buildModel(recipe({}), "s").parts.some((p) => p.name === "seeds")).toBe(false);
    const m = buildModel(recipe({ seeds: 12 }), "s");
    const seeds = m.parts.find((p) => p.name === "seeds");
    expect(seeds).toBeDefined();
    expect(seeds!.outline).toBe(0);
    expect(verts(m, "seeds")).toBeGreaterThan(100);
  });

  it("valida i limiti", () => {
    expect(errorsOf(recipe({ arcDeg: 30 })).some((e) => e.startsWith("params.arcDeg:"))).toBe(true);
    expect(errorsOf(recipe({ seeds: 99 })).some((e) => e.startsWith("params.seeds:"))).toBe(true);
  });
});

describe("fish (pesce intero)", () => {
  const recipe = (params: object): Recipe => ({ ...base, category: "pesce", archetype: "fish", params }) as Recipe;

  it("ha corpo, pinne a doppia faccia e occhi", () => {
    const m = buildModel(recipe({}), "s");
    expect(m.parts.map((p) => p.name)).toEqual(["body", "fins", "eyes"]);
    expect(m.parts.find((p) => p.name === "fins")?.doubleSided).toBe(true);
    expect(m.parts.find((p) => p.name === "body")?.lines).not.toBeNull();
  });

  it("è lungo molto più che alto", () => {
    const m = buildModel(recipe({}), "s");
    expect(m.size[0]).toBeGreaterThan(2.2);
    expect(m.size[2]).toBeLessThan(m.size[1]);
  });

  it("la pinna dorsale e la coda cambiano le proporzioni", () => {
    const noFin = buildModel(recipe({ dorsal: 0 }), "s");
    const bigFin = buildModel(recipe({ dorsal: 1 }), "s");
    expect(noFin.size[0]).toBeGreaterThan(bigFin.size[0]);
    const shortTail = buildModel(recipe({ tail: 0.1 }), "s");
    const longTail = buildModel(recipe({ tail: 0.4 }), "s");
    expect(shortTail.size[0]).not.toBeCloseTo(longTail.size[0], 1);
  });

  it("si può togliere la pinna dorsale e le pettorali", () => {
    const m = buildModel(recipe({ dorsal: 0, pectoral: 0 }), "s");
    expect(m.parts.find((p) => p.name === "fins")).toBeDefined();
    const withAll = buildModel(recipe({ dorsal: 1, pectoral: 1 }), "s");
    expect(verts(withAll, "fins")).toBeGreaterThan(verts(m, "fins"));
  });

  it("valida i limiti", () => {
    expect(errorsOf(recipe({ bodyHeight: 0.9 })).some((e) => e.startsWith("params.bodyHeight:"))).toBe(true);
    expect(errorsOf(recipe({ code: 1 })).some((e) => e.includes("sconosciuto"))).toBe(true);
  });
});

describe("cluster mound (mucchio di chicchi)", () => {
  const recipe = (params: object): Recipe =>
    ({ ...base, category: "dispensa", archetype: "cluster", params: { layout: "mound", count: 150, elementRadius: 0.03, elongation: 1.4, ...params } }) as Recipe;

  it("genera fino a 400 elementi, solo con il layout mound", () => {
    expect(errorsOf(recipe({ count: 400 }))).toEqual([]);
    expect(errorsOf(recipe({ count: 401 })).some((e) => e.startsWith("params.count:"))).toBe(true);
    expect(errorsOf(recipe({ layout: "hanging", count: 100, elementRadius: 0.05 })).some((e) => e.startsWith("params.count:"))).toBe(true);
    expect(errorsOf(recipe({ layout: "hanging", count: 20, elementRadius: 0.02 })).some((e) => e.startsWith("params.elementRadius:"))).toBe(true);
  });

  it("è una cupola bassa e larga che poggia a terra", () => {
    const m = buildModel(recipe({ spread: 0.9 }), "s");
    expect(m.size[0]).toBeGreaterThan(m.size[1] * 1.5);
    expect(m.bounds.min[1]).toBeCloseTo(0, 5);
  });

  it("più chicchi, più geometria; la geometria resta leggera", () => {
    const few = verts(buildModel(recipe({ count: 40 }), "s"), "grains");
    const many = verts(buildModel(recipe({ count: 400 }), "s"), "grains");
    expect(many).toBeGreaterThan(few * 2);
    expect(many).toBeLessThan(40000);
  });
});

describe("esempi di RICETTE.md", () => {
  const examples: Recipe[] = [
    { id: "vd-broccolo", name: "Broccolo", category: "verdura", archetype: "florets", heightCm: 14, params: { count: 34, dome: 0.7, bump: 0.7, stalk: 0.45 } },
    { id: "vd-cavolfiore", name: "Cavolfiore", category: "verdura", archetype: "florets", heightCm: 15, params: { count: 16, dome: 0.85, bump: 0.4, stalk: 0.15, wrap: 5 } },
    { id: "fr-anguria-fetta", name: "Anguria a fetta", category: "frutta", archetype: "slice", heightCm: 12, params: { arcDeg: 180, thickness: 0.22, rindWidth: 0.07, seeds: 14 } },
    { id: "cp-pesce-intero-orata", name: "Pesce intero, orata", category: "pesce", archetype: "fish", heightCm: 8, params: { bodyHeight: 0.34, thickness: 0.14, tail: 0.22, dorsal: 0.7, snout: 0.55 } },
    {
      id: "er-basilico-vaso",
      name: "Basilico in vaso",
      category: "erbe",
      archetype: "composite",
      heightCm: 30,
      params: {
        parts: [
          { recipe: { archetype: "lathe", params: { smooth: false, profile: [[0, 0], [0.3, 0], [0.42, 1], [0, 1]] } } },
          { recipe: { archetype: "leaf", params: { layout: "bunch", count: 12, width: 0.5, spread: 0.6, stalk: 0.8 } }, position: [0, 0.95, 0], scale: 1.6 },
        ],
      },
    },
  ];

  it("sono valide e generabili", () => {
    for (const r of examples) {
      expect(errorsOf(r), r.id).toEqual([]);
      const m = buildModel(r, "x");
      expect(m.bounds.min[1]).toBeCloseTo(0, 5);
      expect(m.size[1]).toBeCloseTo(1, 5);
    }
  });
});
