// Scelta esplicita dell'alimento (foodId) e ricerca per l'interfaccia. Dati FINTI.
import { describe, expect, it } from "vitest";
import { consume, meal, purchase } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { createFoodMatcher, searchFoods } from "./match";
import { createResolver, type CompositionResolver, type IntakeSubject } from "./resolve";
import { FAKE_STATE_FOODS } from "./test-helpers";

const matcher = createFoodMatcher(FAKE_STATE_FOODS);
const ids = (xs: readonly { food: { id: string } }[]) => xs.map((x) => x.food.id);

describe("searchFoods: candidati per l'interfaccia", () => {
  it("restituisce i candidati ordinati, con punteggio, stato e gruppo, anche se ambigui", () => {
    const out = matcher.search("pasta");
    expect(ids(out).sort()).toEqual(["pasta-cotta-s", "pasta-secca-s"]);
    expect(out[0]).toMatchObject({ confidence: 1, variantOf: "pasta-s", viaGroup: false });
    expect(out.map((c) => c.state).sort()).toEqual(["cooked", "dried"]);
    expect(matcher.find("pasta").status).toBe("ambiguous");
  });

  it("alimenti diversi con lo stesso alias compaiono tutti, ciascuno col suo gruppo", () => {
    const out = matcher.search("tonno");
    expect(ids(out).sort()).toEqual(["tonno-fresco-s", "tonno-scatola-s"]);
    expect(new Set(out.map((c) => c.variantOf)).size).toBe(2);
    expect(ids(matcher.search("pomodori")).sort()).toEqual(["pomodoro-crudo-s", "pomodoro-pelato-s"]);
  });

  it("include tutte le voci di un gruppo, anche se una sola corrisponde al testo", () => {
    const out = matcher.search("pasta secca");
    expect(ids(out)).toEqual(["pasta-secca-s", "pasta-cotta-s"]);
    expect(out[0].viaGroup).toBe(false);
    expect(out[1]).toMatchObject({ viaGroup: true, state: "cooked", variantOf: "pasta-s" });
    expect(out[1].confidence).toBeLessThan(out[0].confidence);
  });

  it("le voci dello stesso gruppo stanno vicine, e il gruppo si ordina per la voce migliore", () => {
    const foods = [
      ...FAKE_STATE_FOODS.filter((f) => f.variantOf === "riso-s"),
      ...FAKE_STATE_FOODS.filter((f) => f.variantOf === "pasta-s"),
    ];
    const out = createFoodMatcher(foods).search("pasta secca");
    expect(out.map((c) => c.variantOf)).toEqual(["pasta-s", "pasta-s"]);
    const mixed = createFoodMatcher(FAKE_STATE_FOODS).search("pasta riso", { minConfidence: 0.3 });
    const groups = mixed.map((c) => c.variantOf);
    const firstPasta = groups.indexOf("pasta-s");
    const lastPasta = groups.lastIndexOf("pasta-s");
    expect(groups.slice(firstPasta, lastPasta + 1).every((g) => g === "pasta-s")).toBe(true);
  });

  it("una voce senza gruppo non trascina altre voci", () => {
    const out = matcher.search("pane");
    expect(ids(out)).toEqual(["pane-s"]);
    expect(out[0].variantOf).toBeUndefined();
    expect(out[0].state).toBe("as_sold");
  });

  it("rispetta soglia e limite, e non spezza i gruppi", () => {
    expect(matcher.search("zzzz")).toEqual([]);
    expect(matcher.search("")).toEqual([]);
    expect(matcher.search("200 g")).toEqual([]);
    expect(matcher.search("pasta", { limit: 1 })).toHaveLength(2);
    expect(matcher.search("tonno", { limit: 1 })).toHaveLength(1);
    const wide = matcher.search("pasta secca", { minConfidence: 0.1 });
    expect(wide.length).toBeGreaterThanOrEqual(2);
    expect(matcher.search("riso cotto", { minConfidence: 0.99 })[0].food.id).toBe("riso-cotto-s");
  });

  it("la funzione libera dà lo stesso risultato", () => {
    expect(ids(searchFoods("pasta", FAKE_STATE_FOODS))).toEqual(ids(matcher.search("pasta")));
  });
});

