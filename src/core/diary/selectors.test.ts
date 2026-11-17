import { describe, expect, it } from "vitest";
import { deriveDiary } from "./derive";
import {
  dayCoverage,
  getDay,
  habitsToPropose,
  trackingCoverage,
  waterByDay,
  weightMovingAverage,
  weightSeries,
} from "./selectors";
import { habit, meal, untracked, voidOf, water, weight } from "./test-helpers";

const noon = (date: string) => `${date}T11:00:00Z`;

describe("peso", () => {
  const events = [
    weight("k1", noon("2026-03-01"), { kg: 80 }),
    weight("k1b", "2026-03-01T18:00:00Z", { kg: 79 }),
    weight("k2", noon("2026-03-02"), { kg: 79, certainty: "estimated" }),
    weight("k4", noon("2026-03-04"), { kg: 78, certainty: "label" }),
    weight("k9", noon("2026-03-09"), { kg: 76 }),
  ];
  const state = deriveDiary(events);

  it("la serie ha una pesata per giorno, l'ultima, in ordine di data", () => {
    expect(weightSeries(state)).toEqual([
      { date: "2026-03-01", kg: 79, certainty: "measured" },
      { date: "2026-03-02", kg: 79, certainty: "estimated" },
      { date: "2026-03-04", kg: 78, certainty: "label" },
      { date: "2026-03-09", kg: 76, certainty: "measured" },
    ]);
    expect(weightSeries(state, { from: "2026-03-02", to: "2026-03-04" }).map((p) => p.date)).toEqual([
      "2026-03-02",
      "2026-03-04",
    ]);
    expect(weightSeries(deriveDiary([]))).toEqual([]);
  });

  it("la media mobile conta solo i giorni con una pesata dentro la finestra", () => {
    const avg = weightMovingAverage(state, { windowDays: 3 });
    expect(avg).toEqual([
      { date: "2026-03-01", kg: 79, samples: 1, certainty: "measured" },
      { date: "2026-03-02", kg: 79, samples: 2, certainty: "estimated" },
      // finestra 2-4 marzo: 79 e 78
      { date: "2026-03-04", kg: 78.5, samples: 2, certainty: "estimated" },
      // finestra 7-9 marzo: solo il 9
      { date: "2026-03-09", kg: 76, samples: 1, certainty: "measured" },
    ]);
  });

  it("la finestra predefinita è di 7 giorni e from/to non la accorciano", () => {
    const avg = weightMovingAverage(state);
    expect(avg.map((p) => [p.date, p.samples])).toEqual([
      ["2026-03-01", 1],
      ["2026-03-02", 2],
      ["2026-03-04", 3],
      ["2026-03-09", 2], // 3-9 marzo: 4 e 9
    ]);
    expect(weightMovingAverage(state, { from: "2026-03-04", to: "2026-03-04" })).toEqual([
      { date: "2026-03-04", kg: 78.666667, samples: 3, certainty: "estimated" },
    ]);
  });

  it("finestre non valide (NaN, zero, negative, infinite) non lanciano e ricadono su 7 giorni", () => {
    const expected = weightMovingAverage(state, { windowDays: 7 });
    for (const windowDays of [Number.NaN, 0, -3, 0.5, -Infinity, Infinity, "5" as never, null as never]) {
      expect(() => weightMovingAverage(state, { windowDays })).not.toThrow();
      expect(weightMovingAverage(state, { windowDays })).toEqual(expected);
    }
    expect(weightMovingAverage(state, { windowDays: undefined })).toEqual(expected);
  });

  it("una finestra frazionaria si tronca; una enorme resta calcolabile", () => {
    expect(weightMovingAverage(state, { windowDays: 3.9 })).toEqual(
      weightMovingAverage(state, { windowDays: 3 }),
    );
    expect(weightMovingAverage(state, { windowDays: 1e15 }).map((p) => p.samples)).toEqual([1, 2, 3, 4]);
    expect(weightMovingAverage(state, { windowDays: 1 }).map((p) => p.kg)).toEqual([79, 79, 78, 76]);
  });

  it("ignora i pesi annullati", () => {
    const s = deriveDiary([...events, voidOf("v1", noon("2026-03-10"), "k2")]);
    expect(weightSeries(s).map((p) => p.date)).toEqual(["2026-03-01", "2026-03-04", "2026-03-09"]);
  });
});

