import { describe, expect, it } from "vitest";
import {
  InvalidPlanEventError,
  PLAN_EVENT_TYPES,
  createDayType,
  createPlanStructure,
  createPlanTargets,
  createPlanWeek,
  dayTypeOf,
  derivePlan,
  entriesOfDate,
  getWeek,
  inWeek,
  isMonday,
  isPlanEvent,
  isoWeekday,
  targetsOf,
  validatePlanEvent,
  weekDates,
  weekStartOf,
} from "./index";
import {
  dayTypeEv,
  food,
  recipe,
  seededRandom,
  shuffled,
  structureEv,
  targetsEv,
  voidEv,
  weekEv,
} from "./test-helpers";

const codes = (e: unknown) => validatePlanEvent(e).map((x) => `${x.path}:${x.code}`);

describe("calendario delle settimane", () => {
  it("lunedì, domenica e settimana di una data", () => {
    expect(isoWeekday("2026-03-09")).toBe(1);
    expect(isoWeekday("2026-03-15")).toBe(7);
    expect(isMonday("2026-03-09")).toBe(true);
    expect(isMonday("2026-03-10")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
    expect(isMonday(42)).toBe(false);
    expect(weekStartOf("2026-03-15")).toBe("2026-03-09");
    expect(weekStartOf("2026-03-09")).toBe("2026-03-09");
  });

  it("settimane a cavallo di mese, di anno e di febbraio bisestile", () => {
    expect(weekDates("2026-03-30")).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
    expect(weekDates("2025-12-29")[3]).toBe("2026-01-01");
    expect(weekStartOf("2026-01-01")).toBe("2025-12-29");
    expect(weekDates("2024-02-26")).toContain("2024-02-29");
    expect(weekDates("2024-02-26")[6]).toBe("2024-03-03");
    expect(inWeek("2025-12-29", "2026-01-04")).toBe(true);
    expect(inWeek("2025-12-29", "2026-01-05")).toBe(false);
  });
});

describe("validatePlanEvent", () => {
  const t = "2026-03-01T10:00:00.000Z";

  it("accetta un esempio valido per ogni tipo", () => {
    const events = [
      targetsEv("t1", t, "training", { energyKcal: { min: 2400, max: 2800 }, proteinG: { min: 120 } }),
      structureEv("s1", t, {
        meals: [{ kind: "breakfast", time: "07:30" }, { kind: "snack" }],
        eatingWindow: { from: "08:00", to: "20:00" },
        excludedFoods: ["latte"],
        allergens: ["glutine"],
        defaultDayType: "rest",
      }),
      weekEv("w1", t, "2026-03-09", [
        food("2026-03-09", "lunch", "Riso", 80),
        recipe("2026-03-10", "dinner", "r1", 2),
      ]),
      dayTypeEv("d1", t, "2026-03-09", "training"),
    ];
    for (const e of events) expect(validatePlanEvent(e)).toEqual([]);
    expect(events.map((e) => e.type).sort()).toEqual([...PLAN_EVENT_TYPES].sort());
  });

  it("controlla la busta comune", () => {
    expect(codes(null)).toEqual([":not_an_object"]);
    expect(codes(dayTypeEv("", t, "2026-03-09", "x"))).toContain("id:invalid_type");
    expect(codes({ ...dayTypeEv("d", t, "2026-03-09", "x"), recordedAt: "ieri" })).toContain(
      "recordedAt:invalid_instant",
    );
  });

  it("un tipo che non è del piano è un valore non valido; senza tipo manca", () => {
    expect(codes({ ...dayTypeEv("d", t, "2026-03-09", "x"), type: "altro" })).toContain("type:invalid_value");
    expect(codes({ ...dayTypeEv("d", t, "2026-03-09", "x"), type: undefined })).toContain("type:required");
    expect(isPlanEvent({ type: "planWeek" })).toBe(true);
    expect(isPlanEvent({ type: "meal" })).toBe(false);
    expect(isPlanEvent(null)).toBe(false);
  });

  it("dayType: data e nome", () => {
    expect(codes(dayTypeEv("d", t, "2026-02-30", "x"))).toContain("date:invalid_date");
    expect(codes(dayTypeEv("d", t, "2026-03-09", " "))).toContain("dayType:invalid_type");
    expect(codes({ ...dayTypeEv("d", t, "2026-03-09", "x"), date: undefined })).toContain("date:required");
  });

  it("planTargets: nutrienti noti, minimo e massimo coerenti", () => {
    expect(codes(targetsEv("a", t, "x", {}))).toContain("targets:required");
    expect(codes(targetsEv("a", t, "x", { foo: { min: 1 } } as never))).toContain("targets.foo:invalid_value");
    expect(codes(targetsEv("a", t, "x", { proteinG: {} }))).toContain("targets.proteinG:required");
    expect(codes(targetsEv("a", t, "x", { proteinG: { min: 10, max: 5 } }))).toContain(
      "targets.proteinG.min:invalid_value",
    );
    expect(codes(targetsEv("a", t, "x", { proteinG: { min: -1 } }))).toContain("targets.proteinG.min:negative");
    expect(codes(targetsEv("a", t, "x", { proteinG: { max: Number.NaN } }))).toContain(
      "targets.proteinG.max:invalid_value",
    );
    expect(validatePlanEvent(targetsEv("a", t, "x", { proteinG: { min: 5, max: 5 } }))).toEqual([]);
    expect(codes({ ...targetsEv("a", t, "x", { proteinG: { min: 1 } }), targets: [] })).toContain(
      "targets:invalid_type",
    );
  });

  it("planStructure: pasti, orari, finestra, liste", () => {
    expect(codes(structureEv("a", t, { meals: [] }))).toContain("meals:invalid_value");
    expect(codes(structureEv("a", t, { meals: [{ kind: "brunch" as never }] }))).toContain(
      "meals[0].kind:invalid_value",
    );
    expect(codes(structureEv("a", t, { meals: [{ kind: "lunch", time: "25:00" }] }))).toContain(
      "meals[0].time:invalid_value",
    );
    expect(codes(structureEv("a", t, { eatingWindow: { from: "08:00" } as never }))).toContain(
      "eatingWindow.to:required",
    );
    expect(codes(structureEv("a", t, { excludedFoods: ["ok", ""] }))).toContain("excludedFoods[1]:invalid_type");
    expect(codes(structureEv("a", t, { allergens: "noci" as never }))).toContain("allergens:invalid_type");
    expect(codes(structureEv("a", t, { defaultDayType: "" }))).toContain("defaultDayType:invalid_type");
  });

  it("planWeek: lunedì, date nella settimana, voci", () => {
    expect(codes(weekEv("a", t, "2026-03-10", []))).toContain("weekStart:invalid_value");
    expect(codes(weekEv("a", t, "2026-03-09", [food("2026-03-16", "lunch", "Riso", 80)]))).toContain(
      "entries[0].date:invalid_value",
    );
    expect(validatePlanEvent(weekEv("a", t, "2026-03-09", []))).toEqual([]);
    expect(codes(weekEv("a", t, "2026-03-09", [food("2026-03-09", "lunch", "Riso", 0)]))).toContain(
      "entries[0].item.quantity.value:not_positive",
    );
    expect(codes(weekEv("a", t, "2026-03-09", [food("2026-03-09", "lunch", "Riso", 5, "kg" as never)]))).toContain(
      "entries[0].item.quantity.unit:invalid_value",
    );
    expect(codes(weekEv("a", t, "2026-03-09", [recipe("2026-03-09", "lunch", "r", 0)]))).toContain(
      "entries[0].item.servings:not_positive",
    );
    expect(codes(weekEv("a", t, "2026-03-09", [recipe("2026-03-09", "lunch", "", 1)]))).toContain(
      "entries[0].item.recipeId:invalid_type",
    );
    expect(
      codes(
        weekEv("a", t, "2026-03-09", [
          { date: "2026-03-09", meal: "lunch", item: { kind: "dish" } } as never,
        ]),
      ),
    ).toContain("entries[0].item.kind:invalid_value");
    expect(
      codes(weekEv("a", t, "2026-03-09", [{ date: "2026-03-09", meal: "brunch" } as never])),
    ).toContain("entries[0].meal:invalid_value");
  });

  it("non lancia mai", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => validatePlanEvent(cyc)).not.toThrow();
    expect(() => validatePlanEvent(undefined)).not.toThrow();
    expect(() => validatePlanEvent({ type: "planWeek", weekStart: 5, entries: [null] })).not.toThrow();
  });
});

