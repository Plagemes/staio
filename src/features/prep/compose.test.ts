import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { derivePreps, voidPrep } from "@/core/prep";
import { composeFromInput, eatPortionInMeal, nutrientsOfFrom, prepMessage, type PrepInput } from "./compose";
import { NOW, lotsOf } from "./test-helpers";

const CTX = { now: NOW, deviceId: "dev-a" };

function setup() {
  const { events, lots } = lotsOf([
    { id: "riso", name: "Riso", value: 500, priceCents: 250 },
    { id: "pollo", name: "Petto di pollo", value: 600, priceCents: 600 },
    { id: "spezie", name: "Spezie", value: 50 },
  ]);
  const byId = Object.fromEntries(lots.map((l) => [l.lotId, l])) as Record<string, Lot>;
  const input = (over: Partial<PrepInput> = {}): PrepInput => ({
    title: "Pollo e riso",
    portionsText: "4",
    location: "frigo",
    shelfDaysText: "",
    picks: [
      { lot: byId.riso, quantityText: "200 g" },
      { lot: byId.pollo, quantityText: "400" },
    ],
    ...over,
  });
  return { events, lots, byId, input };
}

function compose(input: PrepInput, ctx = CTX) {
  const r = composeFromInput(input, ctx);
  if (!r.ok) throw new Error(`atteso ok: ${JSON.stringify(r.errors)}`);
  return r.composed;
}

describe("composeFromInput", () => {
  it("compone consumi, lotto di porzioni e preparazione, con scadenza stimata e costo per porzione", () => {
    const { input } = setup();
    const c = compose(input());
    const types = c.events.map((e) => e.type);
    expect(types.filter((t) => t === "consume")).toHaveLength(2);
    expect(types).toContain("declare");
    expect(types.at(-1)).toBe("prep");
    expect(c.expiry.kind).toBe("estimated");
    // 200/500 di 2,50 € + 400/600 di 6,00 € = 1,00 + 4,00 = 5,00 €, su 4 porzioni
    expect(c.cost.totalCents).toBe(500);
    expect(c.cost.perPortionCents).toBe(125);
    expect(c.cost.partial).toBe(false);
  });

  it("dichiara il costo parziale quando un ingrediente non ha prezzo", () => {
    const { input, byId } = setup();
    const c = compose(input({ picks: [{ lot: byId.riso, quantityText: "200" }, { lot: byId.spezie, quantityText: "5" }] }));
    expect(c.cost.partial).toBe(true);
  });

  it("senza alcun prezzo il costo non è zero ma assente", () => {
    const { input, byId } = setup();
    const c = compose(input({ picks: [{ lot: byId.spezie, quantityText: "5" }] }));
    expect(c.cost.perPortionCents).toBeUndefined();
  });

  it("la durata scelta prevale sulla stima e conta dal giorno di cottura", () => {
    const { input } = setup();
    expect(compose(input({ shelfDaysText: "2" })).expiry.date).toBe("2026-11-18");
  });

  it("il freezer dura più del frigo", () => {
    const { input } = setup();
    expect(compose(input({ location: "freezer" })).expiry.date > compose(input()).expiry.date).toBe(true);
  });

  it("riporta gli errori accanto al campo giusto", () => {
    const { input, byId } = setup();
    const bad = composeFromInput(
      input({ title: " ", portionsText: "2,5", shelfDaysText: "-1", picks: [{ lot: byId.riso, quantityText: "900 g" }] }),
      CTX,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.title).toBeDefined();
    expect(bad.errors.portions).toBeDefined();
    expect(bad.errors.shelfDays).toBeDefined();
    expect(bad.errors.picks.riso).toContain("Ne restano solo");
  });

  it("chiede almeno un ingrediente", () => {
    const { input } = setup();
    const r = composeFromInput(input({ picks: [] }), CTX);
    expect(!r.ok && r.errors.general).toBeDefined();
  });

  it("scrive eventi che la dispensa e le preparazioni leggono: porzioni, ingredienti scalati", () => {
    const { events, input } = setup();
    const c = compose(input());
    const all = [...events, ...c.events] as AnyEvent[];
    expect(derivePantry(all).lots.find((l) => l.lotId === "riso")?.remaining).toBe(300);
    const prep = derivePreps(all).preps[0];
    expect(prep?.remaining).toBe(4);
    expect(prep?.title).toBe("Pollo e riso");
  });

  it("calcola i nutrienti per porzione con la funzione passata", () => {
    const { input } = setup();
    const nutrientsOf = nutrientsOfFrom((s) =>
      s.kind === "pantry" && s.productRef === "Riso"
        ? { name: "Riso", origin: "table", basis: "g", per100: { energyKcal: 350 } }
        : undefined,
    );
    const c = compose(input(), { ...CTX, nutrientsOf } as typeof CTX);
    const energy = c.nutrients?.perPortion.energyKcal;
    // 200 g di riso = 700 kcal, su 4 porzioni = 175 kcal; il pollo non ha dati: valore minimo
    expect(energy?.value).toBe(175);
    expect(energy?.partial).toBe(true);
    expect(c.nutrients?.notComputable).toEqual(["pollo"]);
  });
});

