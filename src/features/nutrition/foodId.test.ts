import { describe, expect, it } from "vitest";
import { appendItems, deriveDiary, removeItem } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { computeIntake } from "@/core/nutrition";
import { fakeFood } from "@/core/nutrition/test-helpers";
import { buildMealEvents, buildMealFromHabit } from "../meals";
import { createFoodSearch, resolveFreeItems } from "./candidates";
import { correctMealItems } from "./corrections";
import { unresolvedGroups } from "./prepare";
import { buildResolver } from "./resolver";

const at = (date: string, hour = 9) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const ctx = (date = "2026-11-10", hour = 12) => ({ now: at(date, hour), deviceId: "d" });

const dried = fakeFood("pasta-secca", "Pasta di semola, secca", { energyKcal: 350, proteinG: 12 }, { state: "dried", variantOf: "pasta-semola", aliases: ["pasta", "pasta secca"] });
const cooked = fakeFood("pasta-cotta", "Pasta di semola, cotta", { energyKcal: 150, proteinG: 5 }, { state: "cooked", variantOf: "pasta-semola", aliases: ["pasta", "pasta cotta"] });
const mela = fakeFood("mela", "Mela", { energyKcal: 50 });
const foods = [dried, cooked, mela];
const search = createFoodSearch(foods);
const resolver = () => buildResolver({ foods, products: new Map(), barcodes: new Map(), overrides: {} });

function save(rows: Parameters<typeof resolveFreeItems>[0]): AnyEvent[] {
  const resolved = resolveFreeItems(rows, search);
  expect(resolved.errors).toEqual({});
  const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: resolved.items }, ctx());
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

describe("candidati della tabella per una voce libera", () => {
  it("le voci dello stesso alimento in stati diversi sono affiancate, senza predefinito", () => {
    const groups = search.groups("pasta");
    expect(groups[0].twins).toBe(true);
    expect(groups[0].options.map((o) => o.state).sort()).toEqual(["cooked", "dried"]);
    expect(groups[0].options.map((o) => o.name)).toEqual(expect.arrayContaining(["Pasta di semola, secca", "Pasta di semola, cotta"]));
    expect(search.groups("mela")[0].twins).toBe(false);
  });

  it("testi troppo corti o senza corrispondenze non danno candidati", () => {
    expect(search.groups("")).toEqual([]);
    expect(search.groups("p")).toEqual([]);
    expect(search.groups("zzzzzz")).toEqual([]);
  });

  it("con gemelli la voce non si aggiunge finché non si sceglie; «Nessuno di questi» la lascia passare", () => {
    const unchosen = resolveFreeItems([{ name: "pasta", quantityText: "80 g" }], search);
    expect(unchosen.errors[0]).toMatch(/Nessuno di questi/);
    expect(resolveFreeItems([{ name: "pasta", quantityText: "80 g", none: true }], search).errors).toEqual({});
    expect(resolveFreeItems([{ name: "pasta", quantityText: "80 g", foodId: "pasta-secca" }], search).errors).toEqual({});
    // un alimento senza gemelli non obbliga a scegliere
    expect(resolveFreeItems([{ name: "mela", quantityText: "1 pz" }], search).errors).toEqual({});
    expect(resolveFreeItems([{ name: "  ", quantityText: "" }], search).errors).toEqual({});
  });
});

