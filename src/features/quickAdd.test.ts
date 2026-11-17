import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { buildQuickEvents, defaultLocation, overrideKey, parseQuickLines } from "./quickAdd";

const one = (line: string) => parseQuickLines(line)[0];

describe("parseQuickLines: nome e quantità", () => {
  it.each([
    ["latte 1 l", "Latte", 1000, "ml"],
    ["6 uova", "Uova", 6, "pz"],
    ["uova 6", "Uova", 6, "pz"],
    ["500 g di pasta", "Pasta", 500, "g"],
    ["pasta 500g", "Pasta", 500, "g"],
    ["mezzo kg di riso", "Riso", 500, "g"],
    ["Parmigiano 24 mesi 200 g", "Parmigiano 24 mesi", 200, "g"],
  ])("%s", (line, name, value, unit) => {
    const row = one(line);
    expect(row.status).toBe("ok");
    expect(row.name).toBe(name);
    expect(row.quantity).toEqual({ value, unit });
  });

  it("ignora righe vuote e tiene la posizione delle altre", () => {
    const rows = parseQuickLines("latte 1 l\n\n   \n6 uova");
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
  });

  it("righe non lette, con il perché", () => {
    expect(one("latte")).toMatchObject({ status: "unreadable", error: expect.stringContaining("quantità") });
    expect(one("500 g")).toMatchObject({ status: "unreadable", error: expect.stringContaining("nome") });
    expect(one("2 confezioni di sugo").status).toBe("unreadable");
    expect(one("0 g di pasta").status).toBe("unreadable");
  });
});

describe("parseQuickLines: luogo e categoria", () => {
  it("il luogo scritto dopo la virgola vince sul luogo abituale", () => {
    const row = one("pasta 500 g, credenza");
    expect(row).toMatchObject({ location: "dispensa", locationFromText: true, category: "pasta_dry" });
    expect(one("latte 1 l, freezer").location).toBe("freezer");
    expect(one("latte 1 l in frigo").location).toBe("frigo");
    expect(one("latte 1 l in frigo").name).toBe("Latte");
  });

  it("senza luogo scritto si deduce dalla categoria", () => {
    expect(one("latte 1 l")).toMatchObject({ location: "frigo", locationFromText: false });
    expect(one("pasta 500 g").location).toBe("dispensa");
    expect(one("gelato 500 g").location).toBe("freezer");
  });

  it("una virgola con altro non è un luogo", () => {
    expect(one("latte 1 l, parzialmente scremato")).toMatchObject({ status: "ok", location: "frigo", locationFromText: false });
  });

  it("categoria ignota: serve sceglierla", () => {
    const row = one("zzz 3 pz");
    expect(row.status).toBe("needs_category");
    expect(row.category).toBeUndefined();
  });

  it("il modello del catalogo aiuta quando le parole non bastano", () => {
    const rows = parseQuickLines("zzz 3 pz", { modelCategoryOf: () => "frutta" });
    expect(rows[0]).toMatchObject({ status: "ok", category: "fruit_fresh" });
  });

  it("le correzioni dell'utente vincono", () => {
    const overrides = new Map([[overrideKey(0, "zzz 3 pz"), { category: "yogurt", location: "freezer" as const }]]);
    expect(parseQuickLines("zzz 3 pz", { overrides })[0]).toMatchObject({ status: "ok", category: "yogurt", location: "freezer" });
  });

  it("luogo abituale per categoria", () => {
    expect(defaultLocation("bread_fresh")).toBe("dispensa");
    expect(defaultLocation("milk_uht")).toBe("dispensa");
    expect(defaultLocation("poultry")).toBe("frigo");
    expect(defaultLocation("frozen_foods")).toBe("freezer");
  });
});

describe("buildQuickEvents", () => {
  const ctx = { now: "2026-11-16T10:00:00.000Z", deviceId: "d" };

  it("salva le righe valide come declare e segnala le altre", () => {
    const rows = parseQuickLines("latte 1 l\n6 uova\nbah\nzzz 3 pz\npasta 500 g, credenza");
    const result = buildQuickEvents(rows, ctx);
    expect(result.saved.map((r) => r.name)).toEqual(["Latte", "Uova", "Pasta"]);
    expect(result.skipped.map((r) => r.line)).toEqual(["bah", "zzz 3 pz"]);
    expect(result.events.every((e) => e.type === "declare" && e.certainty === "estimated")).toBe(true);

    const lots = derivePantry(result.events).lots;
    expect(lots).toHaveLength(3);
    expect(lots.find((l) => l.productRef === "Pasta")).toMatchObject({ location: "dispensa", initial: 500, unit: "g", category: "pasta_dry" });
    expect(lots.find((l) => l.productRef === "Latte")).toMatchObject({ initial: 1000, unit: "ml" });
  });

  it("nessuna riga valida: nessun evento", () => {
    expect(buildQuickEvents(parseQuickLines("bah"), ctx).events).toEqual([]);
  });
});
