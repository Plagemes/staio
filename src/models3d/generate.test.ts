import { describe, expect, it } from "vitest";
import { buildModel, disposeModel, modelBounds, type Model } from "./generate";
import { ARCHETYPES, type Recipe } from "./recipe";
import { SEED_RECIPES } from "./catalog/seed";

const base = { id: "t", name: "Prova", category: "altro", heightCm: 10 } as const;

const BY_ARCHETYPE: Record<(typeof ARCHETYPES)[number], Recipe> = {
  lathe: {
    ...base,
    archetype: "lathe",
    params: { profile: [[0, 0], [0.5, 0.2], [0.6, 0.6], [0.3, 0.9], [0, 1]] },
    details: { stem: { length: 0.15, thickness: 0.02 }, leaf: { count: 2, length: 0.3 } },
  },
  box: { ...base, archetype: "box", params: { size: [1, 2, 0.6] }, details: { cap: {}, label: { from: 0.3, to: 0.6 } } },
  bag: { ...base, archetype: "bag", params: { size: [1, 2, 0.5] } },
  elongated: { ...base, archetype: "elongated", params: { radii: [[0, 0.02], [0.5, 0.07], [1, 0.04]], bend: 0.3 } },
  leaf: { ...base, archetype: "leaf", params: { layout: "rosette", count: 10, width: 0.6, spread: 0.5, curl: -0.3, frill: 0.4 } },
  cluster: { ...base, archetype: "cluster", params: { layout: "hanging", count: 12, elementRadius: 0.1 } },
  wedge: { ...base, archetype: "wedge", params: { radius: 2, angleDeg: 40 } },
};

function positions(m: Model): number[][] {
  return m.parts.map((p) => Array.from(p.geometry.getAttribute("position").array));
}

/** Quota di triangoli il cui verso concorda con le normali dei vertici. */
function alignedShare(m: Model): number {
  let ok = 0;
  let total = 0;
  for (const part of m.parts) {
    if (part.doubleSided) continue;
    const g = part.geometry;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
      const v = (j: number) => [pos.getX(j), pos.getY(j), pos.getZ(j)];
      const [pa, pb, pc] = [v(a), v(b), v(c)];
      const e1 = pb.map((x, k) => x - pa[k]);
      const e2 = pc.map((x, k) => x - pa[k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (Math.hypot(...cr) < 1e-12) continue;
      const nn = [a, b, c].reduce((s, j) => [s[0] + nor.getX(j), s[1] + nor.getY(j), s[2] + nor.getZ(j)], [0, 0, 0]);
      total++;
      if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] > 0) ok++;
    }
  }
  return ok / total;
}

describe("buildModel", () => {
  for (const archetype of ARCHETYPES) {
    describe(archetype, () => {
      const model = buildModel(BY_ARCHETYPE[archetype], "seme");

      it("produce geometria non vuota con UV e scatola finita", () => {
        expect(model.parts.length).toBeGreaterThan(0);
        for (const part of model.parts) {
          const pos = part.geometry.getAttribute("position");
          expect(pos.count).toBeGreaterThan(0);
          expect(part.geometry.getAttribute("uv").count).toBe(pos.count);
          expect(part.geometry.getAttribute("normal").count).toBe(pos.count);
          expect(part.geometry.getAttribute("aOutline").count).toBe(pos.count);
          expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
          expect(part.strokeScale.every((n) => Number.isFinite(n) && n >= 2)).toBe(true);
          expect(Number.isFinite(part.transform.scale) && part.transform.scale > 0).toBe(true);
        }
        const { min, max } = model.bounds;
        expect([...min, ...max].every(Number.isFinite)).toBe(true);
        expect(max.every((v, i) => v > min[i])).toBe(true);
      });

      it("poggia su y = 0 ed è alto 1", () => {
        const { min, max } = modelBounds(model);
        expect(min[1]).toBeCloseTo(0, 5);
        expect(max[1]).toBeCloseTo(1, 5);
        expect((min[0] + max[0]) / 2).toBeCloseTo(0, 5);
        expect((min[2] + max[2]) / 2).toBeCloseTo(0, 5);
      });

      it("ha triangoli orientati verso l'esterno", () => {
        expect(alignedShare(model)).toBeGreaterThan(0.98);
      });
    });
  }

  it("è deterministico: stesso seme, stessi vertici", () => {
    for (const archetype of ARCHETYPES) {
      const a = buildModel(BY_ARCHETYPE[archetype], "uno");
      const b = buildModel(BY_ARCHETYPE[archetype], "uno");
      expect(positions(a)).toEqual(positions(b));
      expect(a.parts.map((p) => p.transform)).toEqual(b.parts.map((p) => p.transform));
    }
  });

  it("semi diversi danno modelli diversi", () => {
    for (const archetype of ARCHETYPES) {
      const a = buildModel(BY_ARCHETYPE[archetype], "uno");
      const b = buildModel(BY_ARCHETYPE[archetype], "due");
      expect(positions(a), archetype).not.toEqual(positions(b));
    }
  });

  it("variation 0 azzera la differenza fra semi", () => {
    const recipe: Recipe = { ...BY_ARCHETYPE.lathe, details: undefined, variation: 0 };
    expect(positions(buildModel(recipe, "uno"))).toEqual(positions(buildModel(recipe, "due")));
  });

  it("l'inclinazione di posa viene rispettata", () => {
    const lying = buildModel({ ...BY_ARCHETYPE.elongated, pose: { tiltDeg: 80 }, variation: 0 }, "s");
    expect(lying.size[0]).toBeGreaterThan(2);
  });

  it("genera anche le varianti di layout e gli esempi della guida", () => {
    const variants: Recipe[] = [
      { ...base, archetype: "leaf", params: { layout: "bunch", count: 14, width: 0.5, spread: 0.5, curl: 0.1, stalk: 1.2 } },
      { ...base, archetype: "cluster", params: { layout: "heap", count: 20, elementRadius: 0.08 } },
      { ...base, archetype: "cluster", params: { layout: "truss", count: 8, elementRadius: 0.1 } },
      { ...base, archetype: "wedge", params: { radius: 1.5, angleDeg: 120, rind: false } },
      { ...base, archetype: "box", params: { size: [1, 1, 1], bevel: 0.2 } },
    ];
    for (const recipe of variants) {
      const m = buildModel(recipe, "x");
      const { min, max } = modelBounds(m);
      expect(min[1]).toBeCloseTo(0, 5);
      expect(max[1]).toBeCloseTo(1, 5);
      expect(alignedShare(m)).toBeGreaterThan(0.98);
    }
  });

  it("rifiuta una ricetta malformata", () => {
    expect(() => buildModel({ ...BY_ARCHETYPE.box, heightCm: -3 } as Recipe)).toThrow(/non valida/);
  });

  it("libera le geometrie", () => {
    const m = buildModel(BY_ARCHETYPE.wedge);
    expect(() => disposeModel(m)).not.toThrow();
  });
});

describe("ricette di partenza", () => {
  it("coprono tutti gli archetipi", () => {
    expect(new Set(SEED_RECIPES.map((r) => r.archetype))).toEqual(new Set(ARCHETYPES));
  });

  for (const recipe of SEED_RECIPES) {
    it(`${recipe.id} è generabile e ben formato`, () => {
      const m = buildModel(recipe, "prova");
      const { min, max } = modelBounds(m);
      expect(min[1]).toBeCloseTo(0, 5);
      expect(max[1]).toBeCloseTo(1, 5);
      expect([...min, ...max].every(Number.isFinite)).toBe(true);
      expect(alignedShare(m)).toBeGreaterThan(0.98);
    });
  }
});
