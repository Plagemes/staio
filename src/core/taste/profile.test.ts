import { describe, expect, it } from "vitest";
import type { RecipeFood } from "./cooked-together";
import { MIN_VOTED_DISHES, foodLeanings, rankByTaste, tasteProfile, type VotedDish } from "./profile";

const f = (key: string): RecipeFood => ({ key, name: key.toUpperCase() });
const dish = (recipeId: string, good: boolean, ...keys: string[]): VotedDish => ({ recipeId, good, foods: keys.map(f) });

// 6 piatti: carciofo sempre bene, cavolo sempre male, pomodoro nei due versi, pasta in tutti (di base)
const MANY: VotedDish[] = [
  dish("r1", true, "pasta", "carciofo", "pomodoro"),
  dish("r2", true, "pasta", "carciofo", "limone"),
  dish("r3", true, "pasta", "carciofo", "pomodoro"),
  dish("r4", false, "pasta", "cavolo", "pomodoro"),
  dish("r5", false, "pasta", "cavolo", "limone"),
  dish("r6", false, "pasta", "cavolo", "pomodoro"),
  dish("r7", true, "pasta", "carciofo", "mela"),
  dish("r8", false, "pasta", "cavolo", "mela"),
  dish("r9", true, "riso", "mela"),
  dish("r10", false, "riso", "limone"),
];

// sei piatti, nessun ingrediente di base: a+b sempre bene, c+d sempre male
const PAIRS: VotedDish[] = [
  dish("p1", true, "a", "b"),
  dish("p2", true, "a", "b"),
  dish("p3", true, "a", "b"),
  dish("p4", false, "c", "d"),
  dish("p5", false, "c", "d"),
  dish("p6", false, "c", "d"),
];

describe("profilo di gusto", () => {
  it("nessun voto o pochi voti: «pochi dati», nessun elenco", () => {
    expect(tasteProfile([])).toEqual({ status: "few", voted: 0, needed: MIN_VOTED_DISHES });
    expect(tasteProfile(MANY.slice(0, 4))).toMatchObject({ status: "few", voted: 4 });
  });

  it("piatti senza ingredienti riconosciuti non contano", () => {
    const empty = [...MANY.slice(0, 4), dish("x", true), dish("y", true)];
    expect(tasteProfile(empty)).toMatchObject({ status: "few", voted: 4 });
  });

  it("separa ciò che compare nei piatti buoni da ciò che compare nei cattivi, con i conteggi", () => {
    const p = tasteProfile(MANY);
    if (p.status !== "ok") throw new Error("atteso ok");
    const byKey = Object.fromEntries(p.foods.map((x) => [x.food.key, x]));
    expect(byKey.carciofo).toMatchObject({ good: 4, bad: 0, total: 4, recipes: 4, lean: "liked" });
    expect(byKey.cavolo).toMatchObject({ good: 0, bad: 4, lean: "disliked" });
    // pomodoro in piatti buoni e cattivi: 2 bene, 2 male, misto
    expect(byKey.pomodoro).toMatchObject({ good: 2, bad: 2, total: 4, lean: "mixed" });
    // riso: solo 2 piatti, sotto la soglia
    expect(byKey.riso).toBeUndefined();
  });

  it("toglie gli ingredienti di base e lo dichiara", () => {
    const p = tasteProfile(MANY);
    if (p.status !== "ok") throw new Error("atteso ok");
    expect(p.staples.map((s) => s.key)).toEqual(["pasta"]);
    expect(p.foods.some((x) => x.food.key === "pasta")).toBe(false);
  });

  it("le coppie hanno le stesse soglie", () => {
    const p = tasteProfile(PAIRS);
    if (p.status !== "ok") throw new Error("atteso ok");
    expect(p.pairs.find((x) => x.a.key === "a" && x.b.key === "b")).toMatchObject({ good: 3, bad: 0, total: 3, lean: "liked" });
    expect(p.pairs.find((x) => x.a.key === "c" && x.b.key === "d")).toMatchObject({ good: 0, bad: 3, lean: "disliked" });
    // con due soli piatti insieme non conta
    const few = tasteProfile([...PAIRS.slice(1), dish("p7", true, "e", "f")]);
    if (few.status !== "ok") throw new Error("atteso ok");
    expect(few.pairs.find((x) => x.a.key === "a")).toBeUndefined();
  });

  it("lo stesso piatto rifatto tre volte non basta: servono due ricette", () => {
    const same = [1, 2, 3, 4, 5].map(() => dish("solo", true, "zucca", "salvia"));
    const p = tasteProfile(same);
    if (p.status !== "ok") throw new Error("atteso ok");
    expect(p.foods).toEqual([]);
  });

  it("ingredienti cucinati spesso, anche senza voto", () => {
    const cooked = [1, 2, 3].map((i) => ({ recipeId: `c${i}`, foods: [f("zucca"), f("zucca")] }));
    const p = tasteProfile(MANY, cooked);
    if (p.status !== "ok") throw new Error("atteso ok");
    expect(p.often).toEqual([{ food: f("zucca"), times: 3 }]);
  });

  it("è deterministico: non dipende dall'ordine", () => {
    expect(tasteProfile([...MANY].reverse())).toEqual(tasteProfile(MANY));
    const shuffled = MANY.map((d, i) => ({ ...d, foods: i % 2 ? [...d.foods].reverse() : d.foods }));
    expect(tasteProfile(shuffled)).toEqual(tasteProfile(MANY));
  });
});

describe("ordine per gusto", () => {
  const items = ["cavolo", "mela", "carciofo", "pomodoro", "pera"];
  it("sale ciò che ti piace, scende ciò che no, nulla sparisce, l'ordine interno resta", () => {
    const p = tasteProfile(MANY);
    expect(foodLeanings(p).get("carciofo")).toBe("liked");
    expect(rankByTaste(items, (k) => k, p)).toEqual(["mela", "carciofo", "pomodoro", "pera", "cavolo"]);
  });
  it("senza abbastanza dati l'ordine non cambia", () => {
    expect(rankByTaste(items, (k) => k, tasteProfile(MANY.slice(0, 3)))).toEqual(items);
  });
  it("la coppia con l'alimento di partenza vale più dell'alimento da solo", () => {
    // a e b stanno bene insieme; a è anche in un piatto con z, votato male: a+z non ha dati, resta il giudizio su z (nessuno)
    const p = tasteProfile(PAIRS);
    expect(rankByTaste(["d", "x", "b"], (k) => k, p, ["a"])).toEqual(["b", "x", "d"]);
  });
});
