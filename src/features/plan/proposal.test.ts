import { describe, expect, it } from "vitest";
import { derivePlan, proposeWeek, weekDates, type PlannedEntry, type ProposedMeal } from "@/core/plan";
import { structureEv } from "@/core/plan/test-helpers";
import { derivePantry } from "@/core/ledger";
import { purchase, q } from "@/core/ledger/test-helpers";
import { NOW, lotsOf, recipeOf } from "../prep/test-helpers";
import { makeLinkOf } from "../recipes/allergenLinks";
import { makeExpandForChecks } from "./expand";
import {
  buildProposalInput,
  buildProposalRecipes,
  defaultMoments,
  defaultSettings,
  expiringFoods,
  finalizeProposal,
  headlineText,
  mealsOfTags,
  reasonLine,
  summaryNotes,
  stockViews,
  type FactsArgs,
  type ProposalSettings,
} from "./proposal";

const TODAY = "2026-11-16"; // lunedì
const DATES = weekDates(TODAY);
const plan = derivePlan([]);

const pasta = recipeOf("pasta", {
  title: "Pasta al pomodoro",
  servings: 2,
  ingredients: [
    { name: "Spaghetti", quantity: { value: 200, unit: "g" } },
    { name: "Pomodori", quantity: { value: 400, unit: "g" } },
    { name: "Basilico", quantity: { value: 10, unit: "g" } },
  ],
  steps: [{ text: "Cuoci." }],
  times: { totalMinutes: 25 },
  tags: ["Cena"],
});
const frittata = recipeOf("fritt", {
  title: "Frittata di zucchine",
  servings: 2,
  ingredients: [
    { name: "Uova", quantity: { value: 4, unit: "pz" } },
    { name: "Zucchine", quantity: { value: 300, unit: "g" } },
  ],
  steps: [{ text: "Cuoci in padella." }],
  times: { totalMinutes: 40 },
});
const zuppa = recipeOf("zuppa", {
  title: "Zuppa di ceci",
  servings: 2,
  ingredients: [{ name: "Ceci", quantity: { value: 300, unit: "g" } }, { name: "Carote", quantity: { value: 100, unit: "g" } }],
  steps: [{ text: "Bolli." }],
});

const { lots } = lotsOf([
  { id: "sp", name: "Spaghetti", value: 500 },
  { id: "po", name: "Pomodori", value: 400 },
  { id: "zu", name: "Zucchine", value: 400, expiry: "2026-11-18", location: "frigo" },
  { id: "uo", name: "Uova", value: 6, unit: "pz", location: "frigo" },
  { id: "vecchio", name: "Latte", value: 500, unit: "ml", expiry: "2026-11-10", location: "frigo" },
  { id: "lontano", name: "Riso", value: 500, expiry: "2027-05-01" },
]);

const settings = (over: Partial<ProposalSettings> = {}): ProposalSettings => ({
  moments: ["lunch", "dinner"],
  days: DATES,
  maxRepeats: 2,
  servings: 1,
  allowUncertain: false,
  spendLeast: false,
  lowTimeDays: [],
  ...over,
});

const facts = (over: Partial<FactsArgs> = {}): FactsArgs => ({
  recipes: [pasta, frittata, zuppa],
  settings: settings(),
  today: TODAY,
  now: NOW,
  timeZone: "Europe/Rome",
  lots,
  declared: { allergens: [], excludedFoods: [] },
  linkOf: makeLinkOf([]),
  overrides: {},
  plan,
  weekDates: DATES,
  ...over,
});

