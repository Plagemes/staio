import { describe, expect, it } from "vitest";
import { declaration, meal } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { proteinSpread } from "./proteinSpread";
import { createResolver } from "./resolve";
import { fakeFood } from "./test-helpers";

const FOODS = [
  fakeFood("pollo", "Pollo", { proteinG: 20 }),
  fakeFood("pane", "Pane", { proteinG: 10 }),
  fakeFood("zucchine", "Zucchine", { energyKcal: 15 }),
];
const resolver = createResolver({ foods: FOODS, productByRef: () => undefined });
const TODAY = "2026-03-10";
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;
type Kind = "breakfast" | "lunch" | "dinner" | "snack";
let n = 0;
const m = (date: string, hhmm: string, kind: Kind, items: [string, number][], certainty: "measured" | "estimated" = "measured") => {
  n++;
  return meal(`m${n}`, at(date, hhmm), {
    mealId: `x${n}`,
    kind,
    items: items.map(([name, v]) => ({ name, quantity: { value: v, unit: "g" as const }, certainty })),
  });
};
const run = (events: unknown[]) => proteinSpread(computeIntake(events, resolver, { timeZone: "UTC" }).days, TODAY);
const day = (date: string, b: number, l: number, d: number, extra: unknown[] = []) => [
  m(date, "07:30", "breakfast", [["Pane", b]]),
  m(date, "12:30", "lunch", [["Pollo", l]]),
  m(date, "19:30", "dinner", [["Pollo", d]]),
  ...extra,
];
const of = (r: ReturnType<typeof run>, moment: string) => r.moments.find((x) => x.moment === moment)!;

describe("proteinSpread", () => {
  it("senza dati: nessuna media", () => {
    const r = run([]);
    expect(r).toMatchObject({ daysWithData: 0, completeDays: 0, topIsMajority: false });
    expect(r.dailyAverage).toBeUndefined();
    expect(r.top).toBeUndefined();
    expect(of(r, "lunch").grams).toBeUndefined();
  });

  it("media dei giorni completi e momento prevalente", () => {
    const r = run([...day("2026-03-09", 100, 50, 300), ...day("2026-03-10", 100, 150, 500)]);
    expect(r.completeDays).toBe(2);
    expect(of(r, "breakfast").grams).toBeCloseTo(10);
    expect(of(r, "lunch").grams).toBeCloseTo(20);
    expect(of(r, "dinner").grams).toBeCloseTo(80);
    expect(of(r, "other").grams).toBe(0);
    expect(r.dailyAverage).toBeCloseTo(110);
    expect(r.top).toBe("dinner");
    expect(r.topIsMajority).toBe(true);
    expect(of(r, "dinner").share).toBeCloseTo(80 / 110);
  });

  it("i giorni incompleti non entrano nella media", () => {
    const r = run([...day("2026-03-09", 100, 50, 50), m("2026-03-10", "12:00", "lunch", [["Pollo", 500]])]);
    expect(r).toMatchObject({ daysWithData: 2, completeDays: 1 });
    expect(of(r, "lunch").grams).toBeCloseTo(10);
  });

  it("spuntini e consumi senza pasto vanno in «altro»", () => {
    const r = run(day("2026-03-10", 10, 50, 50, [m("2026-03-10", "16:00", "snack", [["Pane", 100]])]));
    expect(of(r, "other").grams).toBeCloseTo(10);
  });

  it("un momento dichiarato senza voci non entra nella media e non vale zero", () => {
    const r = run([
      m("2026-03-10", "07:30", "breakfast", [["Pane", 100]]),
      declaration("d", at("2026-03-10", "13:00"), { date: "2026-03-10", kind: "lunch", status: "skipped" }),
      m("2026-03-10", "19:30", "dinner", [["Pollo", 100]]),
    ]);
    expect(r.completeDays).toBe(1);
    expect(of(r, "lunch").grams).toBeUndefined();
    expect(of(r, "lunch").days).toBe(0);
    expect(r.dailyAverage).toBeCloseTo(30);
  });

  it("voci senza il dato rendono il momento parziale; le stime restano stime", () => {
    const r = run([
      m("2026-03-10", "07:30", "breakfast", [["Pane", 100]]),
      m("2026-03-10", "12:30", "lunch", [["Pollo", 100], ["Zucchine", 100]], "estimated"),
      m("2026-03-10", "19:30", "dinner", [["Pollo", 100], ["Sconosciuto", 100]]),
    ]);
    expect(of(r, "lunch")).toMatchObject({ partial: true, certainty: "estimated" });
    expect(of(r, "dinner")).toMatchObject({ partial: true, certainty: "estimated" });
    expect(of(r, "breakfast")).toMatchObject({ partial: false, certainty: "estimated" });
    expect(r.partial).toBe(true);
    expect(r.certainty).toBe("estimated");
  });

  it("nessuna maggioranza quando le quote sono vicine", () => {
    const r = run(day("2026-03-10", 100, 100, 100));
    expect(r.topIsMajority).toBe(false);
  });
});
