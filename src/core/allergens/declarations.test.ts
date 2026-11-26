import { describe, expect, it } from "vitest";
import { voidOf } from "../ledger/test-helpers";
import {
  DECLARATION_LIMITS,
  adoptLegacyDeclarations,
  declareVoice,
  declaredTexts,
  deriveDeclarations,
  legacyPlanStructure,
  planDeclarationChanges,
  removeVoice,
  validateDeclarationEvent,
  type AllergenDeclarationEvent,
  type DeclarationChange,
  type LegacyDeclarations,
} from "./index";

let n = 0;
const stamp = (minutes: number): string => new Date(Date.UTC(2026, 10, 1, 8, minutes)).toISOString();
const opts = (minutes: number, deviceId = "A") => ({ deviceId, now: () => stamp(minutes), idGenerator: () => `d${String(++n).padStart(4, "0")}` });
const NONE: LegacyDeclarations = { recipePrefs: undefined, planStructure: undefined };

function add(list: "allergens" | "excludedFoods", text: string, minutes = 0, deviceId = "A"): AllergenDeclarationEvent {
  const e = declareVoice(list, text, opts(minutes, deviceId));
  if (!e) throw new Error(text);
  return e;
}
function remove(list: "allergens" | "excludedFoods", text: string, revokes: string[], minutes = 0, deviceId = "A"): AllergenDeclarationEvent {
  const e = removeVoice(list, text, revokes, opts(minutes, deviceId));
  if (!e) throw new Error(text);
  return e;
}
const structure = (id: string, minutes: number, allergens: string[], excludedFoods: string[] = []) => ({
  id,
  type: "planStructure",
  at: stamp(minutes),
  recordedAt: stamp(minutes),
  deviceId: "B",
  schemaVersion: 1,
  certainty: "measured",
  source: "manual",
  meals: [{ kind: "lunch" }],
  allergens,
  excludedFoods,
});
const legacyOf = (events: readonly unknown[], recipePrefs: LegacyDeclarations["recipePrefs"] = undefined): LegacyDeclarations => ({
  recipePrefs,
  planStructure: legacyPlanStructure(events),
});
const texts = (events: readonly unknown[], legacy: LegacyDeclarations = legacyOf(events)) => declaredTexts(deriveDeclarations(events, legacy));

/** Applica dei cambi come farebbe la pagina Alimentazione e restituisce il registro dopo. */
function apply(events: readonly unknown[], changes: DeclarationChange[], legacy = legacyOf(events), minutes = 30): unknown[] {
  const plan = planDeclarationChanges(events, legacy, changes, opts(minutes));
  if (!plan.ok) throw new Error(plan.reason);
  return [...events, ...plan.events];
}

describe("validateDeclarationEvent", () => {
  it("accetta le aggiunte e le tolte costruite", () => {
    expect(validateDeclarationEvent(add("allergens", "latte"))).toEqual([]);
    expect(validateDeclarationEvent(remove("allergens", "latte", ["x"]))).toEqual([]);
    expect(validateDeclarationEvent(remove("allergens", "latte", []))).toEqual([]);
  });

  it("respinge campi mancanti o fuori misura", () => {
    const ok = add("allergens", "latte");
    const bad = (patch: Record<string, unknown>) => validateDeclarationEvent({ ...ok, ...patch }).length > 0;
    expect(bad({ action: "toggle" })).toBe(true);
    expect(bad({ list: "altro" })).toBe(true);
    expect(bad({ text: "" })).toBe(true);
    expect(bad({ text: "a".repeat(DECLARATION_LIMITS.maxTextLength + 1) })).toBe(true);
    expect(bad({ text: "lat\u0007te" })).toBe(true);
    expect(bad({ revokes: ["a"] })).toBe(true); // `revokes` solo con `remove`
    expect(bad({ absorbs: Array.from({ length: DECLARATION_LIMITS.maxIds + 1 }, (_, i) => `p${i}`) })).toBe(true);
    expect(bad({ origin: "altrove" })).toBe(true);
    expect(validateDeclarationEvent({ ...remove("allergens", "latte", []), origin: "onboarding" }).length).toBeGreaterThan(0);
  });

  it("i costruttori non producono eventi non validi", () => {
    expect(declareVoice("allergens", "", opts(0))).toBeUndefined();
    expect(declareVoice("allergens", "a".repeat(81), opts(0))).toBeUndefined();
  });

  it("le voci di prima e le tolte possono essere lunghe; i caratteri di controllo diventano spazi", () => {
    expect(declareVoice("allergens", "a".repeat(500), { ...opts(0), origin: "planStructure" })).toBeDefined();
    expect(declareVoice("allergens", "a".repeat(500), { ...opts(0), origin: "onboarding" })).toBeUndefined();
    expect(removeVoice("allergens", "a".repeat(500), [], opts(0))).toBeDefined();
    expect(declareVoice("allergens", "lat\u0007te", opts(0))?.text).toBe("lat te");
  });
});

