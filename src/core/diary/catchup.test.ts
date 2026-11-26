import { describe, expect, it } from "vitest";
import {
  CATCHUP_NOTE,
  InvalidCatchUpError,
  buildCatchUpEvents,
  catchUpDays,
  catchUpKey,
  emptyDays,
  stillEmpty,
  type CatchUpChoice,
  type CatchUpEntry,
} from "./catchup";
import { localMoment } from "./calendar";
import { deriveDiary } from "./derive";
import { mealMoments } from "./selectors";
import { declaration, meal, water } from "./test-helpers";
import type { DiaryEvent, MealItem } from "./types";
import { validateDiaryEvent } from "./validate";

const TZ = "Europe/Rome";
const TODAY = "2026-11-17";
const NOW = "2026-11-17T09:00:00.000Z";
const MINUTES = { breakfast: 8 * 60, lunch: 13 * 60, dinner: 20 * 60, snack: 16 * 60 + 30 };

let n = 0;
const nextId = () => `cu-${String(++n).padStart(5, "0")}`;
const ctx = (timeZone = TZ) => ({ deviceId: "dev-a", now: NOW, timeZone, minutesOf: MINUTES, idGenerator: nextId });

const pasta: MealItem = { name: "Pasta al pomodoro", quantity: { value: 120, unit: "g" }, certainty: "measured" };
const lunchOn = (date: string, id = `m-${date}`) =>
  meal(id, `${date}T12:00:00.000Z`, { mealId: `meal-${id}`, kind: "lunch", items: [pasta] });

/** Diario con un pranzo dal 10 al 13: vuoti 14, 15 e 16 se oggi è il 17. */
const upTo13 = (): DiaryEvent[] => ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d) => lunchOn(d));

const ALL_CHOICES: CatchUpChoice[] = [
  { kind: "meal", title: "Solito pranzo", items: [pasta], habitId: "h1", source: "habit" },
  { kind: "meal", items: [pasta, { name: "Insalata", quantity: { value: 80, unit: "g" }, certainty: "estimated" }], source: "manual" },
  { kind: "meal", items: [{ name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: 800 }], source: "manual" },
  { kind: "skipped" },
  { kind: "unknown" },
];

