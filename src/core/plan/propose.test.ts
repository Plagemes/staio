import { describe, expect, it } from "vitest";
import {
  alternativesFor,
  explainProposal,
  isQuickDayType,
  proposalEntries,
  proposeWeek,
  swapPick,
  weekDates,
  type PlannedEntry,
  type ProposalInput,
  type ProposalRecipe,
  type ProposalSlot,
} from "./index";
import { daysBetween } from "../diary";
import { food, recipe as recipeEntry, seededRandom, shuffled } from "./test-helpers";

const W = "2026-11-16"; // lunedì
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

const many = (n: number, extra: (i: number) => Partial<ProposalRecipe> = () => ({})): ProposalRecipe[] =>
  Array.from({ length: n }, (_, i) => rec(`r${String(i).padStart(3, "0")}`, extra(i)));

const input = (recipes: ProposalRecipe[], extra: Partial<ProposalInput> = {}): ProposalInput => ({ slots: slotsOf(), existing: [], recipes, ...extra });

const checkRules = (entries: readonly { date: string; recipeId: string }[], maxRepeats: number) => {
  const byRecipe = new Map<string, number[]>();
  for (const e of entries) byRecipe.set(e.recipeId, [...(byRecipe.get(e.recipeId) ?? []), daysBetween(W, e.date)]);
  for (const days of byRecipe.values()) {
    expect(days.length).toBeLessThanOrEqual(maxRepeats);
    for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) expect(Math.abs((days[i] as number) - (days[j] as number))).toBeGreaterThan(1);
  }
};

