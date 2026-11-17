import { describe, expect, it } from "vitest";
import { deriveDiary, getDay, habitsToPropose, localMoment } from "@/core/diary";
import { declaration, drink, habit, meal } from "@/core/diary/test-helpers";
import { HABIT_WINDOW_MINUTES, nowAction, nowActionHref, nowActionLabel } from "./nowModel";

const DAY = "2026-11-16";
const TZ = "Europe/Rome";
/** Un istante del 16 novembre all'ora di Roma data (UTC+1). */
const rome = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${DAY}T${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
};

const LATTE = { name: "Latte", quantity: { value: 200, unit: "ml" as const }, certainty: "estimated" as const };
const usualBreakfast = habit("h-col", "2026-11-01T07:00:00.000Z", { habitId: "col", title: "Solita colazione", kind: "breakfast", usualTime: "07:00", items: [LATTE] });
const usualLunch = habit("h-pra", "2026-11-01T07:00:00.000Z", { habitId: "pra", title: "Solito pranzo", kind: "lunch", usualTime: "13:00", items: [LATTE] });

/** La scelta di «Adesso» come la fa la schermata: stato dal registro, pasti abituali per tutta la fascia. */
function at(hhmm: string, events: unknown[] = []) {
  const now = rome(hhmm);
  const state = deriveDiary(events, { timeZone: TZ });
  return nowAction({
    nowMinutes: localMoment(now, TZ)?.minutes ?? 0,
    day: getDay(state, DAY),
    habits: habitsToPropose(state, now, { windowMinutes: HABIT_WINDOW_MINUTES }),
  });
}

describe("nowAction: il pulsante di «Adesso»", () => {
  it("7:30, nessun pasto, un pasto abituale di colazione: lo propone; registrato, resta lo spuntino", () => {
    const action = at("07:30", [usualBreakfast]);
    expect(action).toMatchObject({ kind: "habit", moment: "breakfast", habit: { title: "Solita colazione" } });
    expect(nowActionLabel(action)).toBe("Registra: Solita colazione");

    const done = meal("m1", rome("07:31"), { mealId: "meal-1", kind: "breakfast", title: "Solita colazione", habitId: "col", items: [LATTE] });
    const after = at("07:32", [usualBreakfast, done]);
    expect(after).toEqual({ kind: "snack" });
    expect(nowActionLabel(after)).toBe("Registra uno spuntino");
  });

  it("10:15, con ora abituale 7:00: la proposta c'è ancora (vale per tutta la fascia)", () => {
    expect(at("10:15", [usualBreakfast])).toMatchObject({ kind: "habit", moment: "breakfast" });
    // con la finestra di 90 minuti di prima non ci sarebbe più
    const state = deriveDiary([usualBreakfast], { timeZone: TZ });
    expect(habitsToPropose(state, rome("10:15"))).toEqual([]);
  });

  it("12:00, niente: «Registra pranzo», sul momento in corso", () => {
    const action = at("12:00");
    expect(action).toEqual({ kind: "register", moment: "lunch" });
    expect(nowActionLabel(action)).toBe("Registra pranzo");
    expect(nowActionHref(action)).toBe("/app/pasto?momento=lunch");
  });

  it("16:00 e 2:00 di notte: fuori dai tre momenti, lo spuntino", () => {
    expect(at("16:00", [usualBreakfast, usualLunch])).toEqual({ kind: "snack" });
    expect(at("02:00", [usualBreakfast])).toEqual({ kind: "snack" });
    expect(nowActionHref({ kind: "snack" })).toBe("/app/pasto?momento=snack");
  });

  it("i confini delle fasce: colazione dalle 5:00, pranzo dalle 10:30, cena dalle 18:30 alle 23:00", () => {
    expect(at("04:59")).toEqual({ kind: "snack" });
    expect(at("05:00")).toEqual({ kind: "register", moment: "breakfast" });
    expect(at("10:30")).toEqual({ kind: "register", moment: "lunch" });
    expect(at("15:30")).toEqual({ kind: "snack" });
    expect(at("18:30")).toEqual({ kind: "register", moment: "dinner" });
    expect(at("23:00")).toEqual({ kind: "snack" });
  });

  it("momento dichiarato (saltato, o mangiato senza dettagli): lo spuntino", () => {
    const skipped = declaration("d1", rome("12:10"), { date: DAY, kind: "lunch", status: "skipped" });
    const untracked = declaration("d2", rome("12:10"), { date: DAY, kind: "lunch", status: "untracked" });
    expect(at("12:30", [usualLunch, skipped])).toEqual({ kind: "snack" });
    expect(at("12:30", [untracked])).toEqual({ kind: "snack" });
  });

  it("una bevanda non è un pasto: il momento resta da registrare", () => {
    const tea = drink("t1", rome("12:11"), { name: "Tè", ml: 200 });
    expect(at("12:30", [tea])).toEqual({ kind: "register", moment: "lunch" });
  });

  it("il pasto abituale di un altro momento non conta", () => {
    expect(at("12:00", [usualBreakfast])).toEqual({ kind: "register", moment: "lunch" });
  });

  it("più pasti abituali dello stesso momento: il primo dell'elenco, cioè il più vicino all'ora", () => {
    const early = habit("h-a", "2026-11-01T07:00:00.000Z", { habitId: "a", title: "Pranzo presto", kind: "lunch", usualTime: "11:00", items: [LATTE] });
    const late = habit("h-b", "2026-11-01T07:00:00.000Z", { habitId: "b", title: "Pranzo tardi", kind: "lunch", usualTime: "14:00", items: [LATTE] });
    expect(at("13:30", [early, late])).toMatchObject({ kind: "habit", habit: { title: "Pranzo tardi" } });
    expect(at("11:15", [early, late])).toMatchObject({ kind: "habit", habit: { title: "Pranzo presto" } });
    const habits = deriveDiary([early, late], { timeZone: TZ }).habits;
    expect(nowAction({ nowMinutes: 12 * 60, day: undefined, habits })).toMatchObject({ kind: "habit", habit: { habitId: habits[0].habitId } });
  });
});