describe("derivePlan", () => {
  const w1 = "2026-03-09";

  it("stato vuoto", () => {
    expect(derivePlan([])).toEqual({
      targets: [],
      weeks: [],
      dayTypes: [],
      anomalies: [],
      voidedEventIds: [],
    });
  });

  it("un evento successivo con la stessa chiave sostituisce il precedente", () => {
    const state = derivePlan([
      targetsEv("t1", "2026-03-01T10:00:00.000Z", "training", { proteinG: { min: 100 } }),
      targetsEv("t2", "2026-03-02T10:00:00.000Z", "training", { proteinG: { min: 130 } }),
      targetsEv("t3", "2026-03-02T10:00:00.000Z", "rest", { proteinG: { min: 90 } }),
      weekEv("w1", "2026-03-01T10:00:00.000Z", w1, [food("2026-03-09", "lunch", "Riso", 80)]),
      weekEv("w2", "2026-03-03T10:00:00.000Z", w1, [food("2026-03-10", "lunch", "Pasta", 90)]),
      dayTypeEv("d1", "2026-03-01T10:00:00.000Z", "2026-03-09", "rest"),
      dayTypeEv("d2", "2026-03-02T10:00:00.000Z", "2026-03-09", "training"),
      structureEv("s1", "2026-03-01T10:00:00.000Z", { excludedFoods: ["latte"] }),
      structureEv("s2", "2026-03-04T10:00:00.000Z", { excludedFoods: ["uova"], allergens: ["noci"] }),
    ]);
    expect(state.targets.map((t) => [t.dayType, t.targets.proteinG?.min, t.eventId])).toEqual([
      ["rest", 90, "t3"],
      ["training", 130, "t2"],
    ]);
    expect(getWeek(state, w1)?.eventId).toBe("w2");
    expect(getWeek(state, w1)?.entries).toHaveLength(1);
    expect(dayTypeOf(state, "2026-03-09")).toBe("training");
    expect(state.structure?.excludedFoods).toEqual(["uova"]);
    expect(state.structure?.allergens).toEqual(["noci"]);
    expect(targetsOf(state, "rest")?.eventId).toBe("t3");
  });

  it("a parità di recordedAt vince l'id maggiore, non l'ordine di arrivo", () => {
    const t = "2026-03-01T10:00:00.000Z";
    const a = targetsEv("a", t, "x", { proteinG: { min: 1 } });
    const b = targetsEv("b", t, "x", { proteinG: { min: 2 } });
    expect(derivePlan([a, b]).targets[0].eventId).toBe("b");
    expect(derivePlan([b, a]).targets[0].eventId).toBe("b");
  });

  it("vale recordedAt e non at", () => {
    const old = targetsEv("z", "2026-03-01T10:00:00.000Z", "x", { proteinG: { min: 1 } }, {
      at: "2026-06-01T10:00:00.000Z",
    });
    const recent = targetsEv("a", "2026-03-02T10:00:00.000Z", "x", { proteinG: { min: 2 } }, {
      at: "2026-01-01T10:00:00.000Z",
    });
    expect(derivePlan([old, recent]).targets[0].eventId).toBe("a");
  });

  it("il tipo di giornata predefinito vale per le date senza evento", () => {
    const state = derivePlan([
      structureEv("s", "2026-03-01T10:00:00.000Z", { defaultDayType: "rest" }),
      dayTypeEv("d", "2026-03-01T10:00:00.000Z", "2026-03-10", "training"),
    ]);
    expect(dayTypeOf(state, "2026-03-09")).toBe("rest");
    expect(dayTypeOf(state, "2026-03-10")).toBe("training");
    expect(dayTypeOf(derivePlan([]), "2026-03-09")).toBeUndefined();
  });

  it("annullare l'ultimo evento fa riemergere il precedente; annullare l'annullamento lo ripristina", () => {
    const t1 = targetsEv("t1", "2026-03-01T10:00:00.000Z", "x", { proteinG: { min: 100 } });
    const t2 = targetsEv("t2", "2026-03-02T10:00:00.000Z", "x", { proteinG: { min: 130 } });
    const v = voidEv("v1", "2026-03-03T10:00:00.000Z", "t2");
    const vv = voidEv("v2", "2026-03-04T10:00:00.000Z", "v1");
    expect(derivePlan([t1, t2, v]).targets[0].eventId).toBe("t1");
    expect(derivePlan([t1, t2, v]).voidedEventIds).toEqual(["t2"]);
    expect(derivePlan([t1, t2, v, vv]).targets[0].eventId).toBe("t2");
  });

  it("annullare l'unico evento rimuove la voce", () => {
    const w = weekEv("w", "2026-03-01T10:00:00.000Z", w1, [food("2026-03-09", "lunch", "Riso", 80)]);
    const state = derivePlan([w, voidEv("v", "2026-03-02T10:00:00.000Z", "w")]);
    expect(state.weeks).toEqual([]);
  });

  it("un void può puntare a un evento di un altro modulo senza anomalie", () => {
    const state = derivePlan([
      { id: "m1", type: "meal", at: "x" },
      voidEv("v", "2026-03-02T10:00:00.000Z", "m1"),
    ]);
    expect(state.anomalies).toEqual([]);
  });

  it("segnala bersaglio mancante, cicli, eventi non validi e conflitti di id", () => {
    const missing = derivePlan([voidEv("v", "2026-03-02T10:00:00.000Z", "nope")]);
    expect(missing.anomalies.map((a) => a.code)).toEqual(["void_target_missing"]);

    const cycle = derivePlan([
      voidEv("a", "2026-03-02T10:00:00.000Z", "b"),
      voidEv("b", "2026-03-02T10:00:00.000Z", "a"),
    ]);
    expect(cycle.anomalies.map((a) => a.code)).toEqual(["void_cycle", "void_cycle"]);

    const bad = derivePlan([
      { ...dayTypeEv("d", "2026-03-01T10:00:00.000Z", "2026-03-09", "x"), date: "no" },
    ]);
    expect(bad.dayTypes).toEqual([]);
    expect(bad.anomalies[0]).toMatchObject({ code: "invalid_event", eventId: "d" });

    const a = dayTypeEv("same", "2026-03-01T10:00:00.000Z", "2026-03-09", "x");
    const b = dayTypeEv("same", "2026-03-02T10:00:00.000Z", "2026-03-09", "y");
    const conflict = derivePlan([a, b]);
    expect(conflict.anomalies.map((x) => x.code)).toEqual(["id_conflict"]);
    expect(conflict.dayTypes[0].dayType).toBe("y");

    expect(() => derivePlan([null, 3, "x", {}, { id: 5 }])).not.toThrow();
    // Voci di tipo del piano ma senza id utilizzabile sono segnalate; il resto non è di questo modulo.
    expect(derivePlan([{ type: "planWeek" }]).anomalies.map((x) => x.code)).toEqual(["invalid_event"]);
    expect(derivePlan([null, 3, "x"]).anomalies).toEqual([]);
  });

  it("ignora in silenzio gli eventi degli altri moduli", () => {
    const state = derivePlan([
      { id: "p1", type: "purchase" },
      { id: "m1", type: "meal" },
      { id: "x", type: "prep" },
    ]);
    expect(state.anomalies).toEqual([]);
  });

  it("le voci di una settimana sono ordinate per data e pasto, stabili nel resto", () => {
    const state = derivePlan([
      weekEv("w", "2026-03-01T10:00:00.000Z", w1, [
        food("2026-03-10", "dinner", "B", 1),
        food("2026-03-09", "dinner", "C", 1),
        food("2026-03-09", "breakfast", "D", 1),
        food("2026-03-09", "dinner", "A", 1),
      ]),
    ]);
    const names = getWeek(state, w1)!.entries.map((e) => (e.item.kind === "food" ? e.item.name : ""));
    expect(names).toEqual(["D", "C", "A", "B"]);
    expect(entriesOfDate(getWeek(state, w1), "2026-03-09")).toHaveLength(3);
    expect(entriesOfDate(undefined, "2026-03-09")).toEqual([]);
  });

  it("settimane a cavallo di mese e di anno restano distinte per chiave", () => {
    const state = derivePlan([
      weekEv("a", "2026-03-01T10:00:00.000Z", "2026-03-30", [food("2026-04-02", "lunch", "Riso", 80)]),
      weekEv("b", "2026-03-01T10:00:00.000Z", "2025-12-29", [food("2026-01-01", "lunch", "Lenticchie", 80)]),
      weekEv("c", "2026-03-01T10:00:00.000Z", "2024-02-26", [food("2024-02-29", "lunch", "Pesce", 150)]),
    ]);
    expect(state.weeks.map((w) => w.weekStart)).toEqual(["2024-02-26", "2025-12-29", "2026-03-30"]);
    expect(getWeek(state, "2025-12-29")!.entries[0].date).toBe("2026-01-01");
  });

  it("il risultato non dipende dall'ordine né dai duplicati degli eventi", () => {
    const events = [
      targetsEv("t1", "2026-03-01T10:00:00.000Z", "x", { proteinG: { min: 1 } }),
      targetsEv("t2", "2026-03-02T10:00:00.000Z", "x", { proteinG: { min: 2 } }),
      targetsEv("t3", "2026-03-02T10:00:00.000Z", "y", { fatG: { max: 70 } }),
      weekEv("w1", "2026-03-01T10:00:00.000Z", "2026-03-09", [food("2026-03-09", "lunch", "Riso", 80)]),
      weekEv("w2", "2026-03-02T10:00:00.000Z", "2026-03-09", [food("2026-03-10", "lunch", "Pasta", 80)]),
      weekEv("w3", "2026-03-02T10:00:00.000Z", "2025-12-29", [food("2025-12-31", "dinner", "Zuppa", 300)]),
      dayTypeEv("d1", "2026-03-01T10:00:00.000Z", "2026-03-09", "x"),
      structureEv("s1", "2026-03-01T10:00:00.000Z", {}),
      voidEv("v1", "2026-03-05T10:00:00.000Z", "w2"),
      voidEv("v2", "2026-03-06T10:00:00.000Z", "nope"),
      { id: "junk" },
      42,
    ];
    const expected = derivePlan(events);
    for (let seed = 1; seed <= 20; seed++) {
      const mixed = shuffled([...events, ...events.slice(0, 5)], seededRandom(seed));
      expect(derivePlan(mixed)).toEqual(expected);
    }
    expect(getWeek(expected, "2026-03-09")?.eventId).toBe("w1");
  });

  it("non modifica gli eventi in ingresso e non condivide riferimenti con loro", () => {
    const w = weekEv("w", "2026-03-01T10:00:00.000Z", "2026-03-09", [food("2026-03-09", "lunch", "Riso", 80)]);
    const snapshot = JSON.stringify(w);
    const state = derivePlan([w]);
    state.weeks[0].entries[0].date = "mutato";
    expect(JSON.stringify(w)).toBe(snapshot);
  });
});

