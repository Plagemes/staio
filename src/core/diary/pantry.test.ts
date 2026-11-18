import { describe, expect, it } from "vitest";
import { createIdGenerator, derivePantry } from "../ledger";
import { deriveDiary } from "./derive";
import { mealsWithPantry, pantryMealReport } from "./pantry";
import { validateDiaryEvent } from "./validate";
import { voidMeal } from "./voidMeal";
import {
  consume,
  meal,
  purchase,
  seededRandom,
  shuffled,
  voidOf,
  water,
} from "./test-helpers";

const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

const log = [
  purchase("p1", "2026-03-10T06:00:00Z", {
    lotId: "lot-pasta",
    productRef: "pasta",
    quantity: q(500),
    location: "dispensa",
  }),
  purchase("p2", "2026-03-10T06:00:00Z", {
    lotId: "lot-latte",
    productRef: "latte",
    quantity: q(1000, "ml"),
    location: "frigo",
  }),
  meal("m1", "2026-03-10T07:30:00Z", { mealId: "meal-1", kind: "breakfast" }),
  meal("m2", "2026-03-10T12:30:00Z", {
    mealId: "meal-2",
    kind: "lunch",
    items: [{ name: "Insalata", quantity: q(100), certainty: "estimated" }],
  }),
  meal("m3", "2026-03-11T12:30:00Z", { mealId: "meal-3", kind: "lunch" }),
  consume("c1", "2026-03-10T07:31:00Z", { lotId: "lot-latte", quantity: q(200, "ml"), mealId: "meal-1" }),
  consume("c2", "2026-03-10T12:31:00Z", { lotId: "lot-pasta", quantity: q(80), mealId: "meal-2" }),
  consume("c3", "2026-03-10T12:32:00Z", { lotId: "lot-latte", quantity: q(50, "ml"), mealId: "meal-2" }),
  consume("c4", "2026-03-10T15:00:00Z", { lotId: "lot-pasta", quantity: q(30) }), // senza pasto
  consume("c5", "2026-03-10T16:00:00Z", { lotId: "lot-pasta", quantity: q(30), mealId: "orfano" }),
  water("w1", "2026-03-10T09:00:00Z", { ml: 200 }),
];

