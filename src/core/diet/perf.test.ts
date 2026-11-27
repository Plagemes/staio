import { describe, expect, it } from "vitest";
import { addDays } from "../diary";
import type { DayIntake } from "../nutrition";
import { fakeDay, historyInput, lineClass, part } from "./test-helpers";
import { DIET_GROUPS, type ClassPart, type LineClass } from "./types";
import { buildDietHistory } from "./week";

// 56 giorni × 20 righe (più 7 della settimana in corso), con tabelle vere: il tetto è largo, ci si aspetta < 20 ms.
const TODAY = "2026-11-27";
const LINES_PER_DAY = 20;

function build(): { days: DayIntake[]; byDate: Record<string, LineClass[]> } {
  const days: DayIntake[] = [];
  const byDate: Record<string, LineClass[]> = {};
  for (let i = 62; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    days.push(fakeDay(date, { complete: i % 5 !== 0, energyKcal: 2000, saltG: 5, fiberG: 20, missingShare: 0.1 }));
    const lines: LineClass[] = [];
    for (let k = 0; k < LINES_PER_DAY; k++) {
      const group = DIET_GROUPS[(i + k) % DIET_GROUPS.length];
      const parts: ClassPart[] = [
        part(group, {
          grams: k % 4 === 0 ? undefined : 30 + k * 5,
          energyKcal: 50 + k,
          sugarsG: k % 3,
          processing: { level: ((k % 4) + 1) as 1 | 2 | 3 | 4, certainty: "estimated", basis: "declared" },
          certainty: k % 2 ? "label" : "estimated",
        }),
      ];
      if (k % 7 === 0) parts.push(part("unknown", { label: "boh" }));
      lines.push(lineClass(date, parts, { occasionKey: `${date}#${k % 5}` }));
    }
    byDate[date] = lines;
  }
  return { days, byDate };
}

describe("buildDietHistory: prestazioni", () => {
  it("56 giorni × 20 righe sotto 150 ms", () => {
    const { days, byDate } = build();
    const input = historyInput(days, TODAY, byDate);
    buildDietHistory(input); // riscaldamento
    const start = performance.now();
    const h = buildDietHistory(input);
    const elapsed = performance.now() - start;
    expect(h.weeks).toHaveLength(9);
    expect(h.weeks[0].coverage.lines).toBe(7 * LINES_PER_DAY);
    expect(elapsed).toBeLessThan(150);
  });
});