describe("deriveDeclarations", () => {
  it("1. latte solo nel ricettario conta", () => {
    expect(texts([], { recipePrefs: { allergens: ["latte"], excludedFoods: [] }, planStructure: undefined }).allergens).toEqual(["latte"]);
  });

  it("2. latte solo nell'ultima struttura del piano conta", () => {
    const log = [structure("s-1", 0, ["glutine"]), structure("s-2", 5, ["latte"])];
    expect(texts(log).allergens).toEqual(["latte"]);
  });

  it("3. la stessa voce in tre posti è una sola, con il testo degli eventi", () => {
    const log = [structure("s-1", 0, ["Latte"]), add("allergens", "latte", 1)];
    const state = deriveDeclarations(log, legacyOf(log, { allergens: ["LATTE"], excludedFoods: [] }));
    expect(state.allergens.map((v) => v.text)).toEqual(["latte"]);
    expect(state.allergens[0].sources.sort()).toEqual(["events", "planStructure", "recipePrefs"]);
  });

  it("4. la stessa parola in due liste resta in tutte e due", () => {
    const log = [add("allergens", "fragole")];
    expect(texts(log, legacyOf(log, { allergens: [], excludedFoods: ["fragole"] }))).toEqual({ allergens: ["fragole"], excludedFoods: ["fragole"] });
  });

  it("5. due telefoni che aggiungono insieme, anche con orologi sfalsati: tutte e due le voci", () => {
    const uova = add("allergens", "uova", 10, "A");
    const soia = add("allergens", "soia", 10 - 60, "B");
    expect(texts([uova, soia]).allergens.sort()).toEqual(["soia", "uova"]);
    expect(texts([soia, uova]).allergens.sort()).toEqual(["soia", "uova"]);
  });

  it("6. una tolta non cancella l'aggiunta che non conosceva", () => {
    const fromA = add("allergens", "uova", 0, "A");
    const fromB = add("allergens", "uova", 1, "B");
    const removed = remove("allergens", "uova", [fromA.id], 2, "A");
    expect(texts([fromA, removed, fromB]).allergens).toEqual(["uova"]);
    expect(texts([fromA, removed]).allergens).toEqual([]);
  });

  it("7. annullare l'aggiunta la toglie; annullare la tolta la fa tornare", () => {
    const latte = add("allergens", "latte", 0);
    expect(texts([latte, voidOf("v-1", stamp(1), latte.id)]).allergens).toEqual([]);
    const removed = remove("allergens", "latte", [latte.id], 2);
    expect(texts([latte, removed]).allergens).toEqual([]);
    expect(texts([latte, removed, voidOf("v-2", stamp(3), removed.id)]).allergens).toEqual(["latte"]);
  });

  it("8. ricettario illeggibile: le voci degli eventi valgono, il controllo è incompleto, la migrazione non gira", () => {
    const log = [add("allergens", "latte")];
    const legacy: LegacyDeclarations = { recipePrefs: "unreadable", planStructure: undefined };
    const state = deriveDeclarations(log, legacy);
    expect(state.complete).toBe(false);
    expect(declaredTexts(state).allergens).toEqual(["latte"]);
    expect(adoptLegacyDeclarations(log, legacy, opts(5))).toEqual([]);
  });

  it("9. ultima struttura del piano non valida: vale la precedente valida, e il controllo è incompleto", () => {
    const log = [structure("s-1", 0, ["latte"]), { ...structure("s-2", 5, ["uova"]), meals: "rotto" }];
    expect(legacyPlanStructure(log)).toMatchObject({ id: "s-1", partial: true });
    const state = deriveDeclarations(log, legacyOf(log));
    expect(state.complete).toBe(false);
    expect(declaredTexts(state).allergens).toEqual(["latte"]);
    // nessuna valida: non si legge
    expect(legacyPlanStructure([{ ...structure("s-3", 5, ["uova"]), meals: "rotto" }])).toBe("unreadable");
    // una struttura non valida più vecchia di una buona non nasconde niente
    const older = [{ ...structure("s-0", 0, ["uova"]), meals: "rotto" }, structure("s-1", 5, ["latte"])];
    expect(deriveDeclarations(older, legacyOf(older)).complete).toBe(true);
    // un evento di dichiarazione non valido rende incompleto
    expect(deriveDeclarations([{ ...add("allergens", "latte"), list: "altro" }], NONE).complete).toBe(false);
  });

  it("10. una struttura scritta dopo la migrazione da un telefono vecchio conta; tolta da Alimentazione sparisce", () => {
    const base = [structure("s-1", 0, ["latte"])];
    const migrated = [...base, ...adoptLegacyDeclarations(base, legacyOf(base), opts(1))];
    expect(texts(migrated).allergens).toEqual(["latte"]);
    const old = [...migrated, structure("s-2", 10, ["latte", "arachidi"])];
    expect(texts(old).allergens.sort()).toEqual(["arachidi", "latte"]);
    const after = apply(old, [{ action: "remove", list: "allergens", text: "arachidi" }]);
    expect(texts(after).allergens).toEqual(["latte"]);
  });

  it("10b. togliere una voce del piano non fa sparire le altre voci del piano", () => {
    const log = [structure("s-1", 0, ["latte", "uova"], ["funghi"])];
    const after = apply(log, [{ action: "remove", list: "allergens", text: "latte" }]);
    expect(texts(after)).toEqual({ allergens: ["uova"], excludedFoods: ["funghi"] });
    expect(texts(after, NONE)).toEqual({ allergens: ["uova"], excludedFoods: ["funghi"] });
  });

  it("11. una struttura nuova con le liste dichiarate: nessuna voce persa, nessuna voce tolta che rientra", () => {
    const log = [add("allergens", "latte", 0), structure("s-1", 1, ["uova"])];
    const removed = apply(log, [{ action: "remove", list: "allergens", text: "uova" }]);
    const now = texts(removed);
    expect(now.allergens).toEqual(["latte"]);
    const saved = [...removed, structure("s-2", 40, now.allergens, now.excludedFoods)];
    expect(texts(saved).allergens).toEqual(["latte"]);
  });

  it("commutativa e idempotente: ordine e doppioni non contano", () => {
    const a = add("allergens", "latte", 0);
    const b = add("excludedFoods", "funghi", 1, "B");
    const r = remove("allergens", "latte", [a.id], 2);
    const c = add("allergens", "soia", 3);
    const orders = [[a, b, r, c], [c, r, b, a], [r, a, c, b], [a, a, b, r, r, c, c]];
    const states = orders.map((o) => deriveDeclarations(o, NONE));
    for (const s of states) expect(s).toEqual(states[0]);
    expect(declaredTexts(states[0])).toEqual({ allergens: ["soia"], excludedFoods: ["funghi"] });
  });

  it("8b. ricettario letto in parte: le voci leggibili valgono, il controllo è incompleto", () => {
    const state = deriveDeclarations([], { recipePrefs: { allergens: ["latte"], excludedFoods: [], partial: true }, planStructure: undefined });
    expect(declaredTexts(state).allergens).toEqual(["latte"]);
    expect(state.complete).toBe(false);
  });

  it("una tolta conta solo per aggiunte della stessa lista e della stessa voce", () => {
    const latte = add("allergens", "latte", 0);
    const funghi = add("excludedFoods", "funghi", 0);
    const wrongText = remove("allergens", "soia", [latte.id], 1);
    const wrongList = remove("allergens", "funghi", [funghi.id], 1);
    expect(texts([latte, funghi, wrongText, wrongList])).toEqual({ allergens: ["latte"], excludedFoods: ["funghi"] });
    expect(texts([latte, remove("allergens", "Latte", [latte.id], 2)]).allergens).toEqual([]);
  });

  it("changedAt è l'ultima scrittura", () => {
    expect(deriveDeclarations([add("allergens", "latte", 0), add("allergens", "soia", 9)], NONE).changedAt).toBe(stamp(9));
    expect(deriveDeclarations([], NONE).changedAt).toBeUndefined();
  });
});

