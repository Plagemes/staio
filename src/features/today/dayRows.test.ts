import { describe, expect, it } from "vitest";
import { changeConsumeQuantity, deriveDiary, getDay } from "@/core/diary";
import { consume, drink, mood, purchase, supplement, symptom, voidOf, water, weight } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { drinkLinkNote, linkedConsumes, removeDrink } from "../drinks";
import { bodyLines, bodySummary, buildWeightCorrection, drinkConsumes, waterGlasses, weightInputText } from "./dayRows";

const TZ = "Europe/Rome";
const DAY = "2026-11-16";

function view(log: readonly AnyEvent[]) {
  const diary = deriveDiary(log, { timeZone: TZ });
  return { diary, voided: new Set(diary.voidedEventIds) };
}

describe("waterGlasses: i bicchieri d'acqua di un giorno", () => {
  it("dal più recente, con ora e quantità; gli annullati non ci sono", () => {
    const log: AnyEvent[] = [
      water("w1", "2026-11-16T08:10:00.000Z", { ml: 200 }),
      water("w2", "2026-11-16T09:42:00.000Z", { ml: 500 }),
      water("w3", "2026-11-16T11:00:00.000Z", { ml: 200 }),
      voidOf("v1", "2026-11-16T11:05:00.000Z", "w3"),
    ];
    const { voided } = view(log);
    expect(waterGlasses(log, DAY, TZ, voided).map((g) => g.text)).toEqual(["10:42 · 0,5 l", "09:10 · 200 ml"]);
  });

  it("il giorno è quello del fuso del diario, non quello di UTC", () => {
    const log: AnyEvent[] = [
      // 00:30 del 16 a Roma, ma ancora il 15 in UTC
      water("w1", "2026-11-15T23:30:00.000Z", { ml: 200 }),
      // 23:30 del 15 a Roma
      water("w2", "2026-11-15T22:30:00.000Z", { ml: 300 }),
    ];
    const { voided } = view(log);
    expect(waterGlasses(log, DAY, TZ, voided).map((g) => g.eventId)).toEqual(["w1"]);
    expect(waterGlasses(log, "2026-11-15", TZ, voided).map((g) => g.eventId)).toEqual(["w2"]);
  });

  it("due bicchieri alla stessa ora sono due righe", () => {
    const log: AnyEvent[] = [water("w1", "2026-11-16T09:00:00.000Z", { ml: 200 }), water("w2", "2026-11-16T09:00:00.000Z", { ml: 200 })];
    const glasses = waterGlasses(log, DAY, TZ, view(log).voided);
    expect(glasses).toHaveLength(2);
    expect(new Set(glasses.map((g) => g.eventId)).size).toBe(2);
  });

  it("tolto l'ultimo bicchiere l'elenco è vuoto, e l'annullamento annullato lo riporta", () => {
    const one: AnyEvent[] = [water("w1", "2026-11-16T09:00:00.000Z", { ml: 200 }), voidOf("v1", "2026-11-16T09:01:00.000Z", "w1")];
    expect(waterGlasses(one, DAY, TZ, view(one).voided)).toEqual([]);
    const back: AnyEvent[] = [...one, voidOf("v2", "2026-11-16T09:02:00.000Z", "v1")];
    expect(waterGlasses(back, DAY, TZ, view(back).voided).map((g) => g.eventId)).toEqual(["w1"]);
  });

  it("la somma dei bicchieri è l'acqua del giorno", () => {
    const log: AnyEvent[] = [water("w1", "2026-11-16T08:00:00.000Z", { ml: 200 }), water("w2", "2026-11-16T12:00:00.000Z", { ml: 400 })];
    const { diary, voided } = view(log);
    const sum = waterGlasses(log, DAY, TZ, voided).reduce((s, g) => s + g.ml, 0);
    expect(sum).toBe(getDay(diary, DAY)?.waterMl);
  });
});

