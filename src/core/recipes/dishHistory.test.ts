import { describe, expect, it } from "vitest";
import { mergeAllEvents, validateAnyEvent, type AnyEvent } from "../events";
import { compareByFavorite, deriveDishHistory, summarizeCookings } from "./index";
import { deriveRecipes } from "./derive";
import { dishRatingEvent, recipeEvent, voidEvent } from "./test-helpers";

const T = (n: number) => `2026-03-0${n}T12:00:00.000Z`;

// i pasti stanno nel registro: senza il pasto un voto non è una cottura
const derive = (events: readonly unknown[]) => {
  const meals = new Set<string>();
  for (const e of events) if (typeof e === "object" && e && "mealId" in e && (e as { type?: string }).type === "dishRating") meals.add((e as { mealId: string }).mealId);
  return deriveDishHistory([...[...meals].map((m) => ({ id: "ml-" + m, type: "meal", mealId: m })), ...events]);
};

describe("validazione di dishRating", () => {
  it("accetta voto e «lo rifarei» facoltativi", () => {
    expect(validateAnyEvent(dishRatingEvent("a", T(1)))).toEqual([]);
    expect(validateAnyEvent(dishRatingEvent("a", T(1), { rating: "great", again: true }))).toEqual([]);
  });
  it("rifiuta voto sconosciuto, again non booleano, id mancanti", () => {
    const codes = (e: unknown) => validateAnyEvent(e).map((x) => `${x.path}:${x.code}`);
    expect(codes({ ...dishRatingEvent("a", T(1)), rating: "ok" })).toEqual(["rating:invalid_value"]);
    expect(codes({ ...dishRatingEvent("a", T(1)), rating: 3 })).toEqual(["rating:invalid_type"]);
    expect(codes({ ...dishRatingEvent("a", T(1)), again: "si" })).toEqual(["again:invalid_type"]);
    expect(codes({ ...dishRatingEvent("a", T(1)), mealId: "" })).toEqual(["mealId:invalid_type"]);
  });
});

describe("storico delle cotture", () => {
  it("nessun voto: nessuna cottura", () => {
    expect(derive([]).cookings).toEqual([]);
    expect(derive([recipeEvent("x", T(1))]).cookings).toEqual([]);
  });

  it("una cottura senza voto conta come cucinata", () => {
    const h = summarizeCookings(derive([dishRatingEvent("a", T(1))]).cookings);
    expect(h.get("r1")).toMatchObject({ times: 1, rated: 0, again: 0 });
    expect(h.get("r1")?.average).toBeUndefined();
  });

  it("un voto corretto dopo è un nuovo evento: vale l'ultimo, la prima data resta", () => {
    const events = [
      dishRatingEvent("a", T(1), { rating: "poor" }),
      dishRatingEvent("b", T(3), { rating: "great", again: true }),
    ];
    const { cookings } = derive(events);
    expect(cookings).toHaveLength(1);
    expect(cookings[0]).toMatchObject({ rating: "great", again: true, at: T(1), eventId: "b" });
    // annullare la correzione riporta il voto di prima
    const undone = derive([...events, voidEvent("v", T(4), "b")]);
    expect(undone.cookings[0]).toMatchObject({ rating: "poor", eventId: "a" });
  });

  it("una correzione senza voto lo toglie", () => {
    const { cookings } = derive([
      dishRatingEvent("a", T(1), { rating: "good" }),
      dishRatingEvent("b", T(2)),
    ]);
    expect(cookings[0]?.rating).toBeUndefined();
  });

  it("un pasto annullato non è una cottura", () => {
    const meal = { id: "ml", type: "meal", mealId: "m1" };
    const events = [meal, dishRatingEvent("a", T(1), { rating: "good" }), voidEvent("v", T(2), "ml")];
    expect(deriveDishHistory(events).cookings).toEqual([]);
    expect(deriveDishHistory([meal, dishRatingEvent("a", T(1))]).cookings).toHaveLength(1);
  });

  it("un voto senza pasto, o con tutte le righe del pasto annullate una a una, non è una cottura", () => {
    const rating = dishRatingEvent("a", T(1), { rating: "good" });
    expect(deriveDishHistory([rating]).cookings).toEqual([]);
    const rows = [
      { id: "ml1", type: "meal", mealId: "m1" },
      { id: "ml2", type: "meal", mealId: "m1" },
    ];
    const half = [...rows, rating, voidEvent("v1", T(2), "ml1")];
    expect(deriveDishHistory(half).cookings).toHaveLength(1);
    expect(deriveDishHistory([...half, voidEvent("v2", T(2), "ml2")]).cookings).toEqual([]);
  });

  it("riassunto: volte, conteggi, media, ultima", () => {
    const events = [
      dishRatingEvent("a", T(1), { mealId: "m1", rating: "good" }),
      dishRatingEvent("b", T(2), { mealId: "m2", rating: "great", again: true }),
      dishRatingEvent("c", T(3), { mealId: "m3" }),
      dishRatingEvent("d", T(3), { mealId: "m4", recipeId: "r2", rating: "poor" }),
    ];
    const h = summarizeCookings(derive(events).cookings);
    expect(h.get("r1")).toMatchObject({ times: 3, rated: 2, counts: { poor: 0, good: 1, great: 1 }, again: 1, average: 1.5 });
    expect(h.get("r1")?.last.mealId).toBe("m3");
    expect(h.get("r2")?.average).toBe(0);
  });

  it("non dipende dall'ordine né dai duplicati, e l'unione tra dispositivi converge", () => {
    const a = [dishRatingEvent("a", T(1), { rating: "poor" })] as AnyEvent[];
    const b = [dishRatingEvent("b", T(2), { rating: "great" }), dishRatingEvent("a", T(1), { rating: "poor" })] as AnyEvent[];
    const ab = mergeAllEvents(a, b);
    const ba = mergeAllEvents(b, a);
    expect(ab.conflicts).toEqual([]);
    expect(derive(ab.events)).toEqual(derive(ba.events));
    expect(derive([...ab.events].reverse())).toEqual(derive(ab.events));
    expect(derive(ab.events).cookings[0]?.rating).toBe("great");
  });

  it("le ricette ignorano gli eventi dishRating", () => {
    const state = deriveRecipes([recipeEvent("x", T(1)), dishRatingEvent("a", T(1), { rating: "good" })]);
    expect(state.recipes).toHaveLength(1);
    expect(state.anomalies).toEqual([]);
  });
});

describe("ordine delle preferite", () => {
  const h = (events: ReturnType<typeof dishRatingEvent>[], id: string) => summarizeCookings(derive(events).cookings).get(id);
  it("media, poi «lo rifarei», poi volte; senza voto in coda; deterministico", () => {
    const hs = [
      h([dishRatingEvent("a", T(1), { mealId: "a1", recipeId: "A", rating: "good" })], "A"),
      h([dishRatingEvent("b", T(1), { mealId: "b1", recipeId: "B", rating: "great" })], "B"),
      h([dishRatingEvent("c", T(1), { mealId: "c1", recipeId: "C", rating: "great", again: true })], "C"),
      h([dishRatingEvent("d", T(1), { mealId: "d1", recipeId: "D" })], "D"),
      undefined,
    ];
    const order = (xs: typeof hs) => [...xs].sort(compareByFavorite).map((x) => x?.recipeId ?? "-");
    expect(order(hs).slice(0, 3)).toEqual(["C", "B", "A"]);
    expect(order([...hs].reverse()).slice(0, 3)).toEqual(["C", "B", "A"]);
  });
});
