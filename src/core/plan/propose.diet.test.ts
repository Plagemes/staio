import { describe, expect, it } from "vitest";
import {
  PROPOSAL_WEIGHTS,
  alternativesFor,
  explainProposal,
  proposeWeek,
  weekDates,
  type ProposalInput,
  type ProposalRecipe,
  type ProposalSlot,
} from "./index";
import type { DietGroup } from "../diet/types";

const W = "2026-11-16";
const DAYS = weekDates(W);
const slotsOf = (meals: ("lunch" | "dinner")[] = ["lunch", "dinner"], days = DAYS): ProposalSlot[] => days.flatMap((date) => meals.map((meal) => ({ date, meal })));

const rec = (id: string, extra: Partial<ProposalRecipe> = {}): ProposalRecipe => ({
  recipeId: id,
  title: `Ricetta ${id}`,
  servings: 1,
  safety: "clear",
  mainKey: `main-${id}`,
  ingredients: [{ key: `name:${id}-a`, name: "A", inHome: false }],
  ...extra,
});

const input = (recipes: ProposalRecipe[], extra: Partial<ProposalInput> = {}): ProposalInput => ({ slots: slotsOf(), existing: [], recipes, ...extra });

const GROUPS: DietGroup[] = ["vegetables", "fruit", "legumes", "fish", "wholeGrains"];
const mixed = (n: number, withGroups: boolean): ProposalRecipe[] =>
  Array.from({ length: n }, (_, i) =>
    rec(`r${String(i).padStart(3, "0")}`, {
      mainKey: `m${i % 7}`,
      minutes: 10 + (i % 6) * 10,
      ingredients: Array.from({ length: 5 }, (_, k) => ({ key: `k${(i * 3 + k) % 25}`, name: `K${k}`, inHome: (i + k) % 3 === 0 })),
      expiring: [{ key: `e${i % 5}`, name: `E${i % 5}`, expiresOn: DAYS[1 + (i % 5)] as string, weight: 0.4 }],
      nutrients: { energyKcal: 300 + (i % 10) * 50, proteinG: 10 + (i % 7) * 4 },
      ...(withGroups ? { dietGroups: [GROUPS[i % 5] as DietGroup, GROUPS[(i + 2) % 5] as DietGroup] } : {}),
    }),
  );

