import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { buildModel, modelBounds, partMatrix, type Model } from "./generate";
import { parseRecipe, validateRecipe, type CompositeChild, type CompositeRecipe, type Recipe } from "./recipe";
import { STAIO_RECIPE } from "@/vetrina/staio-recipe";

const base = { id: "c", name: "Composto", category: "altro", heightCm: 10 } as const;
const unitBox: CompositeChild = { archetype: "box", params: { size: [1, 1, 1] }, variation: 0 };

const composite = (parts: CompositeRecipe["params"]["parts"], extra: Partial<CompositeRecipe> = {}): CompositeRecipe => ({
  ...base,
  archetype: "composite",
  params: { parts },
  ...extra,
});

function maxYOf(model: Model, prefix: string): number {
  let max = -Infinity;
  const p = new Vector3();
  for (const part of model.parts) {
    if (!part.name.startsWith(prefix)) continue;
    const m: Matrix4 = partMatrix(part.transform);
    const pos = part.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) max = Math.max(max, p.fromBufferAttribute(pos, i).applyMatrix4(m).y);
  }
  return max;
}

describe("composito: validazione", () => {
  it("accetta un composto valido e restituisce la ricetta", () => {
    const r = composite([{ recipe: unitBox }, { recipe: unitBox, position: [2, 0, 0], rotationDeg: [0, 45, 0], scale: 0.5, signal: true, seed: "x" }]);
    expect(validateRecipe(r).ok).toBe(true);
    expect(parseRecipe(r).archetype).toBe("composite");
  });

  it("rifiuta un composto dentro un composto", () => {
    const nested = composite([{ recipe: composite([{ recipe: unitBox }]) as unknown as CompositeChild }]);
    const res = validateRecipe(nested);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.startsWith("params.parts[0].recipe.archetype:") && e.includes("non può contenerne"))).toBe(true);
  });

  it("riporta gli errori del figlio con il percorso completo", () => {
    const bad = composite([{ recipe: { archetype: "box", params: { size: [1, 1] } } as unknown as CompositeChild }]);
    const res = validateRecipe(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.startsWith("params.parts[0].recipe.params.size:"))).toBe(true);
  });

  it("controlla scala, posizione, rotazione, campi sconosciuti e numero di figli", () => {
    const res = validateRecipe(
      composite([{ recipe: unitBox, scale: 0, position: [1, 2] as unknown as [number, number, number], rotationDeg: [0, 999, 0], colour: 1 } as never]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.startsWith("params.parts[0].scale:"))).toBe(true);
      expect(res.errors.some((e) => e.startsWith("params.parts[0].position:") && e.includes("terna"))).toBe(true);
      expect(res.errors.some((e) => e.startsWith("params.parts[0].rotationDeg[1]:"))).toBe(true);
      expect(res.errors.some((e) => e.startsWith("params.parts[0].colour:") && e.includes("sconosciuto"))).toBe(true);
    }
    expect(validateRecipe(composite([])).ok).toBe(false);
    expect(validateRecipe(composite(Array.from({ length: 49 }, () => ({ recipe: unitBox })))).ok).toBe(false);
  });

  it("non ammette dettagli sul composto stesso", () => {
    expect(validateRecipe({ ...composite([{ recipe: unitBox }]), details: { cap: {} } }).ok).toBe(false);
  });

  it("le ricette semplici restano valide e uguali", () => {
    expect(validateRecipe({ ...base, archetype: "box", params: { size: [1, 2, 1] } }).ok).toBe(true);
  });
});

