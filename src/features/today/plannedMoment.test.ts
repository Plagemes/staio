import { describe, expect, it } from "vitest";
import { momentOffer, type DeclarableKind } from "../meals";
import { nextPlannedHidden, unresolvedText, type PlannedMomentFacts } from "./plannedMoment";

const at = (h: number, m = 0) => h * 60 + m;
const offerAt = (minutes: number) => (kind: DeclarableKind) => momentOffer(kind, minutes);
const empty = (...kinds: DeclarableKind[]): PlannedMomentFacts[] => kinds.map((kind) => ({ kind, empty: true }));
const ALL = empty("breakfast", "lunch", "dinner");

describe("nextPlannedHidden", () => {
  it("alle 16:00 la cena pianificata si vede prima della sua ora", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }], offerAt(at(16)))).toBe("dinner");
  });

  it("alle 19:00 la cena è già cominciata: è il momento normale", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }], offerAt(at(19)))).toBeUndefined();
  });

  it("alle 7:00 il primo momento nascosto con voci è il pranzo, non la cena", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }, { meal: "lunch" }], offerAt(at(7)))).toBe("lunch");
  });

  it("alle 12:00 con solo la cena nel piano, la cena", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }], offerAt(at(12)))).toBe("dinner");
  });

  it("alle 22:00 niente è nascosto", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }, { meal: "lunch" }], offerAt(at(22)))).toBeUndefined();
  });

  it("senza voci pianificate nessun momento nascosto compare", () => {
    expect(nextPlannedHidden(ALL, [], offerAt(at(7)))).toBeUndefined();
  });

  it("un momento già registrato o con qualcosa dentro non conta", () => {
    const facts: PlannedMomentFacts[] = [
      { kind: "breakfast", empty: true },
      { kind: "lunch", empty: true },
      { kind: "dinner", empty: false },
    ];
    expect(nextPlannedHidden(facts, [{ meal: "dinner" }], offerAt(at(16)))).toBeUndefined();
  });
});

describe("giorno passato", () => {
  it("con un giorno passato nessun momento è nascosto: niente piano", () => {
    expect(nextPlannedHidden(ALL, [{ meal: "dinner" }], (kind) => momentOffer(kind, at(7), { pastDay: true }))).toBeUndefined();
  });
});

describe("testi", () => {
  it("dice quale voce non si trova più", () => {
    expect(unresolvedText("Pasta al forno")).toBe("Non trovo più «Pasta al forno»: non so che cosa serve.");
    expect(unresolvedText(undefined)).toBe("Non trovo più questa voce: non so che cosa serve.");
  });
});
