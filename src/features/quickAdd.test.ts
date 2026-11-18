import { describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { itemKey, readItemDefault, withItemDefault } from "./memory/itemDefaults";
import { buildQuickEvents, defaultLocation, initialQuickMode, overrideKey, parseQuickLines, quickAddedMessage, restoreRemembered } from "./quickAdd";

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

describe("buildQuickEvents: appena comprati o già in casa", () => {
  const ctx = { now: "2026-11-16T10:00:00.000Z", deviceId: "d" };

  it("«Appena comprati» scrive un acquisto di adesso per riga, senza prezzo", () => {
    const result = buildQuickEvents(parseQuickLines("6 uova\nlatte 1 l"), ctx, { alreadyHave: false });
    expect(result.events.map((e) => e.type)).toEqual(["purchase", "purchase"]);
    for (const e of result.events) {
      expect(e).toMatchObject({ at: ctx.now, source: "manual" });
      expect("priceCents" in e).toBe(false);
    }
    const lots = derivePantry(result.events).lots;
    expect(lots.find((l) => l.productRef === "Uova")).toMatchObject({ origin: "purchase", initial: 6, unit: "pz" });
  });

  it("«Già in casa» e nessuna opzione scrivono come prima: un declare stimato", () => {
    const rows = parseQuickLines("6 uova");
    const had = buildQuickEvents(rows, ctx, { alreadyHave: true });
    const plain = buildQuickEvents(rows, ctx);
    for (const r of [had, plain]) expect(r.events.map((e) => [e.type, e.certainty])).toEqual([["declare", "estimated"]]);
  });
});

describe("parseQuickLines: memoria per nome", () => {
  const memory = withItemDefault({}, { name: "pasta", category: "pasta_dry", location: "freezer", quantityText: "500 g" }, "2026-11-15T10:00:00.000Z");
  const remembered = (name: string) => readItemDefault(memory, name);

  it("il luogo dell'ultima volta vale per ciò che la riga non dice, «come l'ultima volta»", () => {
    const row = parseQuickLines("pasta 500 g", { remembered })[0];
    expect(row).toMatchObject({ status: "ok", location: "freezer", category: "pasta_dry", fromMemory: true, locationFromText: false });
  });

  it("ciò che è scritto vince sulla memoria", () => {
    const row = parseQuickLines("pasta 500 g, frigo", { remembered })[0];
    expect(row).toMatchObject({ location: "frigo", locationFromText: true });
  });

  it("le correzioni dell'utente vincono sulla memoria", () => {
    const overrides = new Map([[overrideKey(0, "pasta 500 g"), { location: "dispensa" as const, category: "rice_cereals" }]]);
    const row = parseQuickLines("pasta 500 g", { remembered, overrides })[0];
    expect(row).toMatchObject({ location: "dispensa", category: "rice_cereals" });
    expect(row.fromMemory).toBeUndefined();
  });

  it("la categoria ricordata vale prima di quella proposta dal nome", () => {
    const own = withItemDefault({}, { name: "latte", category: "milk_uht" }, "2026-11-15T10:00:00.000Z");
    const row = parseQuickLines("latte 1 l", { remembered: (n) => readItemDefault(own, n) })[0];
    expect(row).toMatchObject({ category: "milk_uht", location: "dispensa", fromMemory: true });
  });

  it("senza memoria per quel nome resta la regola per categoria", () => {
    const row = parseQuickLines("riso 1 kg", { remembered })[0];
    expect(row.fromMemory).toBeUndefined();
    expect(row.location).toBe(defaultLocation("rice_cereals"));
  });

  it("una riga «come l'ultima volta» si scrive con quel luogo", () => {
    const result = buildQuickEvents(parseQuickLines("pasta 500 g", { remembered }), { now: "2026-11-16T10:00:00.000Z", deviceId: "d" }, { alreadyHave: false });
    expect(derivePantry(result.events).lots[0]).toMatchObject({ location: "freezer", category: "pasta_dry" });
  });
});

describe("scelta di partenza e avviso", () => {
  it("la scelta ricordata vince; la prima volta «Già in casa» solo a dispensa vuota", () => {
    expect(initialQuickMode("had", false)).toBe("had");
    expect(initialQuickMode("bought", true)).toBe("bought");
    expect(initialQuickMode(undefined, true)).toBe("had");
    expect(initialQuickMode(null, false)).toBe("bought");
    expect(initialQuickMode("boh", false)).toBe("bought");
  });

  it("dice quanti alimenti sono entrati e che cosa manca alle righe rimaste nel campo", () => {
    const unreadable = { status: "unreadable" as const };
    const noCategory = { status: "needs_category" as const };
    expect(quickAddedMessage(5, [])).toBe("Aggiunti alla dispensa: 5 alimenti.");
    expect(quickAddedMessage(1)).toBe("Aggiunto alla dispensa: 1 alimento.");
    expect(quickAddedMessage(4, [unreadable])).toBe("Aggiunti alla dispensa: 4 alimenti. 1 riga non letta: è rimasta nel campo.");
    expect(quickAddedMessage(3, [unreadable, unreadable])).toBe("Aggiunti alla dispensa: 3 alimenti. 2 righe non lette: sono rimaste nel campo.");
    expect(quickAddedMessage(2, [noCategory])).toBe("Aggiunti alla dispensa: 2 alimenti. 1 riga senza categoria: è rimasta nel campo.");
    expect(quickAddedMessage(2, [unreadable, noCategory])).toBe("Aggiunti alla dispensa: 2 alimenti. 1 riga non letta, 1 riga senza categoria: sono rimaste nel campo.");
  });

  it("una riga illeggibile tra cinque: quattro scritte, una resta", () => {
    const result = buildQuickEvents(parseQuickLines("latte 1 l\n6 uova\nbah\npasta 500 g\nriso 1 kg"), { now: "2026-11-16T10:00:00.000Z", deviceId: "d" }, { alreadyHave: false });
    expect(result.saved).toHaveLength(4);
    expect(result.skipped.map((r) => r.line)).toEqual(["bah"]);
  });
});

describe("parseQuickLines: la virgola dei decimali", () => {
  it.each([
    ["latte 1,5 l", "Latte", 1500, "ml", "frigo", false],
    ["olio 0,75 l", "Olio", 750, "ml", undefined, false],
    ["pane 0,5 kg, freezer", "Pane", 500, "g", "freezer", true],
    ["uova 6, frigo", "Uova", 6, "pz", "frigo", true],
    ["1,5 l latte", "Latte", 1500, "ml", "frigo", false],
  ])("%s", (line, name, value, unit, location, fromText) => {
    const row = one(line);
    expect(row.status).not.toBe("unreadable");
    expect(row).toMatchObject({ name, quantity: { value, unit }, locationFromText: fromText });
    if (location) expect(row.location).toBe(location);
  });
});

describe("«Annulla» e la memoria per nome", () => {
  it("rimette com'erano i soli nomi toccati dalla scrittura", () => {
    const before = withItemDefault({}, { name: "pasta", location: "dispensa" }, "2026-11-10T10:00:00.000Z");
    let after = withItemDefault(before, { name: "pasta", location: "freezer" }, "2026-11-16T10:00:00.000Z");
    after = withItemDefault(after, { name: "uova", location: "frigo" }, "2026-11-16T10:00:00.000Z");
    // dopo, un altro modulo ricorda il riso: resta
    after = withItemDefault(after, { name: "riso", location: "dispensa" }, "2026-11-16T10:05:00.000Z");
    const restored = restoreRemembered(after, before, [itemKey("Pasta"), itemKey("Uova")]);
    expect(readItemDefault(restored, "pasta")?.location).toBe("dispensa");
    expect(readItemDefault(restored, "uova")).toBeUndefined();
    expect(readItemDefault(restored, "riso")?.location).toBe("dispensa");
    expect(restoreRemembered(undefined, undefined, ["pasta"])).toEqual({});
  });
});