describe("composito: geometria", () => {
  it("colloca i figli con posizione e scala, appoggiati sulla base", () => {
    const model = buildModel(composite([{ recipe: unitBox, position: [3, 1, -2], scale: 2 }]), "s", { normalize: false });
    const { min, max } = modelBounds(model);
    expect(min[0]).toBeCloseTo(2, 4);
    expect(max[0]).toBeCloseTo(4, 4);
    expect(min[1]).toBeCloseTo(1, 4);
    expect(max[1]).toBeCloseTo(3, 4);
    expect(min[2]).toBeCloseTo(-3, 4);
    expect(max[2]).toBeCloseTo(-1, 4);
  });

  it("ruota il figlio attorno al centro della sua base", () => {
    const tall: CompositeChild = { archetype: "box", params: { size: [1, 3, 1] }, variation: 0 };
    const model = buildModel(composite([{ recipe: tall, rotationDeg: [0, 0, 90] }]), "s", { normalize: false });
    const { min, max } = modelBounds(model);
    // alto 1 e largo 1/3: coricato attorno all'origine occupa x in [-1, 0] e y in [-1/6, 1/6]
    expect(min[0]).toBeCloseTo(-1, 4);
    expect(max[0]).toBeCloseTo(0, 4);
    expect(min[1]).toBeCloseTo(-1 / 6, 3);
    expect(max[1]).toBeCloseTo(1 / 6, 3);
  });

  it("normalizza il composto: altezza 1, base su y = 0, centrato", () => {
    const model = buildModel(composite([{ recipe: unitBox }, { recipe: unitBox, position: [2, 1, 0] }]), "s");
    const { min, max } = modelBounds(model);
    expect(min[1]).toBeCloseTo(0, 5);
    expect(max[1]).toBeCloseTo(2 / 2, 5);
    expect((min[0] + max[0]) / 2).toBeCloseTo(0, 5);
  });

  it("è deterministico e il seme (anche del figlio) cambia il risultato", () => {
    const leafy: CompositeChild = { archetype: "lathe", params: { profile: [[0, 0], [0.5, 0.4], [0, 1]] } };
    const r = composite([{ recipe: leafy }]);
    const pos = (m: Model) => m.parts.map((p) => Array.from(p.geometry.getAttribute("position").array));
    expect(pos(buildModel(r, "uno"))).toEqual(pos(buildModel(r, "uno")));
    expect(pos(buildModel(r, "uno"))).not.toEqual(pos(buildModel(r, "due")));
    expect(pos(buildModel(composite([{ recipe: leafy, seed: "a" }]), "uno"))).not.toEqual(pos(buildModel(composite([{ recipe: leafy, seed: "b" }]), "uno")));
  });

  it("segnala, densità e tratteggio dei figli arrivano alle parti", () => {
    const model = buildModel(
      composite([
        { recipe: { ...unitBox, hatch: { density: 1 } } },
        { recipe: { ...unitBox, hatch: { density: 2, cross: false } }, position: [2, 0, 0], signal: true },
      ]),
      "s",
    );
    const [a, b] = model.parts;
    expect(a.signal).toBe(false);
    expect(b.signal).toBe(true);
    expect(a.cross).toBe(true);
    expect(b.cross).toBe(false);
    expect(b.strokeScale[1]).toBeGreaterThan(a.strokeScale[1]);
    expect(a.name.startsWith("0:") && b.name.startsWith("1:")).toBe(true);
  });

  it("i figli ereditano la variazione del composto", () => {
    const leafy: CompositeChild = { archetype: "lathe", params: { profile: [[0, 0], [0.5, 0.4], [0, 1]] } };
    const pos = (m: Model) => m.parts.map((p) => Array.from(p.geometry.getAttribute("position").array));
    const r = composite([{ recipe: leafy }], { variation: 0 });
    expect(pos(buildModel(r, "uno"))).toEqual(pos(buildModel(r, "due")));
  });
});

describe("staio della vetrina", () => {
  const model = buildModel(STAIO_RECIPE as Recipe, "staio");

  it("è un composto di recipiente e chicchi", () => {
    expect(STAIO_RECIPE.archetype).toBe("composite");
    expect(model.parts.some((p) => p.name.startsWith("0:"))).toBe(true);
    expect(model.parts.some((p) => p.name === "1:grains")).toBe(true);
  });

  it("i chicchi stanno sopra il bordo del recipiente", () => {
    expect(maxYOf(model, "1:")).toBeGreaterThan(maxYOf(model, "0:") + 0.05);
  });

  it("i chicchi sono tanti ma la geometria resta leggera", () => {
    const grains = model.parts.find((p) => p.name === "1:grains")!;
    expect(grains.geometry.getAttribute("position").count).toBeGreaterThan(5000);
    expect(grains.geometry.getAttribute("position").count).toBeLessThan(30000);
  });
});
