import { describe, expect, it } from "vitest";
import type { Indicator, IndicatorId, WeekFrame } from "@/core/diet";
import { fakeFrame, tally } from "@/core/diet/test-helpers";
import { qualityCardView } from "./qualityCardText";

const ind = (id: IndicatorId, over: Partial<Indicator> = {}): Indicator => ({
  id,
  value: 1,
  unit: "servingsPerDay",
  lowerBound: false,
  certainty: "estimated",
  coverage: 1,
  status: "within",
  ...over,
});

const none = (id: IndicatorId): Indicator => ({ ...ind(id), value: undefined, status: "insufficient", insufficient: "few_days" });

function week(start: string, over: Partial<WeekFrame> = {}, indicators: Indicator[] = []): WeekFrame {
  const f = fakeFrame({ weekStart: start, daysWithData: 4, daysElapsed: 7, ...over });
  const rowTallies = { ...f.rowTallies, legumes: tally({ occasions: 1 }), fish: tally({ occasions: 2 }) };
  return { ...f, rowTallies, indicators };
}

const GOOD = (): Indicator[] => [
  ind("vegFruit", { value: 3 }),
  ind("group:legumes", { unit: "count", value: 1 }),
  ind("group:fish", { unit: "count", value: 2 }),
  ind("processedShare", { unit: "share", value: 0.22 }),
];

describe("qualityCardView", () => {
  it("non c'è senza storia né senza nessuna voce", () => {
    expect(qualityCardView(undefined)).toBeNull();
    expect(qualityCardView({ weeks: [] })).toBeNull();
    expect(qualityCardView({ weeks: [week("2026-11-16", { daysWithData: 0 }), week("2026-11-23", { daysWithData: 0, inProgress: true })] })).toBeNull();
  });

  it("dice la settimana in corso con le stime e i molto lavorati", () => {
    const v = qualityCardView({ weeks: [week("2026-11-23", { inProgress: true }, GOOD())] });
    expect(v?.lines).toEqual([
      "Questa settimana, 4 giorni registrati: verdura e frutta ~3 porzioni al giorno, legumi ~1 volta, pesce ~2 volte.",
      "Prodotti molto lavorati: ~22% dell'energia riconosciuta.",
    ]);
    expect(v?.week).toBeUndefined();
  });

  it("senza stime niente tilde e salta ciò che non si calcola", () => {
    const g = GOOD().map((i) => ({ ...i, certainty: "measured" as Indicator["certainty"] })).filter((i) => i.id !== "group:fish");
    const v = qualityCardView({ weeks: [week("2026-11-23", { inProgress: true, daysWithData: 1 }, g)] });
    expect(v?.lines[0]).toBe("Questa settimana, 1 giorno registrato: verdura e frutta 3 porzioni al giorno, legumi 1 volta.");
  });

  it("se la settimana in corso non basta, usa la scorsa e la dichiara", () => {
    const v = qualityCardView({
      weeks: [week("2026-11-16", {}, GOOD()), week("2026-11-23", { inProgress: true, daysWithData: 1, daysElapsed: 2 }, GOOD().map((i) => none(i.id)))],
    });
    expect(v?.lines[0].startsWith("La settimana scorsa, 4 giorni registrati:")).toBe(true);
    expect(v?.week).toBe("2026-11-16");
  });

  it("settimane più vecchie: «nella settimana del …»", () => {
    const v = qualityCardView({ weeks: [week("2026-11-09", {}, GOOD()), week("2026-11-16", { daysWithData: 0 }), week("2026-11-23", { inProgress: true, daysWithData: 0 })] });
    expect(v?.lines[0].startsWith("Nella settimana del 9 nov, ")).toBe(true);
  });

  it("con pochi dati lo dice, senza numeri sulla qualità", () => {
    const v = qualityCardView({ weeks: [week("2026-11-23", { inProgress: true, daysWithData: 2 }, GOOD().map((i) => none(i.id)))] });
    expect(v?.lines).toEqual(["Dati insufficienti: 2 giorni registrati su 7."]);
  });

  it("senza i molto lavorati resta una riga", () => {
    const v = qualityCardView({ weeks: [week("2026-11-23", { inProgress: true }, GOOD().slice(0, 3))] });
    expect(v?.lines).toHaveLength(1);
  });
});
