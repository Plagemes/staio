import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { supersededConsumes } from "./supersede";
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

  it("due sostituti di un consumo non ancora arrivato si riducono a uno", () => {
    expect([...supersededConsumes([lot, byA, byB], new Set())]).toEqual(["ca"]);
  });
});