describe("proposeWeek: vincoli duri", () => {
  it("una ricetta che contiene un allergene non entra mai, nemmeno con poche ricette", () => {
    const recipes = [rec("a", { safety: "contains" }), rec("b", { safety: "contains" }), rec("c")];
    const p = proposeWeek(input(recipes));
    expect(p.meals.every((m) => m.recipeId === "c")).toBe(true);
    expect(p.meals.length).toBeLessThanOrEqual(2);
    expect(p.summary.excluded.contains).toBe(2);
  });

  it("se tutte le ricette contengono qualcosa non propone niente", () => {
    const p = proposeWeek(input([rec("a", { safety: "contains" })]));
    expect(p.meals).toEqual([]);
    expect(p.unfilled).toHaveLength(14);
  });

  it("anche con un indirizzo di ricette 'incerte' e 'contiene' ammesso, 'contiene' resta fuori", () => {
    const recipes = [rec("a", { safety: "contains" }), rec("b", { safety: "uncertain" })];
    const p = proposeWeek(input(recipes, { options: { allowUncertain: true } }));
    expect(p.meals.every((m) => m.recipeId === "b")).toBe(true);
  });

  it("una ricetta incerta entra solo se l'utente lo permette, e porta l'avviso", () => {
    const recipes = [rec("a", { safety: "uncertain" }), ...many(6)];
    const off = proposeWeek(input(recipes));
    expect(off.meals.some((m) => m.recipeId === "a")).toBe(false);
    expect(off.summary.excluded.uncertain).toBe(1);
    const only = proposeWeek(input([rec("a", { safety: "uncertain" })], { options: { allowUncertain: true } }));
    expect(only.meals.length).toBeGreaterThan(0);
    expect(only.meals.every((m) => m.warning === "uncertain")).toBe(true);
  });

  it("non tocca i posti dell'utente e non li propone, anche se glieli si passa", () => {
    const existing: PlannedEntry[] = [food(DAYS[0] as string, "lunch", "Riso", 80), recipeEntry(DAYS[1] as string, "dinner", "r000")];
    const p = proposeWeek(input(many(12), { existing }));
    const taken = new Set(existing.map((e) => `${e.date}|${e.meal}`));
    expect(p.meals.some((m) => taken.has(`${m.slot.date}|${m.slot.meal}`))).toBe(false);
    expect(p.summary.requested).toBe(12);
    expect(p.unfilled.some((s) => taken.has(`${s.date}|${s.meal}`))).toBe(false);
  });

  it("le ripetizioni dell'utente contano: la ricetta già messa a mano rispetta limite e giorni consecutivi", () => {
    const existing: PlannedEntry[] = [recipeEntry(DAYS[2] as string, "dinner", "r000"), recipeEntry(DAYS[4] as string, "dinner", "r000")];
    const p = proposeWeek(input(many(8), { existing }));
    expect(p.meals.some((m) => m.recipeId === "r000")).toBe(false);
    const all = [...existing.map((e) => ({ date: e.date, recipeId: (e.item as { recipeId: string }).recipeId })), ...p.meals.map((m) => ({ date: m.slot.date, recipeId: m.recipeId }))];
    checkRules(all, 2);
    const near = proposeWeek(input(many(8), { existing: [recipeEntry(DAYS[2] as string, "dinner", "r000")], options: { maxRepeats: 3 } }));
    expect(near.meals.some((m) => m.recipeId === "r000" && Math.abs(daysBetween(DAYS[2] as string, m.slot.date)) <= 1)).toBe(false);
  });

  it("varietà: mai la stessa ricetta più di N volte, né nello stesso giorno né in giorni consecutivi", () => {
    for (const n of [1, 2, 3]) {
      const p = proposeWeek(input(many(7), { options: { maxRepeats: n } }));
      checkRules(
        p.meals.map((m) => ({ date: m.slot.date, recipeId: m.recipeId })),
        n,
      );
    }
  });

  it("pochi dati: con 3 ricette riempie ciò che può senza ripetere all'infinito e lo dice", () => {
    const p = proposeWeek(input(many(3)));
    expect(p.summary.fewRecipes).toBe(true);
    expect(p.summary.candidates).toBe(3);
    expect(p.meals.length).toBeLessThan(14);
    expect(p.meals.length).toBeGreaterThan(0);
    expect(p.unfilled.length + p.meals.length).toBe(14);
    checkRules(
      p.meals.map((m) => ({ date: m.slot.date, recipeId: m.recipeId })),
      2,
    );
  });

  it("con molte ricette non c'è l'avviso delle poche", () => {
    expect(proposeWeek(input(many(10))).summary.fewRecipes).toBe(false);
  });

  it("nei giorni con poco tempo non entrano ricette lunghe (quelle senza tempo sì)", () => {
    const recipes = [rec("long", { minutes: 90 }), rec("unknown"), rec("short", { minutes: 15 }), ...many(4, () => ({ minutes: 100 }))];
    const days = { [DAYS[1] as string]: { lowTime: true }, [DAYS[3] as string]: { lowTime: true } };
    const p = proposeWeek(input(recipes, { days }));
    for (const m of p.meals) {
      if (m.slot.date === DAYS[1] || m.slot.date === DAYS[3]) {
        const minutes = recipes.find((r) => r.recipeId === m.recipeId)?.minutes;
        expect(minutes === undefined || minutes <= 30).toBe(true);
      }
    }
  });

  it("rispetta i momenti per cui la ricetta è pensata", () => {
    const recipes = [rec("a", { meals: ["dinner"] }), rec("b", { meals: ["lunch"] }), ...many(4)];
    const p = proposeWeek(input(recipes));
    for (const m of p.meals) {
      if (m.recipeId === "a") expect(m.slot.meal).toBe("dinner");
      if (m.recipeId === "b") expect(m.slot.meal).toBe("lunch");
    }
  });
});