describe("bodyLines e bodySummary: la riga «Corpo»", () => {
  it("una riga per voce, in ordine di ora, con il testo di ognuna", () => {
    const log: AnyEvent[] = [
      mood("o1", "2026-11-16T08:00:00.000Z", { score: 4 }),
      symptom("s1", "2026-11-16T08:00:00.000Z", { kind: "energy", score: 3 }),
      weight("k1", "2026-11-16T06:40:00.000Z", { kg: 72.4 }),
      supplement("p1", "2026-11-16T07:15:00.000Z", { name: "Vitamina D", dose: "1 capsula" }),
      symptom("s2", "2026-11-16T10:00:00.000Z", { kind: "other", score: 2, label: "Mal di testa" }),
    ];
    const day = getDay(deriveDiary(log, { timeZone: TZ }), DAY);
    expect(bodyLines(day, TZ).map((l) => `${l.time} · ${l.text}`)).toEqual([
      "07:40 · Peso 72,4 kg",
      "08:15 · Vitamina D, 1 capsula",
      "09:00 · Umore 4 su 5",
      "09:00 · Energia 3 su 5",
      "11:00 · Mal di testa 2 su 5",
    ]);
    expect(bodyLines(day, TZ).find((l) => l.kind === "weight")?.kg).toBe(72.4);
    expect(bodySummary(day)).toBe("peso 72,4 kg · umore 4 · 2 note · 1 integratore");
  });

  it("due pesate nello stesso giorno: due righe, il riepilogo dice l'ultima", () => {
    const log: AnyEvent[] = [weight("k1", "2026-11-16T06:40:00.000Z", { kg: 72.4 }), weight("k2", "2026-11-16T19:00:00.000Z", { kg: 72.9 })];
    const day = getDay(deriveDiary(log, { timeZone: TZ }), DAY);
    expect(bodyLines(day, TZ).map((l) => l.text)).toEqual(["Peso 72,4 kg", "Peso 72,9 kg"]);
    expect(bodySummary(day)).toBe("peso 72,9 kg");
  });

  it("un giorno con solo un integratore ha la riga; i plurali", () => {
    const one: AnyEvent[] = [supplement("p1", "2026-11-14T07:15:00.000Z", { name: "Magnesio" })];
    const day = getDay(deriveDiary(one, { timeZone: TZ }), "2026-11-14");
    expect(bodySummary(day)).toBe("1 integratore");
    expect(bodyLines(day, TZ).map((l) => l.text)).toEqual(["Magnesio"]);

    const two: AnyEvent[] = [...one, supplement("p2", "2026-11-14T08:00:00.000Z", { name: "Ferro" }), symptom("s1", "2026-11-14T09:00:00.000Z", { kind: "sleep", score: 2 })];
    expect(bodySummary(getDay(deriveDiary(two, { timeZone: TZ }), "2026-11-14"))).toBe("1 nota · 2 integratori");
  });

  it("niente nel giorno, o solo cose annullate: nessuna riga", () => {
    expect(bodySummary(undefined)).toBeNull();
    expect(bodyLines(undefined, TZ)).toEqual([]);
    const log: AnyEvent[] = [weight("k1", "2026-11-16T06:40:00.000Z", { kg: 72.4 }), voidOf("v1", "2026-11-16T06:41:00.000Z", "k1"), water("w1", "2026-11-16T08:00:00.000Z", { ml: 200 })];
    const day = getDay(deriveDiary(log, { timeZone: TZ }), DAY);
    expect(bodySummary(day)).toBeNull();
    expect(bodyLines(day, TZ)).toEqual([]);
  });
});

