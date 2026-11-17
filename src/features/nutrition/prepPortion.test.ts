import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { computeIntake } from "@/core/nutrition";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import type { PrepRecord } from "@/core/prep";
import { buildCaptureEvents } from "../capture";
import { buildMealEvents } from "../meals";
import { markPrepPartials, prepNotes, prepPortionText, topContributors } from "./prepare";
import { PREP_REF_PREFIX } from "./prepPortion";
import { buildResolverWithInfo, overrideKeyOf } from "./resolver";

const at = (hour: number, date = "2026-11-10") => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;

type Ingredient = PrepRecord["ingredients"][number];
const ing = (lotId: string, productRef: string, grams: number): Ingredient => ({
  lotId,
  productRef,
  quantity: { value: grams, unit: "g" },
  consumeEventId: `c-${lotId}`,
});

/** Un lotto di porzioni come lo crea una preparazione: `declare` in pezzi, col titolo del piatto per nome. */
function batch(title: string, portions: number): { events: AnyEvent[]; lot: Lot } {
  const r = buildCaptureEvents(
    { name: title, quantityText: `${portions} pz`, location: "frigo", category: "leftovers_cooked", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: true },
    { now: at(8, "2026-11-09"), deviceId: "d" },
  );
  if (!r.ok) throw new Error("cattura");
  return { events: r.events, lot: derivePantry(r.events as never).lots[0] as Lot };
}

function prepOf(lot: Lot, ingredients: Ingredient[], portions = 4): PrepRecord {
  return { prepId: "p1", title: lot.productRef, batchLotId: lot.lotId, portions, ingredients } as unknown as PrepRecord;
}

const KNOWN = [ing("i1", "Pasta di semola secca", 200), ing("i2", "Petto di pollo crudo", 300)];