describe("proposeWeek: criteri", () => {
  it("usa prima ciò che scade, e non dopo la scadenza", () => {
    const spinach = { key: "name:spinaci", name: "Spinaci", expiresOn: DAYS[2] as string, weight: 0.8 };
    const recipes = [rec("a", { expiring: [spinach] }), ...many(6)];
    const p = proposeWeek(input(recipes));
    const used = p.meals.filter((m) => m.recipeId === "a");
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((m) => m.slot.date <= (DAYS[2] as string))).toBe(true);
    const first = used[0];
    expect(first?.reasons[0]).toEqual({ code: "expiring", uses: [{ name: "Spinaci", expiresOn: DAYS[2] }] });
  });

  it("un alimento già scaduto alla data del posto non dà vantaggio", () => {
    const old = { key: "name:latte", name: "Latte", expiresOn: DAYS[0] as string, weight: 1 };
    const p = proposeWeek(input([rec("z", { expiring: [old] }), rec("b"), rec("c")], { slots: [{ date: DAYS[3] as string, meal: "lunch" }] }));
    expect(p.meals[0]?.recipeId).toBe("b");
  });

  it("l'alimento in scadenza conta una volta: la seconda ricetta che lo usa non ha un secondo vantaggio", () => {
    const x = { key: "name:x", name: "X", expiresOn: DAYS[6] as string, weight: 1 };
    const recipes = [rec("a", { expiring: [x] }), rec("b", { expiring: [x] }), rec("c", { ingredients: [{ key: "k", name: "K", inHome: true }] })];
    const p = proposeWeek(input(recipes, { slots: slotsOf(["lunch"], DAYS.slice(0, 2)) }));
    const reasons = p.meals.flatMap((m) => m.reasons.filter((r) => r.code === "expiring"));
    expect(reasons).toHaveLength(1);
    expect(p.summary.expiring).toEqual({ usable: 1, used: 1 });
  });

  it("a parità, preferisce ciò che c'è già in casa", () => {
    const recipes = [
      rec("a", { ingredients: [{ key: "1", name: "1", inHome: false }, { key: "2", name: "2", inHome: false }] }),
      rec("b", { ingredients: [{ key: "3", name: "3", inHome: true }, { key: "4", name: "4", inHome: true }] }),
    ];
    const p = proposeWeek(input(recipes, { slots: [{ date: DAYS[0] as string, meal: "lunch" }] }));
    expect(p.meals[0]?.recipeId).toBe("b");
    expect(p.meals[0]?.reasons[0]).toEqual({ code: "pantry", inHome: 2, total: 2, stale: 0 });
  });

  it("la scadenza vince sulla dispensa (ordine dei criteri)", () => {
    const recipes = [
      rec("home", { ingredients: [{ key: "1", name: "1", inHome: true }] }),
      rec("exp", { ingredients: [{ key: "2", name: "2", inHome: false }], expiring: [{ key: "e", name: "E", expiresOn: DAYS[1] as string, weight: 0.8 }] }),
    ];
    const p = proposeWeek(input(recipes, { slots: [{ date: DAYS[0] as string, meal: "lunch" }] }));
    expect(p.meals[0]?.recipeId).toBe("exp");
  });

  it("pranzo e cena dello stesso giorno hanno ingredienti principali diversi, se si può", () => {
    const recipes = [rec("a", { mainKey: "pollo" }), rec("b", { mainKey: "pollo" }), rec("c", { mainKey: "pesce" }), rec("d", { mainKey: "uova" })];
    const p = proposeWeek(input(recipes));
    for (const date of DAYS) {
      const mains = p.meals.filter((m) => m.slot.date === date).map((m) => recipes.find((r) => r.recipeId === m.recipeId)?.mainKey);
      expect(new Set(mains).size).toBe(mains.length);
    }
  });

  it("obiettivi: preferisce la ricetta più vicina alla quota di proteine del giorno", () => {
    const targets = { proteinG: { min: 60, max: 80 } };
    const recipes = [rec("low", { nutrients: { proteinG: 5 } }), rec("good", { nutrients: { proteinG: 35 } }), rec("far", { nutrients: { proteinG: 120 } })];
    const p = proposeWeek(input(recipes, { slots: slotsOf(["lunch", "dinner"], DAYS.slice(0, 1)), days: { [DAYS[0] as string]: { targets } } }));
    expect(p.meals[0]?.recipeId).toBe("good");
  });

  it("obiettivi: sono solo una preferenza, non escludono nessuna ricetta", () => {
    const targets = { energyKcal: { max: 100 } };
    const p = proposeWeek(input(many(8, () => ({ nutrients: { energyKcal: 900 } })), { days: Object.fromEntries(DAYS.map((d) => [d, { targets }])) }));
    expect(p.meals).toHaveLength(14);
  });

  it("«Spendi il meno possibile»: il costo viene per primo e dichiara le ricette senza costo", () => {
    const recipes = [
      rec("cheap", { cost: { cents: 100, complete: true } }),
      rec("dear", { cost: { cents: 900, complete: true } }),
      rec("partial", { cost: { cents: 10, complete: false } }),
      rec("none", { ingredients: [{ key: "k", name: "K", inHome: true }] }),
    ];
    const slots = [{ date: DAYS[0] as string, meal: "lunch" as const }];
    const p = proposeWeek(input(recipes, { slots, options: { spendLeast: true } }));
    expect(p.meals[0]?.recipeId).toBe("cheap");
    expect(p.meals[0]?.reasons[0]).toEqual({ code: "cost", cents: 100 });
    expect(p.summary.cost).toMatchObject({ recipesWithoutCost: 2, recipes: 4, knownMeals: 1, unknownMeals: 0 });
    const off = proposeWeek(input(recipes, { slots }));
    expect(off.summary.cost).toBeUndefined();
    expect(off.meals[0]?.recipeId).toBe("none");
  });

  it("costo della proposta: somma dei noti, con i pasti senza costo contati a parte", () => {
    const recipes = [rec("a", { cost: { cents: 200, complete: true } }), rec("b", { cost: { cents: 300, complete: true } }), rec("c")];
    const p = proposeWeek(input(recipes, { slots: slotsOf(["lunch"], DAYS.slice(0, 3)), options: { spendLeast: true } }));
    expect(p.summary.cost?.cents).toBe(p.meals.reduce((s, m) => s + (m.recipeId === "a" ? 200 : m.recipeId === "b" ? 300 : 0), 0));
    expect(p.summary.cost?.unknownMeals).toBe(p.meals.filter((m) => m.recipeId === "c").length);
  });

  it("ogni posto ha un motivo", () => {
    const p = proposeWeek(input(many(10)));
    expect(p.meals.length).toBe(14);
    expect(p.meals.every((m) => m.reasons.length >= 1 && m.reasons.length <= 2)).toBe(true);
  });
});