describe("createResolver: foodId", () => {
  const resolve = createResolver({ foods: FAKE_STATE_FOODS });
  const item = (extra: Partial<Extract<IntakeSubject, { kind: "mealItem" }>>): IntakeSubject => ({
    kind: "mealItem",
    name: "penne cotta",
    mealId: "m",
    preferStates: ["cooked"],
    ...extra,
  });

  it("usa l'alimento scelto, senza passare dal nome né dalla preferenza di stato", () => {
    const r = resolve(item({ foodId: "pasta-secca-s" }));
    expect(r).toMatchObject({
      ref: "pasta-secca-s",
      state: "dried",
      selection: "explicit",
      origin: "table",
    });
    expect(r && "statePreference" in r).toBe(false);
  });

  it("l'identificativo vale anche quando il nome non verrebbe riconosciuto", () => {
    expect(resolve(item({ name: "penne cotta" }))).toBeUndefined();
    expect(resolve(item({ name: "penne cotta", foodId: "pasta-cotta-s" }))).toMatchObject({
      ref: "pasta-cotta-s",
      selection: "explicit",
    });
  });

  it("un identificativo che non esiste più non ricade sul nome: non risolto con motivo dedicato", () => {
    const r = resolve(item({ name: "pasta", foodId: "non-esiste" }));
    expect(r).toMatchObject({ failure: "unknown_food_id" });
    expect(r && "message" in r && r.message).toContain("non-esiste");
  });

  it("senza foodId vale la ricerca per nome, e lo dice", () => {
    expect(resolve(item({ name: "pasta" }))).toMatchObject({ ref: "pasta-cotta-s", selection: "name" });
  });
});

describe("computeIntake: foodId", () => {
  const AT = "2026-03-10T08:00:00.000Z";
  const resolver = createResolver({ foods: FAKE_STATE_FOODS });
  const mealWith = (item: { name: string; foodId?: string }) =>
    meal("m1", AT, {
      mealId: "m1",
      kind: "lunch",
      items: [{ ...item, quantity: { value: 200, unit: "g" }, certainty: "measured" }],
    });
  const lineOf = (item: { name: string; foodId?: string }) =>
    computeIntake([mealWith(item)], resolver).days[0].meals[0].lines[0];

  it("una voce con foodId usa quell'alimento e dichiara la scelta esplicita", () => {
    const line = lineOf({ name: "penne cotta", foodId: "pasta-secca-s" });
    expect(line.status).toBe("ok");
    if (line.status !== "ok") return;
    expect(line.composition).toMatchObject({ ref: "pasta-secca-s", selection: "explicit", state: "dried" });
    expect(line.composition.statePreference).toBeUndefined();
    expect(line.nutrients.energyKcal).toBe(700); // 200 g di secco, scelto dall'utente
  });

  it("senza foodId tutto come prima", () => {
    const line = lineOf({ name: "pasta" });
    expect(line.status === "ok" && line.composition).toMatchObject({
      ref: "pasta-cotta-s",
      selection: "name",
      statePreference: { honored: true },
    });
  });

  it("un foodId inesistente rende la voce non risolta, anche se il nome sarebbe stato riconosciuto", () => {
    const line = lineOf({ name: "pasta", foodId: "non-esiste" });
    expect(line).toMatchObject({ status: "unresolved", reason: "unknown_food_id" });
    expect(line.status === "unresolved" && line.message).toContain("non-esiste");
  });

  it("il risolutore riceve il foodId con la voce", () => {
    const seen: IntakeSubject[] = [];
    const spy: CompositionResolver = (s) => {
      seen.push(s);
      return resolver(s);
    };
    computeIntake([mealWith({ name: "x", foodId: "pane-s" })], spy);
    expect(seen[0]).toMatchObject({ kind: "mealItem", foodId: "pane-s" });
  });

  it("i consumi di dispensa non usano foodId e restano sul nome del prodotto", () => {
    const out = computeIntake(
      [
        purchase("p1", AT, { lotId: "l1", productRef: "pasta", quantity: { value: 500, unit: "g" }, location: "dispensa" }),
        consume("c1", AT, { lotId: "l1", quantity: { value: 100, unit: "g" } }),
      ],
      resolver,
    );
    const line = out.days[0].standalone[0];
    expect(line.status === "ok" && line.composition).toMatchObject({ ref: "pasta-secca-s", selection: "name" });
  });
});
