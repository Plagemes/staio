import { describe, expect, it } from "vitest";
import { deriveDiary, getDay } from "@/core/diary";
import { declaration, drink, meal, water } from "@/core/diary/test-helpers";
import { dayStatusLine, diaryTitle } from "./dayStatus";

const DAY = "2026-11-16";
const rome = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${DAY}T${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
};
const at = (h: number, m = 0) => h * 60 + m;
const dayOf = (events: unknown[]) => getDay(deriveDiary(events, { timeZone: "Europe/Rome" }), DAY);

const breakfast = meal("m-b", rome("08:10"), { mealId: "b", kind: "breakfast" });
const lunch = meal("m-l", rome("13:00"), { mealId: "l", kind: "lunch" });
const dinner = meal("m-d", rome("20:00"), { mealId: "d", kind: "dinner" });
const snack = meal("m-s", rome("16:30"), { mealId: "s", kind: "snack" });
const tea = drink("t1", rome("13:11"), { name: "Tè", ml: 200 });
const declare = (kind: "breakfast" | "lunch" | "dinner", status: "skipped" | "untracked") =>
  declaration(`d-${kind}`, rome("21:30"), { date: DAY, kind, status });

describe("dayStatusLine: la riga di stato del diario", () => {
  it("niente del tutto", () => {
    expect(dayStatusLine(undefined, { nowMinutes: at(13) })).toBe("Ancora niente registrato oggi.");
    expect(dayStatusLine(undefined, {})).toBe("Niente registrato in questo giorno.");
  });

  it("solo bevande o acqua: le bevande contano, il giorno non è «niente»", () => {
    expect(dayStatusLine(dayOf([tea]), { nowMinutes: at(13, 30) })).toBe("Per ora solo bevande.");
    expect(dayStatusLine(dayOf([water("w1", rome("09:00"), { ml: 200 })]), { nowMinutes: at(13, 30) })).toBe("Per ora solo bevande.");
    expect(dayStatusLine(dayOf([tea]), {})).toBe("Solo bevande.");
  });

  it("manca un momento cominciato, o più d'uno", () => {
    expect(dayStatusLine(dayOf([lunch]), { nowMinutes: at(13, 30) })).toBe("Manca la colazione.");
    expect(dayStatusLine(dayOf([breakfast]), { nowMinutes: at(13, 30) })).toBe("Manca il pranzo.");
    expect(dayStatusLine(dayOf([breakfast, lunch]), { nowMinutes: at(21) })).toBe("Manca la cena.");
    expect(dayStatusLine(dayOf([snack]), { nowMinutes: at(17) })).toBe("Mancano colazione e pranzo.");
    expect(dayStatusLine(dayOf([snack]), { nowMinutes: at(21) })).toBe("Mancano colazione, pranzo e cena.");
  });

  it("una bevanda dentro un momento non lo riempie", () => {
    expect(dayStatusLine(dayOf([breakfast, tea]), { nowMinutes: at(13, 30) })).toBe("Manca il pranzo.");
  });

  it("i momenti non ancora cominciati non contano", () => {
    expect(dayStatusLine(dayOf([breakfast]), { nowMinutes: at(9) })).toBe("Fin qui tutto registrato.");
    expect(dayStatusLine(dayOf([breakfast]), { nowMinutes: at(10, 29) })).toBe("Fin qui tutto registrato.");
    expect(dayStatusLine(dayOf([breakfast]), { nowMinutes: at(10, 30) })).toBe("Manca il pranzo.");
    expect(dayStatusLine(dayOf([breakfast, declare("lunch", "skipped")]), { nowMinutes: at(16) })).toBe("Fin qui tutto registrato.");
  });

  it("colazione, pranzo e cena registrati o saltati: giornata completa", () => {
    expect(dayStatusLine(dayOf([breakfast, lunch, dinner]), { nowMinutes: at(21) })).toBe("Giornata completa.");
    expect(dayStatusLine(dayOf([breakfast, declare("lunch", "skipped"), dinner]), { nowMinutes: at(21) })).toBe("Giornata completa.");
  });

  it("nessun momento manca ma uno è «mangiato, senza dettagli»: giornata dichiarata", () => {
    expect(dayStatusLine(dayOf([breakfast, declare("lunch", "untracked"), dinner]), { nowMinutes: at(21) })).toBe(
      "Giornata dichiarata: pranzo senza dettagli. Il totale è incompleto.",
    );
    expect(dayStatusLine(dayOf([declare("breakfast", "untracked"), declare("lunch", "untracked"), dinner]), {})).toBe(
      "Giornata dichiarata: colazione e pranzo senza dettagli. Il totale è incompleto.",
    );
  });

  it("un giorno passato conta tutti e tre i momenti", () => {
    expect(dayStatusLine(dayOf([breakfast]), {})).toBe("Mancano pranzo e cena.");
    expect(dayStatusLine(dayOf([breakfast, lunch, dinner]), {})).toBe("Giornata completa.");
  });

  it("non parla mai di digiuno", () => {
    expect(dayStatusLine(dayOf([snack]), { nowMinutes: at(21) })).not.toMatch(/digiun|saltat/i);
  });
});

describe("diaryTitle", () => {
  it("oggi e un giorno passato", () => {
    expect(diaryTitle("2026-11-17", "2026-11-17")).toBe("Diario di oggi");
    expect(diaryTitle("2026-11-16", "2026-11-17")).toBe("Diario di lunedì 16");
    expect(diaryTitle("2026-11-01", "2026-11-17")).toBe("Diario di domenica 1");
  });
});
