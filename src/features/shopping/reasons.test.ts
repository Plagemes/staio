import { describe, expect, it } from "vitest";
import type { ConsumptionForecast, ListReason, ReasonDetail } from "@/core/shopping";
import { forecastNote, noteText, reasonText } from "./reasons";

const today = "2026-11-16";
const r = (x: ReasonDetail & { rejections?: number }): ListReason => ({ strength: 0.5, rejections: 0, ...x }) as ListReason;

describe("ragioni in chiaro", () => {
  it("dice quando finisce, come stima", () => {
    expect(reasonText(r({ kind: "running_out", daysLeft: 3.2, runoutDate: "2026-11-19", certainty: "estimated" }), today, "g")).toBe("finisce tra 3 giorni (stima dai tuoi consumi)");
    expect(reasonText(r({ kind: "running_out", daysLeft: 0.4, runoutDate: today, certainty: "estimated" }), today, "g")).toMatch(/^finisce oggi/);
    expect(reasonText(r({ kind: "running_out", daysLeft: 1, runoutDate: "2026-11-17", certainty: "estimated" }), today, "g")).toMatch(/^finisce domani/);
  });

  it("scrive scorta minima, piano, aggiunta a mano e scadenza", () => {
    expect(reasonText(r({ kind: "below_minimum", minimum: 500, stock: 200 }), today, "g")).toBe("sotto la scorta minima (ne hai 200 g, il minimo è 500 g)");
    expect(reasonText(r({ kind: "plan", needed: 200, earliestDate: "2026-11-19" }), today, "g")).toBe("serve per giovedì");
    expect(reasonText(r({ kind: "manual" }), today, "g")).toBe("aggiunta da te");
    expect(reasonText(r({ kind: "completes_expiring", forProduct: "ricotta", expiresOn: "2026-11-17" }), today, "g")).toBe("per usare «ricotta» che scade domani");
  });

  it("ricorda un rifiuto passato, ma non per le voci a mano", () => {
    expect(reasonText(r({ kind: "below_minimum", minimum: 1, stock: 0, rejections: 0.9 }), today, "pz")).toMatch(/già rifiutata/);
    expect(reasonText(r({ kind: "manual", rejections: 1 }), today, "pz")).toBe("aggiunta da te");
  });

  it("spiega le note", () => {
    expect(noteText({ code: "waste_caution", wasteShare: 0.31 }, "g")).toMatch(/31%/);
    expect(noteText({ code: "format_too_big", size: 1000, suggestedMaxSize: 500 }, "ml")).toMatch(/1 l.*0,5 l/);
    expect(noteText({ code: "consumption_unknown" }, "g")).toMatch(/Non so ancora/);
  });

  it("dove lo storico non basta lo dice", () => {
    const f: ConsumptionForecast = {
      id: "latte|ml",
      key: "latte",
      unit: "ml",
      name: "Latte",
      stock: 0,
      observations: 2,
      spanDays: 3,
      certainty: "estimated",
      sufficient: false,
      reasons: ["few_observations", "short_history"],
    };
    expect(forecastNote(f)).toBe("Non so quando finirà: ci sono 2 consumi registrati, ne servono almeno 4; lo storico copre 3 giorni, ne servono almeno 7.");
    expect(forecastNote(undefined)).toBeUndefined();
  });
});