describe("mealsWithPantry", () => {
  const diary = deriveDiary(log);

  it("unisce a ogni pasto i consume con lo stesso mealId", () => {
    const result = mealsWithPantry(diary, log);
    expect(result.map((m) => [m.mealId, m.date, m.pantryConsumes.map((c) => c.id)])).toEqual([
      ["meal-1", "2026-03-10", ["c1"]],
      ["meal-2", "2026-03-10", ["c2", "c3"]],
      ["meal-3", "2026-03-11", []],
    ]);
    expect(result[1].items).toHaveLength(1);
    expect(result[1].pantryConsumes[0]).toEqual(expect.objectContaining({ lotId: "lot-pasta", mealId: "meal-2" }));
  });

  it("non dipende dallo stato della dispensa", () => {
    // Un consume oltre la giacenza è un'anomalia della dispensa, ma resta legato al pasto.
    const over = consume("c9", "2026-03-10T12:33:00Z", { lotId: "lot-pasta", quantity: q(5000), mealId: "meal-2" });
    const events = [...log, over];
    expect(derivePantry(events as never).anomalies.map((a) => a.code)).toContain("over_consumption");
    const meals = mealsWithPantry(deriveDiary(events), events);
    expect(meals[1].pantryConsumes.map((c) => c.id)).toEqual(["c2", "c3", "c9"]);
    // E funziona senza nessun acquisto nel registro.
    const only = [log[3], log[6]];
    expect(mealsWithPantry(deriveDiary(only), only)[0].pantryConsumes.map((c) => c.id)).toEqual(["c2"]);
  });

  it("esclude i consume annullati e li ripristina se l'annullamento è annullato", () => {
    const v1 = voidOf("v1", "2026-03-10T13:00:00Z", "c3");
    const v2 = voidOf("v2", "2026-03-10T14:00:00Z", "v1");
    const ids = (events: unknown[]) =>
      mealsWithPantry(deriveDiary(events), events)[1].pantryConsumes.map((c) => c.id);
    expect(ids([...log, v1])).toEqual(["c2"]);
    expect(ids([...log, v1, v2])).toEqual(["c2", "c3"]);
  });

  it("esclude i pasti annullati con i loro consume e ignora i consume non validi", () => {
    const events = [
      ...log,
      voidOf("v1", "2026-03-10T13:00:00Z", "m1"),
      voidOf("v1c", "2026-03-10T13:00:00Z", "c1"),
      { ...consume("bad", "2026-03-10T12:34:00Z", { lotId: "lot-pasta", quantity: q(5), mealId: "meal-2" }), quantity: q(-5) },
    ];
    const result = mealsWithPantry(deriveDiary(events), events);
    expect(result.map((m) => m.mealId)).toEqual(["meal-2", "meal-3"]);
    expect(result[0].pantryConsumes.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("un pasto annullato a cui resta un consume valido compare lo stesso, con quel consume e il segno `revived`", () => {
    const events = [...log, voidOf("v1", "2026-03-10T13:00:00Z", "m1")];
    const result = mealsWithPantry(deriveDiary(events), events);
    expect(result.map((m) => [m.mealId, m.revived, m.pantryConsumes.map((c) => c.id)])).toEqual([
      ["meal-1", true, ["c1"]],
      ["meal-2", undefined, ["c2", "c3"]],
      ["meal-3", undefined, []],
    ]);
    expect(result[0]).toMatchObject({ kind: "breakfast", at: "2026-03-10T07:30:00Z", date: "2026-03-10", items: [] });
  });

  it("è indipendente dall'ordine e dai duplicati", () => {
    const expected = mealsWithPantry(diary, log);
    const random = seededRandom(7);
    for (let i = 0; i < 30; i++) {
      const shuffledLog = shuffled([...log, ...log.slice(5, 9)], random);
      expect(mealsWithPantry(deriveDiary(shuffledLog), shuffledLog)).toEqual(expected);
    }
  });

  it("senza pasti restituisce un elenco vuoto", () => {
    expect(mealsWithPantry(deriveDiary([]), log)).toEqual([]);
    expect(mealsWithPantry(diary, [])).toHaveLength(3);
  });
});

describe("consumi orfani", () => {
  const orphanIds = (events: unknown[]) =>
    pantryMealReport(deriveDiary(events), events).orphanConsumes.map((c) => c.id);

  it("riporta a parte i consume con un mealId senza pasto attivo", () => {
    const report = pantryMealReport(deriveDiary(log), log);
    expect(report.meals).toEqual(mealsWithPantry(deriveDiary(log), log));
    // c4 non ha mealId: non è orfano, è semplicemente fuori dal diario.
    expect(report.orphanConsumes.map((c) => [c.id, c.mealId])).toEqual([["c5", "orfano"]]);
  });

  it("un pasto annullato non rende orfani i suoi consume: restano nel diario, nel pasto che torna a comparire", () => {
    const v1 = voidOf("v1", "2026-03-10T13:00:00Z", "m1");
    expect(orphanIds([...log, v1])).toEqual(["c5"]);
    expect(orphanIds([...log, v1, voidOf("v2", "2026-03-10T14:00:00Z", "v1")])).toEqual(["c5"]);
  });

  it("un consume annullato non è orfano; uno non valido nemmeno", () => {
    expect(orphanIds([...log, voidOf("v1", "2026-03-10T13:00:00Z", "c5")])).toEqual([]);
    const bad = { ...log[9], quantity: q(-1) };
    expect(orphanIds([...log.slice(0, 9), bad])).toEqual([]);
  });

  it("senza diario tutti i consume con mealId sono orfani, in ordine canonico e senza duplicati", () => {
    const shuffledLog = shuffled([...log, ...log], seededRandom(3));
    expect(pantryMealReport(deriveDiary([]), shuffledLog).orphanConsumes.map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c5",
    ]);
  });
});

describe("consumi che citano un evento che non è un consumo", () => {
  const eaten = (events: unknown[]) => ({
    pantry: 500 - (derivePantry(events as never[]).lots.find((l) => l.lotId === "lot-pasta")?.remaining ?? 0),
    diary: mealsWithPantry(deriveDiary(events), events)
      .flatMap((m) => m.pantryConsumes)
      .filter((c) => c.lotId === "lot-pasta")
      .reduce((sum, c) => sum + c.quantity.value, 0),
  });
  const citing = (target: string) => [
    consume("z1", "2026-03-10T12:40:00Z", { lotId: "lot-pasta", quantity: q(10), mealId: "meal-2", replaces: target, recordedAt: "2026-03-10T12:40:00Z" }),
    consume("z2", "2026-03-10T12:41:00Z", { lotId: "lot-pasta", quantity: q(20), mealId: "meal-2", replaces: target, recordedAt: "2026-03-10T12:41:00Z" }),
  ];

  it("due consumi che citano un pasto restano due, nella dispensa come nel diario, in qualunque ordine", () => {
    const events = [...log.filter((e) => e.id !== "c4" && e.id !== "c5"), ...citing("m2")];
    const random = seededRandom(9);
    for (let i = 0; i < 20; i++) expect(eaten(shuffled(events, random))).toEqual({ pantry: 110, diary: 110 });
  });

  it("lo stesso se citano un evento del diario non valido o di un tipo sconosciuto", () => {
    const broken = { ...water("w9", "2026-03-10T09:00:00Z", { ml: 200 }), ml: -1 };
    const unknown = { ...water("u9", "2026-03-10T09:00:00Z", { ml: 200 }), type: "futuro" };
    for (const [extra, target] of [[broken, "w9"], [unknown, "u9"]] as const) {
      const events = [...log.filter((e) => e.id !== "c4" && e.id !== "c5"), extra, ...citing(target)];
      const random = seededRandom(10);
      for (let i = 0; i < 10; i++) expect(eaten(shuffled(events, random))).toEqual({ pantry: 110, diary: 110 });
    }
  });

  it("due consumi che citano un consumo non ancora arrivato restano una voce sola, nella dispensa come nel diario", () => {
    const events = [...log.filter((e) => e.id !== "c4" && e.id !== "c5"), ...citing("non-arrivato")];
    expect(eaten(events)).toEqual({ pantry: 100, diary: 100 });
  });
});

describe("voidMeal", () => {
  const opts = () => ({
    deviceId: "dev-a",
    now: () => "2026-03-12T10:00:00.000Z",
    idGenerator: createIdGenerator({ now: () => 1, random: seededRandom(5) }),
  });
  const targets = (voids: { targetEventId: string }[]) => voids.map((v) => v.targetEventId);

  it("annulla il pasto e tutti i consume attivi con lo stesso mealId", () => {
    const voids = voidMeal("meal-2", log, opts());
    expect(targets(voids)).toEqual(["m2", "c2", "c3"]);
    for (const v of voids) {
      expect(v).toEqual(
        expect.objectContaining({ type: "void", at: "2026-03-12T10:00:00.000Z", deviceId: "dev-a" }),
      );
      expect(validateDiaryEvent(v)).toEqual([]);
    }
    expect(new Set(voids.map((v) => v.id)).size).toBe(3);

    // Scritti nel registro, il pasto sparisce dal diario e la dispensa non resta scalata.
    const after = [...log, ...voids];
    expect(mealsWithPantry(deriveDiary(after), after).map((m) => m.mealId)).toEqual([
      "meal-1",
      "meal-3",
    ]);
    expect(pantryMealReport(deriveDiary(after), after).orphanConsumes.map((c) => c.id)).toEqual([
      "c5",
    ]);
    const lot = derivePantry(after as never).lots.find((l) => l.lotId === "lot-pasta");
    expect(lot?.remaining).toBe(500 - 30 - 30); // restano c4 e c5, che non hanno un pasto attivo
  });

  it("non tocca i consume di altri pasti né quelli senza mealId", () => {
    expect(targets(voidMeal("meal-1", log, opts()))).toEqual(["m1", "c1"]);
  });

  it("un pasto senza consume produce il solo void del pasto", () => {
    expect(targets(voidMeal("meal-3", log, opts()))).toEqual(["m3"]);
  });

  it("vuoto se il pasto non esiste o è già annullato", () => {
    expect(voidMeal("inesistente", log, opts())).toEqual([]);
    expect(voidMeal("orfano", log, opts())).toEqual([]);
    expect(voidMeal("meal-2", [], opts())).toEqual([]);
    const done = [...log, ...voidMeal("meal-2", log, opts())];
    expect(voidMeal("meal-2", done, opts())).toEqual([]);
  });

  it("dopo un ripristino (annullamento annullato) lo ritrova attivo", () => {
    const first = voidMeal("meal-2", log, opts());
    const restore = first.map((v, i) => voidOf(`r${i}`, "2026-03-12T11:00:00Z", v.id));
    const restored = [...log, ...first, ...restore];
    expect(mealsWithPantry(deriveDiary(restored), restored).map((m) => m.mealId)).toContain(
      "meal-2",
    );
    expect(targets(voidMeal("meal-2", restored, opts()))).toEqual(["m2", "c2", "c3"]);
  });

  it("ignora consume non validi o già annullati, a prescindere da ordine e duplicati", () => {
    const bad = consume("bad", "2026-03-10T12:34:00Z", {
      lotId: "lot-pasta",
      quantity: q(-5),
      mealId: "meal-2",
    });
    const extra = [bad, voidOf("v1", "2026-03-10T13:00:00Z", "c3")];
    const expected = targets(voidMeal("meal-2", [...log, ...extra], opts()));
    expect(expected).toEqual(["m2", "c2"]);
    const random = seededRandom(11);
    for (let i = 0; i < 20; i++) {
      const input = shuffled([...log, ...extra, ...log], random);
      expect(targets(voidMeal("meal-2", input, opts()))).toEqual(expected);
    }
  });

  it("senza opzioni usa orologio e generatore di sistema, e non modifica l'ingresso", () => {
    const snapshot = JSON.stringify(log);
    const [v] = voidMeal("meal-3", log);
    expect(validateDiaryEvent(v)).toEqual([]);
    expect(v.deviceId).toBe("dev-a");
    expect(JSON.stringify(log)).toBe(snapshot);
  });
});
