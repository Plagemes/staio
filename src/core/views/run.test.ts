import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { purchase, q } from "../ledger/test-helpers";
import { runView, viewNeedsNutrition } from "./run";
import { PINNED_SETTING_KEY, normalizePinned, pinView, toStore } from "./pinned";
import type { ViewSpec } from "./spec";
import { EMPTY_CONTEXT, buildContext, sampleEvents } from "./test-helpers";
import { validateView } from "./validate";

const SPEC: ViewSpec = {
  title: "La spesa del mese",
  blocks: [
    { type: "figure", label: "Spesa totale", query: { name: "spend_total", params: { period: "last_30_days", group: "all" } } },
    { type: "list", label: "Per negozio", query: { name: "spend_by_store", params: { period: "last_30_days", limit: 5 } } },
    { type: "chart", query: { name: "spend_over_time", params: { period: "last_30_days" } } },
    { type: "text", text: "Contano solo gli acquisti con prezzo." },
    { type: "action", action: "open_shopping" },
    { type: "action", action: "add_to_shopping", item: "Latte intero" },
  ],
};

describe("esecuzione di una vista", () => {
  it("calcola i dati di ogni blocco", () => {
    const data = runView(SPEC, buildContext());
    expect(data.title).toBe("La spesa del mese");
    expect(data.blocks.map((b) => b.type)).toEqual(["figure", "list", "chart", "text", "action", "action"]);
    const fig = data.blocks[0];
    expect(fig.type === "figure" && fig.result.kind === "number" && fig.result.value).toBeCloseTo(8.2, 6);
    const act = data.blocks[4];
    expect(act).toEqual({ type: "action", action: "open_shopping", label: "Apri la spesa", href: "/app/spesa" });
    expect(data.blocks[5]).toMatchObject({ action: "add_to_shopping", item: "Latte intero", label: "Aggiungi alla spesa" });
    expect(data.blocks[5]).not.toHaveProperty("href");
  });

  it("su un'app vuota nessun blocco è vuoto: dà «dati insufficienti» con il motivo", () => {
    const data = runView(SPEC, EMPTY_CONTEXT);
    for (const b of data.blocks) {
      if ("result" in b) {
        expect(b.result.kind).toBe("insufficient");
        if (b.result.kind === "insufficient") expect(b.result.reason.length).toBeGreaterThan(5);
      }
    }
  });

  it("un'interrogazione che non esiste più o che si rompe non fa cadere la vista", () => {
    const stale = { title: "x", blocks: [{ type: "figure", label: "a", query: { name: "sparita", params: {} } }] } as unknown as ViewSpec;
    const out = runView(stale, buildContext());
    expect(out.blocks[0]).toMatchObject({ result: { kind: "insufficient" } });
    const broken = { title: "x", blocks: [{ type: "figure", label: "a", query: { name: "spend_total", params: { period: "mai", group: "all" } } }] } as unknown as ViewSpec;
    expect(() => runView(broken, buildContext())).not.toThrow();
    expect(runView(broken, buildContext()).blocks[0]).toMatchObject({ result: { kind: "insufficient" } });
  });

  it("la didascalia è dell'app e dice cosa è stato calcolato e il periodo", () => {
    const data = runView(SPEC, buildContext());
    const fig = data.blocks[0];
    expect(fig.type === "figure" && fig.caption).toBe("Spesa · tutti gli alimenti · ultimi 30 giorni");
    expect(fig.type === "figure" && fig.label).toBe("Spesa totale");
  });

  it("dice se servono i nutrienti", () => {
    expect(viewNeedsNutrition(SPEC)).toBe(false);
    const v = validateView({ title: "x", blocks: [{ type: "figure", label: "a", query: { name: "nutrient_average", params: { nutrient: "ironMg" } } }] });
    expect(v.ok && viewNeedsNutrition(v.view)).toBe(true);
  });
});

describe("viste fissate", () => {
  it("si salvano come sola descrizione, senza dati", () => {
    const pinned = pinView([], { id: "v1", spec: SPEC, question: "quanto ho speso?", now: "2026-11-16T10:00:00Z" });
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    const stored = JSON.stringify(toStore(pinned.views));
    expect(stored).not.toContain("Coop");
    expect(stored).not.toContain("8,2");
    expect(PINNED_SETTING_KEY).toBe("assistant.pinned");
  });

  it("riletta dall'archivio si ricalcola sui dati nuovi senza intelligenza artificiale", () => {
    const pinned = pinView([], { id: "v1", spec: SPEC, now: "2026-11-16T10:00:00Z" });
    if (!pinned.ok) throw new Error("non fissata");
    const fromStorage = normalizePinned(JSON.parse(JSON.stringify(toStore(pinned.views))));
    expect(fromStorage).toHaveLength(1);
    expect(fromStorage[0].spec.blocks.some((b) => b.type === "text")).toBe(false);

    const before = runView(fromStorage[0].spec, buildContext());
    const events = [...sampleEvents(), purchase("p-new", "2026-11-15T18:00:00Z", { lotId: "lot-new", productRef: "Caffè", quantity: q(250, "g"), priceCents: 430, store: "Coop", location: "dispensa" })];
    const ctxAfter = buildContext(events);
    expect(derivePantry(events as never).lots.length).toBeGreaterThan(buildContext().pantry.lots.length);
    const after = runView(fromStorage[0].spec, ctxAfter);

    const value = (d: typeof before) => {
      const b = d.blocks[0];
      return b.type === "figure" && b.result.kind === "number" ? b.result.value : NaN;
    };
    expect(value(before)).toBeCloseTo(8.2, 6);
    expect(value(after)).toBeCloseTo(12.5, 6);
    const stores = after.blocks[1];
    expect(stores.type === "list" && stores.result.kind === "rows" && stores.result.rows[0]).toMatchObject({ label: "Coop", valueText: expect.stringContaining("8,30") });
  });

  it("anche con il tempo che passa: lo stesso periodo relativo dà un altro intervallo", () => {
    const events = sampleEvents();
    const today = runView(SPEC, buildContext(events));
    const later = runView(SPEC, buildContext(events, { today: "2026-12-30" }));
    const first = today.blocks[0];
    const second = later.blocks[0];
    expect(first.type === "figure" && first.result.kind).toBe("number");
    expect(second.type === "figure" && second.result.kind).toBe("insufficient");
  });
});
