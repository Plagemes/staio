import { describe, expect, it } from "vitest";
import {
  mealDateError,
  mealInstant,
  mealTargetQuery,
  mealTimeError,
  parseMealTarget,
  pastDayText,
  proposedMealTime,
  registerTitle,
  appendTitle,
  submitLabel,
  todayEntryHref,
  todayHref,
  usualHeading,
  whenText,
} from "./mealTarget";

const at = (hh: number, mm = 0) => hh * 60 + mm;

describe("proposedMealTime", () => {
  it("9. alle 21 «Registra pranzo»: le 13:00, non adesso", () => {
    expect(proposedMealTime({ kind: "lunch", pastDate: null, nowMinutes: at(21) })).toBe("13:00");
    expect(proposedMealTime({ kind: "breakfast", pastDate: null, nowMinutes: at(21) })).toBe("08:00");
  });
  it("il momento dell'ora: adesso", () => {
    expect(proposedMealTime({ kind: "dinner", pastDate: null, nowMinutes: at(19, 55) })).toBe("19:55");
    expect(proposedMealTime({ kind: "breakfast", pastDate: null, nowMinutes: at(7, 5) })).toBe("07:05");
  });
  it("un momento diverso la cui ora tipica deve ancora venire: adesso", () => {
    expect(proposedMealTime({ kind: "dinner", pastDate: null, nowMinutes: at(17) })).toBe("17:00");
  });
  it("10. giorno passato: l'ora tipica del momento", () => {
    expect(proposedMealTime({ kind: "dinner", pastDate: "2026-11-14", nowMinutes: at(9) })).toBe("20:00");
    expect(proposedMealTime({ kind: "snack", pastDate: "2026-11-14", nowMinutes: at(9) })).toBe("16:30");
  });
  it("l'ora scritta vince sempre", () => {
    expect(proposedMealTime({ kind: "lunch", pastDate: null, nowMinutes: at(21), typed: "12:30" })).toBe("12:30");
    expect(proposedMealTime({ kind: "lunch", pastDate: "2026-11-14", nowMinutes: at(21), typed: "" })).toBe("");
  });
});

describe("giorno e ora del pasto", () => {
  it("il giorno: non oltre oggi, fino a 60 giorni indietro", () => {
    expect(mealDateError("2026-11-17", "2026-11-17")).toBeNull();
    expect(mealDateError("2026-09-18", "2026-11-17")).toBeNull();
    expect(mealDateError("2026-09-17", "2026-11-17")).toMatch(/60 giorni/);
    expect(mealDateError("2026-11-18", "2026-11-17")).not.toBeNull();
    expect(mealDateError("", "2026-11-17")).not.toBeNull();
  });
  it("l'ora: leggibile, e per oggi non dopo adesso", () => {
    expect(mealTimeError("13:00", true, at(21))).toBeNull();
    expect(mealTimeError("22:00", true, at(21))).not.toBeNull();
    expect(mealTimeError("22:00", false, at(21))).toBeNull();
    expect(mealTimeError("", false, 0)).toMatch(/Scrivi l'ora/);
  });
});

describe("testi della pagina", () => {
  it("titoli, pulsante e «Di solito»", () => {
    expect(registerTitle("dinner")).toBe("Registra cena");
    expect(registerTitle("snack")).toBe("Registra uno spuntino");
    expect(appendTitle("dinner")).toBe("Aggiungi a cena");
    expect(submitLabel("dinner", 2, false)).toBe("Registra cena (2)");
    expect(submitLabel("dinner", 0, false)).toBe("Registra cena");
    expect(submitLabel("snack", 1, false)).toBe("Registra spuntino (1)");
    expect(submitLabel("lunch", 2, true)).toBe("Aggiungi (2)");
    expect(usualHeading("dinner")).toBe("Di solito a cena");
  });
  it("quando, e la riga del giorno passato", () => {
    expect(whenText("2026-11-17", "2026-11-17", "19:55")).toBe("oggi · 19:55");
    expect(whenText("2026-11-16", "2026-11-17", "13:00")).toBe("ieri · 13:00");
    expect(pastDayText("2026-11-16", "2026-11-17")).toBe("Pasto di ieri. Gli alimenti della dispensa si scalano adesso.");
    expect(pastDayText("2026-11-14", "2026-11-17")).toBe("Pasto di 3 giorni fa. Gli alimenti della dispensa si scalano adesso.");
    expect(pastDayText("2026-11-01", "2026-11-17")).toBe("Pasto del 1 nov 2026. Gli alimenti della dispensa si scalano adesso.");
  });
  it("a Oggi sulla riga nuova", () => {
    expect(todayEntryHref(null, "ev-1")).toBe("/app?voce=ev-1");
    expect(todayEntryHref("2026-11-14", "ev-1")).toBe("/app?giorno=2026-11-14&voce=ev-1");
    expect(todayEntryHref(null, undefined)).toBe("/app");
  });
});

describe("parseMealTarget", () => {
  it("legge momento e giorno passato", () => {
    expect(parseMealTarget("lunch", "2026-11-14", "2026-11-17")).toEqual({ kind: "lunch", pastDate: "2026-11-14" });
  });
  it("ignora valori non validi, oggi e il futuro", () => {
    expect(parseMealTarget("brunch", "2026-11-17", "2026-11-17")).toEqual({ kind: null, pastDate: null });
    expect(parseMealTarget(null, "2026-11-20", "2026-11-17").pastDate).toBeNull();
    expect(parseMealTarget(null, "ieri", "2026-11-17").pastDate).toBeNull();
  });
});

describe("mealTargetQuery e todayHref", () => {
  it("porta avanti ciò che c'è", () => {
    expect(mealTargetQuery("dinner", "2026-11-14")).toBe("?momento=dinner&giorno=2026-11-14");
    expect(mealTargetQuery("dinner", null)).toBe("?momento=dinner");
    expect(mealTargetQuery(null, null)).toBe("");
  });
  it("torna a Oggi sul giorno giusto", () => {
    expect(todayHref(null)).toBe("/app");
    expect(todayHref("2026-11-14")).toBe("/app?giorno=2026-11-14");
  });
});

describe("mealInstant", () => {
  it("costruisce l'istante all'ora locale del giorno", () => {
    expect(mealInstant("2026-11-14", "13:00", "Europe/Rome")).toBe("2026-11-14T12:00:00.000Z");
    expect(mealInstant("2026-11-14", "boh", "Europe/Rome")).toBeUndefined();
  });
});
