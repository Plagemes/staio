import { describe, expect, it } from "vitest";
import { diffScan, parsePantryScan, type DiffContext, type Difference, type ExpectedLot } from "./index";
import { json } from "./pantryFixtures";

const ctx: DiffContext = { location: "frigo", today: "2026-11-17" };
const lot = (expiry?: ExpectedLot["expiry"]): ExpectedLot => ({ id: "L1", name: "Insalata", remaining: { value: 150, unit: "g" }, initial: 150, opened: false, category: "leafy_vegetables", ...(expiry ? { expiry } : {}) });

function fresh(expected: ExpectedLot, state: "use_soon" | "discard"): Difference[] {
  const scan = parsePantryScan(json({ lots: [{ id: "L1", status: "seen", confidence: 0.9, freshness: { state, confidence: 0.9 } }] }), [expected], { location: "frigo" });
  return diffScan(scan, [expected], ctx);
}

/** La data di scadenza che la differenza scriverebbe, se ne scrive una. */
const writtenDate = (d: Difference) => (d.change.type === "expiry" ? d.change.expiry.date : undefined);

describe("la valutazione visiva e le date d'etichetta", () => {
  it.each(["use_by", "best_before"] as const)("con una data %s in etichetta è solo un avviso, mai una scadenza scritta", (kind) => {
    for (const state of ["use_soon", "discard"] as const) {
      const [d] = fresh(lot({ date: "2026-12-30", kind }), state);
      expect(d.change).toEqual({ type: "notice", labelDate: "2026-12-30", labelKind: kind });
      expect(d.kind).toBe("use_soon");
      expect(d.reason).toContain("la data in etichetta è 30 dic 2026");
      expect(d.reason).toMatch(/Non cambio la data/);
      expect(writtenDate(d)).toBeUndefined();
    }
  });

  it("l'avviso c'è anche se la data in etichetta è già vicina o passata", () => {
    for (const date of ["2026-11-18", "2026-11-10"]) {
      const diffs = fresh(lot({ date, kind: "use_by" }), "use_soon");
      expect(diffs).toHaveLength(1);
      expect(diffs[0].change.type).toBe("notice");
    }
  });

  it("senza nessuna scadenza scrive una stima", () => {
    const [soon] = fresh(lot(), "use_soon");
    expect(soon.change).toEqual({ type: "expiry", expiry: { date: "2026-11-19", kind: "estimated" } });
    const [bad] = fresh(lot(), "discard");
    expect(bad.change).toEqual({ type: "expiry", expiry: { date: "2026-11-17", kind: "estimated" } });
  });

  it("con una scadenza già stimata la sostituisce solo se la nuova è più vicina", () => {
    const [closer] = fresh(lot({ date: "2026-11-25", kind: "estimated" }), "use_soon");
    expect(closer.change).toMatchObject({ type: "expiry", expiry: { date: "2026-11-19", kind: "estimated" }, registered: "2026-11-25" });
    expect(fresh(lot({ date: "2026-11-19", kind: "estimated" }), "use_soon")).toEqual([]); // uguale: niente
    expect(fresh(lot({ date: "2026-11-18", kind: "estimated" }), "use_soon")).toEqual([]); // più vicina quella che c'è: niente
    expect(fresh(lot({ date: "2026-11-10", kind: "estimated" }), "discard")).toEqual([]);
  });

  it("in nessun caso una stima visiva sposta una scadenza più in là", () => {
    const expiries: (ExpectedLot["expiry"] | undefined)[] = [
      undefined,
      { date: "2026-11-10", kind: "estimated" },
      { date: "2026-11-17", kind: "estimated" },
      { date: "2026-11-19", kind: "estimated" },
      { date: "2026-11-30", kind: "estimated" },
      { date: "2027-02-01", kind: "estimated" },
      { date: "2026-11-10", kind: "use_by" },
      { date: "2026-11-30", kind: "best_before" },
    ];
    for (const expiry of expiries) {
      for (const state of ["use_soon", "discard"] as const) {
        for (const d of fresh(lot(expiry), state)) {
          const date = writtenDate(d);
          if (date !== undefined && expiry) expect(date < expiry.date).toBe(true);
          if (expiry && expiry.kind !== "estimated") expect(date).toBeUndefined();
        }
      }
    }
  });

  it("una data letta dall'etichetta con la foto resta una proposta di scadenza, non un avviso", () => {
    const expected = lot({ date: "2026-12-30", kind: "use_by" });
    const scan = parsePantryScan(json({ lots: [{ id: "L1", status: "seen", confidence: 0.9, expiry: { date: "2026-12-28", kind: "use_by", confidence: 0.9 } }] }), [expected], { location: "frigo" });
    const [d] = diffScan(scan, [expected], ctx);
    expect(d).toMatchObject({ kind: "expiry_differs", change: { type: "expiry", expiry: { date: "2026-12-28", kind: "use_by" } } });
  });

  it("avviso e data letta possono comparire insieme: l'avviso non scrive, la data sì", () => {
    const expected = lot({ date: "2026-12-30", kind: "use_by" });
    const scan = parsePantryScan(
      json({ lots: [{ id: "L1", status: "seen", confidence: 0.9, expiry: { date: "2026-12-28", kind: "use_by", confidence: 0.9 }, freshness: { state: "use_soon", confidence: 0.9 } }] }),
      [expected],
      { location: "frigo" },
    );
    const diffs = diffScan(scan, [expected], ctx);
    expect(diffs.map((d) => d.change.type).sort()).toEqual(["expiry", "notice"]);
  });
});