describe("fatti delle ricette", () => {
  it("scadenze: solo da oggi a una settimana, mai i già scaduti", () => {
    const foods = expiringFoods(lots, NOW, "Europe/Rome");
    expect(foods.map((f) => f.name)).toEqual(["Zucchine"]);
    expect(foods[0]?.daysLeft).toBe(2);
  });

  it("ingredienti in casa, scadenza, tempo, momento ed ingrediente principale", () => {
    const [p, f, z] = buildProposalRecipes(facts());
    expect(p?.ingredients.filter((i) => i.inHome).map((i) => i.name)).toEqual(["Spaghetti", "Pomodori"]);
    expect(p?.ingredients).toHaveLength(3);
    expect(p?.minutes).toBe(25);
    expect(p?.meals).toEqual(["dinner"]);
    expect(p?.mainKey).toBeTruthy();
    expect(f?.expiring).toEqual([expect.objectContaining({ name: "Zucchine", expiresOn: "2026-11-18" })]);
    expect(f?.expiring?.[0]?.weight).toBeGreaterThan(0);
    expect(z?.expiring).toEqual([]);
    expect(z?.minutes).toBeUndefined();
  });

  it("le porzioni proposte cambiano ciò che si ha in casa", () => {
    const few = buildProposalRecipes(facts({ settings: settings({ servings: 1 }) }))[0];
    const lots6 = buildProposalRecipes(facts({ settings: settings({ servings: 6 }) }))[0];
    expect(few?.ingredients.filter((i) => i.inHome)).toHaveLength(2);
    expect(lots6?.ingredients.filter((i) => i.inHome).length).toBeLessThanOrEqual(2);
  });

  it("allergeni dichiarati: l'esito è quello del ricettario", () => {
    const [p, f] = buildProposalRecipes(facts({ declared: { allergens: ["uova"], excludedFoods: [] } }));
    expect(f?.safety).toBe("contains");
    expect(p?.safety).not.toBe("contains");
    const none = buildProposalRecipes(facts());
    expect(none.every((r) => r.safety === "clear")).toBe(true);
  });

  it("alimento escluso", () => {
    const [, f] = buildProposalRecipes(facts({ declared: { allergens: [], excludedFoods: ["zucchine"] } }));
    expect(f?.safety).toBe("contains");
  });

  it("etichette di momento", () => {
    expect(mealsOfTags(["Pranzo", "cena", "dolce"])).toEqual(["lunch", "dinner"]);
    expect(mealsOfTags(["primo"])).toEqual([]);
  });
});

describe("dall'ingresso alla proposta", () => {
  const slots = DATES.flatMap((date) => (["lunch", "dinner"] as const).map((meal) => ({ date, meal })));

  it("solo giorni e momenti scelti, e mai l'allergene dichiarato", () => {
    const input = buildProposalInput({
      ...facts({ declared: { allergens: ["uova"], excludedFoods: [] }, settings: settings({ days: DATES.slice(0, 3), moments: ["dinner"] }) }),
      slots,
      entries: [],
    });
    expect(input.slots).toHaveLength(3);
    const p = proposeWeek(input);
    expect(p.meals.some((m) => m.recipeId === "fritt")).toBe(false);
    expect(p.meals.every((m) => m.slot.meal === "dinner" && DATES.slice(0, 3).includes(m.slot.date))).toBe(true);
  });

  it("i giorni con poco tempo escludono le ricette lunghe", () => {
    const input = buildProposalInput({ ...facts({ settings: settings({ lowTimeDays: DATES }) }), slots, entries: [] });
    const p = proposeWeek(input);
    expect(p.meals.some((m) => m.recipeId === "fritt")).toBe(false);
  });

  it("senza obiettivi non calcola i nutrienti; con «spendi il meno possibile» e senza prezzi non c'è costo", () => {
    const input = buildProposalInput({ ...facts({ settings: settings({ spendLeast: true }) }), slots, entries: [] });
    expect(input.recipes.every((r) => r.nutrients === undefined && r.cost === undefined)).toBe(true);
    expect(input.existingNutrients).toBeUndefined();
  });

  it("le voci dell'utente restano e i loro posti non si propongono", () => {
    const mine: PlannedEntry[] = [{ date: TODAY, meal: "lunch", item: { kind: "food", name: "Riso", quantity: { value: 80, unit: "g" } } }];
    const input = buildProposalInput({ ...facts(), slots, entries: mine });
    const p = proposeWeek(input);
    expect(p.meals.some((m) => m.slot.date === TODAY && m.slot.meal === "lunch")).toBe(false);
    expect(p.summary.requested).toBe(13);
  });
});

