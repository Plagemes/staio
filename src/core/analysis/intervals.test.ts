import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { drink } from "../diary/test-helpers";
import { analyzeMealTiming } from "./timing";
import { foodFreeIntervals } from "./intervals";
import { buildReport } from "./report";
import { analyzeLight, at, dateOf, day } from "./test-helpers";

const run = (events: unknown[]) => foodFreeIntervals(analyzeLight(events).diary);
const hours = (minutes: number | undefined) => (minutes === undefined ? undefined : minutes / 60);

describe("intervalli senza cibo", () => {
  it("giorno completo: colazione, pranzo e cena fanno tre pasti e due intervalli nel giorno", () => {
    const r = run(day(0));
    expect(r.intervals.map((i) => i.minutes)).toEqual([5 * 60, 7 * 60]);
    expect(r.excludedDays).toBe(0);
  });

  it("un pranzo «saltato» allunga l'intervallo reale: colazione-cena, 12 ore", () => {
    const r = run(day(0, { skippedKinds: ["lunch"] }));
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ minutes: 12 * 60, skipped: ["lunch"] });
    expect(r.withSkipped).toBe(1);
    expect(hours(r.longestMinutes)).toBe(12);
  });

  it("un momento senza dati non allunga nulla: il giorno non produce intervalli", () => {
    const r = run(day(0, { skip: ["lunch"] }));
    expect(r.intervals).toEqual([]);
    expect(r.excludedDays).toBe(1);
  });

  it("«mangiato, non registrato» non produce intervalli: non si sa quando si è mangiato", () => {
    const r = run(day(0, { untrackedKinds: ["lunch"] }));
    expect(r.intervals).toEqual([]);
    expect(r.excludedDays).toBe(1);
  });

  it("l'intervallo della notte unisce due giorni solo se entrambi sono tracciati per intero", () => {
    const both = run([...day(0), ...day(1)]);
    expect(both.intervals.map((i) => i.minutes)).toEqual([5 * 60, 7 * 60, 12 * 60, 5 * 60, 7 * 60]);
    const gap = run([...day(0), ...day(1, { skip: ["breakfast"] }), ...day(2)]);
    expect(gap.intervals.map((i) => i.minutes)).toEqual([5 * 60, 7 * 60, 5 * 60, 7 * 60]);
  });

  it("una colazione saltata allunga la notte: cena di ieri - pranzo di oggi", () => {
    const r = run([...day(0), ...day(1, { skippedKinds: ["breakfast"] })]);
    const overnight = r.intervals.find((i) => i.fromDate === dateOf(0) && i.toDate === dateOf(1));
    expect(overnight).toMatchObject({ minutes: 17 * 60, skipped: ["breakfast"] });
  });

  it("una bevanda con energia interrompe l'intervallo; tè e caffè senza zucchero no", () => {
    const cola = drink("c", at(0, "10:00"), { name: "Cola", ml: 330, energyKcal: 139, sugarsG: 35 });
    const tea = drink("t", at(0, "10:00"), { name: "Tè", ml: 200, energyKcal: 1 });
    const wine = drink("w", at(0, "16:00"), { name: "Vino", ml: 150, alcoholG: 14 });

    const withTea = run([...day(0, { skippedKinds: ["lunch"] }), tea]);
    expect(withTea.intervals.map((i) => i.minutes)).toEqual([12 * 60]);

    const withCola = run([...day(0, { skippedKinds: ["lunch"] }), cola]);
    expect(withCola.intervals.map((i) => i.minutes)).toEqual([2.5 * 60, 9.5 * 60]);

    const withWine = run([...day(0, { skippedKinds: ["lunch"] }), wine]);
    expect(withWine.intervals.map((i) => i.minutes)).toEqual([8.5 * 60, 3.5 * 60]);
  });

  it("una bevanda senza energia dichiarata non interrompe, ma l'intervallo lo segnala", () => {
    const mystery = drink("m", at(0, "10:00"), { name: "Infuso", ml: 250 });
    const r = run([...day(0, { skippedKinds: ["lunch"] }), mystery]);
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ minutes: 12 * 60, unknownDrinks: 1 });
  });

  it("senza giorni: niente intervalli", () => {
    expect(run([])).toEqual({ intervals: [], excludedDays: 0, withSkipped: 0 });
  });
});

describe("orari dei pasti con momenti saltati", () => {
  it("un giorno con pranzo saltato è tracciato per intero: entra negli orari; senza dato, no", () => {
    const week = (lunch: "skipped" | "missing") => {
      const events: unknown[] = [];
      for (let i = 0; i < 8; i++) events.push(...day(i, lunch === "skipped" ? { skippedKinds: ["lunch"] } : { skip: ["lunch"] }));
      return analyzeLight(events).diary;
    };
    const ok = analyzeMealTiming(week("skipped"));
    if (ok.status !== "ok") throw new Error("atteso ok");
    expect(ok.days).toHaveLength(8);
    expect(ok.foodFree).toMatchObject({ count: 8 + 7, longestMinutes: 12 * 60, withSkipped: 8 });

    const none = analyzeMealTiming(week("missing"));
    expect(none.status).toBe("insufficient");
  });
});

describe("rapporto: momenti saltati come fatto descrittivo", () => {
  it("conta i pranzi saltati nella settimana, senza giudizio, e non conta quelli con un pasto", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 7; i++) events.push(...day(i, i < 3 ? { skippedKinds: ["lunch"] } : {}));
    events.push(...day(0, {}).filter((e) => (e as { type: string }).type === "meal" && (e as { kind: string }).kind === "lunch"));
    const { diary, intakeDays } = analyzeLight(events);
    const pantry = derivePantry(events as never, {});
    const r = buildReport("week", dateOf(3), { diary, pantry, intakeDays });
    // il giorno 0 ha anche un pranzo registrato: il pasto vince, restano due pranzi saltati
    expect(r.meals.skipped).toEqual({ total: 2, breakfast: 0, lunch: 2, dinner: 0 });
    expect(r.tracking).toMatchObject({ completeDays: 7, gapDays: 0 });
  });
});
