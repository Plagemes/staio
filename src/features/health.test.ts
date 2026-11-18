import { describe, expect, it } from "vitest";
import { createMood, createSupplement, createSymptom, createWater, createWeight, deriveDiary, type SymptomKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import {
  alcoholGrams,
  averageChange,
  buildScoreEvents,
  buildWeightChart,
  DRINK_PRESETS,
  formatKg,
  formatMl,
  parseWaterAmount,
  parseWaterGoal,
  parseWeightKg,
  lastSupplementDose,
  recentSupplementNames,
  scoreAverages,
  supplementDays,
  waterWeek,
} from "./health";

const TODAY = "2026-11-16";
const weight = (date: string, kg: number): AnyEvent =>
  createWeight({ kg }, { deviceId: "d", at: `${date}T09:00:00.000Z`, now: () => `${date}T09:00:00.000Z` });
const at = (date: string, time: string) => ({ deviceId: "d", at: `${date}T${time}:00.000Z`, now: () => `${date}T${time}:00.000Z` });
const supplement = (date: string, name: string, dose?: string, time = "09:00"): AnyEvent =>
  createSupplement({ name, ...(dose ? { dose } : {}) }, at(date, time));
const mood = (date: string, score: number, time = "09:00"): AnyEvent => createMood({ score }, at(date, time));
const symptom = (date: string, kind: SymptomKind, score: number, time = "09:00"): AnyEvent => createSymptom({ kind, score }, at(date, time));
const water = (instant: string, ml: number): AnyEvent => createWater({ ml }, { deviceId: "d", at: instant, now: () => instant });

describe("acqua", () => {
  it("quantità scritte a mano", () => {
    expect(parseWaterAmount("300")).toEqual({ ok: true, value: 300 });
    expect(parseWaterAmount("0,5 l")).toEqual({ ok: true, value: 500 });
    expect(parseWaterAmount("250 ml")).toEqual({ ok: true, value: 250 });
  });

  it("rifiuta il resto con una spiegazione", () => {
    for (const bad of ["", "tanta", "2 g", "5", "20 l"]) {
      const r = parseWaterAmount(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("l'obiettivo: un numero piccolo vale come litri", () => {
    expect(parseWaterGoal("2")).toEqual({ ok: true, value: 2000 });
    expect(parseWaterGoal("2,5 l")).toEqual({ ok: true, value: 2500 });
    expect(parseWaterGoal("1800")).toEqual({ ok: true, value: 1800 });
    expect(parseWaterGoal("100").ok).toBe(false);
    expect(parseWaterGoal("30 l").ok).toBe(false);
  });

  it("formato", () => {
    expect(formatMl(200)).toBe("200 ml");
    expect(formatMl(1400)).toBe("1,4 l");
  });
});

describe("peso", () => {
  it("legge i chili con la virgola", () => {
    expect(parseWeightKg("71,4")).toEqual({ ok: true, value: 71.4 });
    expect(parseWeightKg("71.4 kg")).toEqual({ ok: true, value: 71.4 });
    expect(parseWeightKg("70")).toEqual({ ok: true, value: 70 });
  });

  it("rifiuta valori impossibili", () => {
    for (const bad of ["", "abc", "0", "600", "71,456", "-3"]) expect(parseWeightKg(bad).ok, bad).toBe(false);
  });

  it("formato", () => {
    expect(formatKg(71.44)).toBe("71,4 kg");
    expect(formatKg(70)).toBe("70,0 kg");
  });
});

describe("grafico del peso", () => {
  it("senza pesate: niente punti", () => {
    const chart = buildWeightChart(deriveDiary([]), TODAY);
    expect(chart).toMatchObject({ count: 0, enough: false, dots: [], average: [] });
    expect(chart.last).toBeUndefined();
  });

  it("pochi dati: i punti ci sono ma non si dichiara un andamento", () => {
    const chart = buildWeightChart(deriveDiary([weight("2026-11-10", 71), weight("2026-11-14", 70.8)]), TODAY);
    expect(chart.count).toBe(2);
    expect(chart.enough).toBe(false);
    expect(averageChange(chart)).toBeUndefined();
  });

  it("con abbastanza dati: coordinate dentro l'area e media mobile", () => {
    const events = [
      weight("2026-10-20", 72),
      weight("2026-10-27", 71.6),
      weight("2026-11-03", 71.2),
      weight("2026-11-10", 71),
      weight("2026-11-16", 70.6),
    ];
    const chart = buildWeightChart(deriveDiary(events), TODAY);
    expect(chart.enough).toBe(true);
    expect(chart.dots).toHaveLength(5);
    for (const p of [...chart.dots, ...chart.average]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(chart.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(chart.height);
    }
    // pesi più bassi stanno più in basso (y maggiore), giorni più recenti più a destra
    expect(chart.dots[4].y).toBeGreaterThan(chart.dots[0].y);
    expect(chart.dots[4].x).toBeGreaterThan(chart.dots[0].x);
    expect(chart.lastAverage?.samples).toBe(2);
    expect(averageChange(chart)).toBeLessThan(0);
  });

  it("fuori dai 30 giorni non conta", () => {
    const chart = buildWeightChart(deriveDiary([weight("2026-09-01", 75), weight("2026-11-15", 70)]), TODAY);
    expect(chart.count).toBe(1);
  });

  it("una scala mai più stretta di un chilo", () => {
    const events = [weight("2026-11-01", 70), weight("2026-11-08", 70.1), weight("2026-11-15", 70.05)];
    const chart = buildWeightChart(deriveDiary(events), TODAY);
    expect(chart.yMax - chart.yMin).toBeGreaterThanOrEqual(1);
  });
});

describe("bevande e integratori", () => {
  it("l'alcol dalla gradazione", () => {
    expect(alcoholGrams(330, 5)).toBe(13);
    expect(alcoholGrams(150, 12)).toBe(14.2);
    const beer = DRINK_PRESETS.find((p) => p.id === "beer");
    expect(beer?.alcoholG).toBe(13);
    expect(beer?.caffeineMg).toBeUndefined();
  });

  it("integratori recenti, dal più frequente", () => {
    const events = [
      supplement("2026-11-14", "Vitamina D"),
      supplement("2026-11-15", "Magnesio"),
      supplement("2026-11-16", "vitamina d"),
      supplement("2026-09-01", "Ferro"),
    ];
    // lo stesso integratore scritto in due modi è una riga sola, con il nome scritto l'ultima volta
    expect(recentSupplementNames(deriveDiary(events), TODAY)).toEqual(["vitamina d", "Magnesio"]);
  });

  it("integratori recenti: spazi in più e maiuscole non fanno due righe", () => {
    const events = [
      supplement("2026-11-13", "Vitamina  D", "1 capsula"),
      supplement("2026-11-15", " vitamina d "),
      supplement("2026-11-16", "Vitamina D", "2 capsule"),
      supplement("2026-11-14", "Magnesio"),
    ];
    const diary = deriveDiary(events);
    const names = recentSupplementNames(diary, TODAY);
    expect(names).toEqual(["Vitamina D", "Magnesio"]);
    expect(lastSupplementDose(diary, names[0])).toBe("2 capsule");
  });
});

describe("la dose dell'ultima volta", () => {
  it("il nome si confronta senza maiuscole né spazi in più", () => {
    const diary = deriveDiary([supplement("2026-11-14", "Vitamina D", "1 capsula")]);
    expect(lastSupplementDose(diary, "  VITAMINA   d ")).toBe("1 capsula");
    expect(lastSupplementDose(diary, "Magnesio")).toBeUndefined();
  });

  it("più dosi nel tempo: vale l'ultima, anche nello stesso giorno", () => {
    const diary = deriveDiary([
      supplement("2026-11-10", "Magnesio", "1 bustina"),
      supplement("2026-11-15", "Magnesio", "2 bustine", "08:00"),
      supplement("2026-11-15", "magnesio", "mezza bustina", "21:00"),
    ]);
    expect(lastSupplementDose(diary, "Magnesio")).toBe("mezza bustina");
  });

  it("se l'ultima volta la dose non c'era, non se ne propone una più vecchia", () => {
    const diary = deriveDiary([supplement("2026-11-10", "Ferro", "1 compressa"), supplement("2026-11-15", "Ferro")]);
    expect(lastSupplementDose(diary, "Ferro")).toBeUndefined();
  });
});

describe("medie di «Come sto»", () => {
  it("sotto i tre giorni conta i giorni e non dà una media", () => {
    const diary = deriveDiary([mood("2026-11-15", 4), mood("2026-11-16", 2)]);
    expect(scoreAverages(diary, TODAY)).toEqual([
      { measure: "mood", days: 2 },
      { measure: "energy", days: 0 },
      { measure: "digestion", days: 0 },
      { measure: "sleep", days: 0 },
    ]);
  });

  it("con tre giorni su sette dà la media, misura per misura", () => {
    const diary = deriveDiary([
      mood("2026-11-12", 4),
      mood("2026-11-14", 4),
      mood("2026-11-16", 3),
      symptom("2026-11-14", "sleep", 4),
      symptom("2026-11-15", "sleep", 4),
      symptom("2026-11-16", "sleep", 4),
      symptom("2026-11-16", "energy", 5),
      symptom("2026-11-16", "other", 1),
    ]);
    const byMeasure = Object.fromEntries(scoreAverages(diary, TODAY).map((a) => [a.measure, a]));
    // (4 + 4 + 3) / 3 = 3,666…: una cifra dopo la virgola
    expect(byMeasure.mood).toEqual({ measure: "mood", days: 3, average: 3.7 });
    expect(byMeasure.sleep).toEqual({ measure: "sleep", days: 3, average: 4 });
    expect(byMeasure.energy).toEqual({ measure: "energy", days: 1 });
    expect(byMeasure.digestion).toEqual({ measure: "digestion", days: 0 });
  });

  it("due valori nello stesso giorno: il giorno conta una volta, con l'ultimo valore", () => {
    const diary = deriveDiary([
      mood("2026-11-14", 5),
      mood("2026-11-15", 5),
      mood("2026-11-16", 1, "08:00"),
      mood("2026-11-16", 4, "19:00"),
    ]);
    // (5 + 5 + 4) / 3, non (5 + 5 + 1 + 4) / 4
    expect(scoreAverages(diary, TODAY)[0]).toEqual({ measure: "mood", days: 3, average: 4.7 });
  });

  it("fuori dai sette giorni non conta", () => {
    const diary = deriveDiary([mood("2026-11-09", 1), mood("2026-11-10", 4), mood("2026-11-11", 4), mood("2026-11-12", 4)]);
    expect(scoreAverages(diary, TODAY)[0]).toEqual({ measure: "mood", days: 3, average: 4 });
  });
});

describe("«Come sto»: gli eventi da scrivere insieme", () => {
  const ctx = { deviceId: "d", now: "2026-11-16T09:00:00.000Z" };

  it("una sola scelta: un evento solo", () => {
    const events = buildScoreEvents({ sleep: 4 }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "symptom", kind: "sleep", score: 4, at: ctx.now });
  });

  it("un umore e fino a tre sintomi, nell'ordine di sempre e alla stessa ora", () => {
    const events = buildScoreEvents({ sleep: 2, mood: 4, digestion: 5, energy: 3 }, ctx);
    expect(events.map((e) => e.type)).toEqual(["mood", "symptom", "symptom", "symptom"]);
    expect(events.map((e) => (e.type === "symptom" ? e.kind : e.type))).toEqual(["mood", "energy", "digestion", "sleep"]);
    expect(new Set(events.map((e) => e.at))).toEqual(new Set([ctx.now]));
    expect(new Set(events.map((e) => e.id)).size).toBe(4);
  });

  it("niente scelto: niente da scrivere", () => {
    expect(buildScoreEvents({}, ctx)).toEqual([]);
  });

  it("il diario li legge tutti nello stesso giorno", () => {
    const day = deriveDiary(buildScoreEvents({ mood: 4, energy: 3 }, ctx)).days[0];
    expect(day.moods.map((m) => m.score)).toEqual([4]);
    expect(day.symptoms.map((s) => [s.kind, s.score])).toEqual([["energy", 3]]);
  });
});

describe("integratori della settimana", () => {
  it("conta i giorni, non le volte, dal più costante", () => {
    const diary = deriveDiary([
      supplement("2026-11-09", "Vitamina D"),
      supplement("2026-11-14", "Magnesio"),
      supplement("2026-11-15", "Vitamina D", undefined, "08:00"),
      supplement("2026-11-15", "vitamina d", undefined, "20:00"),
      supplement("2026-11-16", "Vitamina D"),
    ]);
    expect(supplementDays(diary, TODAY)).toEqual([
      { name: "Vitamina D", days: 2 },
      { name: "Magnesio", days: 1 },
    ]);
  });

  it("senza integratori: nessuna riga", () => {
    expect(supplementDays(deriveDiary([]), TODAY)).toEqual([]);
  });
});

describe("l'acqua della settimana", () => {
  it("sempre sette righe, dal più vecchio a oggi; i giorni senza acqua valgono zero", () => {
    const diary = deriveDiary([water("2026-11-12T10:00:00.000Z", 500), water("2026-11-12T15:00:00.000Z", 700), water("2026-11-01T10:00:00.000Z", 900)]);
    expect(waterWeek(diary, TODAY)).toEqual([
      { date: "2026-11-10", ml: 0 },
      { date: "2026-11-11", ml: 0 },
      { date: "2026-11-12", ml: 1200 },
      { date: "2026-11-13", ml: 0 },
      { date: "2026-11-14", ml: 0 },
      { date: "2026-11-15", ml: 0 },
      { date: "2026-11-16", ml: 0 },
    ]);
  });

  it("anche con il diario vuoto", () => {
    const week = waterWeek(deriveDiary([]), TODAY);
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.ml === 0)).toBe(true);
    expect(week[6].date).toBe(TODAY);
  });

  it("i giorni sono quelli del fuso del diario", () => {
    // le 23:30 UTC del 15 sono già il 16 a Roma, ancora il 15 a New York
    const glass = [water("2026-11-15T23:30:00.000Z", 300)];
    expect(waterWeek(deriveDiary(glass, { timeZone: "Europe/Rome" }), TODAY).at(-1)).toEqual({ date: "2026-11-16", ml: 300 });
    const newYork = waterWeek(deriveDiary(glass, { timeZone: "America/New_York" }), TODAY);
    expect(newYork.at(-1)).toEqual({ date: "2026-11-16", ml: 0 });
    expect(newYork.at(-2)).toEqual({ date: "2026-11-15", ml: 300 });
  });
});