describe("proposeWeek: determinismo e tempo", () => {
  it("stesse ricette e stessa dispensa: stesso piano, qualunque sia l'ordine d'ingresso", () => {
    const recipes = many(30, (i) => ({
      mainKey: `m${i % 7}`,
      minutes: 10 + (i % 5) * 20,
      ingredients: [0, 1, 2, 3].map((k) => ({ key: `k${(i + k) % 11}`, name: `K${(i + k) % 11}`, inHome: (i + k) % 3 === 0 })),
      expiring: i % 6 === 0 ? [{ key: `e${i % 4}`, name: `E${i % 4}`, expiresOn: DAYS[2 + (i % 3)] as string, weight: 0.5 }] : [],
      nutrients: { energyKcal: 300 + i * 10, proteinG: 10 + (i % 9) * 4 },
    }));
    const days = { [DAYS[0] as string]: { targets: { proteinG: { min: 60 } } } };
    const a = proposeWeek(input(recipes, { days }));
    const b = proposeWeek(input(shuffled(recipes, seededRandom(7)), { days }));
    const c = proposeWeek(input(shuffled(recipes, seededRandom(99)), { days, slots: [...slotsOf()].reverse() }));
    expect(b.picks).toEqual(a.picks);
    expect(c.picks).toEqual(a.picks);
    expect(proposeWeek(input(recipes, { days })).picks).toEqual(a.picks);
  });

  it("21 posti e 200 ricette in meno di 200 ms", () => {
    const recipes = many(200, (i) => ({
      mainKey: `m${i % 13}`,
      minutes: 10 + (i % 8) * 10,
      safety: i % 17 === 0 ? ("uncertain" as const) : i % 23 === 0 ? ("contains" as const) : ("clear" as const),
      ingredients: Array.from({ length: 8 }, (_, k) => ({ key: `k${(i * 3 + k) % 60}`, name: `K${(i * 3 + k) % 60}`, inHome: (i + k) % 3 === 0 })),
      expiring: [{ key: `e${i % 9}`, name: `E${i % 9}`, expiresOn: DAYS[1 + (i % 5)] as string, weight: 0.3 + (i % 5) / 10 }],
      nutrients: { energyKcal: 300 + (i % 20) * 40, proteinG: 8 + (i % 12) * 3 },
      cost: { cents: 100 + i * 7, complete: i % 4 !== 0 },
    }));
    const slots = [...slotsOf(["lunch", "dinner"]), ...DAYS.slice(0, 7).map((date) => ({ date, meal: "breakfast" as const }))];
    const days = Object.fromEntries(DAYS.map((d, i) => [d, { lowTime: i === 2, targets: { energyKcal: { min: 1800, max: 2200 }, proteinG: { min: 80 } } }]));
    const run = () => proposeWeek({ slots, existing: [], recipes, days, options: { spendLeast: true, allowUncertain: true } });
    run();
    const t0 = performance.now();
    const p = run();
    const ms = performance.now() - t0;
    expect(slots).toHaveLength(21);
    expect(p.meals.length).toBe(21);
    expect(ms).toBeLessThan(200);
    checkRules(
      p.meals.map((m) => ({ date: m.slot.date, recipeId: m.recipeId })),
      2,
    );
    expect(p.meals.some((m) => recipes.find((r) => r.recipeId === m.recipeId)?.safety === "contains")).toBe(false);
  });
});

