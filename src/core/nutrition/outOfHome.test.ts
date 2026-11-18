import { describe, expect, it } from "vitest";
import { MEAL_KINDS, type MealItem, type MealKind } from "../diary";
import { meal } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import {
  OUT_OF_HOME_FACTOR,
  OUT_OF_HOME_MIN_MEAL_SHARE,
  OUT_OF_HOME_MOMENT_SHARE,
  OUT_OF_HOME_PERSONAL_RANGE,
  OUT_OF_HOME_REFERENCE_KCAL,
  OUT_OF_HOME_SIZES,
  REFERENCE_ENERGY_KCAL,
  estimateOutOfHome,
  mealEnergyHistory,
  outOfHomeEnergyShare,
} from "./outOfHome";
import { createResolver } from "./resolve";
import { FAKE_FOODS } from "./test-helpers";

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
const TODAY = "2026-03-30";
const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;
const HOUR: Record<MealKind, string> = { breakfast: "08:00", lunch: "13:00", dinner: "20:00", snack: "16:30" };

// «Petto di pollo» nei dati finti vale 100 kcal per 100 g: i grammi sono le kcal.
const chicken = (kcal: number): MealItem => ({ name: "Petto di pollo", quantity: { value: kcal, unit: "g" }, certainty: "measured" });
const outOfHome = (kcal: number): MealItem => ({
  name: "Fuori casa · normale",
  quantity: { value: 1, unit: "pz" },
  certainty: "estimated",
  energyKcal: kcal,
});
const unknown: MealItem = { name: "Dolce misterioso", quantity: { value: 100, unit: "g" }, certainty: "measured" };
// «Latte intero» nei dati finti vale 60 kcal per 100 ml.
const milk = (ml: number): MealItem => ({ name: "Latte intero", quantity: { value: ml, unit: "ml" }, certainty: "measured" });

const mealOn = (date: string, kind: MealKind, items: MealItem[]) =>
  meal(`m-${date}-${kind}`, `${date}T${HOUR[kind]}:00.000Z`, { mealId: `${date}-${kind}`, kind, items, certainty: "estimated" });

const historyOf = (events: unknown[], kind: MealKind = "lunch", today = TODAY) =>
  mealEnergyHistory(computeIntake(events, resolver, { timeZone: "UTC" }), kind, today);

describe("i valori di riferimento", () => {
  it("le quote dei momenti fanno il giorno intero e danno 400, 800, 600, 200 kcal", () => {
    const total = MEAL_KINDS.reduce((sum, k) => sum + OUT_OF_HOME_MOMENT_SHARE[k], 0);
    expect(total).toBeCloseTo(1);
    expect(REFERENCE_ENERGY_KCAL).toBe(2000);
    expect(OUT_OF_HOME_REFERENCE_KCAL).toEqual({ breakfast: 400, lunch: 800, dinner: 600, snack: 200 });
    expect(OUT_OF_HOME_FACTOR).toEqual({ light: 0.6, normal: 1, large: 1.5 });
  });
});

