import { describe, expect, it } from "vitest";
import { deriveDiary, getDay } from "@/core/diary";
import { buildUndo } from "./actions";
import { buildDrink, inputOfPreset } from "./drinks";
import { DRINK_PRESETS } from "./health";
import { buildMealDeclaration, momentOffer, momentTitle, momentsOf, summarizeDay, minutesOfTime } from "./meals";

const NOW = "2026-11-16T11:30:00.000Z"; // 12:30 a Roma
const ctx = { now: NOW, deviceId: "d" };
const TZ = { timeZone: "Europe/Rome" };
const stateOf = (events: unknown[]) => getDay(deriveDiary(events, TZ), "2026-11-16");

describe("buildMealDeclaration", () => {
  it("«Saltato»: un evento con la data, il momento e lo stato, e un avviso sobrio", () => {
    const r = buildMealDeclaration("2026-11-16", "lunch", "skipped", ctx);
    expect(r.message).toBe("Segnato: pranzo saltato.");
    expect(r.events[0]).toMatchObject({ type: "mealDeclaration", date: "2026-11-16", kind: "lunch", status: "skipped" });
  });

  it("l'avviso concorda con il genere del momento", () => {
    expect(buildMealDeclaration("2026-11-16", "breakfast", "skipped", ctx).message).toBe("Segnato: colazione saltata.");
    expect(buildMealDeclaration("2026-11-16", "dinner", "skipped", ctx).message).toBe("Segnato: cena saltata.");
    expect(buildMealDeclaration("2026-11-16", "breakfast", "untracked", ctx).message).toBe("Segnato: colazione mangiata, senza dettagli.");
    expect(buildMealDeclaration("2026-11-16", "lunch", "untracked", ctx).message).toBe("Segnato: pranzo mangiato, senza dettagli.");
  });

  it("«Mangiato, senza dettagli» dichiara che il dato manca", () => {
    const r = buildMealDeclaration("2026-11-16", "dinner", "untracked", ctx);
    expect(r.message).toBe("Segnato: cena mangiata, senza dettagli.");
  });

  it("«Annulla» toglie la dichiarazione; si può anche cambiare idea con una nuova", () => {
    const skipped = buildMealDeclaration("2026-11-16", "lunch", "skipped", ctx).events;
    const [v] = buildUndo(skipped, { now: "2026-11-16T11:31:00.000Z", deviceId: "d" });
    const status = (events: unknown[]) => momentsOf(stateOf(events)).find((m) => m.kind === "lunch")?.status;
    expect(status(skipped)).toBe("skipped");
    expect(status([...skipped, v])).toBe("none");
    const changed = buildMealDeclaration("2026-11-16", "lunch", "untracked", { ...ctx, now: "2026-11-16T11:32:00.000Z" }).events;
    expect(status([...skipped, ...changed])).toBe("untracked");
  });

  it("segnare il passato: la dichiarazione va alla data indicata, non a oggi", () => {
    const r = buildMealDeclaration("2026-11-14", "lunch", "skipped", ctx);
    const state = deriveDiary(r.events, TZ);
    expect(state.days.map((d) => d.date)).toEqual(["2026-11-14"]);
  });
});

