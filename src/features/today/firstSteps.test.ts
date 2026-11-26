import { describe, expect, it } from "vitest";
import { FIRST_STEPS_DAYS, firstStepsView, type FirstStepsInput } from "./firstSteps";

const base: FirstStepsInput = {
  memory: { phase: "done", since: "2026-11-20" },
  today: "2026-11-20",
  hasLots: false,
  hasMeal: false,
  hasProfile: false,
};
const ids = (input: FirstStepsInput) => firstStepsView(input)?.map((r) => r.id);

describe("firstStepsView", () => {
  it("il primo giorno: tre righe, in ordine, con le strade giuste", () => {
    const rows = firstStepsView(base);
    expect(rows?.map((r) => [r.id, r.href])).toEqual([
      ["pantry", "/app/cattura"],
      ["meal", "/app/pasto"],
      ["profile", "/app/impostazioni/profilo"],
    ]);
    expect(rows?.[0].label).toBe("Aggiungi alla dispensa ciò che hai in casa");
    expect(rows?.[0].hint).toBe("codice, scontrino, a mano");
    expect(rows?.[1].hint).toBeUndefined();
    expect(rows?.[2].hint).toBe("per i valori di riferimento dei nutrienti");
  });

  it("sette giorni in tutto: il sesto giorno dopo c'è ancora, l'ottavo no", () => {
    expect(FIRST_STEPS_DAYS).toBe(7);
    expect(ids({ ...base, today: "2026-11-26" })).toHaveLength(3);
    expect(firstStepsView({ ...base, today: "2026-11-27" })).toBeNull();
    expect(firstStepsView({ ...base, today: "2026-12-30" })).toBeNull();
  });

  it("a cavallo del mese e dell'anno", () => {
    const memory = { phase: "done" as const, since: "2026-12-29" };
    expect(ids({ ...base, memory, today: "2027-01-04" })).toHaveLength(3);
    expect(firstStepsView({ ...base, memory, today: "2027-01-05" })).toBeNull();
  });

  it("un orologio indietro di un giorno non le toglie", () => {
    expect(ids({ ...base, today: "2026-11-19" })).toHaveLength(3);
  });

  it("spariscono una a una appena fatte", () => {
    expect(ids({ ...base, hasLots: true })).toEqual(["meal", "profile"]);
    expect(ids({ ...base, hasLots: true, hasMeal: true })).toEqual(["profile"]);
    expect(ids({ ...base, hasMeal: true, hasProfile: true })).toEqual(["pantry"]);
  });

  it("tutte fatte: niente", () => {
    expect(firstStepsView({ ...base, hasLots: true, hasMeal: true, hasProfile: true })).toBeNull();
  });

  it("«Lascia così» le toglie", () => {
    expect(firstStepsView({ ...base, memory: { ...base.memory, stepsHidden: true } })).toBeNull();
  });

  it("senza giorno di fine (chi aveva già dati, introduzione mai vista): niente", () => {
    expect(firstStepsView({ ...base, memory: { phase: "done" } })).toBeNull();
    expect(firstStepsView({ ...base, memory: { phase: "new" } })).toBeNull();
  });
});