/** Un giorno con la porzione mangiata a pranzo e gli altri due pasti, perché il giorno sia completo. */
function eat(lot: Lot, base: AnyEvent[], portions: string): AnyEvent[] {
  const day = (kind: "breakfast" | "lunch" | "dinner", hour: number, picks: { lot: Lot; choice: { kind: "text"; text: string } }[], items: { name: string; quantityText: string }[]) => {
    const r = buildMealEvents({ kind, picks, freeItems: items }, { now: at(hour), deviceId: "d" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.events;
  };
  return [
    ...base,
    ...day("breakfast", 7, [], [{ name: "Latte intero", quantityText: "200 ml" }]),
    ...day("lunch", 12, [{ lot, choice: { kind: "text", text: portions } }], []),
    ...day("dinner", 19, [], [{ name: "Petto di pollo crudo", quantityText: "100 g" }]),
  ];
}

const resolverFor = (prep: PrepRecord | undefined, overrides: Record<string, string> = {}) =>
  buildResolverWithInfo({
    foods: FAKE_FOODS,
    products: new Map(),
    barcodes: new Map(),
    overrides,
    ...(prep ? { preps: new Map([[prep.batchLotId, prep]]) } : {}),
  });

const lunchLine = (events: AnyEvent[], r: ReturnType<typeof resolverFor>) =>
  computeIntake(events, r.resolve).days[0].meals.find((m) => m.kind === "lunch")?.lines[0];

describe("nutrienti di una porzione di preparazione", () => {
  it("senza la preparazione il lotto, che ha il titolo del piatto, non è riconosciuto", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const line = lunchLine(eat(lot, events, "1"), resolverFor(undefined));
    expect(line).toMatchObject({ status: "unresolved", reason: "no_composition" });
  });

  it("con la preparazione i nutrienti si calcolano dagli ingredienti, per porzione, come stima", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const r = resolverFor(prepOf(lot, KNOWN));
    const line = lunchLine(eat(lot, events, "1"), r);
    expect(line?.status).toBe("ok");
    if (line?.status !== "ok") return;
    // (200 g x 3,5 + 300 g x 1) kcal / 4 porzioni; proteine (200 x 0,12 + 300 x 0,2) / 4
    expect(line.nutrients.energyKcal).toBe(250);
    expect(line.nutrients.proteinG).toBe(21);
    expect(line.composition).toMatchObject({ origin: "derived", ref: `${PREP_REF_PREFIX}p1`, name: "Pasta al pollo" });
    expect(line.certainty).toBe("estimated");
    const info = r.prepInfo.get(`${PREP_REF_PREFIX}p1`);
    expect(info).toMatchObject({ unresolved: [], empty: false, ingredientCount: 2 });
    // energia e proteine ce le hanno entrambi gli ingredienti: complete. I carboidrati solo la pasta: un minimo.
    expect(info?.partial.map((x) => x.key)).not.toContain("energyKcal");
    expect(info?.partial.map((x) => x.key)).not.toContain("proteinG");
    expect(info?.partial.map((x) => x.key)).toContain("carbsG");
  });

  it("mezza porzione, due porzioni: proporzionale", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const energy = (portions: string) => {
      const line = lunchLine(eat(lot, events, portions), resolverFor(prepOf(lot, KNOWN)));
      return line?.status === "ok" ? line.nutrients.energyKcal : undefined;
    };
    expect(energy("0.5")).toBe(125);
    expect(energy("2")).toBe(500);
  });

  it("un ingrediente senza dato rende la porzione parziale, e lo dice con la quota mancante", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const prep = prepOf(lot, [...KNOWN, ing("i3", "Ingrediente ignoto", 50)]);
    const r = resolverFor(prep);
    const all = eat(lot, events, "1");
    const intake = computeIntake(all, r.resolve);
    const info = r.prepInfo.get(`${PREP_REF_PREFIX}p1`);
    expect(info?.unresolved).toEqual(["Ingrediente ignoto"]);
    const energy = info?.partial.find((p) => p.key === "energyKcal");
    // 50 g su 550 g
    expect(energy?.missingShare).toBeCloseTo(50 / 550, 5);

    // il motore vede la porzione come un alimento completo: la marcatura la rende un minimo
    expect(intake.days[0].totals.energyKcal?.partial).toBe(false);
    const marked = markPrepPartials(intake.days, r.prepInfo)[0];
    expect(marked.totals.energyKcal?.partial).toBe(true);
    expect(marked.totals.energyKcal?.missingShare).toBeGreaterThan(0);
    expect(marked.totals.energyKcal?.value).toBe(intake.days[0].totals.energyKcal?.value);

    const text = prepPortionText(info!);
    expect(text).toContain("calcolata dagli ingredienti, è una stima");
    expect(text).toContain("Non ho il dato di 1 ingrediente su 3 (Ingrediente ignoto)");
    expect(text).toMatch(/minimo/);
    expect(prepNotes(marked, r.prepInfo)).toEqual([text]);
  });

  it("una porzione i cui ingredienti hanno gli stessi dati non produce note", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const r = resolverFor(prepOf(lot, [ing("i1", "Farina 00", 100), ing("i2", "Farina 0", 100)]));
    const days = computeIntake(eat(lot, events, "1"), r.resolve).days;
    expect(prepNotes(days[0], r.prepInfo)).toEqual([]);
    expect(markPrepPartials(days, r.prepInfo)[0]).toBe(days[0]);
  });

  it("se nessun ingrediente ha un dato la porzione resta non risolta", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const r = resolverFor(prepOf(lot, [ing("i1", "Boh uno", 100), ing("i2", "Boh due", 100)]));
    expect(lunchLine(eat(lot, events, "1"), r)).toMatchObject({ status: "unresolved", reason: "no_composition" });
    expect(r.prepInfo.get(`${PREP_REF_PREFIX}p1`)).toMatchObject({ empty: true, unresolved: ["Boh uno", "Boh due"] });
  });

  it("una preparazione che usa le porzioni di sé stessa non gira in tondo", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const r = resolverFor(prepOf(lot, [...KNOWN, ing(lot.lotId, "Pasta al pollo", 1)]));
    const line = lunchLine(eat(lot, events, "1"), r);
    expect(line?.status).toBe("ok");
    expect(r.prepInfo.get(`${PREP_REF_PREFIX}p1`)?.unresolved).toEqual(["Pasta al pollo"]);
  });

  it("una preparazione fatta con le porzioni di un'altra le usa", () => {
    const first = batch("Sugo", 2);
    const second = batch("Pasta al sugo", 2);
    const sugo = { prepId: "p-sugo", title: "Sugo", batchLotId: first.lot.lotId, portions: 2, ingredients: [ing("s1", "Petto di pollo crudo", 200)] } as unknown as PrepRecord;
    const pasta = {
      prepId: "p-pasta",
      title: "Pasta al sugo",
      batchLotId: second.lot.lotId,
      portions: 2,
      ingredients: [ing("s2", "Pasta di semola secca", 100), { lotId: first.lot.lotId, productRef: "Sugo", quantity: { value: 1, unit: "pz" }, consumeEventId: "c-sugo" }],
    } as unknown as PrepRecord;
    const r = buildResolverWithInfo({
      foods: FAKE_FOODS,
      products: new Map(),
      barcodes: new Map(),
      overrides: {},
      preps: new Map([
        [sugo.batchLotId, sugo],
        [pasta.batchLotId, pasta],
      ]),
    });
    const line = lunchLine(eat(second.lot, [...first.events, ...second.events], "1"), { ...r, resolve: r.resolve });
    // sugo: 200 g di pollo = 200 kcal in 2 porzioni -> 100; pasta 100 g = 350 kcal; totale (350 + 100) / 2
    expect(line?.status === "ok" && line.nutrients.energyKcal).toBe(225);
  });

  it("nei contributi la porzione dice come è calcolata", () => {
    const { events, lot } = batch("Pasta al pollo", 4);
    const r = resolverFor(prepOf(lot, [...KNOWN, ing("i3", "Ingrediente ignoto", 50)]));
    const intake = computeIntake(eat(lot, events, "1"), r.resolve);
    const days = markPrepPartials(intake.days, r.prepInfo).map((d) => ({ ...d, complete: true }));
    const top = topContributors(days, "energyKcal", 5, r.prepInfo);
    const portion = top.find((c) => c.name === "Pasta al pollo");
    expect(portion?.stateText).toMatch(/calcolata dagli ingredienti/);
    expect(portion?.stateText).toMatch(/Ingrediente ignoto/);
  });
});

describe("il risolutore e le scelte esplicite", () => {
  it("un foodId non passa dalla scelta ricordata per nome", () => {
    const r = resolverFor(undefined, { [overrideKeyOf("pasta")]: "farina-00" });
    const explicit = r.resolve({ kind: "mealItem", name: "pasta", mealId: "m", foodId: "pasta-secca" });
    expect(explicit && "ref" in explicit && explicit.ref).toBe("pasta-secca");
    const byName = r.resolve({ kind: "mealItem", name: "pasta", mealId: "m" });
    expect(byName && "ref" in byName && byName.ref).toBe("farina-00");
  });
});
