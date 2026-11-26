import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { buildUndo } from "./actions";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import { deriveDeclarations, declaredTexts, legacyPlanStructure, type LegacyDeclarations } from "@/core/allergens";
import { AUTOMATIC_NOTE, dietDeclarationsMigration, legacyBarcodeOfNote, legacyBarcodeUpdates } from "./migrations";

const NOW = "2026-11-17T08:00:00.000Z";
const ctx = { now: NOW, deviceId: "d" };

const input: CaptureInput = {
  name: "Latte intero",
  quantityText: "1 l",
  location: "frigo",
  category: "milk_fresh",
  expiryKind: "none",
  expiryDate: "",
  priceText: "",
  alreadyHave: false,
};

/** Un lotto come lo scriveva la cattura prima del campo `barcode`: il codice solo nella nota. */
function legacy(note: string | undefined, over: Partial<CaptureInput> = {}): AnyEvent {
  const r = buildCaptureEvents({ ...input, ...over }, { now: "2026-11-01T10:00:00.000Z", deviceId: "d" });
  if (!r.ok) throw new Error("cattura");
  const { note: _ignored, ...rest } = r.events[0] as LedgerEvent & { note?: string };
  void _ignored;
  return (note === undefined ? rest : { ...rest, note }) as AnyEvent;
}

describe("legacyBarcodeOfNote", () => {
  it("riconosce solo il testo esatto della cattura", () => {
    expect(legacyBarcodeOfNote("Codice a barre 8001234567890")).toBe("8001234567890");
    expect(legacyBarcodeOfNote("Codice a barre 8001234567890 · Granarolo")).toBe("8001234567890");
    expect(legacyBarcodeOfNote("Riga scontrino: Codice a barre 8001234567890")).toBeUndefined();
    expect(legacyBarcodeOfNote("Riga scontrino: latte")).toBeUndefined();
    expect(legacyBarcodeOfNote("Ho letto il Codice a barre 8001234567890 ieri")).toBeUndefined();
    expect(legacyBarcodeOfNote("Codice a barre 12345")).toBeUndefined();
    expect(legacyBarcodeOfNote(undefined)).toBeUndefined();
  });
});

describe("legacyBarcodeUpdates", () => {
  it("scrive il campo per i lotti vecchi, con la marca nella nota o senza", () => {
    const a = legacy("Codice a barre 8001234567890 · Granarolo");
    const b = legacy("Codice a barre 8076800195057", { name: "Spaghetti", category: "pasta_dry", quantityText: "500 g" });
    const updates = legacyBarcodeUpdates([a, b], ctx);
    expect(updates).toHaveLength(2);
    expect(updates.every((e) => e.type === "updateLot")).toBe(true);
    const lots = derivePantry([a as LedgerEvent, b as LedgerEvent, ...updates]).lots;
    expect(lots.map((l) => l.barcode).sort()).toEqual(["8001234567890", "8076800195057"]);
  });

  it("non tocca né i lotti che hanno già il codice né quelli da scontrino", () => {
    const withField = buildCaptureEvents({ ...input, barcode: "8001234567890" }, { now: "2026-11-01T10:00:00.000Z", deviceId: "d" });
    if (!withField.ok) throw new Error("cattura");
    const receipt = legacy("Riga scontrino: Codice a barre 8001234567890", { name: "Da scontrino" });
    const plain = legacy(undefined, { name: "Senza nota" });
    expect(legacyBarcodeUpdates([...withField.events, receipt, plain], ctx)).toEqual([]);
  });

  it("è idempotente: dopo la migrazione non c'è più niente da fare", () => {
    const a = legacy("Codice a barre 8001234567890");
    const updates = legacyBarcodeUpdates([a], ctx);
    expect(legacyBarcodeUpdates([a, ...updates], { ...ctx, now: "2026-11-17T09:00:00.000Z" })).toEqual([]);
  });

  it("un ingresso annullato non produce niente", () => {
    const a = legacy("Codice a barre 8001234567890");
    const undo = buildUndo([a], ctx);
    expect(legacyBarcodeUpdates([a, ...undo], ctx)).toEqual([]);
  });

  it("senza eventi non fa niente", () => {
    expect(legacyBarcodeUpdates([], ctx)).toEqual([]);
  });
});