describe("impostazioni di partenza", () => {
  it("momenti: pranzo e cena, anche se la struttura ha colazione e spuntino", () => {
    expect(defaultMoments(undefined)).toEqual(["lunch", "dinner"]);
    expect(defaultMoments(["breakfast", "lunch", "dinner", "snack"])).toEqual(["lunch", "dinner"]);
    expect(defaultMoments(["breakfast", "snack"])).toEqual(["breakfast", "snack"]);
    expect(defaultMoments(["dinner"])).toEqual(["dinner"]);
  });

  it("giorni: da oggi a domenica; poco tempo dai tipi di giornata che lo dicono", () => {
    const p = derivePlan([structureEv("s", "2026-11-10T08:00:00.000Z", { defaultDayType: "poco tempo" })]);
    const s = defaultSettings({ plan: p, weekDates: DATES, today: "2026-11-18" });
    expect(s.days).toEqual(DATES.slice(2));
    expect(s.lowTimeDays).toEqual(DATES.slice(2));
    expect(defaultSettings({ plan, weekDates: DATES, today: TODAY }).lowTimeDays).toEqual([]);
  });
});

describe("dispensa giorno per giorno", () => {
  const latte = recipeOf("latte", { title: "Budino", servings: 2, ingredients: [{ name: "Latte", quantity: { value: 300, unit: "ml" } }], steps: [{ text: "Cuoci." }] });
  const riso = recipeOf("riso", { title: "Riso in bianco", servings: 2, ingredients: [{ name: "Riso", quantity: { value: 100, unit: "g" } }], steps: [{ text: "Bolli." }] });
  const pere = recipeOf("pere", { title: "Pere cotte", servings: 2, ingredients: [{ name: "Pere", quantity: { value: 300, unit: "g" } }], steps: [{ text: "Cuoci." }] });

  const useBy = (id: string, name: string, value: number, date: string, unit: "g" | "ml" = "g") =>
    derivePantry([purchase(`p-${id}`, "2026-11-12T08:00:00.000Z", { lotId: id, productRef: name, quantity: q(value, unit), location: "frigo", expiry: { date, kind: "use_by" } })]).lots;

  it("un lotto con la data di sicurezza passata non è in casa", () => {
    const [b] = buildProposalRecipes(facts({ recipes: [latte], lots: useBy("la", "Latte", 500, "2026-11-10", "ml") }));
    expect(b?.ingredients[0]?.inHome).toBe(false);
    const meal = proposeWeek(buildProposalInput({ ...facts({ recipes: [latte], lots: useBy("la", "Latte", 500, "2026-11-10", "ml") }), slots: [{ date: TODAY, meal: "dinner" }], entries: [] })).meals[0] as ProposedMeal;
    expect(reasonLine(meal, TODAY)).not.toMatch(/Hai già/);
  });

  it("un lotto che scade in settimana è in casa solo fino a quel giorno", () => {
    const stock = useBy("pe", "Pere", 500, "2026-11-18");
    const [r] = buildProposalRecipes(facts({ recipes: [pere], lots: stock }));
    const ing = r?.ingredients[0];
    expect(ing?.inHome).toBe(true);
    expect(ing?.homeUntil).toBe("2026-11-18");
    const input = buildProposalInput({ ...facts({ recipes: [pere], lots: stock, settings: settings({ days: [DATES[1] as string, DATES[4] as string], moments: ["dinner"], maxRepeats: 3 }) }), slots: [{ date: DATES[1] as string, meal: "dinner" }, { date: DATES[4] as string, meal: "dinner" }], entries: [] });
    const p = proposeWeek(input);
    const byDate = new Map(p.meals.map((m) => [m.slot.date, m.reasons.find((x) => x.code === "pantry")]));
    expect(byDate.get(DATES[1] as string)).toMatchObject({ inHome: 1, total: 1 });
    expect(byDate.get(DATES[4] as string)).toBeUndefined();
  });

  it("oltre la data di qualità c'è ancora, ma lo dice e non dice «tutto»", () => {
    const stock = lotsOf([{ id: "ri", name: "Riso", value: 500, expiry: "2026-11-18" }]).lots;
    const [r] = buildProposalRecipes(facts({ recipes: [riso], lots: stock }));
    expect(r?.ingredients[0]).toMatchObject({ inHome: true, freshUntil: "2026-11-18" });
    expect(r?.ingredients[0]?.homeUntil).toBeUndefined();
    const input = buildProposalInput({ ...facts({ recipes: [riso], lots: stock }), slots: [{ date: DATES[4] as string, meal: "dinner" }], entries: [] });
    const meal = proposeWeek(input).meals[0] as ProposedMeal;
    expect(meal.reasons[0]).toEqual({ code: "pantry", inHome: 1, total: 1, stale: 1 });
    expect(reasonLine(meal, TODAY)).toBe("Hai già 1 ingrediente su 1, 1 oltre la data consigliata.");
  });

  it("le viste della dispensa cambiano solo quando cambia l'insieme dei lotti buoni", () => {
    expect(stockViews(lots, NOW, "Europe/Rome", DATES)).toHaveLength(2);
    expect(stockViews([], NOW, "Europe/Rome", DATES)).toHaveLength(1);
  });
});