describe("annullare una preparazione", () => {
  it("rifiuta se le porzioni sono già state usate", () => {
    const { events, input } = setup();
    const c = compose(input());
    const batch = derivePantry([...events, ...c.events] as AnyEvent[]).lots.find((l) => l.lotId === c.batchLotId) as Lot;
    const meal = eatPortionInMeal({ title: "Pollo e riso" }, batch, "dinner", CTX);
    if (!meal.ok) throw new Error("atteso ok");
    const log = [...events, ...c.events, ...meal.events] as AnyEvent[];
    const v = voidPrep(c.prepId, log, { deviceId: "dev-a", now: () => NOW });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toBe("portions_used");
  });

  it("senza porzioni usate rimette tutto a posto", () => {
    const { events, input } = setup();
    const c = compose(input());
    const log = [...events, ...c.events] as AnyEvent[];
    const v = voidPrep(c.prepId, log, { deviceId: "dev-a", now: () => NOW });
    if (!v.ok) throw new Error("atteso ok");
    const after = derivePantry([...log, ...v.events]);
    expect(after.lots.find((l) => l.lotId === "riso")?.remaining).toBe(500);
  });
});

describe("eatPortionInMeal", () => {
  it("registra un pasto con una porzione e scala il lotto", () => {
    const { events, input } = setup();
    const c = compose(input());
    const batch = derivePantry([...events, ...c.events] as AnyEvent[]).lots.find((l) => l.lotId === c.batchLotId) as Lot;
    const meal = eatPortionInMeal({ title: "Pollo e riso" }, batch, "lunch", CTX);
    if (!meal.ok) throw new Error("atteso ok");
    expect(meal.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    const after = derivePantry([...events, ...c.events, ...meal.events] as AnyEvent[]);
    expect(after.lots.find((l) => l.lotId === c.batchLotId)?.remaining).toBe(3);
  });

  it("rifiuta se le porzioni sono finite", () => {
    const { events, input } = setup();
    const c = compose(input({ portionsText: "1" }));
    const batch = derivePantry([...events, ...c.events] as AnyEvent[]).lots.find((l) => l.lotId === c.batchLotId) as Lot;
    expect(eatPortionInMeal({ title: "x" }, { ...batch, remaining: 0 }, "lunch", CTX).ok).toBe(false);
  });
});

describe("prepMessage", () => {
  it("dice porzioni e luogo", () => {
    expect(prepMessage(" Ragù ", 6, "freezer")).toBe("Preparato: Ragù, 6 porzioni in freezer.");
    expect(prepMessage("Zuppa", 1, "frigo")).toBe("Preparato: Zuppa, 1 porzione in frigo.");
  });
});