describe("acqua per giorno", () => {
  const state = deriveDiary([
    water("w1", noon("2026-03-01"), { ml: 250 }),
    water("w2", "2026-03-01T15:00:00Z", { ml: 250, certainty: "label" }),
    water("w3", noon("2026-03-04"), { ml: 1500, certainty: "estimated" }),
  ]);

  it("riempie con zero i giorni senza acqua", () => {
    expect(waterByDay(state)).toEqual([
      { date: "2026-03-01", ml: 500, certainty: "label" },
      { date: "2026-03-02", ml: 0 },
      { date: "2026-03-03", ml: 0 },
      { date: "2026-03-04", ml: 1500, certainty: "estimated" },
    ]);
  });

  it("rispetta l'intervallo richiesto, anche oltre i dati", () => {
    expect(waterByDay(state, { from: "2026-03-03", to: "2026-03-05" }).map((d) => d.ml)).toEqual([
      0, 1500, 0,
    ]);
    expect(waterByDay(state, { from: "2026-03-05", to: "2026-03-03" })).toEqual([]);
    expect(waterByDay(deriveDiary([]))).toEqual([]);
  });
});

describe("giorni completi e giorni con vuoti", () => {
  const m = (id: string, date: string, hour: number, kind: "breakfast" | "lunch" | "dinner" | "snack") =>
    meal(id, `${date}T${String(hour).padStart(2, "0")}:00:00Z`, { mealId: id, kind });
  const events = [
    // 1 marzo: colazione, pranzo e cena tracciati -> completo
    m("a1", "2026-03-01", 7, "breakfast"),
    m("a2", "2026-03-01", 12, "lunch"),
    m("a3", "2026-03-01", 18, "dinner"),
    // 2 marzo: due tracciati e uno segnato come non tracciato -> incompleto ma dichiarato
    m("b1", "2026-03-02", 7, "breakfast"),
    m("b2", "2026-03-02", 12, "lunch"),
    untracked("b3", "2026-03-02T18:00:00Z", { kind: "dinner" }),
    // 3 marzo: nessuna voce di pasto (ma c'è dell'acqua) -> vuoto
    water("w", "2026-03-03T10:00:00Z", { ml: 200 }),
    // 4 marzo: manca la cena -> vuoto
    m("d1", "2026-03-04", 7, "breakfast"),
    m("d2", "2026-03-04", 12, "lunch"),
    // 5 marzo: uno tracciato e uno non tracciato -> ancora vuoto
    m("e1", "2026-03-05", 7, "breakfast"),
    untracked("e2", "2026-03-05T12:00:00Z", { kind: "lunch" }),
    // 6 marzo: tre dichiarati non tracciati -> dichiarato
    untracked("f1", "2026-03-06T07:00:00Z", { kind: "breakfast" }),
    untracked("f2", "2026-03-06T12:00:00Z", { kind: "lunch" }),
    untracked("f3", "2026-03-06T18:00:00Z", { kind: "dinner" }),
    // 7 marzo: nessuna voce; 8 marzo: pasti completi
    m("h1", "2026-03-08", 7, "breakfast"),
    m("h2", "2026-03-08", 12, "lunch"),
    m("h3", "2026-03-08", 18, "dinner"),
  ];
  const state = deriveDiary(events);

  it("classifica ogni giorno", () => {
    const cov = trackingCoverage(state);
    expect(cov.days.map((d) => [d.date, d.status, d.tracked, d.untracked])).toEqual([
      ["2026-03-01", "complete", 3, 0],
      ["2026-03-02", "declared", 2, 1],
      ["2026-03-03", "gaps", 0, 0],
      ["2026-03-04", "gaps", 2, 0],
      ["2026-03-05", "gaps", 1, 1],
      ["2026-03-06", "declared", 0, 3],
      ["2026-03-07", "gaps", 0, 0],
      ["2026-03-08", "complete", 3, 0],
    ]);
    expect([cov.complete, cov.declared, cov.gaps]).toEqual([2, 2, 4]);
  });

  it("un pasto non tracciato non è un vuoto, ma rende il giorno incompleto", () => {
    expect(dayCoverage(getDay(state, "2026-03-02"), "2026-03-02").status).toBe("declared");
    expect(dayCoverage(undefined, "2026-04-01")).toEqual({
      date: "2026-04-01",
      status: "gaps",
      tracked: 0,
      untracked: 0,
      missing: ["breakfast", "lunch", "dinner"],
    });
  });

  it("rispetta l'intervallo e annullare un pasto lo toglie dal conteggio", () => {
    const cov = trackingCoverage(state, { from: "2026-03-07", to: "2026-03-09" });
    expect(cov.days.map((d) => d.status)).toEqual(["gaps", "complete", "gaps"]);
    const voided = deriveDiary([...events, voidOf("v", "2026-03-09T00:00:00Z", "a3")]);
    expect(trackingCoverage(voided, { from: "2026-03-01", to: "2026-03-01" }).days[0].status).toBe("gaps");
    const restored = deriveDiary([
      ...events,
      voidOf("v", "2026-03-09T00:00:00Z", "a3"),
      voidOf("v2", "2026-03-09T00:01:00Z", "v"),
    ]);
    expect(trackingCoverage(restored, { from: "2026-03-01", to: "2026-03-01" }).days[0].status).toBe("complete");
    expect(trackingCoverage(deriveDiary([]))).toEqual({ days: [], complete: 0, declared: 0, gaps: 0 });
  });

  it("conta i tipi di pasto, non il numero: colazione più due spuntini non è un giorno completo", () => {
    const status = (events: unknown[]) => trackingCoverage(deriveDiary(events)).days[0];
    const at = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00Z`;
    const mk = (id: string, h: number, kind: "breakfast" | "lunch" | "dinner" | "snack") =>
      meal(id, at(h), { mealId: id, kind });

    const snacks = status([mk("a", 7, "breakfast"), mk("b", 10, "snack"), mk("c", 16, "snack")]);
    expect(snacks).toEqual({
      date: "2026-03-01",
      status: "gaps",
      tracked: 3,
      untracked: 0,
      missing: ["lunch", "dinner"],
    });

    // Tre pranzi non fanno colazione e cena; un tipo conta una volta sola.
    expect(status([mk("a", 11, "lunch"), mk("b", 12, "lunch"), mk("c", 13, "lunch")]).missing).toEqual([
      "breakfast",
      "dinner",
    ]);

    // Colazione, pranzo e cena più spuntini: completo; gli spuntini non cambiano nulla.
    const full = [mk("a", 7, "breakfast"), mk("b", 12, "lunch"), mk("c", 19, "dinner")];
    expect(status(full).status).toBe("complete");
    expect(status([...full, mk("d", 16, "snack")])).toEqual(
      expect.objectContaining({ status: "complete", tracked: 4, missing: [] }),
    );
    // Gli spuntini dichiarati non tracciati non contano nemmeno loro.
    expect(
      status([mk("a", 7, "breakfast"), mk("b", 12, "lunch"), untracked("u", at(16), { kind: "snack" })]).status,
    ).toBe("gaps");
  });

  it("declared: i tre tipi ci sono, ma almeno uno solo come pasto non tracciato", () => {
    const at = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00Z`;
    const b = meal("b", at(7), { mealId: "b", kind: "breakfast" });
    const l = meal("l", at(12), { mealId: "l", kind: "lunch" });
    const d = meal("d", at(19), { mealId: "d", kind: "dinner" });
    const u = (id: string, h: number, kind: "breakfast" | "lunch" | "dinner") =>
      untracked(id, at(h), { kind });
    const cov = (events: unknown[]) => trackingCoverage(deriveDiary(events)).days[0].status;
    expect(cov([b, l, u("u", 19, "dinner")])).toBe("declared");
    expect(cov([u("x", 7, "breakfast"), u("y", 12, "lunch"), u("z", 19, "dinner")])).toBe("declared");
    // Se un tipo è tracciato, un segnaposto non tracciato dello stesso tipo non toglie la completezza.
    expect(cov([b, l, d, u("u", 20, "dinner")])).toBe("complete");
    // Un tipo mancante resta un vuoto, anche con gli altri dichiarati.
    expect(cov([b, u("y", 12, "lunch")])).toBe("gaps");
    // Annullare il segnaposto riapre il vuoto.
    expect(cov([b, l, u("u", 19, "dinner"), voidOf("v", at(21), "u")])).toBe("gaps");
  });

  it("i pasti a cavallo della mezzanotte italiana contano nel giorno italiano", () => {
    // 23:30 UTC di gennaio sono le 00:30 del giorno dopo a Roma.
    const s = deriveDiary([
      meal("x1", "2026-01-15T22:00:00Z", { mealId: "x1", kind: "dinner" }),
      meal("x2", "2026-01-15T23:30:00Z", { mealId: "x2", kind: "snack" }),
    ]);
    expect(trackingCoverage(s).days.map((d) => [d.date, d.tracked])).toEqual([
      ["2026-01-15", 1],
      ["2026-01-16", 1],
    ]);
  });
});