describe("create*", () => {
  const options = {
    deviceId: "dev-a",
    now: () => "2026-03-05T09:00:00.000Z",
    idGenerator: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  };

  it("crea eventi validi con la busta comune", () => {
    const targets = createPlanTargets({ dayType: "rest", targets: { energyKcal: { max: 2200 } } }, options);
    expect(targets).toMatchObject({
      type: "planTargets",
      at: "2026-03-05T09:00:00.000Z",
      recordedAt: "2026-03-05T09:00:00.000Z",
      certainty: "measured",
      source: "manual",
      schemaVersion: 1,
    });
    expect(validatePlanEvent(createPlanStructure({ meals: [{ kind: "lunch" }] }, options))).toEqual([]);
    expect(validatePlanEvent(createPlanWeek({ weekStart: "2026-03-09", entries: [] }, options))).toEqual([]);
    expect(validatePlanEvent(createDayType({ date: "2026-03-09", dayType: "rest" }, options))).toEqual([]);
  });

  it("lancia se i dati non sono validi", () => {
    expect(() => createDayType({ date: "2026-03-09", dayType: "" }, options)).toThrow(InvalidPlanEventError);
    expect(() => createPlanWeek({ weekStart: "2026-03-10", entries: [] }, options)).toThrow(/weekStart/);
  });
});