describe("estimateOutOfHome", () => {
  it("1. nessun pasto registrato prima: stima generica dal valore di riferimento", () => {
    expect(estimateOutOfHome("lunch", "normal", [])).toEqual({ energyKcal: 800, basis: "generic" });
    expect(estimateOutOfHome("lunch", "light", [])).toEqual({ energyKcal: 480, basis: "generic" });
    expect(estimateOutOfHome("lunch", "large", [])).toEqual({ energyKcal: 1200, basis: "generic" });
    expect(estimateOutOfHome("breakfast", "normal", [])).toEqual({ energyKcal: 400, basis: "generic" });
    expect(estimateOutOfHome("dinner", "large", [])).toEqual({ energyKcal: 900, basis: "generic" });
  });

  it("2. sei pranzi attorno a 700 kcal: 700, 420 e 1050, dai pasti registrati", () => {
    const history = [600, 650, 700, 700, 750, 800];
    expect(estimateOutOfHome("lunch", "normal", history)).toEqual({ energyKcal: 700, basis: "personal", meals: 6 });
    expect(estimateOutOfHome("lunch", "light", history)).toEqual({ energyKcal: 420, basis: "personal", meals: 6 });
    expect(estimateOutOfHome("lunch", "large", history)).toEqual({ energyKcal: 1050, basis: "personal", meals: 6 });
  });

  it("con quattro pasti la media non si usa, con cinque sì", () => {
    expect(estimateOutOfHome("lunch", "normal", [500, 500, 500, 500])).toEqual({ energyKcal: 800, basis: "generic" });
    expect(estimateOutOfHome("lunch", "normal", [500, 500, 500, 500, 500])).toEqual({ energyKcal: 500, basis: "personal", meals: 5 });
  });

  it("7. spuntino fuori casa: 200 kcal di riferimento", () => {
    expect(estimateOutOfHome("snack", "normal", [])).toEqual({ energyKcal: 200, basis: "generic" });
    expect(estimateOutOfHome("snack", "light", [])).toEqual({ energyKcal: 120, basis: "generic" });
    expect(estimateOutOfHome("snack", "large", [])).toEqual({ energyKcal: 300, basis: "generic" });
  });

  it("arrotonda alla decina", () => {
    // valore di mezzo 683: 680; per 0,6 fa 409,8: 410; per 1,5 fa 1024,5: 1020
    const history = [683, 683, 683, 684, 684];
    expect(estimateOutOfHome("lunch", "normal", history).energyKcal).toBe(680);
    expect(estimateOutOfHome("lunch", "light", history).energyKcal).toBe(410);
    expect(estimateOutOfHome("lunch", "large", history).energyKcal).toBe(1020);
    for (const kind of MEAL_KINDS) {
      for (const size of OUT_OF_HOME_SIZES) expect(estimateOutOfHome(kind, size, [333, 417, 512, 688, 901]).energyKcal % 10).toBe(0);
    }
  });

  it("i valori che non sono energie non entrano nella media", () => {
    const history = [700, 700, 700, 700, Number.NaN, 0, -50, Infinity];
    expect(estimateOutOfHome("lunch", "normal", history)).toEqual({ energyKcal: 800, basis: "generic" });
    expect(estimateOutOfHome("lunch", "normal", [...history, 700])).toEqual({ energyKcal: 700, basis: "personal", meals: 5 });
  });

  it("usa il valore di mezzo, non la media: un pranzo registrato male da 9000 kcal non sposta la stima", () => {
    const history = [600, 650, 700, 650, 9000];
    expect(estimateOutOfHome("lunch", "normal", history)).toEqual({ energyKcal: 650, basis: "personal", meals: 5 });
    // con la media sarebbe 2320 kcal, e «abbondante» 3480
    expect(estimateOutOfHome("lunch", "large", history)).toEqual({ energyKcal: 980, basis: "personal", meals: 5 });
  });

  it("cinque colazioni da un espresso non fanno una colazione fuori casa da 10 kcal: vale la stima generica", () => {
    expect(OUT_OF_HOME_MIN_MEAL_SHARE).toBe(0.25);
    expect(estimateOutOfHome("breakfast", "normal", [5, 8, 5, 12, 5])).toEqual({ energyKcal: 400, basis: "generic" });
    // sotto un quarto del pasto di riferimento (100 kcal a colazione) un pasto non entra; da lì in su sì
    expect(estimateOutOfHome("breakfast", "normal", [99, 99, 99, 99, 300, 300, 300, 300])).toEqual({ energyKcal: 400, basis: "generic" });
    expect(estimateOutOfHome("breakfast", "normal", [99, 300, 300, 300, 300, 300]).meals).toBe(5);
  });

  it("il valore personale resta tra la metà e il doppio del pasto di riferimento", () => {
    expect(OUT_OF_HOME_PERSONAL_RANGE).toEqual({ min: 0.5, max: 2 });
    // cene da 4000 kcal: al più il doppio di 600
    expect(estimateOutOfHome("dinner", "normal", [4000, 4000, 4000, 4000, 4000])).toEqual({ energyKcal: 1200, basis: "personal", meals: 5 });
    expect(estimateOutOfHome("dinner", "large", [4000, 4000, 4000, 4000, 4000]).energyKcal).toBe(1800);
    // pranzi da 210 kcal: almeno la metà di 800
    expect(estimateOutOfHome("lunch", "normal", [210, 210, 210, 210, 210])).toEqual({ energyKcal: 400, basis: "personal", meals: 5 });
    expect(estimateOutOfHome("lunch", "light", [210, 210, 210, 210, 210]).energyKcal).toBe(240);
    for (const kind of MEAL_KINDS) {
      for (const size of OUT_OF_HOME_SIZES) {
        const kcal = estimateOutOfHome(kind, size, [9000, 9000, 9000, 9000, 9000]).energyKcal;
        expect(kcal).toBe(OUT_OF_HOME_REFERENCE_KCAL[kind] * 2 * OUT_OF_HOME_FACTOR[size]);
        expect(kcal).toBeLessThanOrEqual(5000);
        expect(kcal).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("dà solo l'energia", () => {
    expect(Object.keys(estimateOutOfHome("lunch", "normal", [])).sort()).toEqual(["basis", "energyKcal"]);
  });
});

describe("mealEnergyHistory", () => {
  const sixLunches = [600, 650, 700, 700, 750, 800].map((kcal, i) => mealOn(day(20 + i), "lunch", [chicken(kcal)]));

  it("2. un valore per pasto del momento chiesto, in ordine di data", () => {
    const events = [...sixLunches, mealOn(day(22), "dinner", [chicken(300)])];
    expect(historyOf(events)).toEqual([600, 650, 700, 700, 750, 800]);
    expect(historyOf(events, "dinner")).toEqual([300]);
    expect(estimateOutOfHome("lunch", "large", historyOf(events))).toEqual({ energyKcal: 1050, basis: "personal", meals: 6 });
  });

  it("3. cinque pranzi di cui uno fuori casa: quello non conta, restano quattro, stima generica", () => {
    const events = [...sixLunches.slice(0, 4), mealOn(day(26), "lunch", [outOfHome(900)])];
    expect(historyOf(events)).toEqual([600, 650, 700, 700]);
    expect(estimateOutOfHome("lunch", "normal", historyOf(events))).toEqual({ energyKcal: 800, basis: "generic" });
  });

  it("un pasto che ha dentro una stima fuori casa non entra, nemmeno con le sue altre voci", () => {
    expect(historyOf([mealOn(day(26), "lunch", [chicken(300), outOfHome(500)])])).toEqual([]);
  });

  it("4. un pranzo con una voce senza valori non entra nella media", () => {
    const events = [...sixLunches.slice(0, 5), mealOn(day(27), "lunch", [chicken(900), unknown])];
    expect(historyOf(events)).toEqual([600, 650, 700, 700, 750]);
  });

  it("un pasto senza voci non entra", () => {
    expect(historyOf([mealOn(day(27), "lunch", [])])).toEqual([]);
  });

  it("solo gli ultimi 30 giorni, oggi compreso; i giorni dopo oggi no", () => {
    const events = [
      mealOn("2026-02-28", "lunch", [chicken(100)]), // 31 giorni fa
      mealOn("2026-03-01", "lunch", [chicken(200)]), // il trentesimo giorno
      mealOn(TODAY, "lunch", [chicken(300)]),
      mealOn("2026-03-31", "lunch", [chicken(400)]),
    ];
    expect(historyOf(events)).toEqual([200, 300]);
  });
});

describe("mealEnergyHistory: pasti minimi", () => {
  it("cinque colazioni fatte di una sola bevanda non entrano nella storia", () => {
    const events = [20, 21, 22, 23, 24].map((n) => mealOn(day(n), "breakfast", [milk(30)]));
    expect(historyOf(events, "breakfast")).toEqual([]);
    expect(estimateOutOfHome("breakfast", "normal", historyOf(events, "breakfast"))).toEqual({ energyKcal: 400, basis: "generic" });
  });

  it("nemmeno una bevanda abbondante: un pasto di sole voci in millilitri non dice quanto si mangia", () => {
    // 400 ml di latte sono 240 kcal, sopra la soglia della colazione
    expect(historyOf([mealOn(day(20), "breakfast", [milk(400)])], "breakfast")).toEqual([]);
    expect(historyOf([mealOn(day(20), "breakfast", [milk(400), chicken(100)])], "breakfast")).toEqual([340]);
  });

  it("un pasto sotto un quarto del pasto di riferimento del momento non entra", () => {
    expect(historyOf([mealOn(day(20), "lunch", [chicken(199)])])).toEqual([]);
    expect(historyOf([mealOn(day(20), "lunch", [chicken(200)])])).toEqual([200]);
    expect(historyOf([mealOn(day(20), "snack", [chicken(49)])], "snack")).toEqual([]);
    expect(historyOf([mealOn(day(20), "snack", [chicken(50)])], "snack")).toEqual([50]);
  });
});

describe("outOfHomeEnergyShare", () => {
  const dayOf = (events: unknown[]) => computeIntake(events, resolver, { timeZone: "UTC" }).days[0];

  it("zero senza stime fuori casa, la parte di energia stimata altrimenti", () => {
    expect(outOfHomeEnergyShare(dayOf([mealOn(day(20), "lunch", [chicken(500)])]))).toBe(0);
    const half = dayOf([mealOn(day(20), "lunch", [outOfHome(800)]), mealOn(day(20), "dinner", [chicken(800)])]);
    expect(half.outOfHome).toEqual({ meals: 1, energyKcal: 800 });
    expect(outOfHomeEnergyShare(half)).toBe(0.5);
    expect(outOfHomeEnergyShare(dayOf([mealOn(day(20), "lunch", [outOfHome(800)])]))).toBe(1);
  });
});