describe("buildWeightCorrection: il foglio «Peso»", () => {
  const AT = "2026-11-16T06:40:00.000Z";
  const NOW = "2026-11-16T09:00:00.000Z";
  const ctx = { deviceId: "dev-a", now: NOW, timeZone: TZ };
  const p1 = weight("p1", AT, { kg: 72.45 });

  it("il campo mostra il valore salvato senza arrotondarlo; lo stesso valore non scrive niente", () => {
    expect(weightInputText(72.45)).toBe("72,45");
    expect(weightInputText(80)).toBe("80");
    expect(buildWeightCorrection([p1], "p1", weightInputText(72.45), ctx)).toEqual({ ok: true, unchanged: true });
    expect(buildWeightCorrection([p1], "p1", "72.45", ctx)).toEqual({ ok: true, unchanged: true });
  });

  it("un valore nuovo: l'annullamento della pesata e una pesata alla stessa ora", () => {
    const r = buildWeightCorrection([p1], "p1", "72,5", ctx);
    if (!r.ok || r.unchanged) throw new Error("attesa una correzione");
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ type: "void", targetEventId: "p1" });
    expect(r.events[1]).toMatchObject({ type: "weight", kg: 72.5, at: AT });
    expect(r.message).toContain("72,5");
    const day = getDay(deriveDiary([p1, ...r.events], { timeZone: TZ }), DAY);
    expect(day?.weights.map((w) => w.kg)).toEqual([72.5]);
  });

  it("un valore che non si legge non scrive niente e dice perché", () => {
    expect(buildWeightCorrection([p1], "p1", "abc", ctx).ok).toBe(false);
    expect(buildWeightCorrection([p1], "p1", "0", ctx).ok).toBe(false);
  });

  it("una pesata già tolta da un altro telefono non si fa rivivere", () => {
    const elsewhere = voidOf("v1", "2026-11-16T08:00:00.000Z", "p1", { deviceId: "dev-b" });
    expect(buildWeightCorrection([p1, elsewhere], "p1", "73", ctx)).toEqual({ ok: false, error: "Questa pesata non c'è più." });
    expect(buildWeightCorrection([], "p1", "73", ctx)).toEqual({ ok: false, error: "Questa pesata non c'è più." });
  });
});

describe("drinkConsumes: «Togli» e «Cambia ora» portano con sé tutta la famiglia del consumo scalato", () => {
  const lot = purchase("buy", "2026-11-10T09:00:00.000Z", { lotId: "lot-tea", productRef: "Tè nero in bustine", quantity: { value: 20, unit: "pz" }, location: "dispensa" });
  const tea = drink("d1", "2026-11-16T08:00:00.000Z", { name: "Tè", ml: 200 });
  const scaled = consume("c1", "2026-11-16T08:00:00.000Z", { lotId: "lot-tea", quantity: { value: 1, unit: "pz" }, certainty: "estimated", note: drinkLinkNote("d1") });
  let n = 0;
  const fix = (value: number, now: string, deviceId: string) => {
    const r = changeConsumeQuantity(scaled, { value, estimated: true }, 20, { deviceId, now, idGenerator: () => `${deviceId}-${++n}`, timeZone: TZ });
    if (!r.ok) throw new Error(r.error);
    return r.events;
  };
  const remaining = (log: readonly AnyEvent[]) => derivePantry(log as LedgerEvent[]).lots.find((l) => l.lotId === "lot-tea")?.remaining;
  const voidedOf = (log: readonly AnyEvent[]) => derivePantry(log as LedgerEvent[]).voidedEventIds;

  it("senza consumo collegato non c'è niente da portare", () => {
    expect(drinkConsumes("d1", [lot, tea], voidedOf([lot, tea]))).toEqual([]);
  });

  it("consumo corretto da due telefoni: togliendo la bevanda la dispensa torna com'era", () => {
    const log: AnyEvent[] = [lot, tea, scaled, ...fix(2, "2026-11-16T08:10:00.000Z", "dev-a"), ...fix(3, "2026-11-16T08:11:00.000Z", "dev-b")];
    expect(remaining(log)).toBe(17);
    const voided = voidedOf(log);
    const family = drinkConsumes("d1", log, voided);
    const drinkRow = getDay(deriveDiary(log, { timeZone: TZ }), DAY)!.drinks[0];
    const ctx = { deviceId: "dev-a", now: "2026-11-16T09:00:00.000Z", timeZone: TZ };
    // solo i collegati che valgono: la correzione dell'altro telefono tornerebbe a contare
    expect(remaining([...log, ...removeDrink(drinkRow, linkedConsumes("d1", log, voided), ctx).events])).not.toBe(20);
    const removed = removeDrink(drinkRow, family, { deviceId: "dev-a", now: "2026-11-16T09:00:00.000Z", timeZone: TZ }).events;
    const after = [...log, ...removed];
    expect(remaining(after)).toBe(20);
    expect(drinkConsumes("d1", after, voidedOf(after))).toEqual([]);
  });
});