describe("testi", () => {
  it("dice cosa usa e quando scade, in una riga", () => {
    const meal: ProposedMeal = {
      slot: { date: "2026-11-17", meal: "dinner" },
      recipeId: "x",
      title: "X",
      servings: 1,
      reasons: [{ code: "expiring", uses: [{ name: "Spinaci", expiresOn: "2026-11-19" }] }, { code: "pantry", inHome: 4, total: 6, stale: 0 }],
    };
    expect(reasonLine(meal, TODAY)).toBe("Usa spinaci in scadenza giovedì. Hai già 4 ingredienti su 6.");
    expect(reasonLine({ reasons: [{ code: "expiring", uses: [{ name: "Latte", expiresOn: TODAY }] }] }, TODAY)).toBe("Usa latte in scadenza oggi.");
    expect(reasonLine({ reasons: [{ code: "pantry", inHome: 3, total: 3, stale: 0 }] }, TODAY)).toBe("Hai già tutto.");
    expect(reasonLine({ reasons: [{ code: "cost", cents: 240 }] }, TODAY)).toMatch(/^Costa circa 2,40/);
  });

  it("riepilogo: poche ricette, escluse e costi non calcolabili", () => {
    const summary = {
      requested: 14,
      filled: 4,
      candidates: 3,
      excluded: { contains: 2, uncertain: 1 },
      fewRecipes: true,
      expiring: { usable: 2, used: 1 },
      cost: { cents: 800, knownMeals: 3, unknownMeals: 1, recipesWithoutCost: 2, recipes: 3 },
    };
    const notes = summaryNotes(summary, 10);
    expect(notes.join("\n")).toMatch(/poche ricette utilizzabili \(3\)/);
    expect(notes.join("\n")).toMatch(/2 ricette non entrano/);
    expect(notes.join("\n")).toMatch(/1 ricetta non si può controllare del tutto/);
    expect(notes.join("\n")).toMatch(/Costo stimato: almeno 8,00/);
    expect(notes.join("\n")).toMatch(/2 ricette su 3 non hanno un costo calcolabile/);
    expect(headlineText(summary)).toBe("Riempio 4 posti su 14 con le tue ricette.");
    expect(headlineText({ filled: 0, requested: 0 })).toMatch(/Non ci sono posti vuoti/);
  });
});