describe("planDeclarationChanges", () => {
  it("17. una voce vuota o troppo lunga non si scrive", () => {
    expect(planDeclarationChanges([], NONE, [{ action: "add", list: "allergens", text: "   " }], opts(0))).toEqual({ ok: false, reason: "empty" });
    expect(planDeclarationChanges([], NONE, [{ action: "add", list: "allergens", text: "a".repeat(81) }], opts(0))).toEqual({ ok: false, reason: "too_long" });
  });

  it("18. la 41ª voce attiva è rifiutata", () => {
    const log = Array.from({ length: 40 }, (_, i) => add("excludedFoods", `cibo ${i}`, i));
    expect(planDeclarationChanges(log, NONE, [{ action: "add", list: "excludedFoods", text: "un altro" }], opts(50))).toEqual({ ok: false, reason: "too_many" });
    // l'altra lista non è piena
    expect(planDeclarationChanges(log, NONE, [{ action: "add", list: "allergens", text: "latte" }], opts(50)).ok).toBe(true);
  });

  it("doppioni e voci mancanti", () => {
    const log = [add("allergens", "latte")];
    expect(planDeclarationChanges(log, NONE, [{ action: "add", list: "allergens", text: "Latte" }], opts(1))).toEqual({ ok: false, reason: "duplicate" });
    expect(planDeclarationChanges(log, NONE, [{ action: "remove", list: "allergens", text: "soia" }], opts(1))).toEqual({ ok: false, reason: "missing" });
  });

  it("togliere una voce del ricettario: prima un'aggiunta automatica, poi la tolta che la ritira", () => {
    const legacy: LegacyDeclarations = { recipePrefs: { allergens: ["latte"], excludedFoods: [] }, planStructure: undefined };
    const plan = planDeclarationChanges([], legacy, [{ action: "remove", list: "allergens", text: "latte" }], { ...opts(1), automaticNote: "auto" });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.prefsRemovals).toEqual({ allergens: ["latte"], excludedFoods: [] });
    expect(plan.prelude).toHaveLength(1);
    expect(plan.prelude[0]).toMatchObject({ action: "add", text: "latte", origin: "recipePrefs", note: "auto" });
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ action: "remove", revokes: [plan.prelude[0].id] });
    const log = [...plan.prelude, ...plan.events];
    const empty: LegacyDeclarations = { recipePrefs: { allergens: [], excludedFoods: [] }, planStructure: undefined };
    expect(texts(log, empty).allergens).toEqual([]);
    // annullata la tolta, il latte torna anche senza il ricettario
    expect(texts([...log, voidOf("v-r", stamp(2), plan.events[0].id)], empty).allergens).toEqual(["latte"]);
  });

  it("una voce lunga del ricettario o del piano si toglie sempre", () => {
    const long = `${"formaggio stagionato ".repeat(6)}di grotta`;
    const fromPrefs: LegacyDeclarations = { recipePrefs: { allergens: [], excludedFoods: [long, "olive"] }, planStructure: undefined };
    const p1 = planDeclarationChanges([], fromPrefs, [{ action: "remove", list: "excludedFoods", text: long }], opts(1));
    if (!p1.ok) throw new Error(p1.reason);
    expect(texts([...p1.prelude, ...p1.events], { recipePrefs: { allergens: [], excludedFoods: ["olive"] }, planStructure: undefined }).excludedFoods).toEqual(["olive"]);
    const log = [structure("s-1", 0, ["latte"], [long, "olive"])];
    const after = apply(log, [{ action: "remove", list: "excludedFoods", text: long }]);
    expect(texts(after)).toEqual({ allergens: ["latte"], excludedFoods: ["olive"] });
    const after2 = apply(log, [{ action: "remove", list: "excludedFoods", text: "olive" }]);
    expect(texts(after2).excludedFoods.map((x) => x.length)).toEqual([long.length]);
  });

  it("15. togliere latte e aggiungere soia è una sola scrittura, senza nota automatica", () => {
    const log = [add("allergens", "latte")];
    const plan = planDeclarationChanges(
      log,
      NONE,
      [
        { action: "remove", list: "allergens", text: "latte" },
        { action: "add", list: "allergens", text: "soia" },
      ],
      { ...opts(5), origin: "onboarding" },
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.prelude).toEqual([]);
    expect(plan.events.map((e) => e.action)).toEqual(["remove", "add"]);
    expect(plan.events.every((e) => e.note === undefined)).toBe(true);
    expect(texts([...log, ...plan.events]).allergens).toEqual(["soia"]);
  });

  it("una struttura del piano con una voce enorme non si prende: si tolgono comunque le altre voci", () => {
    const huge = "a".repeat(DECLARATION_LIMITS.maxLegacyTextLength + 1);
    const log = [add("allergens", "soia", 0), structure("s-1", 1, ["latte", huge])];
    expect(planDeclarationChanges(log, legacyOf(log), [{ action: "remove", list: "allergens", text: "latte" }], opts(2))).toEqual({
      ok: false,
      reason: "plan_unabsorbable",
    });
    // una voce che non viene dal piano si toglie, anche insieme a una che non si può togliere
    const plan = planDeclarationChanges(
      log,
      legacyOf(log),
      [
        { action: "remove", list: "allergens", text: "latte" },
        { action: "remove", list: "allergens", text: "soia" },
      ],
      opts(2),
    );
    if (!plan.ok) throw new Error(plan.reason);
    expect(texts([...log, ...plan.events]).allergens).toHaveLength(2);
    // aggiungere resta possibile, e la struttura continua a contare
    const after = apply(log, [{ action: "add", list: "allergens", text: "uova" }]);
    expect(texts(after).allergens).toHaveLength(4);
  });
});
