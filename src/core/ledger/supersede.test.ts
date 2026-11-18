import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { consumeRoots, supersededConsumes } from "./supersede";
import { consume, purchase, q, seededRandom, shuffled, voidOf } from "./test-helpers";

const D = "2026-03-10";
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(1000), location: "frigo" });
const original = consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(100) });
const voidOriginal = (id: string, when: string) => voidOf(id, when, "c1");
// due dispositivi correggono lo stesso consumo prima di sincronizzarsi: due sostituti con lo stesso `replaces`
const byA = consume("ca", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "c1", recordedAt: at("14:00"), deviceId: "dev-a" });
const byB = consume("cb", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "c1", recordedAt: at("14:01"), deviceId: "dev-b" });
const base = [lot, original, voidOriginal("v-a", at("14:00")), byA, byB];

describe("due sostituti dello stesso consumo", () => {
  it("la dispensa scala una volta sola, qualunque sia l'ordine di arrivo", () => {
    const random = seededRandom(7);
    for (let i = 0; i < 30; i++) {
      const state = derivePantry(shuffled(base, random));
      expect(state.lots[0].remaining).toBe(900);
      expect(state.voidedEventIds).toContain("ca");
      expect(state.voidedEventIds).not.toContain("cb");
    }
  });

  it("vale il più recente; a parità di istante, l'id più alto", () => {
    expect([...supersededConsumes(base, new Set(["c1"]))]).toEqual(["ca"]);
    const tie = { ...byB, recordedAt: byA.recordedAt };
    expect([...supersededConsumes([byA, tie], new Set())]).toEqual(["ca"]);
  });

  it("se il vincitore viene annullato vale l'altro", () => {
    const state = derivePantry([...base, voidOf("v-b", at("15:00"), "cb")]);
    expect(state.lots[0].remaining).toBe(900);
    expect(state.voidedEventIds).toContain("cb");
    expect(state.voidedEventIds).not.toContain("ca");
  });

  it("un consumo che sostituisce un altro, da solo, conta; così la catena c1 → c2 → c3", () => {
    const chain = [
      lot,
      original,
      voidOriginal("v1", at("14:00")),
      consume("c2", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "c1" }),
      voidOf("v2", at("14:05"), "c2"),
      consume("c3", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "c2" }),
    ];
    expect(derivePantry(chain).lots[0].remaining).toBe(900);
    expect(supersededConsumes(chain, new Set(["c1", "c2"])).size).toBe(0);
  });
});

describe("sostituti di un evento che non è un consumo", () => {
  it("due consumi che citano un acquisto restano due consumi", () => {
    const x = consume("cx", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "p1", recordedAt: at("14:00") });
    const y = consume("cy", at("13:05"), { lotId: "lot-1", quantity: q(100), replaces: "p1", recordedAt: at("14:01") });
    expect([...supersededConsumes([lot, x, y], new Set())]).toEqual([]);
    expect(derivePantry([lot, x, y]).lots[0].remaining).toBe(800);
  });

  it("due consumi che citano un evento di un altro modulo (un pasto del diario) restano due consumi", () => {
    const mealOfDiary = { id: "m1", type: "meal", at: at("13:00"), recordedAt: at("13:00"), deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", mealId: "meal-1", kind: "lunch" };
    const x = consume("cx", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "m1", recordedAt: at("14:00") });
    const y = consume("cy", at("13:05"), { lotId: "lot-1", quantity: q(100), replaces: "m1", recordedAt: at("14:01") });
    const random = seededRandom(15);
    for (let i = 0; i < 20; i++) {
      const state = derivePantry(shuffled([lot, mealOfDiary, x, y], random) as never[]);
      expect(state.lots[0].remaining).toBe(800);
      expect(state.anomalies).toEqual([]);
    }
  });

  it("due sostituti di un consumo non ancora arrivato si riducono a uno", () => {
    expect([...supersededConsumes([lot, byA, byB], new Set())]).toEqual(["ca"]);
  });
});