describe("scrittura: ultimo controllo", () => {
  const expandForChecks = makeExpandForChecks({ recipes: [pasta, frittata, zuppa], preps: [] });
  const meal = (recipeId: string, date: string, meal: "lunch" | "dinner" = "dinner"): ProposedMeal => ({
    slot: { date, meal },
    recipeId,
    title: recipeId,
    servings: 2,
    reasons: [{ code: "variety" }],
  });
  const base = { weekStart: TODAY, expandForChecks, linkOf: makeLinkOf([]), allowUncertain: false, activeRecipeIds: new Set(["pasta", "fritt", "zuppa", "dubbia"]) };

  it("scrive le voci dell'utente come sono più le proposte, in un'unica settimana", () => {
    const mine: PlannedEntry[] = [{ date: TODAY, meal: "lunch", item: { kind: "food", name: "Riso", quantity: { value: 80, unit: "g" } } }];
    const r = finalizeProposal({ ...base, entries: mine, meals: [meal("pasta", DATES[1] as string), meal("zuppa", DATES[2] as string)], declared: { allergens: [], excludedFoods: [] } });
    expect(r.added).toBe(2);
    expect(r.dropped).toBe(0);
    expect(r.entries.slice(0, 1)).toEqual(mine);
    expect(r.entries).toHaveLength(3);
    expect(r.entries[1]).toEqual({ date: DATES[1], meal: "dinner", item: { kind: "recipe", recipeId: "pasta", servings: 2 } });
  });

  it("un posto occupato nel frattempo non si tocca", () => {
    const mine: PlannedEntry[] = [{ date: DATES[1] as string, meal: "dinner", item: { kind: "food", name: "Riso", quantity: { value: 80, unit: "g" } } }];
    const r = finalizeProposal({ ...base, entries: mine, meals: [meal("pasta", DATES[1] as string)], declared: { allergens: [], excludedFoods: [] } });
    expect(r.entries).toEqual(mine);
    expect(r.added).toBe(0);
    expect(r.dropped).toBe(1);
  });

  it("un allergene dichiarato ferma la proposta anche se è arrivata fin qui", () => {
    const r = finalizeProposal({ ...base, entries: [], meals: [meal("fritt", DATES[1] as string), meal("zuppa", DATES[2] as string)], declared: { allergens: ["uova"], excludedFoods: [] } });
    expect(r.entries.map((e) => (e.item.kind === "recipe" ? e.item.recipeId : ""))).toEqual(["zuppa"]);
    expect(r.dropped).toBe(1);
  });

  it("un alimento escluso ferma la proposta", () => {
    const r = finalizeProposal({ ...base, entries: [], meals: [meal("fritt", DATES[1] as string)], declared: { allergens: [], excludedFoods: ["zucchine"] } });
    expect(r.added).toBe(0);
  });

  it("una ricetta ritirata dopo la proposta non si scrive", () => {
    const r = finalizeProposal({ ...base, activeRecipeIds: new Set(["zuppa"]), entries: [], meals: [meal("pasta", DATES[1] as string), meal("zuppa", DATES[2] as string)], declared: { allergens: [], excludedFoods: [] } });
    expect(r.entries.map((e) => (e.item.kind === "recipe" ? e.item.recipeId : ""))).toEqual(["zuppa"]);
    expect(r.dropped).toBe(1);
  });

  it("una ricetta che non si riesce a leggere non entra, nemmeno con le incerte permesse", () => {
    const r = finalizeProposal({ ...base, allowUncertain: true, activeRecipeIds: new Set(["fantasma"]), expandForChecks: () => undefined, entries: [], meals: [meal("fantasma", DATES[1] as string)], declared: { allergens: ["uova"], excludedFoods: [] } });
    expect(r.added).toBe(0);
  });

  it("un dubbio ferma la proposta, a meno che l'utente abbia permesso le ricette incerte", () => {
    const dubbia = recipeOf("dubbia", { title: "Dubbia", servings: 2, ingredients: [{ name: "Dado", quantity: { value: 1, unit: "pz" } }], steps: [{ text: "Cuoci." }] });
    const ctx = { ...base, expandForChecks: makeExpandForChecks({ recipes: [dubbia], preps: [] }), entries: [], meals: [meal("dubbia", DATES[1] as string)], declared: { allergens: ["glutine"], excludedFoods: [] } };
    expect(finalizeProposal(ctx).added).toBe(0);
    expect(finalizeProposal({ ...ctx, allowUncertain: true }).added).toBe(1);
  });
});
