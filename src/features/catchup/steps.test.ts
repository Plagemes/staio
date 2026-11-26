import { describe, expect, it } from "vitest";
import { STEP_SETTLE_MS, onPrimaryTap, primaryAction, tapAccepted } from "./steps";

describe("i passi del foglio", () => {
  it("«Avanti» prima dell'ultimo giorno, «Salva» sull'ultimo", () => {
    expect([0, 1, 2].map((step) => primaryAction(step, 3))).toEqual(["next", "next", "save"]);
    expect(primaryAction(0, 1)).toBe("save");
  });

  it("subito dopo un cambio di passo il pulsante pieno non vale", () => {
    expect(tapAccepted(null, 0)).toBe(true);
    expect(tapAccepted(1000, 1000 + STEP_SETTLE_MS - 1)).toBe(false);
    expect(tapAccepted(1000, 1000 + STEP_SETTLE_MS)).toBe(true);
  });

  it("un doppio tocco su «Avanti» nel penultimo giorno non salva", () => {
    // tre giorni: dal secondo (1) si va al terzo (2) con il primo tocco, il secondo tocco arriva 120 ms dopo
    const first = onPrimaryTap({ step: 1, total: 3, changedAt: 0, now: 5000 });
    expect(first).toBe("next");
    const second = onPrimaryTap({ step: 2, total: 3, changedAt: 5000, now: 5120 });
    expect(second).toBe("ignore");
    // con l'ultimo giorno in vista da mezzo secondo, «Salva» vale
    expect(onPrimaryTap({ step: 2, total: 3, changedAt: 5000, now: 5000 + STEP_SETTLE_MS })).toBe("save");
  });
});