describe("momentOffer: quando proporre «Saltato»", () => {
  const at = (h: number, m = 0) => h * 60 + m;
  it("non mostra nulla prima della fascia del momento", () => {
    expect(momentOffer("lunch", at(9))).toBe("hidden");
    expect(momentOffer("dinner", at(15))).toBe("hidden");
  });
  it("nella fascia propone solo di registrare; «Saltato» solo dopo l'orario abituale", () => {
    expect(momentOffer("lunch", at(11))).toBe("register");
    expect(momentOffer("lunch", at(14, 29))).toBe("register");
    expect(momentOffer("lunch", at(14, 30))).toBe("declare");
    expect(momentOffer("dinner", at(20))).toBe("register");
    expect(momentOffer("dinner", at(21))).toBe("declare");
    expect(momentOffer("breakfast", at(10))).toBe("declare");
  });
  it("con un pasto abituale conta il suo orario più un'ora e mezza", () => {
    expect(momentOffer("lunch", at(13, 59), { usualTime: "12:30" })).toBe("register");
    expect(momentOffer("lunch", at(14), { usualTime: "12:30" })).toBe("declare");
    // un orario abituale tardivo non sposta oltre la fine della fascia tipica
    expect(momentOffer("dinner", at(21), { usualTime: "22:00" })).toBe("declare");
  });
  it("un giorno passato offre sempre tutto", () => {
    expect(momentOffer("dinner", at(8), { pastDay: true })).toBe("declare");
  });
  it("legge gli orari come 12:30", () => {
    expect(minutesOfTime("12:30")).toBe(750);
    expect(minutesOfTime("8.05")).toBe(485);
    expect(minutesOfTime("25:00")).toBeUndefined();
  });
});

describe("momentTitle: lo stato resta scritto", () => {
  it("«Pranzo · saltato» e «Colazione · solo una bevanda: tè»", () => {
    expect(momentTitle("lunch", "skipped")).toBe("Pranzo · saltato");
    expect(momentTitle("dinner", "untracked")).toBe("Cena · mangiato, senza dettagli");
    expect(momentTitle("breakfast", "none", ["Tè"])).toBe("Colazione · solo una bevanda: tè");
    expect(momentTitle("breakfast", "none", ["Tè", "Caffè espresso"])).toBe("Colazione · solo bevande: tè, caffè espresso");
    expect(momentTitle("lunch", "none")).toBe("Pranzo");
  });
  it("«saltato» con una bevanda dice che c'è una bevanda", () => {
    expect(momentTitle("lunch", "skipped", ["Cola"])).toBe("Pranzo · saltato · bevanda: cola");
  });
});

describe("una bevanda non è un pasto registrato", () => {
  const tea = DRINK_PRESETS.find((p) => p.id === "tea")!;
  const events = buildDrink(inputOfPreset(tea), { now: "2026-11-16T07:12:00.000Z", deviceId: "d", timeZone: "Europe/Rome" }).events;

  it("con il solo tè, la colazione resta un momento senza pasto", () => {
    const moment = momentsOf(stateOf(events)).find((m) => m.kind === "breakfast");
    expect(moment?.status).toBe("none");
    expect(summarizeDay(stateOf(events)).missing).toContain("breakfast");
  });
});

describe("summarizeDay con i momenti saltati", () => {
  const meal = (kind: "breakfast" | "dinner", at: string, id: string) => ({
    id,
    type: "meal",
    at,
    recordedAt: at,
    deviceId: "d",
    schemaVersion: 1,
    certainty: "estimated",
    source: "manual",
    mealId: id,
    kind,
  });
  const day = (extra: unknown[]) =>
    summarizeDay(stateOf([meal("breakfast", "2026-11-16T07:00:00.000Z", "b"), meal("dinner", "2026-11-16T18:30:00.000Z", "d"), ...extra]));

  it("colazione e cena registrate e pranzo saltato: giornata completa, con il testo che lo dice", () => {
    const s = day(buildMealDeclaration("2026-11-16", "lunch", "skipped", ctx).events);
    expect(s.status).toBe("complete");
    expect(s.skipped).toEqual(["lunch"]);
    expect(s.text).toBe("Giornata completa: colazione e cena registrati, pranzo saltato.");
  });

  it("con «mangiato, senza dettagli» il giorno è dichiarato e il totale è incompleto", () => {
    const s = day(buildMealDeclaration("2026-11-16", "lunch", "untracked", ctx).events);
    expect(s.status).toBe("declared");
  });

  it("senza dichiarazione il pranzo è un vuoto, e il testo non parla di digiuno", () => {
    const s = day([]);
    expect(s.status).toBe("gaps");
    expect(s.text).not.toMatch(/digiun/i);
  });
});