describe("habitsToPropose", () => {
  const def = (habitId: string, kind: "breakfast" | "lunch" | "dinner" | "snack", usualTime?: string) =>
    habit(`def-${habitId}`, "2026-03-01T08:00:00Z", {
      habitId,
      title: `Abituale ${habitId}`,
      kind,
      items: [],
      ...(usualTime ? { usualTime } : {}),
    } as never);
  const base = [
    def("col", "breakfast", "07:30"),
    def("pra", "lunch", "13:00"),
    def("cen", "dinner", "20:30"),
    def("notte", "snack", "23:50"),
  ];
  const ids = (events: unknown[], at: string, options?: { windowMinutes?: number }) =>
    habitsToPropose(deriveDiary(events), at, options).map((h) => h.habitId);

  it("propone i pasti abituali vicini all'ora, letta nel fuso dello stato", () => {
    // 06:45 UTC = 07:45 a Roma (inverno)
    expect(ids(base, "2026-01-15T06:45:00Z")).toEqual(["col"]);
    // 11:30 UTC = 12:30 a Roma: il pranzo è entro 90 minuti
    expect(ids(base, "2026-01-15T11:30:00Z")).toEqual(["pra"]);
    // 15:00 UTC = 16:00 a Roma: nessuno
    expect(ids(base, "2026-01-15T15:00:00Z")).toEqual([]);
    // d'estate la stessa ora UTC è un'ora più tardi
    expect(ids(base, "2026-07-15T06:45:00Z")).toEqual(["col"]);
    expect(ids(base, "2026-07-15T05:00:00Z")).toEqual(["col"]); // 07:00
    expect(ids(base, "2026-07-15T04:00:00Z")).toEqual(["col"]); // 06:00: esattamente 90 minuti
    expect(ids(base, "2026-07-15T03:59:00Z")).toEqual([]); // 05:59: oltre la finestra
  });

  it("ordina per vicinanza all'ora e rispetta la finestra", () => {
    const two = [def("a", "snack", "12:00"), def("b", "snack", "12:40"), def("c", "snack", "11:50")];
    // 12:30 a Roma = 11:30 UTC
    expect(ids(two, "2026-01-15T11:30:00Z", { windowMinutes: 60 })).toEqual(["b", "a", "c"]);
    expect(ids(two, "2026-01-15T11:30:00Z", { windowMinutes: 30 })).toEqual(["b", "a"]);
    expect(ids(two, "2026-01-15T11:30:00Z", { windowMinutes: 20 })).toEqual(["b"]);
    expect(ids(two, "2026-01-15T11:30:00Z", { windowMinutes: 0 })).toEqual([]);
  });

  it("l'ora si confronta passando per la mezzanotte", () => {
    // 00:10 a Roma (inverno) = 23:10 UTC del giorno prima: distanza 20 minuti da 23:50
    expect(ids(base, "2026-01-15T23:10:00Z")).toEqual(["notte"]);
  });

  it("senza ora abituale usa quella tipica del tipo di pasto", () => {
    const state = [def("x", "breakfast"), def("y", "dinner")];
    expect(ids(state, "2026-01-15T07:00:00Z")).toEqual(["x"]); // 08:00 a Roma
    expect(ids(state, "2026-01-15T19:00:00Z")).toEqual(["y"]); // 20:00 a Roma
  });

  it("non ripropone un pasto già fatto oggi", () => {
    const at = "2026-01-15T06:45:00Z"; // 07:45 a Roma, giorno 15
    const done = meal("m", "2026-01-15T06:30:00Z", {
      mealId: "m",
      kind: "breakfast",
      habitId: "col",
    });
    expect(ids([...base, done], at)).toEqual([]);
    // un pasto dello stesso tipo, anche senza habitId, vale come già fatto
    const other = meal("m", "2026-01-15T06:30:00Z", { mealId: "m", kind: "breakfast" });
    expect(ids([...base, other], at)).toEqual([]);
    // anche un pasto segnato come non tracciato
    expect(ids([...base, untracked("u", "2026-01-15T06:00:00Z", { kind: "breakfast" })], at)).toEqual([]);
    // un pasto di ieri non conta
    const yesterday = meal("m", "2026-01-14T06:30:00Z", { mealId: "m", kind: "breakfast" });
    expect(ids([...base, yesterday], at)).toEqual(["col"]);
    // un pasto annullato non conta
    expect(ids([...base, done, voidOf("v", "2026-01-15T07:00:00Z", "m")], at)).toEqual(["col"]);
    // gli spuntini si possono ripetere
    const snack = def("sp", "snack", "07:30");
    const snackDone = meal("s", "2026-01-15T06:30:00Z", { mealId: "s", kind: "snack" });
    expect(ids([snack, snackDone], at)).toEqual(["sp"]);
  });

  it("non propone pasti ritirati e tollera istanti non validi", () => {
    const archived = habit("arch", "2026-03-02T08:00:00Z", {
      habitId: "col",
      title: "x",
      kind: "breakfast",
      items: [],
      archived: true,
    });
    expect(ids([...base, archived], "2026-01-15T06:45:00Z")).toEqual([]);
    expect(ids(base, "ieri")).toEqual([]);
  });
});
