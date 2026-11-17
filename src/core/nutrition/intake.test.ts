import { describe, expect, it } from "vitest";
import { consume, drink, meal, purchase, untracked, voidOf } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { createResolver } from "./resolve";
import { FAKE_FOODS, FAKE_PRODUCT } from "./test-helpers";

const resolver = createResolver({
  foods: FAKE_FOODS,
  productByRef: (ref) => (ref === FAKE_PRODUCT.barcode ? FAKE_PRODUCT : undefined),
});

const D = "2026-03-10";
const at = (hhmm: string, date = D) => `${date}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz") => ({ value, unit });

const lot = purchase("p1", at("06:00"), {
  lotId: "lot-1",
  productRef: FAKE_PRODUCT.barcode,
  quantity: q(500, "g"),
  location: "dispensa",
});

function fullDay() {
  return [
    lot,
    meal("m-b", at("07:30"), {
      mealId: "b",
      kind: "breakfast",
      items: [
        { name: "Latte intero", quantity: q(200, "ml"), certainty: "measured" },
        { name: "uova", quantity: q(2, "pz"), certainty: "estimated" },
      ],
    }),
    consume("c1", at("07:31"), { lotId: "lot-1", quantity: q(50, "g"), mealId: "b" }),
    meal("m-l", at("12:00"), {
      mealId: "l",
      kind: "lunch",
      items: [{ name: "Dolce misterioso", quantity: q(100, "g"), certainty: "measured" }],
    }),
    meal("m-d", at("19:30"), {
      mealId: "d",
      kind: "dinner",
      items: [{ name: "Petto di pollo", quantity: q(150, "g"), certainty: "measured" }],
    }),
    drink("dr1", at("09:00"), { name: "Espresso", ml: 30, caffeineMg: 63 }),
    consume("c2", at("15:00"), { lotId: "lot-1", quantity: q(20, "g") }),
  ];
}

describe("computeIntake: pasto", () => {
  const result = computeIntake(fullDay(), resolver);
  const breakfast = result.days[0].meals.find((m) => m.mealId === "b");

  it("somma le voci libere e i consumi di dispensa collegati", () => {
    expect(breakfast?.lines).toHaveLength(3);
    // 200 ml latte (120) + 2 uova = 120 g (168) + 50 g prodotto (200)
    expect(breakfast?.totals.energyKcal?.value).toBe(488);
    expect(breakfast?.totals.proteinG?.value).toBeCloseTo(6 + 14.4 + 5);
    expect(breakfast?.totals.proteinG?.partial).toBe(false);
  });

  it("segnala come parziale un nutriente che manca in alcune voci", () => {
    // I carboidrati ci sono solo nel latte; un pezzo non ha peso, quindi si conta per voci.
    expect(breakfast?.totals.carbsG).toMatchObject({
      value: 10,
      partial: true,
      missingCount: 2,
      count: 3,
      shareBy: "count",
    });
  });

  it("la certezza è la peggiore tra quantità e origine", () => {
    expect(breakfast?.certainty).toBe("estimated");
    const line = breakfast?.lines.find((l) => l.kind === "pantry");
    expect(line).toMatchObject({ status: "ok", certainty: "label" });
    expect(line?.status === "ok" && line.composition.origin).toBe("label");
    const milk = breakfast?.lines[0];
    expect(milk).toMatchObject({ status: "ok", certainty: "estimated" });
  });

  it("riporta le voci non risolte e non le conta come zero", () => {
    const lunch = result.days[0].meals.find((m) => m.mealId === "l");
    expect(lunch?.unresolved).toHaveLength(1);
    expect(lunch?.unresolved[0]).toMatchObject({ label: "Dolce misterioso", reason: "no_composition" });
    expect(lunch?.totals).toEqual({});
    expect(lunch?.certainty).toBeUndefined();
  });

  it("una quantità non convertibile è non risolta, con il motivo", () => {
    const out = computeIntake(
      [
        meal("m1", at("08:00"), {
          mealId: "x",
          kind: "breakfast",
          items: [{ name: "Petto di pollo", quantity: q(1, "pz"), certainty: "measured" }],
        }),
      ],
      resolver,
    );
    expect(out.days[0].meals[0].unresolved[0]).toMatchObject({ reason: "missing_unit_weight" });
  });

  it("un pasto con voci non risolte e risolte: i risolti sommano, la quota mancante sale", () => {
    const out = computeIntake(
      [
        meal("m1", at("08:00"), {
          mealId: "x",
          kind: "lunch",
          items: [
            { name: "Petto di pollo", quantity: q(100, "g"), certainty: "measured" },
            { name: "Sconosciuto", quantity: q(100, "g"), certainty: "measured" },
          ],
        }),
      ],
      resolver,
    );
    expect(out.days[0].meals[0].totals.energyKcal).toMatchObject({
      value: 100,
      partial: true,
      missingShare: 0.5,
      shareBy: "weight",
    });
  });
});

describe("computeIntake: giornata", () => {
  const result = computeIntake(fullDay(), resolver);
  const day = result.days[0];

  it("somma pasti, consumo senza pasto e bevande", () => {
    expect(result.days).toHaveLength(1);
    expect(day.date).toBe(D);
    expect(day.standalone).toHaveLength(1);
    expect(day.standalone[0]).toMatchObject({ status: "ok", label: FAKE_PRODUCT.barcode });
    // colazione 488 + pollo 150 + consumo senza pasto 20 g * 4 = 80
    expect(day.totals.energyKcal?.value).toBe(488 + 150 + 80);
    expect(day.totals.energyKcal?.partial).toBe(true); // il dolce misterioso non ha dati
  });

  it("le bevande portano solo la sostanza dichiarata, senza rendere parziali gli altri nutrienti", () => {
    expect(day.drinks).toHaveLength(1);
    expect(day.totals.caffeineMg?.value).toBe(63);
    expect(day.totals.alcoholG).toBeUndefined();
  });

  it("elenca le voci non risolte della giornata", () => {
    expect(day.unresolved.map((u) => u.label)).toEqual(["Dolce misterioso"]);
  });

  it("un giorno con colazione, pranzo e cena tracciati è completo", () => {
    expect(day.complete).toBe(true);
    expect(day.reasons).toEqual([]);
    expect(day.coverage.status).toBe("complete");
  });

  it("un pasto non tracciato rende parziale il giorno", () => {
    const out = computeIntake(
      [
        ...fullDay().filter((e) => e.id !== "m-l"),
        untracked("u1", at("12:30"), { kind: "lunch" }),
      ],
      resolver,
    );
    expect(out.days[0].complete).toBe(false);
    expect(out.days[0].reasons).toContain("untracked_meals");
    expect(out.days[0].reasons).not.toContain("missing_meals");
  });

  it("un vuoto (manca la cena) rende parziale il giorno", () => {
    const out = computeIntake(fullDay().filter((e) => e.id !== "m-d"), resolver);
    expect(out.days[0].complete).toBe(false);
    expect(out.days[0].reasons).toEqual(["missing_meals"]);
    expect(out.days[0].coverage.missing).toEqual(["dinner"]);
  });

  it("un pasto tracciato senza voci è un vuoto", () => {
    const events = fullDay().map((e) =>
      e.id === "m-d" ? meal("m-d", at("19:30"), { mealId: "d", kind: "dinner", items: [] }) : e,
    );
    const out = computeIntake(events, resolver);
    expect(out.days[0].complete).toBe(false);
    expect(out.days[0].reasons).toEqual(["empty_meals"]);
  });

  it("un giorno con solo un consumo di dispensa esiste ed è parziale", () => {
    const out = computeIntake(
      [lot, consume("c9", at("10:00", "2026-03-11"), { lotId: "lot-1", quantity: q(10, "g") })],
      resolver,
    );
    expect(out.days.map((d) => d.date)).toEqual(["2026-03-11"]);
    expect(out.days[0].complete).toBe(false);
    expect(out.days[0].totals.energyKcal?.value).toBe(40);
  });
});

describe("computeIntake: registro", () => {
  it("ignora gli eventi annullati e non conta i duplicati", () => {
    const events = [...fullDay(), voidOf("v1", at("16:00"), "c2")];
    const out = computeIntake([...events, ...events], resolver);
    expect(out.days[0].standalone).toHaveLength(0);
    expect(out.days[0].totals.energyKcal?.value).toBe(488 + 150);
  });

  it("l'ordine degli eventi non cambia il risultato", () => {
    const events = fullDay();
    expect(computeIntake([...events].reverse(), resolver)).toEqual(computeIntake(events, resolver));
  });

  it("un consumo di un pasto che non esiste va alla giornata del suo istante", () => {
    const out = computeIntake(
      [lot, consume("c3", at("10:00"), { lotId: "lot-1", quantity: q(10, "g"), mealId: "ghost" })],
      resolver,
    );
    expect(out.days[0].standalone[0]).toMatchObject({ mealId: "ghost", status: "ok" });
  });

  it("un consumo di un lotto sconosciuto non è risolto", () => {
    const out = computeIntake(
      [consume("c4", at("10:00"), { lotId: "nope", quantity: q(10, "g") })],
      resolver,
    );
    expect(out.days[0].standalone[0]).toMatchObject({ status: "unresolved", reason: "unknown_lot" });
  });

  it("assegna i giorni nel fuso scelto", () => {
    const events = [
      lot,
      consume("c5", "2026-03-10T23:30:00.000Z", { lotId: "lot-1", quantity: q(10, "g") }),
    ];
    expect(computeIntake(events, resolver).days[0].date).toBe("2026-03-11");
    expect(computeIntake(events, resolver, { timeZone: "UTC" }).days[0].date).toBe("2026-03-10");
  });

  it("senza eventi non ci sono giorni", () => {
    expect(computeIntake([], resolver).days).toEqual([]);
  });
});
