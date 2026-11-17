// Il file dei dati veri, generato da scripts/taste/build_taste.py. Controlla la forma e qualche abbinamento noto con
// soglie larghe: se si rigenera da una versione diversa dei vettori i punteggi cambiano un poco.
import { describe, expect, it } from "vitest";
import { FOODS } from "../nutrition/data/foods";
import compact from "./data/flavorgraph.json";
import { decodeTasteData, type CompactTasteData } from "./decode";
import { createTasteIndex, resolveTasteFood } from "./index-build";
import { pairingsForSet, pairingsOf } from "./pairings";

const file = compact as unknown as CompactTasteData & { _licenza: string; method: string };
const data = decodeTasteData(file);
const index = createTasteIndex(data);

describe("file dei dati", () => {
  it("dichiara fonte e licenza", () => {
    expect(file.source).toBe("flavorgraph");
    expect(file.version).toMatch(/sha256/);
    expect(file.method).toBe("csls");
    expect(file._licenza).toMatch(/CC BY-NC-SA 3\.0/);
    expect(file._licenza).toMatch(/10\.1038\/s41598-020-79422-8/);
    expect(file._licenza).toMatch(/non commerciale/);
  });

  it("è compatto", () => {
    expect(JSON.stringify(compact).length).toBeLessThan(300_000);
  });

  it("ha la forma attesa e nessuna voce scartata dall'indice", () => {
    expect(file.foods.length).toBeGreaterThan(150);
    expect(file.neighbors.length).toBe(file.foods.length);
    expect(index.problems).toEqual([]);
    for (const list of file.neighbors) {
      expect(list.length).toBeLessThanOrEqual(20);
      expect(list.length).toBeGreaterThan(0);
      // l'ordine è quello del valore d'ordine (CSLS), non del coseno
      const orders = list.map(([, , o]) => o);
      expect(orders).toEqual([...orders].sort((a, b) => b - a));
      for (const [j, s, o] of list) {
        expect(Number.isInteger(j) && j >= 0 && j < file.foods.length).toBe(true);
        expect(Number.isInteger(s) && s >= 1 && s <= 100).toBe(true);
        expect(Number.isInteger(o)).toBe(true);
      }
    }
  });

  it("ogni identificativo esiste nella tabella nutrizionale e sta in un solo nodo", () => {
    const known = new Set(FOODS.map((f) => f.id));
    const seen = new Set<string>();
    for (const f of data.foods) {
      expect(f.foodIds.length).toBeGreaterThan(0);
      for (const id of f.foodIds) {
        expect(known.has(id), id).toBe(true);
        expect(seen.has(id), `${id} doppio`).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBeGreaterThan(300);
    expect(seen.size).toBeLessThanOrEqual(FOODS.length);
  });

  it("nessun alimento è tra i vicini di più di un terzo degli altri (effetto hub corretto)", () => {
    const count = new Map<string, number>();
    for (const list of Object.values(data.neighbors)) for (const [k] of list) count.set(k, (count.get(k) ?? 0) + 1);
    expect(Math.max(...count.values())).toBeLessThan(data.foods.length / 3);
  });

  it("nessun nodo è vicino di se stesso e i punteggi sono simmetrici dove i due elenchi si incontrano", () => {
    let both = 0;
    let total = 0;
    data.foods.forEach((f) => {
      for (const [other, score, order] of data.neighbors[f.key] ?? []) {
        expect(other).not.toBe(f.key);
        total++;
        const back = (data.neighbors[other] ?? []).find(([k]) => k === f.key);
        if (back) {
          both++;
          expect(back[1]).toBeCloseTo(score, 2);
          expect(back[2]).toBeCloseTo(order ?? 0, 2);
        }
      }
    });
    // il vicinato è per «primi venti»: non sempre reciproco, ma in buona parte sì
    expect(both / total).toBeGreaterThan(0.4);
  });
});

describe("abbinamenti noti", () => {
  const score = (a: string, b: string) => index.links.get(a)?.get(b)?.score ?? 0;

  it.each([
    ["tomato", "basil"],
    ["lemon", "orange"],
    ["apple", "cinnamon"],
    ["strawberry", "raspberry"],
    ["salmon", "shrimp"],
    ["lentil", "chickpea"],
  ])("%s e %s si somigliano", (a, b) => {
    expect(score(a, b)).toBeGreaterThanOrEqual(0.4);
  });

  it("dal pomodoro di Staio si arriva al basilico, con la base statistica", () => {
    const r = pairingsOf(index, { name: "x", foodId: "pomodoro-crudo" });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.members.map((m) => m.key)).toEqual(["tomato"]);
    expect(r.pairings.some((p) => p.food.key === "basil")).toBe(true);
    expect(r.pairings.length).toBeLessThanOrEqual(20);
    expect(r.basis.statistical).toBe(true);
    expect(r.basis.text).toMatch(/non è una regola né un giudizio di salute/);
    const ranks = r.pairings.map((p) => p.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(r.pairings.every((p) => p.score > 0 && p.score <= 1)).toBe(true);
  });

  it("riconosce per nome e per identificativo, non per somiglianza", () => {
    expect(resolveTasteFood(index, { name: "Pomodori" })?.key).toBe("tomato");
    expect(resolveTasteFood(index, { name: "Spaghetti" })?.key).toBe("pasta");
    expect(resolveTasteFood(index, { name: "Basilico" })?.key).toBe("basil");
    expect(resolveTasteFood(index, { name: "Zibibbo" })).toBeUndefined();
    expect(resolveTasteFood(index, { name: "Lasagne surgelate", foodId: "lasagne-surgelate" })).toBeUndefined();
  });

  it("un alimento fuori elenco dà «non in elenco»", () => {
    expect(pairingsOf(index, { name: "Pinoli", foodId: "pinoli" })).toMatchObject({ status: "not_in_list" });
  });

  it("un insieme porta i suoi membri e l'allergene dichiarato toglie i vicini che lo contengono", () => {
    const set = pairingsForSet(index, [{ name: "Pomodoro" }, { name: "Basilico" }], { limit: 40 });
    if (set.status !== "ok") throw new Error("atteso ok");
    expect(set.members.map((m) => m.key).sort()).toEqual(["basil", "tomato"]);
    const keys = set.pairings.map((p) => p.food.key);
    expect(keys).not.toContain("tomato");
    expect(keys).not.toContain("basil");

    const plain = pairingsOf(index, { name: "Pasta" }, { limit: 200 });
    const safe = pairingsOf(index, { name: "Pasta" }, { allergens: ["glutine", "lattosio"], limit: 200 });
    if (plain.status !== "ok" || safe.status !== "ok") throw new Error("atteso ok");
    expect(safe.pairings.length + safe.hiddenCount).toBe(plain.pairings.length);
    expect(safe.hiddenCount).toBeGreaterThan(0);
    expect(safe.pairings.every((p) => p.doubt === undefined || p.doubt.allergens.length > 0)).toBe(true);
  });
});