describe("emptyDays e catchUpDays", () => {
  it("1. dati fino al 13, oggi 17: vuoti 14, 15 e 16", () => {
    const state = deriveDiary(upTo13(), { timeZone: TZ });
    expect(emptyDays(state, TODAY)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(catchUpDays(state, TODAY)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(catchUpKey(catchUpDays(state, TODAY))).toBe("catchup:2026-11-14:2026-11-16");
  });

  it("2. un solo giorno vuoto: niente da proporre", () => {
    const state = deriveDiary([...upTo13(), lunchOn("2026-11-14"), lunchOn("2026-11-15")], { timeZone: TZ });
    expect(emptyDays(state, TODAY)).toEqual(["2026-11-16"]);
    expect(catchUpDays(state, TODAY)).toEqual([]);
  });

  it("3. utente nuovo: primo giorno oggi o ieri, niente", () => {
    expect(catchUpDays(deriveDiary([lunchOn(TODAY)], { timeZone: TZ }), TODAY)).toEqual([]);
    expect(catchUpDays(deriveDiary([lunchOn("2026-11-16")], { timeZone: TZ }), TODAY)).toEqual([]);
    expect(catchUpDays(deriveDiary([], { timeZone: TZ }), TODAY)).toEqual([]);
    // primo giorno l'altro ieri: resta solo ieri, che da solo non basta
    expect(catchUpDays(deriveDiary([lunchOn("2026-11-15")], { timeZone: TZ }), TODAY)).toEqual([]);
  });

  it("4. una pausa di 20 giorni: solo gli ultimi sette", () => {
    const state = deriveDiary([lunchOn("2026-10-28")], { timeZone: TZ });
    expect(catchUpDays(state, TODAY)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
  });

  it("5. un giorno con solo l'acqua è vuoto; uno con solo uno spuntino no", () => {
    const snack = meal("s-15", "2026-11-15T15:00:00.000Z", { mealId: "snack-15", kind: "snack", items: [pasta] });
    const state = deriveDiary([...upTo13(), water("w-14", "2026-11-14T09:00:00.000Z", { ml: 250 }), snack], { timeZone: TZ });
    expect(emptyDays(state, TODAY)).toEqual(["2026-11-14", "2026-11-16"]);
  });

  it("un giorno con una dichiarazione non è vuoto", () => {
    const skipped = declaration("x-15", "2026-11-16T09:00:00.000Z", { date: "2026-11-15", kind: "dinner", status: "skipped" });
    expect(emptyDays(deriveDiary([...upTo13(), skipped], { timeZone: TZ }), TODAY)).toEqual(["2026-11-14", "2026-11-16"]);
  });
});

const plan = (days: readonly string[], choice: CatchUpChoice): CatchUpEntry[] =>
  days.flatMap((date) => (["breakfast", "lunch", "dinner"] as const).map((kind) => ({ date, kind, choice })));

describe("buildCatchUpEvents", () => {
  it("9. tutti «Saltato» per tre giorni: nove dichiarazioni, con il giorno e la nota", () => {
    const events = buildCatchUpEvents(plan(["2026-11-14", "2026-11-15", "2026-11-16"], { kind: "skipped" }), ctx());
    expect(events).toHaveLength(9);
    for (const e of events) {
      expect(e.type).toBe("mealDeclaration");
      expect(e.note).toBe(CATCHUP_NOTE);
      expect(e.at).toBe(NOW);
      expect(e.recordedAt).toBe(NOW);
    }
    expect(events.map((e) => (e.type === "mealDeclaration" ? `${e.date} ${e.kind} ${e.status}` : ""))).toContain("2026-11-15 lunch skipped");
    const state = deriveDiary([...upTo13(), ...events], { timeZone: TZ });
    expect(catchUpDays(state, TODAY)).toEqual([]);
    expect(mealMoments(state.days.find((d) => d.date === "2026-11-16")).map((m) => m.status)).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("«Non ricordo» è «mangiato, senza dettagli»", () => {
    const [e] = buildCatchUpEvents([{ date: "2026-11-14", kind: "dinner", choice: { kind: "unknown" } }], ctx());
    expect(e).toMatchObject({ type: "mealDeclaration", date: "2026-11-14", kind: "dinner", status: "untracked", note: CATCHUP_NOTE });
  });

  it("un pasto: all'ora del momento nel giorno scelto, stimato, con la sua fonte", () => {
    const events = buildCatchUpEvents([{ date: "2026-11-14", kind: "lunch", choice: ALL_CHOICES[0] }], ctx());
    expect(events).toHaveLength(1);
    const m = events[0];
    expect(m).toMatchObject({ type: "meal", kind: "lunch", title: "Solito pranzo", habitId: "h1", source: "habit", certainty: "estimated", note: CATCHUP_NOTE });
    expect(m.at).toBe("2026-11-14T12:00:00.000Z");
    expect(m.type === "meal" ? m.items?.every((i) => i.certainty === "estimated") : false).toBe(true);
    // le voci di chi chiama non si toccano
    expect(pasta.certainty).toBe("measured");
  });

  it("15. ogni scelta: nessun consumo, ogni evento valido e con la nota", () => {
    const slots = plan(["2026-11-14", "2026-11-15"], { kind: "skipped" });
    const events = buildCatchUpEvents(ALL_CHOICES.map((choice, i) => ({ ...slots[i], choice })), ctx());
    expect(events).toHaveLength(ALL_CHOICES.length);
    for (const choice of ALL_CHOICES) {
      const one = buildCatchUpEvents([{ date: "2026-11-15", kind: "dinner", choice }], ctx());
      expect(one.map((e) => e.type as string)).not.toContain("consume");
      events.push(...one);
    }
    for (const e of events) {
      expect(e.type as string).not.toBe("consume");
      expect(["meal", "mealDeclaration"]).toContain(e.type);
      expect(validateDiaryEvent(e)).toEqual([]);
      expect(e.note).toBe(CATCHUP_NOTE);
    }
  });

  it("14. ora legale: i pasti cadono nel giorno giusto attorno al cambio dell'ora", () => {
    // a Roma l'ora cambia domenica 29 marzo e domenica 25 ottobre 2026
    for (const days of [["2026-03-28", "2026-03-29", "2026-03-30"], ["2026-10-24", "2026-10-25", "2026-10-26"]]) {
      const events = buildCatchUpEvents(plan(days, ALL_CHOICES[1]), ctx());
      for (const e of events) {
        const local = localMoment(e.at, TZ);
        expect(local).toBeDefined();
        expect(days).toContain(local?.date);
        expect([MINUTES.breakfast, MINUTES.lunch, MINUTES.dinner]).toContain(local?.minutes);
      }
      const state = deriveDiary(events, { timeZone: TZ });
      expect(state.days.map((d) => d.date)).toEqual(days);
      for (const day of state.days) expect(mealMoments(day).map((m) => m.status)).toEqual(["recorded", "recorded", "recorded"]);
    }
    // un fuso lontano: il giorno resta quello scelto
    const far = buildCatchUpEvents([{ date: "2026-11-14", kind: "breakfast", choice: ALL_CHOICES[1] }], ctx("Pacific/Auckland"));
    expect(localMoment(far[0].at, "Pacific/Auckland")).toEqual({ date: "2026-11-14", minutes: MINUTES.breakfast });
  });

  it("14. un'ora che non esiste (passaggio all'ora legale) resta nello stesso giorno", () => {
    const events = buildCatchUpEvents([{ date: "2026-03-29", kind: "breakfast", choice: ALL_CHOICES[1] }], { ...ctx(), minutesOf: { ...MINUTES, breakfast: 2 * 60 + 30 } });
    expect(localMoment(events[0].at, TZ)?.date).toBe("2026-03-29");
  });

  it("vicino alla mezzanotte il pasto resta nel suo giorno, anche nei giorni del cambio dell'ora", () => {
    const edges = { breakfast: 0, lunch: 1, dinner: 23 * 60 + 59, snack: 0 };
    for (const timeZone of [TZ, "Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      for (const date of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-25", "2026-11-01", "2026-12-31"]) {
        const events = buildCatchUpEvents(plan([date], ALL_CHOICES[1]), { ...ctx(timeZone), minutesOf: edges });
        expect(events.map((e) => localMoment(e.at, timeZone)?.date)).toEqual([date, date, date]);
        expect(events.map((e) => localMoment(e.at, timeZone)?.minutes)).toEqual([0, 1, 23 * 60 + 59]);
        expect(deriveDiary(events, { timeZone }).days.map((d) => d.date)).toEqual([date]);
      }
    }
    // fuori dai limiti del giorno: errore, niente scritto
    expect(() => buildCatchUpEvents(plan(["2026-11-14"], ALL_CHOICES[1]), { ...ctx(), minutesOf: { ...MINUTES, dinner: 1440 } })).toThrow(InvalidCatchUpError);
  });

  it("un piano non valido non costruisce niente", () => {
    expect(() => buildCatchUpEvents([{ date: "2026-11-31", kind: "lunch", choice: { kind: "skipped" } }], ctx())).toThrow(InvalidCatchUpError);
    expect(() => buildCatchUpEvents([{ date: "2026-11-14", kind: "snack" as "lunch", choice: { kind: "skipped" } }], ctx())).toThrow(InvalidCatchUpError);
    expect(() =>
      buildCatchUpEvents(
        [
          { date: "2026-11-14", kind: "lunch", choice: { kind: "skipped" } },
          { date: "2026-11-14", kind: "lunch", choice: { kind: "unknown" } },
        ],
        ctx(),
      ),
    ).toThrow(InvalidCatchUpError);
    expect(() => buildCatchUpEvents([{ date: "2026-11-14", kind: "lunch", choice: { kind: "meal", items: [], source: "manual" } }], ctx())).toThrow(InvalidCatchUpError);
    // una voce non valida: la validazione del diario la ferma
    const bad: CatchUpChoice = { kind: "meal", items: [{ name: "Pasta", quantity: { value: -1, unit: "g" }, certainty: "estimated" }], source: "manual" };
    expect(() => buildCatchUpEvents([{ date: "2026-11-14", kind: "breakfast", choice: { kind: "skipped" } }, { date: "2026-11-14", kind: "lunch", choice: bad }], ctx())).toThrow();
  });
});

describe("stillEmpty", () => {
  it("11. il pranzo del 15 registrato da un altro telefono non si riscrive", () => {
    const entries = plan(["2026-11-14", "2026-11-15", "2026-11-16"], { kind: "unknown" });
    const fresh = deriveDiary([...upTo13(), lunchOn("2026-11-15", "other-phone")], { timeZone: TZ });
    const { entries: kept, filled } = stillEmpty(fresh, entries);
    expect(filled).toEqual([{ date: "2026-11-15", kind: "lunch", choice: { kind: "unknown" } }]);
    expect(kept).toHaveLength(8);
    expect(kept.some((e) => e.date === "2026-11-15" && e.kind === "lunch")).toBe(false);
  });

  it("anche una dichiarazione arrivata nel frattempo vale", () => {
    const entries = plan(["2026-11-14"], { kind: "skipped" });
    const fresh = deriveDiary([...upTo13(), declaration("x", NOW, { date: "2026-11-14", kind: "breakfast", status: "untracked" })], { timeZone: TZ });
    expect(stillEmpty(fresh, entries).filled.map((e) => e.kind)).toEqual(["breakfast"]);
  });
});

describe("«Lascia così»", () => {
  it("13. i giorni lasciati così non tornano; un vuoto nuovo la settimana dopo fa una riga nuova", () => {
    const state = deriveDiary(upTo13(), { timeZone: TZ });
    const dismissed = ["altro", catchUpKey(catchUpDays(state, TODAY))];
    expect(catchUpDays(state, TODAY, dismissed)).toEqual([]);
    // il giorno dopo, il 17 vuoto da solo non basta
    expect(catchUpDays(state, "2026-11-18", dismissed)).toEqual([]);
    // la settimana dopo: 17-23 vuoti, 14-16 restano lasciati così e il 14-16 esce dai sette giorni
    const next = catchUpDays(state, "2026-11-24", dismissed);
    expect(next).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(catchUpKey(next)).toBe("catchup:2026-11-17:2026-11-23");
  });
});