describe("dietDeclarationsMigration", () => {
  const T0 = "2026-11-01T10:00:00.000Z";
  const NOW = "2026-11-20T10:00:00.000Z";
  let k = 0;
  const mctx = () => ({ now: NOW, deviceId: "A", idGenerator: () => `d-${String(++k).padStart(4, "0")}` });
  const structure = (id: string, at: string, allergens: string[], excludedFoods: string[] = []) =>
    ({ id, type: "planStructure", at, recordedAt: at, deviceId: "B", schemaVersion: 1, certainty: "measured", source: "manual", meals: [{ kind: "lunch" }], allergens, excludedFoods }) as AnyEvent;
  const legacyFor = (events: readonly AnyEvent[], recipePrefs: LegacyDeclarations["recipePrefs"]): LegacyDeclarations => ({
    recipePrefs,
    planStructure: legacyPlanStructure(events),
  });
  const texts = (events: readonly AnyEvent[], recipePrefs: LegacyDeclarations["recipePrefs"]) =>
    declaredTexts(deriveDeclarations(events, legacyFor(events, recipePrefs)));
  /** Dopo la migrazione le voci devono restare tutte anche senza i posti di prima. */
  const withoutLegacy = (events: readonly AnyEvent[]) => declaredTexts(deriveDeclarations(events, { recipePrefs: undefined, planStructure: undefined }));

  it("dal ricettario: una add per voce, con la nota automatica", () => {
    const out = dietDeclarationsMigration([], legacyFor([], { allergens: ["latte"], excludedFoods: ["funghi"] }), mctx());
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.type === "allergenDeclaration" && e.note === AUTOMATIC_NOTE && e.origin === "recipePrefs")).toBe(true);
    expect(withoutLegacy(out)).toEqual({ allergens: ["latte"], excludedFoods: ["funghi"] });
  });

  it("dal piano: prende le voci e assorbe l'ultima struttura", () => {
    const log = [structure("s-1", T0, ["glutine"]), structure("s-2", "2026-11-02T10:00:00.000Z", ["arachidi"], ["olive"])];
    const out = dietDeclarationsMigration(log, legacyFor(log, undefined), mctx());
    expect(out.map((e) => (e.type === "allergenDeclaration" ? e.origin : ""))).toEqual(["planStructure", "planStructure"]);
    expect(out.some((e) => e.type === "allergenDeclaration" && e.absorbs?.includes("s-2"))).toBe(true);
    expect(texts([...log, ...out], undefined)).toEqual({ allergens: ["arachidi"], excludedFoods: ["olive"] });
  });

  it("da entrambi, senza doppioni e senza perdere niente", () => {
    const log = [structure("s-1", T0, ["Latte", "uova"])];
    const prefs = { allergens: ["latte", "soia"], excludedFoods: [] };
    const out = dietDeclarationsMigration(log, legacyFor(log, prefs), mctx());
    const after = [...log, ...out];
    expect(withoutLegacy(after).allergens.map((x) => x.toLowerCase()).sort()).toEqual(["latte", "soia", "uova"]);
    expect(texts(after, prefs).allergens).toHaveLength(3);
  });

  it("rifatta non scrive niente", () => {
    const log = [structure("s-1", T0, ["uova"])];
    const prefs = { allergens: ["latte"], excludedFoods: ["funghi"] };
    const first = dietDeclarationsMigration(log, legacyFor(log, prefs), mctx());
    const after = [...log, ...first];
    expect(dietDeclarationsMigration(after, legacyFor(after, prefs), mctx())).toEqual([]);
  });

  it("se il ricettario o il piano non si leggono non fa niente", () => {
    const log = [structure("s-1", T0, ["uova"])];
    expect(dietDeclarationsMigration(log, { recipePrefs: "unreadable", planStructure: legacyPlanStructure(log) }, mctx())).toEqual([]);
    const broken = [{ ...structure("s-2", "2026-11-03T10:00:00.000Z", ["latte"]), meals: "rotto" } as unknown as AnyEvent];
    expect(legacyPlanStructure(broken)).toBe("unreadable");
    expect(dietDeclarationsMigration(broken, legacyFor(broken, { allergens: ["soia"], excludedFoods: [] }), mctx())).toEqual([]);
  });

  it("letti in parte: porta le voci che si leggono, senza toglierne", () => {
    const log = [structure("s-1", T0, ["uova"]), { ...structure("s-2", "2026-11-03T10:00:00.000Z", ["latte"]), meals: "rotto" } as unknown as AnyEvent];
    const out = dietDeclarationsMigration(log, legacyFor(log, { allergens: ["soia"], excludedFoods: [], partial: true }), mctx());
    expect(withoutLegacy([...log, ...out]).allergens.sort()).toEqual(["soia", "uova"]);
  });
});