describe("percorso: scrivo «pasta», scelgo la voce secca", () => {
  it("il pasto salvato ha il foodId giusto e il nome invariato, e il calcolo usa quell'alimento", () => {
    const secca = search.groups("pasta")[0].options.find((o) => o.state === "dried");
    expect(secca?.id).toBe("pasta-secca");

    const events = save([{ name: "pasta", quantityText: "80 g", foodId: secca?.id }]);
    const meal = events[0];
    expect(meal.type).toBe("meal");
    if (meal.type !== "meal") return;
    expect(meal.items?.[0]).toMatchObject({ name: "pasta", foodId: "pasta-secca" });
    expect(meal.items?.[0].name).toBe("pasta");

    const day = computeIntake(events, resolver()).days[0];
    expect(day.totals.energyKcal?.value).toBe(280);
    const line = day.meals[0].lines[0];
    expect(line.status).toBe("ok");
    if (line.status === "ok") expect(line.composition).toMatchObject({ ref: "pasta-secca", selection: "explicit" });
  });

  it("senza foodId il nome resta quello scritto e basta il nome: nessuna parola di stato inventata", () => {
    const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "penne", quantityText: "80 g" }] }, ctx());
    if (!r.ok) throw new Error("pasto");
    expect(r.events[0].type === "meal" && r.events[0].items?.[0]).not.toHaveProperty("foodId");
    expect(r.events[0].type === "meal" && r.events[0].items?.[0].name).toBe("penne");
  });

  it("una scelta esplicita funziona anche dove il nome da solo non verrebbe riconosciuto", () => {
    const events = save([{ name: "penne rigate", quantityText: "80 g", foodId: "pasta-secca" }]);
    expect(computeIntake(events, resolver()).days[0].totals.energyKcal?.value).toBe(280);
  });

  it("un alimento che non esiste più nella tabella lascia la voce non risolta, con il suo motivo", () => {
    const events = save([{ name: "pasta", quantityText: "80 g", foodId: "alimento-sparito" }]);
    const lines = computeIntake(events, resolver()).days[0].meals[0].lines;
    expect(lines[0]).toMatchObject({ status: "unresolved", reason: "unknown_food_id" });
  });

  it("il pasto abituale conserva il foodId delle voci", () => {
    const resolved = resolveFreeItems([{ name: "pasta", quantityText: "80 g", foodId: "pasta-secca" }], search);
    const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: resolved.items, saveHabitAs: "Solito pranzo" }, ctx());
    if (!r.ok) throw new Error("pasto");
    const habit = deriveDiary(r.events).habits[0];
    expect(habit.items[0]).toMatchObject({ name: "pasta", foodId: "pasta-secca" });
    const again = buildMealFromHabit(habit, [], ctx("2026-11-11"));
    const meal = again.events[0];
    expect(meal.type === "meal" && meal.items?.[0]).toMatchObject({ name: "pasta", foodId: "pasta-secca" });
  });
});

