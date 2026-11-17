import { describe, expect, it } from "vitest";
import { deriveDiary, type DiaryState } from "./derive";
import { getDay } from "./selectors";
import {
  consume,
  drink,
  habit,
  meal,
  mood,
  purchase,
  seededRandom,
  shuffled,
  supplement,
  symptom,
  untracked,
  voidOf,
  water,
  weight,
} from "./test-helpers";

const day = (state: DiaryState, date: string) => {
  const d = getDay(state, date);
  if (!d) throw new Error(`giorno ${date} assente`);
  return d;
};
const codes = (s: DiaryState) => s.anomalies.map((a) => a.code);
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

describe("deriveDiary: riduzione per giornata", () => {
  it("raccoglie ogni tipo di voce nella giornata giusta", () => {
    const events = [
      meal("m1", "2026-03-10T07:30:00Z", {
        mealId: "meal-1",
        kind: "breakfast",
        title: "Colazione",
        items: [{ name: "Biscotti", quantity: q(40), certainty: "label" }],
        habitId: "h1",
      }),
      meal("m2", "2026-03-10T12:30:00Z", { mealId: "meal-2", kind: "lunch" }),
      untracked("u1", "2026-03-10T19:30:00Z", { kind: "dinner" }),
      water("w1", "2026-03-10T08:00:00Z", { ml: 250 }),
      water("w2", "2026-03-10T15:00:00Z", { ml: 500, certainty: "estimated" }),
      drink("d1", "2026-03-10T08:10:00Z", { name: "Espresso", ml: 30, caffeineMg: 63 }),
      drink("d2", "2026-03-10T09:10:00Z", { name: "Caffè lungo", ml: 80, caffeineMg: 90, certainty: "estimated" }),
      drink("d3", "2026-03-10T18:00:00Z", { name: "Birra", ml: 330, alcoholG: 13, certainty: "label" }),
      weight("k1", "2026-03-10T06:30:00Z", { kg: 72.4 }),
      weight("k2", "2026-03-10T20:30:00Z", { kg: 73.1 }),
      mood("o1", "2026-03-10T10:00:00Z", { score: 4, tags: ["calmo"] }),
      symptom("s1", "2026-03-10T14:00:00Z", { kind: "digestion", score: 2, label: "gonfiore" }),
      supplement("p1", "2026-03-10T08:05:00Z", { name: "Vitamina D", dose: "1000 UI", lotId: "lot-d3" }),
      water("w3", "2026-03-11T08:00:00Z", { ml: 100 }),
    ];
    const state = deriveDiary(events);
    expect(state.timeZone).toBe("Europe/Rome");
    expect(state.anomalies).toEqual([]);
    expect(state.days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-11"]);

    const d = day(state, "2026-03-10");
    expect(d.meals.map((m) => [m.mealId, m.kind, m.title, m.habitId])).toEqual([
      ["meal-1", "breakfast", "Colazione", "h1"],
      ["meal-2", "lunch", undefined, undefined],
    ]);
    expect(d.meals[0].items).toEqual([{ name: "Biscotti", quantity: q(40), certainty: "label" }]);
    expect(d.meals[1].items).toEqual([]);
    expect(d.untrackedMeals.map((m) => m.kind)).toEqual(["dinner"]);
    expect(d.waterMl).toBe(750);
    expect(d.waterCertainty).toBe("estimated");
    expect(d.drinks.map((x) => x.name)).toEqual(["Espresso", "Caffè lungo", "Birra"]);
    expect(d.caffeineMg).toBe(153);
    expect(d.caffeineCertainty).toBe("estimated");
    expect(d.alcoholG).toBe(13);
    expect(d.alcoholCertainty).toBe("label");
    expect(d.weights.map((w) => w.kg)).toEqual([72.4, 73.1]);
    expect(d.weightKg).toBe(73.1);
    expect(d.moods).toEqual([
      expect.objectContaining({ eventId: "o1", score: 4, tags: ["calmo"], at: "2026-03-10T10:00:00Z" }),
    ]);
    expect(d.symptoms[0]).toEqual(expect.objectContaining({ kind: "digestion", score: 2, label: "gonfiore" }));
    expect(d.supplements[0]).toEqual(
      expect.objectContaining({ name: "Vitamina D", dose: "1000 UI", lotId: "lot-d3" }),
    );

    const next = day(state, "2026-03-11");
    expect(next.waterMl).toBe(100);
    expect(next.waterCertainty).toBe("measured");
    expect(next.caffeineCertainty).toBeUndefined();
    expect(next.weightKg).toBeUndefined();
  });

  it("le somme non lasciano residui binari", () => {
    const events = [0.1, 0.2, 0.3].map((alcoholG, i) =>
      drink(`d${i}`, `2026-03-10T1${i}:00:00Z`, { name: "x", ml: 10, alcoholG }),
    );
    expect(day(deriveDiary(events), "2026-03-10").alcoholG).toBe(0.6);
  });

  it("ignora in silenzio gli eventi di dispensa e segnala il resto", () => {
    const pantry = [
      purchase("pu1", "2026-03-10T08:00:00Z", {
        lotId: "lot-1",
        productRef: "latte",
        quantity: q(1000, "ml"),
        location: "frigo",
      }),
      consume("c1", "2026-03-10T08:30:00Z", { lotId: "lot-1", quantity: q(200, "ml") }),
    ];
    const state = deriveDiary([
      ...pantry,
      water("w1", "2026-03-10T08:00:00Z", { ml: 200 }),
      { ...water("x1", "2026-03-10T08:00:00Z", { ml: 1 }), type: "sonno" },
      { ...water("x2", "2026-03-10T08:00:00Z", { ml: 1 }), ml: -1 },
      { id: "x3" },
      42,
      null,
    ]);
    expect(day(state, "2026-03-10").waterMl).toBe(200);
    expect(state.anomalies.filter((a) => a.eventId === "pu1" || a.eventId === "c1")).toEqual([]);
    expect(state.anomalies.find((a) => a.code === "unknown_event_type")).toEqual({
      code: "unknown_event_type",
      eventId: "x1",
      eventType: "sonno",
    });
    expect(state.anomalies.find((a) => a.eventId === "x2")?.errors).toEqual([
      { path: "ml", code: "not_positive" },
    ]);
    expect(state.anomalies.find((a) => a.eventId === "x3")?.code).toBe("invalid_event");
    expect(state.anomalies.filter((a) => a.code === "invalid_event" && a.eventId === undefined)).toHaveLength(2);
  });

  it("non lancia con ingressi anomali", () => {
    const cyclic: Record<string, unknown> = { id: "c" };
    cyclic.self = cyclic;
    expect(() => deriveDiary([cyclic, undefined, "x", BigInt(1), () => 1])).not.toThrow();
    expect(deriveDiary([]).days).toEqual([]);
  });

  it("due pasti con lo stesso mealId: conta il primo", () => {
    const state = deriveDiary([
      meal("m1", "2026-03-10T08:00:00Z", { mealId: "same", kind: "breakfast" }),
      meal("m2", "2026-03-10T09:00:00Z", { mealId: "same", kind: "snack" }),
    ]);
    expect(day(state, "2026-03-10").meals.map((m) => m.eventId)).toEqual(["m1"]);
    expect(state.anomalies).toEqual([{ code: "duplicate_meal", eventId: "m2", mealId: "same" }]);
  });

  it("stesso id con contenuti diversi: vince la versione valida, poi la più recente", () => {
    const good = water("w1", "2026-03-10T08:00:00Z", { ml: 200, recordedAt: "2026-03-10T08:00:00Z" });
    const newer = water("w1", "2026-03-10T08:00:00Z", { ml: 300, recordedAt: "2026-03-10T09:00:00Z" });
    const broken = water("w1", "2026-03-10T08:00:00Z", { ml: -5, recordedAt: "2026-03-10T10:00:00Z" });
    const state = deriveDiary([good, broken, newer]);
    expect(day(state, "2026-03-10").waterMl).toBe(300);
    expect(codes(state)).toEqual(["id_conflict"]);
    // Un duplicato identico non è un conflitto.
    expect(codes(deriveDiary([good, { ...good }]))).toEqual([]);
  });
});

describe("deriveDiary: annullamenti", () => {
  const base = [
    meal("m1", "2026-03-10T08:00:00Z", { mealId: "meal-1", kind: "breakfast" }),
    water("w1", "2026-03-10T09:00:00Z", { ml: 250 }),
    weight("k1", "2026-03-10T07:00:00Z", { kg: 70 }),
  ];

  it("un evento annullato non conta", () => {
    const state = deriveDiary([...base, voidOf("v1", "2026-03-10T10:00:00Z", "w1")]);
    const d = day(state, "2026-03-10");
    expect(d.waterMl).toBe(0);
    expect(d.waterCertainty).toBeUndefined();
    expect(d.meals).toHaveLength(1);
    expect(state.voidedEventIds).toEqual(["w1"]);
    expect(state.anomalies).toEqual([]);
  });

  it("un giorno con tutte le voci annullate sparisce", () => {
    const state = deriveDiary([base[1], voidOf("v1", "2026-03-10T10:00:00Z", "w1")]);
    expect(state.days).toEqual([]);
  });

  it("un annullamento annullato ripristina l'evento, a qualunque profondità", () => {
    const v1 = voidOf("v1", "2026-03-10T10:00:00Z", "w1");
    const v2 = voidOf("v2", "2026-03-10T11:00:00Z", "v1");
    const v3 = voidOf("v3", "2026-03-10T12:00:00Z", "v2");
    expect(day(deriveDiary([...base, v1, v2]), "2026-03-10").waterMl).toBe(250);
    expect(deriveDiary([...base, v1, v2]).voidedEventIds).toEqual(["v1"]);
    expect(day(deriveDiary([...base, v1, v2, v3]), "2026-03-10").waterMl).toBe(0);
  });

  it("segnala bersagli mancanti e cicli, senza danni", () => {
    const missing = deriveDiary([...base, voidOf("v1", "2026-03-10T10:00:00Z", "ghost")]);
    expect(missing.anomalies).toEqual([
      { code: "void_target_missing", eventId: "v1", targetEventId: "ghost" },
    ]);
    expect(day(missing, "2026-03-10").waterMl).toBe(250);

    const cycle = deriveDiary([
      ...base,
      voidOf("va", "2026-03-10T10:00:00Z", "vb"),
      voidOf("vb", "2026-03-10T10:00:01Z", "va"),
    ]);
    expect(codes(cycle)).toEqual(["void_cycle", "void_cycle"]);
    expect(day(cycle, "2026-03-10").waterMl).toBe(250);
  });

  it("un void su un evento di dispensa presente nel registro non è un'anomalia", () => {
    const c = consume("c1", "2026-03-10T08:30:00Z", { lotId: "lot-1", quantity: q(100) });
    const state = deriveDiary([...base, c, voidOf("v1", "2026-03-10T10:00:00Z", "c1")]);
    expect(state.anomalies).toEqual([]);
    expect(state.voidedEventIds).toEqual(["c1"]);
  });

  it("un void non valido è ignorato e segnalato", () => {
    const bad = { ...voidOf("v1", "2026-03-10T10:00:00Z", "w1"), targetEventId: undefined };
    const state = deriveDiary([...base, bad]);
    expect(day(state, "2026-03-10").waterMl).toBe(250);
    expect(state.anomalies).toEqual([
      { code: "invalid_event", eventId: "v1", errors: [{ path: "targetEventId", code: "required" }] },
    ]);
  });
});

describe("deriveDiary: giornate e fuso orario", () => {
  const dates = (events: unknown[], options?: { timeZone?: string }) =>
    Object.fromEntries(
      deriveDiary(events, options).days.flatMap((d) => d.waterMl > 0 ? [[d.date, d.waterMl]] : []),
    );

  it("d'inverno la mezzanotte italiana cade alle 23:00 UTC", () => {
    expect(
      dates([
        water("a", "2026-01-15T22:59:59Z", { ml: 1 }),
        water("b", "2026-01-15T23:00:00Z", { ml: 10 }),
        water("c", "2026-01-16T22:59:59Z", { ml: 100 }),
      ]),
    ).toEqual({ "2026-01-15": 1, "2026-01-16": 110 });
  });

  it("d'estate la mezzanotte italiana cade alle 22:00 UTC", () => {
    expect(
      dates([
        water("a", "2026-07-15T21:59:59Z", { ml: 1 }),
        water("b", "2026-07-15T22:00:00Z", { ml: 10 }),
        water("c", "2026-07-16T21:59:59Z", { ml: 100 }),
      ]),
    ).toEqual({ "2026-07-15": 1, "2026-07-16": 110 });
  });

  it("nella notte del cambio d'ora la giornata resta quella di calendario", () => {
    expect(
      dates([
        water("a", "2026-03-28T23:30:00Z", { ml: 1 }), // 00:30 del 29, ancora ora solare
        water("b", "2026-03-29T00:30:00Z", { ml: 10 }), // 01:30 del 29
        water("c", "2026-03-29T01:30:00Z", { ml: 100 }), // 03:30 del 29, ora legale
        water("d", "2026-03-29T21:59:59Z", { ml: 1000 }), // 23:59 del 29
        water("e", "2026-03-29T22:00:00Z", { ml: 10000 }), // 00:00 del 30
      ]),
    ).toEqual({ "2026-03-29": 1111, "2026-03-30": 10000 });
  });

  it("il fuso è un'opzione; uno non valido torna al predefinito con un'anomalia", () => {
    const events = [water("a", "2026-01-15T23:30:00Z", { ml: 5 })];
    expect(dates(events)).toEqual({ "2026-01-16": 5 });
    expect(dates(events, { timeZone: "UTC" })).toEqual({ "2026-01-15": 5 });
    expect(dates(events, { timeZone: "America/New_York" })).toEqual({ "2026-01-15": 5 });
    const bad = deriveDiary(events, { timeZone: "Atlantide" });
    expect(bad.timeZone).toBe("Europe/Rome");
    expect(bad.anomalies).toEqual([{ code: "invalid_time_zone" }]);
    expect(bad.days[0].date).toBe("2026-01-16");
  });

  it("le giornate sono ordinate per data indipendentemente dall'ordine in ingresso", () => {
    const state = deriveDiary([
      water("c", "2026-03-12T10:00:00Z", { ml: 1 }),
      water("a", "2026-03-10T10:00:00Z", { ml: 1 }),
      water("b", "2026-03-11T10:00:00Z", { ml: 1 }),
    ]);
    expect(state.days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });
});

describe("deriveDiary: pasti abituali", () => {
  const items = [{ name: "Caffè", quantity: q(30, "ml"), certainty: "estimated" as const }];
  const def = (id: string, recordedAt: string, extra: Record<string, unknown> = {}) =>
    habit(id, "2026-03-01T08:00:00Z", {
      habitId: "h1",
      title: "Solita colazione",
      kind: "breakfast",
      usualTime: "07:30",
      items,
      recordedAt,
      ...extra,
    } as never);

  it("un evento successivo con lo stesso habitId sostituisce il precedente", () => {
    const state = deriveDiary([
      def("a", "2026-03-01T08:00:00Z"),
      def("b", "2026-03-05T08:00:00Z", { title: "Colazione nuova", usualTime: "08:15" }),
    ]);
    expect(state.habits).toHaveLength(1);
    expect(state.habits[0]).toEqual(
      expect.objectContaining({ habitId: "h1", title: "Colazione nuova", usualTime: "08:15", eventId: "b" }),
    );
  });

  it("vale l'ultimo per recordedAt, non per at né per ordine di arrivo; a parità vince l'id maggiore", () => {
    const newer = def("a", "2026-03-05T08:00:00Z", { title: "Recente", at: "2026-01-01T00:00:00Z" });
    const older = def("z", "2026-03-01T08:00:00Z", { title: "Vecchia", at: "2026-06-01T00:00:00Z" });
    expect(deriveDiary([older, newer]).habits[0].title).toBe("Recente");
    expect(deriveDiary([newer, older]).habits[0].title).toBe("Recente");
    const t1 = def("a", "2026-03-05T08:00:00Z", { title: "A" });
    const t2 = def("b", "2026-03-05T08:00:00Z", { title: "B" });
    expect(deriveDiary([t1, t2]).habits[0].title).toBe("B");
    expect(deriveDiary([t2, t1]).habits[0].title).toBe("B");
  });

  it("archived: true lo ritira; una definizione successiva lo riattiva", () => {
    const d1 = def("a", "2026-03-01T08:00:00Z");
    const archived = def("b", "2026-03-02T08:00:00Z", { archived: true });
    const again = def("c", "2026-03-03T08:00:00Z", { title: "Di nuovo" });
    expect(deriveDiary([d1, archived]).habits).toEqual([]);
    expect(deriveDiary([d1, archived, again]).habits.map((h) => h.title)).toEqual(["Di nuovo"]);
  });

  it("annullare il ritiro riporta in vita la definizione", () => {
    const d1 = def("a", "2026-03-01T08:00:00Z");
    const archived = def("b", "2026-03-02T08:00:00Z", { archived: true });
    const state = deriveDiary([d1, archived, voidOf("v1", "2026-03-03T08:00:00Z", "b")]);
    expect(state.habits.map((h) => h.eventId)).toEqual(["a"]);
  });

  it("elenca solo gli attivi, per ora abituale, titolo e id", () => {
    const mk = (habitId: string, title: string, usualTime?: string) =>
      habit(`e-${habitId}`, "2026-03-01T08:00:00Z", {
        habitId,
        title,
        kind: "snack",
        items,
        ...(usualTime ? { usualTime } : {}),
      } as never);
    const state = deriveDiary([
      mk("h-late", "Cena", "20:00"),
      mk("h-none", "Senza ora"),
      mk("h-b", "Colazione", "07:30"),
      mk("h-a", "Colazione", "07:30"),
    ]);
    expect(state.habits.map((h) => h.habitId)).toEqual(["h-a", "h-b", "h-late", "h-none"]);
  });

  it("un pasto abituale non compare nelle giornate", () => {
    expect(deriveDiary([def("a", "2026-03-01T08:00:00Z")]).days).toEqual([]);
  });
});

describe("deriveDiary: indipendenza dall'ordine", () => {
  const events: unknown[] = [
    meal("m1", "2026-03-10T07:30:00Z", { mealId: "meal-1", kind: "breakfast" }),
    meal("m2", "2026-03-10T12:30:00Z", { mealId: "meal-2", kind: "lunch", habitId: "h1" }),
    meal("m3", "2026-03-10T12:45:00Z", { mealId: "meal-2", kind: "lunch" }),
    meal("m4", "2026-03-10T23:30:00Z", { mealId: "meal-3", kind: "snack" }),
    untracked("u1", "2026-03-10T19:30:00Z", { kind: "dinner" }),
    water("w1", "2026-03-10T08:00:00Z", { ml: 250 }),
    water("w2", "2026-03-10T15:00:00Z", { ml: 500, certainty: "estimated" }),
    water("w3", "2026-03-10T15:00:00Z", { ml: 100, certainty: "label" }),
    drink("d1", "2026-03-10T08:10:00Z", { name: "Espresso", ml: 30, caffeineMg: 63, alcoholG: 0.1 }),
    drink("d2", "2026-03-10T08:10:00Z", { name: "Vino", ml: 150, alcoholG: 0.2 }),
    weight("k1", "2026-03-10T06:30:00Z", { kg: 72.4 }),
    weight("k2", "2026-03-10T06:30:00Z", { kg: 72.6 }),
    mood("o1", "2026-03-10T10:00:00Z", { score: 4 }),
    symptom("s1", "2026-03-10T14:00:00Z", { kind: "sleep", score: 2 }),
    supplement("p1", "2026-03-10T08:05:00Z", { name: "Vitamina D" }),
    habit("a1", "2026-03-01T08:00:00Z", { habitId: "h1", title: "Vecchia", kind: "lunch", items: [] }),
    habit("a2", "2026-03-02T08:00:00Z", { habitId: "h1", title: "Nuova", kind: "lunch", items: [] }),
    habit("a3", "2026-03-02T08:00:00Z", { habitId: "h2", title: "Ritirata", kind: "dinner", items: [] }),
    habit("a4", "2026-03-03T08:00:00Z", { habitId: "h2", title: "Ritirata", kind: "dinner", items: [], archived: true }),
    voidOf("v1", "2026-03-10T11:00:00Z", "w1"),
    voidOf("v2", "2026-03-10T12:00:00Z", "v1"),
    voidOf("v3", "2026-03-10T13:00:00Z", "k1"),
    voidOf("v4", "2026-03-10T13:00:00Z", "ghost"),
    voidOf("va", "2026-03-10T14:00:00Z", "vb"),
    voidOf("vb", "2026-03-10T14:00:01Z", "va"),
    water("c1", "2026-03-10T10:00:00Z", { ml: 10 }),
    { ...water("c1", "2026-03-10T10:00:00Z", { ml: 20 }), recordedAt: "2026-03-10T11:00:00Z" },
    { ...water("bad", "2026-03-10T10:00:00Z", { ml: 1 }), ml: -1 },
    { ...water("odd", "2026-03-10T10:00:00Z", { ml: 1 }), type: "futuro" },
    { id: "senza-tipo" },
    "spazzatura",
    purchase("pu1", "2026-03-10T08:00:00Z", {
      lotId: "lot-1",
      productRef: "latte",
      quantity: q(1000, "ml"),
      location: "frigo",
    }),
    consume("cn1", "2026-03-10T08:30:00Z", { lotId: "lot-1", quantity: q(200, "ml"), mealId: "meal-1" }),
    water("w-sum1", "2026-03-11T08:00:00Z", { ml: 0.1 }),
    water("w-sum2", "2026-03-11T08:01:00Z", { ml: 0.2 }),
    water("w-sum3", "2026-03-11T08:02:00Z", { ml: 0.3 }),
  ];

  it("dà lo stesso stato per permutazioni casuali a seme fisso, con duplicati", () => {
    const expected = deriveDiary(events);
    expect(expected.days.length).toBeGreaterThan(0);
    expect(expected.anomalies.length).toBeGreaterThan(5);
    expect(expected.habits.map((h) => h.title)).toEqual(["Nuova"]);
    const random = seededRandom(20260317);
    for (let i = 0; i < 60; i++) {
      const pool = i % 3 === 0 ? [...events, ...events.slice(0, 15)] : events;
      expect(deriveDiary(shuffled(pool, random))).toEqual(expected);
    }
  });

  it("accetta qualunque iterabile e non modifica l'ingresso", () => {
    const snapshot = JSON.stringify(events);
    const a = deriveDiary(new Set(events));
    const b = deriveDiary(events);
    expect(a).toEqual(b);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("l'uscita non condivide riferimenti con l'ingresso", () => {
    const m = meal("m1", "2026-03-10T07:30:00Z", {
      mealId: "meal-1",
      kind: "breakfast",
      items: [{ name: "Pane", quantity: q(50), certainty: "label" }],
    });
    const state = deriveDiary([m]);
    state.days[0].meals[0].items[0].quantity.value = 999;
    expect(m.items?.[0].quantity.value).toBe(50);
  });
});