describe("proposeWeek: lacune per gruppo alimentare", () => {
  it("i pesi restano uno il doppio del successivo", () => {
    const w = PROPOSAL_WEIGHTS;
    expect(w).toEqual({ cost: 64, expiry: 32, pantry: 16, diet: 8, variety: 4, goals: 2 });
    expect([w.cost / w.expiry, w.expiry / w.pantry, w.pantry / w.diet, w.diet / w.variety, w.variety / w.goals]).toEqual([2, 2, 2, 2, 2]);
  });

  describe("non regressione: senza lacune l'esito è identico a quello di prima", () => {
    const days = Object.fromEntries(DAYS.map((d, i) => [d, { lowTime: i === 2, targets: { energyKcal: { min: 1800, max: 2200 }, proteinG: { min: 80 } } }]));
    const base = (extra: Partial<ProposalInput> = {}) => input(mixed(40, false), { days, ...extra });

    it("dietGaps assente, vuoto o a zero, e ricette con o senza gruppi: stessa proposta", () => {
      const reference = proposeWeek(base());
      expect(reference.meals.length).toBeGreaterThan(0);
      for (const variant of [
        proposeWeek(base({ dietGaps: {} })),
        proposeWeek(base({ dietGaps: { vegetables: 0, fish: -2 } })),
        proposeWeek({ ...base(), recipes: mixed(40, true) }),
        proposeWeek({ ...base({ dietGaps: {} }), recipes: mixed(40, true) }),
      ]) {
        expect(variant).toEqual(reference);
      }
      expect(reference.meals.some((m) => m.reasons.some((r) => r.code === "diet"))).toBe(false);
    });

    it("anche con «Spendi il meno possibile» e con le alternative", () => {
      const options = { spendLeast: true };
      const recipes = mixed(30, false).map((r, i) => ({ ...r, cost: { cents: 100 + i * 9, complete: i % 4 !== 0 } }));
      const a = proposeWeek(input(recipes, { options }));
      const b = proposeWeek(input(recipes.map((r) => ({ ...r, dietGroups: ["fish" as const] })), { options, dietGaps: {} }));
      expect(b).toEqual(a);
      const slot = a.picks[3]?.slot as ProposalSlot;
      expect(alternativesFor(input(recipes, { options, dietGaps: { fish: 0 } }), a.picks, slot)).toEqual(alternativesFor(input(recipes, { options }), a.picks, slot));
    });
  });

  it("una lacuna orienta la scelta verso le ricette che la colmano", () => {
    const recipes = [rec("a-plain"), rec("b-plain"), rec("c-legumes", { dietGroups: ["legumes"] })];
    const slots = [{ date: W, meal: "lunch" as const }];
    const without = proposeWeek(input(recipes, { slots }));
    expect(without.picks[0]?.recipeId).toBe("a-plain");
    const withGap = proposeWeek(input(recipes, { slots, dietGaps: { legumes: 2 } }));
    expect(withGap.picks[0]?.recipeId).toBe("c-legumes");
    expect(withGap.meals[0]?.reasons).toContainEqual({ code: "diet", groups: ["legumes"] });
  });

  it("una ricetta scelta riduce le lacune per le successive", () => {
    const recipes = [rec("a-veg", { dietGroups: ["vegetables"] }), rec("b-veg", { dietGroups: ["vegetables"] }), rec("c-fish", { dietGroups: ["fish"] })];
    const slots = [
      { date: W, meal: "lunch" as const },
      { date: W, meal: "dinner" as const },
    ];
    const p = proposeWeek(input(recipes, { slots, dietGaps: { vegetables: 1, fish: 1 } }));
    expect(p.picks.map((x) => x.recipeId).sort()).toEqual(["a-veg", "c-fish"]);
    // con due porzioni di verdura mancanti, invece, la seconda verdura vale ancora
    const two = proposeWeek(input(recipes, { slots, dietGaps: { vegetables: 2, fish: 1 } }));
    expect(two.picks.map((x) => x.recipeId).sort()).toEqual(["a-veg", "b-veg"]);
  });

  it("il motivo «diet» elenca solo le lacune ancora aperte e lascia al massimo due motivi", () => {
    const recipes = [rec("a", { dietGroups: ["vegetables", "fish"] }), rec("b", { dietGroups: ["vegetables", "fish"] })];
    const slots = [
      { date: W, meal: "lunch" as const },
      { date: DAYS[2] as string, meal: "lunch" as const },
    ];
    const p = proposeWeek(input(recipes, { slots, dietGaps: { vegetables: 1, fish: 2 } }));
    expect(p.meals[0]?.reasons).toContainEqual({ code: "diet", groups: ["vegetables", "fish"] });
    expect(p.meals[1]?.reasons).toContainEqual({ code: "diet", groups: ["fish"] });
    for (const m of p.meals) expect(m.reasons.length).toBeLessThanOrEqual(2);
  });

  it("la dispensa viene prima dei gruppi alimentari", () => {
    const recipes = [rec("a-home", { ingredients: [{ key: "k", name: "K", inHome: true }] }), rec("b-legumes", { dietGroups: ["legumes"] })];
    const p = proposeWeek(input(recipes, { slots: [{ date: W, meal: "lunch" }], dietGaps: { legumes: 3 } }));
    expect(p.picks[0]?.recipeId).toBe("a-home");
  });

  it("spiegazioni e alternative tengono conto delle lacune", () => {
    const recipes = [rec("a-plain"), rec("b-plain"), rec("c-fish", { dietGroups: ["fish"] })];
    const slot = { date: W, meal: "dinner" as const };
    const inp = input(recipes, { slots: [slot], dietGaps: { fish: 1 } });
    expect(alternativesFor(inp, [], slot).map((x) => x.recipeId)).toEqual(["c-fish", "a-plain", "b-plain"]);
    const e = explainProposal(inp, [{ slot, recipeId: "c-fish" }]);
    expect(e.meals[0]?.reasons[0]).toEqual({ code: "diet", groups: ["fish"] });
    // la ricetta del posto stesso non conta come già scelta
    expect(alternativesFor(inp, [{ slot, recipeId: "c-fish" }], slot)[0]?.recipeId).toBe("c-fish");
  });

  it("21 posti e 200 ricette con le lacune in meno di 200 ms, ancora deterministico", () => {
    const recipes = mixed(200, true);
    const slots = [...slotsOf(), ...DAYS.slice(0, 7).map((date) => ({ date, meal: "breakfast" as const }))];
    const run = () => proposeWeek({ slots, existing: [], recipes, dietGaps: { vegetables: 6, fruit: 5, legumes: 2, fish: 2, wholeGrains: 4 } });
    const first = run();
    const t0 = performance.now();
    const p = run();
    const ms = performance.now() - t0;
    expect(p.meals).toHaveLength(21);
    expect(p.picks).toEqual(first.picks);
    expect(ms).toBeLessThan(200);
  });
});