describe("scambio, rimozione, riepilogo", () => {
  const recipes = [
    rec("a", { ingredients: [{ key: "1", name: "1", inHome: true }] }),
    rec("b", { ingredients: [{ key: "2", name: "2", inHome: true }, { key: "x", name: "x", inHome: false }] }),
    rec("c", { ingredients: [{ key: "3", name: "3", inHome: false }] }),
    rec("d", { safety: "contains" }),
  ];
  const slot = { date: DAYS[0] as string, meal: "lunch" as const };

  it("«Un'altra» propone la successiva migliore, mai una che contiene, e dopo l'ultima torna alla prima", () => {
    const base = input(recipes, { slots: [slot] });
    const p = proposeWeek(base);
    expect(p.picks[0]?.recipeId).toBe("a");
    const ranking = alternativesFor(base, p.picks, slot).map((x) => x.recipeId);
    expect(ranking).toEqual(["a", "b", "c"]);
    const second = swapPick(base, p.picks, slot);
    expect(second?.[0]?.recipeId).toBe("b");
    const third = swapPick(base, second ?? [], slot);
    expect(third?.[0]?.recipeId).toBe("c");
    const back = swapPick(base, third ?? [], slot);
    expect(back?.[0]?.recipeId).toBe("a");
  });

  it("lo scambio rispetta i limiti: non porta una ricetta accanto a un'altra uguale", () => {
    const two = [slot, { date: DAYS[1] as string, meal: "lunch" as const }];
    const base = input(recipes, { slots: two });
    const p = proposeWeek(base);
    const ids = p.picks.map((x) => x.recipeId);
    expect(new Set(ids).size).toBe(2);
    const first = p.picks[0] as { slot: ProposalSlot; recipeId: string };
    const swapped = swapPick(base, p.picks, first.slot);
    const after = swapped?.map((x) => x.recipeId) ?? [];
    expect(new Set(after).size).toBe(after.length);
  });

  it("senza altre ricette ammesse non c'è scambio", () => {
    const base = input([rec("a")], { slots: [slot] });
    const p = proposeWeek(base);
    expect(swapPick(base, p.picks, slot)).toBeUndefined();
  });

  it("togliere una voce lascia il posto vuoto e aggiorna il riepilogo", () => {
    const base = input(many(8), { slots: slotsOf(["lunch"], DAYS.slice(0, 3)) });
    const p = proposeWeek(base);
    const removed = explainProposal(base, p.picks.slice(1));
    expect(removed.meals).toHaveLength(2);
    expect(removed.unfilled).toHaveLength(1);
    expect(removed.summary.filled).toBe(2);
    expect(proposalEntries(removed.meals)).toHaveLength(2);
  });

  it("le voci scritte hanno ricetta e porzioni della proposta", () => {
    const p = proposeWeek(input([rec("a", { servings: 2 }), rec("b"), rec("c")], { slots: [slot] }));
    expect(proposalEntries(p.meals)).toEqual([{ date: slot.date, meal: "lunch", item: { kind: "recipe", recipeId: p.meals[0]?.recipeId, servings: p.meals[0]?.servings } }]);
  });
});

describe("isQuickDayType", () => {
  it("riconosce i nomi che dicono poco tempo", () => {
    expect(isQuickDayType("Poco tempo")).toBe(true);
    expect(isQuickDayType("giornata di corsa")).toBe(true);
    expect(isQuickDayType("di corsa")).toBe(true);
    expect(isQuickDayType("allenamento")).toBe(false);
    expect(isQuickDayType(undefined)).toBe(false);
  });
});