describe("correggere l'alimento di una voce già registrata", () => {
  it("sostituisce il pasto con il foodId aggiornato; il vecchio resta annullato, il nome non cambia", () => {
    const events = save([{ name: "Cibo misterioso", quantityText: "80 g", none: true }]);
    const intake = computeIntake(events, resolver());
    const group = unresolvedGroups(intake.days)[0];
    expect(group).toMatchObject({ label: "Cibo misterioso", reason: "no_composition" });
    expect(group.mealRefs).toHaveLength(1);

    const corrected = correctMealItems(events, group.mealRefs, "pasta-cotta", { now: at("2026-11-10", 15), deviceId: "d" });
    if (!corrected.ok) throw new Error(corrected.error);
    expect(corrected.meals).toBe(1);
    expect(corrected.events.map((e) => e.type)).toEqual(["void", "meal"]);
    const replacement = corrected.events[1];
    expect(replacement.type === "meal" && replacement.replaces).toBe(events[0].id);

    const after = [...events, ...corrected.events];
    const diary = deriveDiary(after);
    expect(diary.days[0].meals).toHaveLength(1);
    expect(diary.days[0].meals[0].items[0]).toMatchObject({ name: "Cibo misterioso", foodId: "pasta-cotta" });
    const fixed = computeIntake(after, resolver()).days[0];
    expect(fixed.totals.energyKcal?.value).toBe(120);
    expect(fixed.unresolved).toEqual([]);

    // «Annulla» sull'avviso annulla la correzione e riporta il pasto com'era
    const undo = corrected.events.map((e) => ({ ...e, id: `u-${e.id}`, type: "void", targetEventId: e.id, at: at("2026-11-10", 16), recordedAt: at("2026-11-10", 16) }) as unknown as AnyEvent);
    expect(deriveDiary([...after, ...undo]).days[0].meals[0].items[0].foodId).toBeUndefined();
  });

  it("più voci dello stesso pasto si correggono con una sola sostituzione", () => {
    const events = save([
      { name: "Primo", quantityText: "50 g", none: true },
      { name: "Secondo", quantityText: "50 g", none: true },
    ]);
    const refs = [0, 1].map((itemIndex) => ({ eventId: events[0].id, itemIndex }));
    const corrected = correctMealItems(events, refs, "mela", { now: at("2026-11-10", 15), deviceId: "d" });
    if (!corrected.ok) throw new Error(corrected.error);
    expect(corrected.meals).toBe(1);
    expect(corrected.events).toHaveLength(2);
    const items = deriveDiary([...events, ...corrected.events]).days[0].meals[0].items;
    expect(items.map((i) => i.foodId)).toEqual(["mela", "mela"]);
  });

  it("un pasto corretto su due telefoni: la voce è quella mostrata, e dopo ne resta una versione sola", () => {
    const base = save([
      { name: "Primo", quantityText: "50 g", none: true },
      { name: "Secondo", quantityText: "50 g", none: true },
    ]);
    const first = base[0];
    if (first.type !== "meal") throw new Error("pasto");
    const mealId = first.mealId;
    // un telefono toglie «Primo»; l'altro, senza saperlo, aggiunge «Terzo» un'ora dopo
    const removed = removeItem(mealId, 0, base, { now: at("2026-11-10", 13), deviceId: "a" });
    const added = appendItems(mealId, [{ name: "Terzo", quantity: { value: 50, unit: "g" }, certainty: "estimated" }], base, { now: at("2026-11-10", 14), deviceId: "b" });
    if (!removed.ok || !added.ok) throw new Error("correzioni");
    const events: AnyEvent[] = [...base, ...removed.events, ...added.events];

    // le due versioni si uniscono: ciò che si mostra non è l'evento più recente così com'è
    const shown = deriveDiary(events).days[0].meals[0];
    expect(shown.items.map((i) => i.name)).toEqual(["Secondo", "Terzo"]);
    const winner = events.find((e) => e.id === shown.eventId);
    expect(winner?.type === "meal" && winner.items?.map((i) => i.name)).toEqual(["Primo", "Secondo", "Terzo"]);

    const corrected = correctMealItems(events, [{ eventId: shown.eventId, itemIndex: 1 }], "mela", { now: at("2026-11-10", 15), deviceId: "d" });
    if (!corrected.ok) throw new Error(corrected.error);
    // tutte e due le versioni in vigore sono annullate, e ne nasce una
    expect(corrected.events.map((e) => e.type)).toEqual(["void", "void", "meal"]);

    const after = deriveDiary([...events, ...corrected.events]);
    expect(after.anomalies.filter((a) => a.code === "duplicate_meal")).toEqual([]);
    expect(after.days[0].meals).toHaveLength(1);
    const items = after.days[0].meals[0].items;
    expect(items.map((i) => i.name)).toEqual(["Secondo", "Terzo"]);
    expect(items.map((i) => i.foodId)).toEqual([undefined, "mela"]);

    // «Annulla» riporta le due versioni di prima, unite allo stesso modo
    const undo = corrected.events.map((e) => ({ ...e, id: `u-${e.id}`, type: "void", targetEventId: e.id, at: at("2026-11-10", 16), recordedAt: at("2026-11-10", 16) }) as unknown as AnyEvent);
    const back = deriveDiary([...events, ...corrected.events, ...undo]).days[0].meals[0];
    expect(back.items.map((i) => [i.name, i.foodId])).toEqual([["Secondo", undefined], ["Terzo", undefined]]);
  });

  it("una voce indicata su una versione che non è più quella mostrata non si corregge", () => {
    const base = save([{ name: "Primo", quantityText: "50 g", none: true }]);
    const first = base[0];
    if (first.type !== "meal") throw new Error("pasto");
    const added = appendItems(first.mealId, [{ name: "Terzo", quantity: { value: 50, unit: "g" }, certainty: "estimated" }], base, { now: at("2026-11-10", 14), deviceId: "b" });
    if (!added.ok) throw new Error("correzione");
    expect(correctMealItems([...base, ...added.events], [{ eventId: first.id, itemIndex: 0 }], "mela", ctx()).ok).toBe(false);
  });

  it("un pasto che non c'è più, o nessuna voce, è un errore e non scrive niente", () => {
    expect(correctMealItems([], [{ eventId: "boh", itemIndex: 0 }], "mela", ctx()).ok).toBe(false);
    expect(correctMealItems([], [], "mela", ctx()).ok).toBe(false);
  });

  it("per «manca la voce cotta» l'azione «pesata a crudo» è una scelta esplicita della voce secca", () => {
    const onlyDried = [dried];
    const onlyResolver = buildResolver({ foods: onlyDried, products: new Map(), barcodes: new Map(), overrides: {} });
    const events = (() => {
      const r = buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Pasta", quantityText: "80 g" }] }, ctx());
      if (!r.ok) throw new Error("pasto");
      return r.events;
    })();
    const group = unresolvedGroups(computeIntake(events, onlyResolver).days)[0];
    expect(group.reason).toBe("missing_cooked_entry");
    const option = createFoodSearch(onlyDried).uncookedFor("Pasta");
    expect(option?.id).toBe("pasta-secca");
    const corrected = correctMealItems(events, group.mealRefs, option?.id ?? "", { now: at("2026-11-10", 15), deviceId: "d" });
    if (!corrected.ok) throw new Error(corrected.error);
    expect(computeIntake([...events, ...corrected.events], onlyResolver).days[0].totals.energyKcal?.value).toBe(280);
  });
});
