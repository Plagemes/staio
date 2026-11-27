import { describe, expect, it } from "vitest";
import { deriveDiary } from "../diary";
import type { AnyEvent } from "../events";
import { derivePantry } from "../ledger";
import { purchase, q } from "../ledger/test-helpers";
import { MAX_LINES, buildBriefing } from "./briefing";
import type { BriefingInput } from "./types";

// 2026-11-17 alle 10:00 a Roma (UTC+1)
const NOW = "2026-11-17T09:00:00Z";

const ADVICE = {
  key: "diet:legumesLow:2026-11-10",
  text: "Legumi: 1 volta la settimana scorsa; le Linee guida CREA ne indicano 2–4.",
  href: "/app/salute/mangiato#consigli",
  certainty: "estimated" as const,
};

function make(events: unknown[] = [], over: Partial<BriefingInput> = {}): BriefingInput {
  return { now: NOW, pantry: derivePantry(events), diary: deriveDiary(events), log: events as AnyEvent[], ...over };
}

const expiring = (id: string, date: string) =>
  purchase(`p-${id}`, "2026-11-10T08:00:00Z", {
    lotId: id,
    productRef: id,
    quantity: q(500),
    location: "frigo",
    category: "dairy",
    expiry: { date, kind: "use_by" },
  });

describe("riga del consiglio sul mangiato", () => {
  it("compare con il suo testo, il suo percorso e la sua certezza", () => {
    const [line] = buildBriefing(make([], { dietAdvice: ADVICE })).lines;
    expect(line).toEqual({ ...ADVICE, kind: "diet", order: 65 });
  });

  it("senza consiglio non c'è alcuna riga", () => {
    expect(buildBriefing(make()).lines).toEqual([]);
  });

  it("se la chiave è tra quelle lasciate così non compare", () => {
    const b = buildBriefing(make([], { dietAdvice: ADVICE, dismissed: [ADVICE.key] }));
    expect(b.lines).toEqual([]);
  });

  it("lasciare così un'altra chiave non la nasconde", () => {
    const b = buildBriefing(make([], { dietAdvice: ADVICE, dismissed: ["diet:fishLow:2026-11-10"] }));
    expect(b.lines.map((l) => l.kind)).toEqual(["diet"]);
  });

  it("nel giorno passato non compare", () => {
    const b = buildBriefing(make([], { dietAdvice: ADVICE, viewDate: "2026-11-16" }));
    expect(b.lines).toEqual([]);
  });

  it("viene dopo le scadenze e prima degli altri avvisi", () => {
    const events = [expiring("Yogurt", "2026-11-17")];
    const b = buildBriefing(
      make(events, {
        dietAdvice: ADVICE,
        otherNotices: [{ key: "n1", short: "Spesa da fare", url: "/app/spesa" }],
      }),
    );
    expect(b.lines.map((l) => l.kind)).toEqual(["expiry", "diet", "notice"]);
  });

  it("non supera il numero massimo di righe: con tre righe più urgenti resta fuori", () => {
    const events = [expiring("Yogurt", "2026-11-17")];
    const b = buildBriefing(
      make(events, {
        dietAdvice: ADVICE,
        planned: [{ meal: "lunch", text: "Pasta" }],
        missingForPlan: ["Pasta"],
        otherNotices: [
          { key: "n1", short: "Uno", url: "/app/spesa" },
          { key: "n2", short: "Due", url: "/app/spesa" },
        ],
      }),
    );
    expect(b.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(MAX_LINES).toBe(3);
    expect(b.lines.map((l) => l.kind)).toEqual(["expiry", "plan", "diet"]);
  });
});
