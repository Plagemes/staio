import { describe, expect, it } from "vitest";
import { deriveDiary, getDay, drinksByMoment } from "@/core/diary";
import { buildUndo } from "./actions";
import { buildDrink, drinkCounts, drinkDetail, drinkMomentWord, inputOfPreset, retimeDrink, shortTime } from "./drinks";
import { DRINK_PRESETS } from "./health";

// 08:12 a Roma
const NOW = "2026-11-16T07:12:00.000Z";
const ctx = (now = NOW) => ({ now, deviceId: "d", timeZone: "Europe/Rome" });
const tea = DRINK_PRESETS.find((p) => p.id === "tea")!;

function drinksOf(events: unknown[], date = "2026-11-16") {
  return getDay(deriveDiary(events, { timeZone: "Europe/Rome" }), date)?.drinks ?? [];
}

describe("buildDrink", () => {
  it("riscontro chiaro: nome, ora e momento", () => {
    const r = buildDrink(inputOfPreset(tea), ctx());
    expect(r.message).toBe("Segnato: tè, alle 8:12 · colazione");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "drink", name: "Tè", ml: 200, caffeineMg: 40, energyKcal: 1, certainty: "estimated" });
  });

  it("di un giorno passato il giorno va in coda", () => {
    const r = buildDrink(inputOfPreset(tea), { ...ctx(), dayLabel: "ieri" });
    expect(r.message).toBe("Segnato: tè, alle 8:12 · colazione · ieri");
  });

  it("il momento segue l'ora, con «spuntino» a metà pomeriggio", () => {
    expect(drinkMomentWord("2026-11-16T11:00:00.000Z", "Europe/Rome")).toBe("pranzo"); // 12:00
    expect(drinkMomentWord("2026-11-16T16:00:00.000Z", "Europe/Rome")).toBe("spuntino"); // 17:00
    expect(drinkMomentWord("2026-11-16T19:30:00.000Z", "Europe/Rome")).toBe("cena"); // 20:30
    expect(shortTime("2026-11-16T07:05:00.000Z", "Europe/Rome")).toBe("8:05");
  });

  it("le scelte rapide valgono come stime e portano energia e zuccheri se li hanno", () => {
    const cola = buildDrink(inputOfPreset(DRINK_PRESETS.find((p) => p.id === "cola")!), ctx()).events[0];
    expect(cola).toMatchObject({ energyKcal: 139, sugarsG: 35, certainty: "estimated" });
  });
});

describe("doppio tocco e annulla", () => {
  it("due tocchi involontari danno due voci, ma il conteggio le mostra: «Tè × 2»", () => {
    const a = buildDrink(inputOfPreset(tea), ctx()).events[0];
    const b = buildDrink(inputOfPreset(tea), ctx("2026-11-16T07:12:01.000Z")).events[0];
    const drinks = drinksOf([a, b]);
    expect(drinks).toHaveLength(2);
    expect(drinkCounts(drinks)).toBe("Tè × 2");
    expect(drinkCounts([{ name: "Tè" }, { name: "Caffè espresso" }])).toBe("Tè, Caffè espresso");
  });

  it("«Annulla» toglie la bevanda con un void; annullare l'annullamento la riporta", () => {
    const [drink] = buildDrink(inputOfPreset(tea), ctx()).events;
    const [v] = buildUndo([drink], { now: NOW, deviceId: "d" });
    expect(drinksOf([drink, v])).toHaveLength(0);
    const [back] = buildUndo([v], { now: "2026-11-16T07:13:00.000Z", deviceId: "d" });
    expect(drinksOf([drink, v, back])).toHaveLength(1);
  });
});

describe("retimeDrink: «l'ho bevuto prima»", () => {
  const [original] = buildDrink(inputOfPreset(tea), ctx("2026-11-16T09:00:00.000Z")).events; // 10:00 a Roma
  const originalDrink = () => drinksOf([original])[0];

  it("annulla la voce vecchia e ne scrive una nuova alle ore indicate, con gli stessi valori", () => {
    const r = retimeDrink(originalDrink(), "2026-11-16", "08:15", ctx("2026-11-16T09:30:00.000Z"));
    if (!r.ok) throw new Error(r.error);
    expect(r.message).toBe("Tè spostato alle 8:15 · colazione");
    const drinks = drinksOf([original, ...r.events]);
    expect(drinks).toHaveLength(1);
    expect(drinks[0]).toMatchObject({ name: "Tè", ml: 200, caffeineMg: 40, certainty: "estimated", at: "2026-11-16T07:15:00.000Z" });
    expect(drinksByMoment(getDay(deriveDiary([original, ...r.events], { timeZone: "Europe/Rome" }), "2026-11-16"), "Europe/Rome").breakfast).toHaveLength(1);
  });

  it("«Annulla» sull'avviso riporta la voce com'era", () => {
    const r = retimeDrink(originalDrink(), "2026-11-16", "08:15", ctx("2026-11-16T09:30:00.000Z"));
    if (!r.ok) throw new Error(r.error);
    const undo = buildUndo(r.events, { now: "2026-11-16T09:31:00.000Z", deviceId: "d" });
    const drinks = drinksOf([original, ...r.events, ...undo]);
    expect(drinks).toHaveLength(1);
    expect(drinks[0].at).toBe(original.at);
  });

  it("rifiuta un'ora non valida o non ancora passata", () => {
    expect(retimeDrink(originalDrink(), "2026-11-16", "8 e un quarto", ctx())).toEqual({ ok: false, error: "Scrivi l'ora come 08:15." });
    expect(retimeDrink(originalDrink(), "2026-11-16", "23:00", ctx("2026-11-16T09:30:00.000Z"))).toEqual({
      ok: false,
      error: "Quest'ora non è ancora passata.",
    });
  });
});

describe("drinkDetail", () => {
  it("le stime portano la tilde; l'alcol usa la virgola", () => {
    const [beer] = buildDrink(inputOfPreset(DRINK_PRESETS.find((p) => p.id === "beer")!), ctx()).events;
    const d = drinksOf([beer])[0];
    expect(drinkDetail(d)).toEqual({ text: "Birra, 330 ml · alcol ~13 g", estimated: true });
  });
});
