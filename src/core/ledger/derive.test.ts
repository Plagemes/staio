import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { mergeEvents } from "./merge";
import {
  adjust,
  consume,
  declare,
  discard,
  gift,
  move,
  open,
  purchase,
  q,
  seededRandom,
  shuffled,
  updateLot,
  voidOf,
} from "./test-helpers";
import type { LedgerEvent } from "./types";

const T = (h: number, m = 0, s = 0) =>
  `2026-03-10T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;

const milk = (id = "e1", at = T(8)) =>
  purchase(id, at, {
    lotId: "L1",
    productRef: "latte",
    quantity: q(1000, "ml"),
    priceCents: 150,
    store: "Coop",
    location: "frigo",
    expiry: { date: "2026-03-20", kind: "use_by" },
  });

describe("derivePantry: flussi base", () => {
  it("acquisto e consumi riducono la quantità rimasta", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(250, "ml"), mealId: "m1" }),
      consume("e3", T(10), { lotId: "L1", quantity: q(250, "ml") }),
    ]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots).toHaveLength(1);
    const lot = state.lots[0];
    expect(lot).toMatchObject({
      lotId: "L1",
      productRef: "latte",
      origin: "purchase",
      status: "active",
      unit: "ml",
      initial: 1000,
      remaining: 500,
      consumed: 500,
      location: "frigo",
      priceCents: 150,
      store: "Coop",
      createdAt: T(8),
      expiry: { date: "2026-03-20", kind: "use_by" },
    });
    expect(lot.history.map((h) => h.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(lot.history[1].quantityDelta).toBe(-250);
  });

  it("un lotto a zero diventa finito", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(1000, "ml") }),
    ]);
    expect(state.lots[0]).toMatchObject({ remaining: 0, status: "finished", finishedAt: T(9) });
    expect(state.anomalies).toEqual([]);
  });

  it("declare crea un lotto senza prezzo; discard e gift hanno totali separati", () => {
    const state = derivePantry([
      declare("d1", T(7), {
        lotId: "L2",
        productRef: "riso",
        quantity: q(1000),
        location: "dispensa",
      }),
      discard("d2", T(8), { lotId: "L2", quantity: q(100), reason: "expired" }),
      gift("d3", T(9), { lotId: "L2", quantity: q(200) }),
    ]);
    expect(state.lots[0]).toMatchObject({
      origin: "declare",
      remaining: 700,
      discarded: 100,
      gifted: 200,
      consumed: 0,
    });
    expect(state.lots[0].priceCents).toBeUndefined();
    expect(state.lots[0].history[1]).toMatchObject({ type: "discard", reason: "expired" });
  });

  it("open registra la prima apertura; move registra congelamento e scongelamento", () => {
    const state = derivePantry([
      milk(),
      open("e2", T(9), { lotId: "L1" }),
      open("e3", T(10), { lotId: "L1" }),
      move("e4", T(11), { lotId: "L1", to: "freezer" }),
      move("e5", T(12), { lotId: "L1", to: "freezer" }),
      move("e6", T(13), { lotId: "L1", to: "frigo" }),
    ]);
    expect(state.lots[0]).toMatchObject({
      openedAt: T(9),
      location: "frigo",
      frozenAt: T(11),
      thawedAt: T(13),
    });
  });

  it("l'ordine di ingresso non conta: gli eventi sono riordinati per tempo", () => {
    const events = [
      consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml") }),
      milk(),
    ];
    expect(derivePantry(events).lots[0].remaining).toBe(900);
  });

  it("non muta gli eventi in ingresso e non condivide oggetti con essi", () => {
    const e = milk();
    const snapshot = JSON.stringify(e);
    const state = derivePantry([e]);
    state.lots[0].expiry!.date = "1999-01-01";
    expect(JSON.stringify(e)).toBe(snapshot);
  });

  it("asOf mostra lo stato a un istante passato", () => {
    const events = [
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(400, "ml") }),
      consume("e3", T(12), { lotId: "L1", quantity: q(400, "ml") }),
    ];
    expect(derivePantry(events, { asOf: T(10) }).lots[0].remaining).toBe(600);
    expect(derivePantry(events).lots[0].remaining).toBe(200);
  });

  it("le somme decimali arrivano esattamente a zero", () => {
    const state = derivePantry([
      purchase("p", T(1), {
        lotId: "L",
        productRef: "x",
        quantity: q(0.3, "pz"),
        location: "dispensa",
      }),
      consume("c1", T(2), { lotId: "L", quantity: q(0.1, "pz") }),
      consume("c2", T(3), { lotId: "L", quantity: q(0.1, "pz") }),
      consume("c3", T(4), { lotId: "L", quantity: q(0.1, "pz") }),
    ]);
    expect(state.lots[0]).toMatchObject({ remaining: 0, status: "finished" });
    expect(state.anomalies).toEqual([]);
  });
});

describe("derivePantry: certezza", () => {
  it("la quantità rimasta peggiora con uscite stimate e si azzera con adjust misurato", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml"), certainty: "estimated" }),
    ]);
    expect(state.lots[0].remainingCertainty).toBe("estimated");
    expect(state.lots[0].initialCertainty).toBe("measured");
    const again = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml"), certainty: "estimated" }),
      adjust("e3", T(10), { lotId: "L1", remaining: q(850, "ml") }),
    ]);
    expect(again.lots[0].remainingCertainty).toBe("measured");
  });
});

describe("derivePantry: annullamento e ripristino", () => {
  const base = [
    milk(),
    consume("e2", T(9), { lotId: "L1", quantity: q(300, "ml") }),
  ];

  it("un evento annullato è ignorato ma resta nel libro", () => {
    const state = derivePantry([...base, voidOf("v1", T(10), "e2")]);
    expect(state.lots[0].remaining).toBe(1000);
    expect(state.voidedEventIds).toEqual(["e2"]);
    expect(state.anomalies).toEqual([]);
  });

  it("annullare il void ripristina l'evento; annullarlo ancora lo riannulla", () => {
    const v1 = voidOf("v1", T(10), "e2");
    const v2 = voidOf("v2", T(11), "v1");
    expect(derivePantry([...base, v1, v2]).lots[0].remaining).toBe(700);
    expect(derivePantry([...base, v1, v2]).voidedEventIds).toEqual(["v1"]);
    const v3 = voidOf("v3", T(12), "v2");
    expect(derivePantry([...base, v1, v2, v3]).lots[0].remaining).toBe(1000);
  });

  it("l'ordine temporale del void non conta: vale il grafo degli annullamenti", () => {
    // il void ha `at` anteriore al bersaglio (orologi sfasati tra dispositivi)
    const state = derivePantry([...base, voidOf("v1", T(5), "e2")]);
    expect(state.lots[0].remaining).toBe(1000);
  });

  it("void su evento sconosciuto: anomalia, nessun effetto", () => {
    const state = derivePantry([...base, voidOf("v1", T(10), "nope")]);
    expect(state.lots[0].remaining).toBe(700);
    expect(state.anomalies).toEqual([
      { code: "void_target_missing", eventId: "v1", targetEventId: "nope" },
    ]);
  });

  it("void su se stesso o ciclo di void: ignorati con anomalia, senza loop infinito", () => {
    const self = derivePantry([...base, voidOf("v1", T(10), "v1")]);
    expect(self.lots[0].remaining).toBe(700);
    expect(self.anomalies.map((a) => a.code)).toEqual(["void_cycle"]);

    const cycle = derivePantry([
      ...base,
      voidOf("v1", T(10), "v2"),
      voidOf("v2", T(11), "v1"),
      voidOf("v3", T(12), "e2"),
    ]);
    expect(cycle.anomalies.filter((a) => a.code === "void_cycle")).toHaveLength(2);
    expect(cycle.lots[0].remaining).toBe(1000); // v3 resta efficace
  });

  it("annullare l'acquisto fa sparire il lotto; gli eventi successivi sono anomali", () => {
    const state = derivePantry([...base, voidOf("v1", T(10), "e1")]);
    expect(state.lots).toEqual([]);
    expect(state.anomalies).toEqual([
      { code: "unknown_lot", eventId: "e2", lotId: "L1" },
    ]);
  });
});

describe("derivePantry: adjust e updateLot", () => {
  it("adjust imposta la quantità assoluta e può riattivare un lotto finito", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(1000, "ml") }),
      adjust("e3", T(10), { lotId: "L1", remaining: q(300, "ml") }),
    ]);
    expect(state.lots[0]).toMatchObject({ remaining: 300, status: "active" });
    expect(state.lots[0].finishedAt).toBeUndefined();
    expect(state.lots[0].history[2].quantityDelta).toBe(300);
  });

  it("adjust a zero finisce il lotto", () => {
    const state = derivePantry([
      milk(),
      adjust("e2", T(9), { lotId: "L1", remaining: q(0, "ml") }),
    ]);
    expect(state.lots[0]).toMatchObject({ remaining: 0, status: "finished" });
  });

  it("updateLot arricchisce scadenza, prodotto, prezzo e negozio; null cancella", () => {
    const state = derivePantry([
      declare("d1", T(7), {
        lotId: "L2",
        productRef: "free text",
        quantity: q(500),
        location: "dispensa",
      }),
      updateLot("u1", T(8), {
        lotId: "L2",
        certainty: "label",
        patch: {
          productRef: "cat:pasta",
          expiry: { date: "2027-01-31", kind: "best_before" },
          priceCents: 99,
          store: "Lidl",
        },
      }),
    ]);
    expect(state.lots[0]).toMatchObject({
      productRef: "cat:pasta",
      expiry: { date: "2027-01-31", kind: "best_before" },
      priceCents: 99,
      priceCertainty: "label",
      store: "Lidl",
    });
    const cleared = derivePantry([
      milk(),
      updateLot("u1", T(9), { lotId: "L1", patch: { expiry: null, priceCents: null, store: null } }),
    ]);
    expect(cleared.lots[0].expiry).toBeUndefined();
    expect(cleared.lots[0].priceCents).toBeUndefined();
    expect(cleared.lots[0].store).toBeUndefined();
  });

  it("updateLot su lotto finito è applicato (arricchimento tardivo)", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(1000, "ml") }),
      updateLot("u1", T(10), { lotId: "L1", patch: { priceCents: 160 } }),
    ]);
    expect(state.lots[0].priceCents).toBe(160);
    expect(state.lots[0].status).toBe("finished");
  });
});

describe("derivePantry: ordinamento con pareggi", () => {
  it("a pari `at` decide recordedAt, poi id", () => {
    // adjust poi consume o consume poi adjust danno risultati diversi: l'ordine deve essere fisso
    const a = adjust("b", T(9), { lotId: "L1", remaining: q(500, "ml"), recordedAt: T(9, 0, 1) });
    const c = consume("a", T(9), { lotId: "L1", quantity: q(100, "ml"), recordedAt: T(9, 0, 2) });
    expect(derivePantry([milk(), c, a]).lots[0].remaining).toBe(400); // a (rec. prima) poi c
    expect(derivePantry([milk(), a, c]).lots[0].remaining).toBe(400);

    // stesso at e recordedAt: decide l'id
    const a2 = adjust("z", T(9), { lotId: "L1", remaining: q(500, "ml") });
    const c2 = consume("a", T(9), { lotId: "L1", quantity: q(100, "ml") });
    expect(derivePantry([milk(), a2, c2]).lots[0].remaining).toBe(500); // c2 (id "a") poi a2
    expect(derivePantry([milk(), c2, a2]).lots[0].remaining).toBe(500);
  });

  it("formati diversi dello stesso istante (con e senza millisecondi) si ordinano per valore", () => {
    const early = consume("x", "2026-03-10T09:00:00Z", { lotId: "L1", quantity: q(1, "ml") });
    const late = adjust("a", "2026-03-10T09:00:00.500Z", {
      lotId: "L1",
      remaining: q(10, "ml"),
    });
    expect(derivePantry([milk(), late, early]).lots[0].remaining).toBe(10);
  });
});

describe("derivePantry: anomalie senza eccezioni", () => {
  it("consumo eccessivo: si ferma a zero e segnala", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(800, "ml") }),
      consume("e3", T(10), { lotId: "L1", quantity: q(500, "ml") }),
      consume("e4", T(11), { lotId: "L1", quantity: q(50, "ml") }),
    ]);
    expect(state.lots[0]).toMatchObject({ remaining: 0, status: "finished", consumed: 1000 });
    expect(state.anomalies).toEqual([
      { code: "over_consumption", eventId: "e3", lotId: "L1", requested: 500, available: 200 },
      { code: "over_consumption", eventId: "e4", lotId: "L1", requested: 50, available: 0 },
    ]);
    expect(state.lots[0].history[2]).toMatchObject({ quantityDelta: -200, clamped: true });
  });

  it("lotto inesistente: anomalia e evento saltato", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "GHOST", quantity: q(1, "ml") }),
      open("e3", T(9), { lotId: "GHOST" }),
    ]);
    expect(state.lots[0].remaining).toBe(1000);
    expect(state.anomalies.map((a) => [a.code, a.eventId, a.lotId])).toEqual([
      ["unknown_lot", "e2", "GHOST"],
      ["unknown_lot", "e3", "GHOST"],
    ]);
  });

  it("evento anteriore alla creazione del lotto: avviso, ma applicato come avvenuto alla creazione", () => {
    const state = derivePantry([
      consume("e0", T(6), { lotId: "L1", quantity: q(1, "ml") }),
      milk(),
    ]);
    expect(state.lots[0].remaining).toBe(999);
    expect(state.lots[0].history[1]).toMatchObject({ eventId: "e0", at: T(8), quantityDelta: -1 });
    expect(state.anomalies).toEqual([{ code: "event_before_lot", eventId: "e0", lotId: "L1" }]);
  });

  it("unità incoerente con il lotto: anomalia e evento saltato", () => {
    const state = derivePantry([
      milk(),
      consume("e2", T(9), { lotId: "L1", quantity: q(100, "g") }),
      adjust("e3", T(10), { lotId: "L1", remaining: q(1, "pz") }),
    ]);
    expect(state.lots[0].remaining).toBe(1000);
    expect(state.anomalies).toEqual([
      { code: "unit_mismatch", eventId: "e2", lotId: "L1", expectedUnit: "ml", actualUnit: "g" },
      { code: "unit_mismatch", eventId: "e3", lotId: "L1", expectedUnit: "ml", actualUnit: "pz" },
    ]);
  });

  it("acquisto duplicato dello stesso lotto: il secondo è saltato", () => {
    const state = derivePantry([
      milk("e1", T(8)),
      purchase("e9", T(9), {
        lotId: "L1",
        productRef: "altro",
        quantity: q(5, "pz"),
        location: "frigo",
      }),
    ]);
    expect(state.lots).toHaveLength(1);
    expect(state.lots[0].productRef).toBe("latte");
    expect(state.anomalies).toEqual([{ code: "duplicate_lot", eventId: "e9", lotId: "L1" }]);
  });

  it("eventi non validi o spazzatura: anomalia, nessuna eccezione", () => {
    const bad = { ...consume("e2", T(9), { lotId: "L1", quantity: q(-5, "ml") }) };
    const junk = [null, 42, { foo: 1 }] as unknown as LedgerEvent[];
    const state = derivePantry([milk(), bad, ...junk]);
    expect(state.lots[0].remaining).toBe(1000);
    const codes = state.anomalies.map((a) => a.code);
    expect(codes.filter((c) => c === "invalid_event")).toHaveLength(4);
    expect(state.anomalies.find((a) => a.eventId === "e2")?.errors).toEqual([
      { path: "quantity.value", code: "not_positive" },
    ]);
  });

  it("stesso id con contenuti diversi: sceglie in modo deterministico e segnala", () => {
    const v1 = consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml") });
    const v2 = { ...v1, recordedAt: T(9, 0, 5), quantity: q(200, "ml") };
    const a = derivePantry([milk(), v1, v2]);
    const b = derivePantry([milk(), v2, v1]);
    expect(a).toEqual(b);
    expect(a.lots[0].remaining).toBe(800); // vince la registrazione più recente
    expect(a.anomalies).toEqual([{ code: "id_conflict", eventId: "e2" }]);
  });

  it("duplicati identici non cambiano nulla", () => {
    const events = [milk(), consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml") })];
    expect(derivePantry([...events, ...events, ...events])).toEqual(derivePantry(events));
  });
});

describe("derivePantry: invarianza rispetto all'ordine di ingresso", () => {
  const scenario: LedgerEvent[] = [
    milk(),
    purchase("p2", T(8, 30), {
      lotId: "L2",
      productRef: "uova",
      quantity: q(6, "pz"),
      location: "frigo",
      certainty: "label",
    }),
    consume("c1", T(9), { lotId: "L1", quantity: q(300, "ml") }),
    consume("c2", T(9), { lotId: "L1", quantity: q(300, "ml"), recordedAt: T(9, 0, 1) }),
    consume("c3", T(9), { lotId: "L1", quantity: q(300, "ml"), recordedAt: T(9, 0, 1) }),
    consume("c4", T(9, 5), { lotId: "L1", quantity: q(500, "ml") }), // consumo eccessivo
    voidOf("v1", T(10), "c3"),
    voidOf("v2", T(11), "v1"), // ripristina c3
    voidOf("v3", T(12), "c1"),
    adjust("a1", T(13), { lotId: "L2", remaining: q(4, "pz") }),
    discard("x1", T(14), { lotId: "L2", quantity: q(1, "pz"), reason: "expired" }),
    updateLot("u1", T(14, 30), { lotId: "L2", patch: { priceCents: 280 } }),
    open("o1", T(15), { lotId: "L2" }),
    move("m1", T(16), { lotId: "L2", to: "freezer" }),
    consume("g1", T(17), { lotId: "GHOST", quantity: q(1, "pz") }),
    consume("u2", T(18), { lotId: "L2", quantity: q(1, "g") }), // unità errata
    voidOf("v9", T(19), "missing"),
    voidOf("va", T(20), "vb"),
    voidOf("vb", T(21), "va"),
  ];

  it("20 permutazioni casuali a seme fisso danno lo stesso stato e le stesse anomalie", () => {
    const expected = derivePantry(scenario);
    expect(expected.anomalies.length).toBeGreaterThan(3);
    const random = seededRandom(20260310);
    for (let i = 0; i < 20; i++) {
      expect(derivePantry(shuffled(scenario, random))).toEqual(expected);
    }
  });

  it("derivare dall'unione di due metà equivale a derivare dall'insieme intero", () => {
    const expected = derivePantry(scenario);
    const random = seededRandom(7);
    for (let i = 0; i < 10; i++) {
      const mixed = shuffled(scenario, random);
      const cut = Math.floor(random() * mixed.length);
      const merged = mergeEvents(mixed.slice(0, cut), mixed.slice(cut - 1 < 0 ? 0 : cut - 1));
      expect(derivePantry(merged.events)).toEqual(expected);
    }
  });
});