describe("catene di sostituti: una famiglia sola, qualunque anello si citi", () => {
  // Il telefono A corregge due volte (ogni sostituto cita il precedente), il telefono B una volta sola.
  const a1 = consume("a1", at("13:00"), { lotId: "lot-1", quantity: q(200), replaces: "c1", recordedAt: at("14:00"), deviceId: "dev-a" });
  const a2 = consume("a2", at("13:00"), { lotId: "lot-1", quantity: q(150), replaces: "a1", recordedAt: at("14:02"), deviceId: "dev-a" });
  const b1 = consume("b1", at("13:00"), { lotId: "lot-1", quantity: q(120), replaces: "c1", recordedAt: at("14:01"), deviceId: "dev-b" });
  const chains = [
    lot,
    original,
    voidOf("va0", at("14:00"), "c1", { deviceId: "dev-a" }),
    a1,
    voidOf("va1", at("14:02"), "a1", { deviceId: "dev-a" }),
    a2,
    voidOf("vb0", at("14:01"), "c1", { deviceId: "dev-b" }),
    b1,
  ];

  it("due correzioni su un telefono e una sull'altro: vale un solo consumo, il più recente, in qualunque ordine di arrivo", () => {
    const random = seededRandom(11);
    for (let i = 0; i < 40; i++) {
      const state = derivePantry(shuffled(chains, random));
      expect(state.lots[0].remaining).toBe(850);
      expect(state.lots[0].consumed).toBe(150);
      expect(state.voidedEventIds).toContain("b1");
      expect(state.anomalies).toEqual([]);
    }
  });

  it("lo stesso se l'ultimo sostituto cita il capostipite invece del precedente", () => {
    const direct = chains.map((e) => (e.id === "a2" ? { ...a2, replaces: "c1" } : e));
    const random = seededRandom(12);
    for (let i = 0; i < 20; i++) expect(derivePantry(shuffled(direct, random)).lots[0].remaining).toBe(850);
  });

  it("annullato il vincitore vale quello che lo precede; annullati tutti, non conta più niente", () => {
    const withoutWinner = [...chains, voidOf("x1", at("15:00"), "a2")];
    expect(derivePantry(withoutWinner).lots[0].remaining).toBe(880);
    const none = [...withoutWinner, voidOf("x2", at("15:00"), "b1")];
    expect(derivePantry(none).lots[0].remaining).toBe(1000);
  });

  it("il capostipite ancora valido (il suo annullamento non è arrivato) non conta insieme al suo sostituto", () => {
    const late = [lot, original, a1];
    expect(derivePantry(late).lots[0].remaining).toBe(800);
    expect([...supersededConsumes(late, new Set())]).toEqual(["c1"]);
  });

  it("un anello non ancora arrivato: chi lo cita sta insieme, e quando arriva la catena si ricompone", () => {
    const a3 = consume("a3", at("13:00"), { lotId: "lot-1", quantity: q(90), replaces: "a2", recordedAt: at("14:05"), deviceId: "dev-a" });
    const partial = [lot, original, voidOf("vb0", at("14:01"), "c1"), b1, a3];
    expect(consumeRoots(partial).get("a3")).toBe("a2");
    expect(consumeRoots(partial).get("b1")).toBe("c1");
    const whole = [...chains, voidOf("va2", at("14:05"), "a2", { deviceId: "dev-a" }), a3];
    expect(new Set(["a1", "a2", "a3", "b1", "c1"].map((id) => consumeRoots(whole).get(id)))).toEqual(new Set(["c1"]));
    const random = seededRandom(13);
    for (let i = 0; i < 20; i++) expect(derivePantry(shuffled(whole, random)).lots[0].remaining).toBe(910);
  });

  it("una catena che torna su se stessa non blocca niente e dà lo stesso risultato da qualunque parte si cominci", () => {
    const x = consume("cx", at("13:00"), { lotId: "lot-1", quantity: q(100), replaces: "cz", recordedAt: at("14:00") });
    const y = consume("cy", at("13:00"), { lotId: "lot-1", quantity: q(110), replaces: "cx", recordedAt: at("14:01") });
    const z = consume("cz", at("13:00"), { lotId: "lot-1", quantity: q(120), replaces: "cy", recordedAt: at("14:02") });
    const tail = consume("ct", at("13:00"), { lotId: "lot-1", quantity: q(130), replaces: "cy", recordedAt: at("14:03") });
    const own = consume("cs", at("13:00"), { lotId: "lot-1", quantity: q(10), replaces: "cs", recordedAt: at("14:00") });
    const loop = [lot, x, y, z, tail, own];
    const random = seededRandom(14);
    for (let i = 0; i < 30; i++) {
      const order = shuffled(loop, random);
      const roots = consumeRoots(order);
      expect(["cx", "cy", "cz", "ct"].map((id) => roots.get(id))).toEqual(["cx", "cx", "cx", "cx"]);
      expect(roots.get("cs")).toBe("cs");
      // del giro vale solo il più recente (130 g), più il consumo che cita se stesso (10 g)
      expect(derivePantry(order).lots[0].remaining).toBe(860);
    }
  });

  it("una catena lunga si risale senza esaurire la pila", () => {
    const long = [original];
    for (let i = 1; i <= 5000; i++) {
      long.push(consume(`k${i}`, at("13:00"), { lotId: "lot-1", quantity: q(1), replaces: i === 1 ? "c1" : `k${i - 1}`, recordedAt: at("14:00") }));
    }
    const roots = consumeRoots(long.reverse());
    expect(roots.get("k5000")).toBe("c1");
    expect(supersededConsumes(long, new Set()).size).toBe(5000);
  });

  it("lo stesso evento passato due volte non si scarta da solo", () => {
    expect([...supersededConsumes([byA, byA], new Set())]).toEqual([]);
  });
});
