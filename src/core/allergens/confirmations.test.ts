import { describe, expect, it } from "vitest";
import { validateAnyEvent, familyOf, mergeAllEvents } from "../events";
import { voidOf } from "../ledger/test-helpers";
import { seededRandom, shuffled } from "../diary/test-helpers";
import {
  assessItem,
  assessRecipe,
  confirmIngredient,
  confirmability,
  confirmationKey,
  confirmationLapse,
  deriveConfirmations,
  revokeConfirmation,
  validateConfirmationEvent,
  type AllergenConfirmationEvent,
  type ConfirmationMap,
  type ItemSubject,
} from "./index";

const stamp = (minutes: number): string => new Date(Date.UTC(2026, 10, 1, 8, minutes)).toISOString();
let n = 0;
const opts = (minutes: number, deviceId = "A") => ({ deviceId, now: () => stamp(minutes), idGenerator: () => `e${String(++n).padStart(4, "0")}` });
const NONE = { allergens: ["glutine"], excludedFoods: [] as string[] };

const ham: ItemSubject = { name: "Prosciutto cotto" };

function confirm(item: ItemSubject, criteria = NONE, minutes = 1, deviceId = "A"): AllergenConfirmationEvent {
  const r = confirmIngredient(item, criteria, opts(minutes, deviceId));
  if (!r.ok) throw new Error(`rifiutata: ${r.reason}`);
  return r.event;
}
const revoke = (item: ItemSubject, minutes: number, deviceId = "A"): AllergenConfirmationEvent => {
  const e = revokeConfirmation(confirmationKey(item), item.name, opts(minutes, deviceId));
  if (!e) throw new Error("revoca non valida");
  return e;
};
const mapOf = (events: unknown[]): ConfirmationMap => deriveConfirmations(events).byKey;

describe("chiave dell'ingrediente", () => {
  it("usa la normalizzazione del motore: maiuscole, accenti e punteggiatura non cambiano la chiave", () => {
    expect(confirmationKey({ name: "Prosciutto  COTTO!" })).toBe(confirmationKey({ name: "prosciutto cotto" }));
    expect(confirmationKey({ name: "PÂTÉ" })).toBe(confirmationKey({ name: "pâté" }));
  });

  it("nomi simili non sono lo stesso ingrediente", () => {
    const k = confirmationKey({ name: "prosciutto cotto" });
    expect(confirmationKey({ name: "prosciutto crudo" })).not.toBe(k);
    expect(confirmationKey({ name: "prosciutto cotto affumicato" })).not.toBe(k);
    expect(confirmationKey({ name: "prosciutti cotti" })).not.toBe(k);
    expect(confirmationKey({ name: "cotto prosciutto" })).not.toBe(k);
  });

  it("nota, alimento, collegati, prodotto e codici fanno parte della chiave; l'ordine dei collegati no", () => {
    const k = confirmationKey({ name: "prosciutto cotto", linkedNames: ["A", "B"], productRefs: ["1", "2"] });
    expect(confirmationKey({ name: "prosciutto cotto", linkedNames: ["b", "a"], productRefs: ["2", "1"] })).toBe(k);
    expect(confirmationKey({ name: "prosciutto cotto" })).not.toBe(k);
    expect(confirmationKey({ name: "prosciutto cotto", linkedNames: ["A", "B"], productRefs: ["1", "3"] })).not.toBe(k);
    expect(confirmationKey({ name: "prosciutto cotto", note: "a fette" })).not.toBe(confirmationKey({ name: "prosciutto cotto" }));
    expect(confirmationKey({ name: "prosciutto cotto", productName: "Rovagnati" })).not.toBe(confirmationKey({ name: "prosciutto cotto" }));
    expect(confirmationKey({ name: "prosciutto cotto", foodId: "prosciutto-cotto" })).not.toBe(confirmationKey({ name: "prosciutto cotto" }));
  });

  it("un nome senza lettere né cifre non ha chiave", () => {
    expect(confirmationKey({ name: "  ?! " })).toBe("");
  });
});

describe("che cosa si può confermare", () => {
  it("un ingrediente incerto sì", () => {
    expect(assessItem(ham, ["glutine"]).verdict).toBe("uncertain");
    expect(confirmability(ham, NONE).ok).toBe(true);
  });

  it("un ingrediente che contiene l'allergene no, e nemmeno si propone", () => {
    const r = confirmIngredient({ name: "farina 00" }, NONE, opts(1));
    expect(r).toEqual({ ok: false, reason: "contains" });
    expect(confirmability({ name: "farina 00" }, NONE)).toEqual({ ok: false, reason: "contains" });
  });

  it("un ingrediente che contiene un altro allergene dichiarato no, anche se per il primo è solo incerto", () => {
    const both = { allergens: ["glutine", "latte"], excludedFoods: [] as string[] };
    expect(assessItem({ name: "burro" }, ["glutine", "latte"]).verdict).toBe("contains");
    expect(confirmIngredient({ name: "burro" }, both, opts(1))).toEqual({ ok: false, reason: "contains" });
  });

  it("l'etichetta che dichiara l'allergene è un contains: non si conferma", () => {
    const item = { name: "prosciutto cotto", labelAllergens: ["en:gluten"] };
    expect(confirmIngredient(item, NONE, opts(1))).toEqual({ ok: false, reason: "contains" });
  });

  it("un ingrediente che corrisponde a un'esclusione no", () => {
    const c = { allergens: ["glutine"], excludedFoods: ["maiale"] };
    expect(confirmIngredient({ name: "prosciutto cotto" }, c, opts(1))).toEqual({ ok: false, reason: "contains" });
  });

  it("un ingrediente riconosciuto e pulito non serve confermarlo; senza allergeni dichiarati non c'è niente da confermare", () => {
    expect(confirmIngredient({ name: "riso" }, NONE, opts(1))).toEqual({ ok: false, reason: "not_uncertain" });
    expect(confirmIngredient(ham, { allergens: [], excludedFoods: [] }, opts(1))).toEqual({ ok: false, reason: "nothing_declared" });
    expect(confirmIngredient({ name: "?!" }, NONE, opts(1))).toEqual({ ok: false, reason: "no_name" });
  });

  it("anche una conferma costruita a mano su un contains non conta: il motore la ignora", () => {
    const flour: ItemSubject = { name: "farina 00" };
    const fake: ConfirmationMap = new Map([
      [confirmationKey(flour), { key: confirmationKey(flour), ingredient: "farina 00", allergens: ["glutine"], excludedFoods: [], confirmedAt: stamp(1), eventId: "x", eventIds: ["x"], deviceId: "A" }],
    ]);
    const a = assessItem(flour, ["glutine"], { confirmations: fake, excludedFoods: [] });
    expect(a.verdict).toBe("contains");
    expect(a.confirmed).toBeUndefined();
    const r = assessRecipe({ ingredients: [flour] }, { allergens: ["glutine"], confirmations: fake, excludedFoods: [] });
    expect(r.verdict).toBe("contains");
    expect(r.confirmed).toBeUndefined();
  });
});

describe("effetto della conferma sul motore", () => {
  it("l'ingrediente confermato non è clear in silenzio: l'esito porta la conferma con la data", () => {
    const e = confirm(ham);
    const a = assessItem(ham, ["glutine"], { confirmations: mapOf([e]), excludedFoods: [] });
    expect(a.verdict).toBe("clear");
    expect(a.findings).toEqual([]);
    expect(a.confirmed).toHaveLength(1);
    expect(a.confirmed?.[0]).toMatchObject({ allergen: "glutine", verdict: "uncertain", confirmedAt: e.recordedAt });
  });

  it("senza conferme il motore dà gli stessi esiti di prima", () => {
    expect(assessItem(ham, ["glutine"]).confirmed).toBeUndefined();
    expect(assessItem(ham, ["glutine"], { confirmations: new Map(), excludedFoods: [] })).toEqual(assessItem(ham, ["glutine"]));
  });

  it("una ricetta con soli ingredienti clear e confermati è clear e porta il segno", () => {
    const e = confirm(ham);
    const a = assessRecipe({ ingredients: [{ name: "riso" }, ham] }, { allergens: ["glutine"], confirmations: mapOf([e]), excludedFoods: [] });
    expect(a.verdict).toBe("clear");
    expect(a.allergens).toEqual([]);
    expect(a.confirmed).toEqual([expect.objectContaining({ index: 1, name: "Prosciutto cotto", allergen: "glutine", confirmedAt: e.recordedAt })]);
  });

  it("un ingrediente confermato accanto a uno ancora incerto: la ricetta resta incerta solo per l'altro", () => {
    const e = confirm(ham);
    const a = assessRecipe({ ingredients: [ham, { name: "sugo pronto" }] }, { allergens: ["glutine"], confirmations: mapOf([e]), excludedFoods: [] });
    expect(a.verdict).toBe("uncertain");
    expect(a.allergens[0]?.ingredients.map((i) => i.name)).toEqual(["sugo pronto"]);
    expect(a.confirmed?.map((c) => c.name)).toEqual(["Prosciutto cotto"]);
  });

  it("la conferma non nasconde un allergene trovato in un'altra riga, nei passi o nel titolo", () => {
    const e = confirm(ham);
    const m = mapOf([e]);
    expect(assessRecipe({ ingredients: [ham, { name: "farina 00" }] }, { allergens: ["glutine"], confirmations: m, excludedFoods: [] }).verdict).toBe("contains");
    expect(assessRecipe({ ingredients: [ham], steps: ["Spolvera con la farina"] }, { allergens: ["glutine"], confirmations: m, excludedFoods: [] }).verdict).toBe("contains");
    expect(assessRecipe({ title: "Pasta al forno", ingredients: [ham] }, { allergens: ["glutine"], confirmations: m, excludedFoods: [] }).verdict).toBe("contains");
  });
});

describe("la conferma copre solo ciò che era dichiarato", () => {
  it("conferma, poi nuovo allergene: per il nuovo l'ingrediente torna incerto", () => {
    const e = confirm(ham);
    const m = mapOf([e]);
    const a = assessItem(ham, ["glutine", "uova"], { confirmations: m, excludedFoods: [] });
    expect(a.verdict).toBe("uncertain");
    expect(a.findings.map((f) => f.allergen)).toEqual(["uova"]);
    expect(a.confirmed?.map((f) => f.allergen)).toEqual(["glutine"]);
    const r = assessRecipe({ ingredients: [ham] }, { allergens: ["glutine", "uova"], confirmations: m, excludedFoods: [] });
    expect(r.verdict).toBe("uncertain");
    expect(r.allergens.map((o) => o.allergen)).toEqual(["uova"]);
  });

  it("se il nuovo allergene è trovato con certezza l'ingrediente è contains e la conferma non conta più", () => {
    const pesto: ItemSubject = { name: "pesto" };
    const m = mapOf([confirm(pesto, NONE)]);
    expect(assessItem(pesto, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("clear");
    const a = assessItem(pesto, ["glutine", "latte"], { confirmations: m, excludedFoods: [] });
    expect(a.verdict).toBe("contains");
    expect(a.confirmed).toBeUndefined();
    expect(a.findings.map((f) => `${f.allergen}:${f.verdict}`)).toEqual(["glutine:uncertain", "latte:contains"]);
    expect(assessRecipe({ ingredients: [pesto] }, { allergens: ["glutine", "latte"], confirmations: m, excludedFoods: [] }).verdict).toBe("contains");
  });

  it("se l'utente toglie un allergene la conferma vale ancora per gli altri", () => {
    const e = confirm(ham, { allergens: ["glutine", "uova"], excludedFoods: [] });
    const a = assessItem(ham, ["glutine"], { confirmations: mapOf([e]), excludedFoods: [] });
    expect(a.verdict).toBe("clear");
  });

  it("una nuova esclusione dichiarata dopo la conferma toglie valore alla conferma", () => {
    const e = confirm(ham, { allergens: ["glutine"], excludedFoods: ["funghi"] });
    const m = mapOf([e]);
    expect(assessItem(ham, ["glutine"], { confirmations: m, excludedFoods: ["funghi"] }).verdict).toBe("clear");
    expect(assessItem(ham, ["glutine"], { confirmations: m, excludedFoods: ["Funghi", "noci"] }).verdict).toBe("uncertain");
    expect(
      assessRecipe({ ingredients: [ham] }, { allergens: ["glutine"], excludedFoods: ["funghi", "noci"], confirmations: m }).verdict,
    ).toBe("uncertain");
  });

  it("l'ingrediente che corrisponde a un'esclusione resta contains anche se confermato prima", () => {
    const e = confirm(ham);
    const r = assessRecipe({ ingredients: [ham] }, { allergens: ["glutine"], excludedFoods: ["maiale"], confirmations: mapOf([e]) });
    expect(r.verdict).toBe("contains");
  });

  it("confirmationLapse dice che cosa non è coperto", () => {
    const rec = mapOf([confirm(ham, { allergens: ["glutine"], excludedFoods: ["funghi"] })]).get(confirmationKey(ham));
    expect(rec).toBeDefined();
    expect(confirmationLapse(rec!, ["glutine", "uova"], ["funghi", "noci"])).toEqual({ allergens: ["uova"], excludedFoods: ["noci"] });
    expect(confirmationLapse(rec!, ["glutine"], ["funghi"])).toEqual({ allergens: [], excludedFoods: [] });
  });
});

describe("legata all'ingrediente e al prodotto", () => {
  it("«prosciutto cotto» confermato non copre «prosciutto crudo» né «prosciutto cotto affumicato»", () => {
    const m = mapOf([confirm(ham)]);
    expect(assessItem(ham, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("clear");
    expect(assessItem({ name: "prosciutto crudo" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessItem({ name: "prosciutto cotto affumicato" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessItem({ name: "prosciutti cotti" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
  });

  it("maiuscole e accenti non fanno decadere la conferma", () => {
    const m = mapOf([confirm(ham)]);
    expect(assessItem({ name: "PROSCIUTTO   cotto" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("clear");
  });

  it("cambiare prodotto collegato, nome del prodotto o codice a barre fa decadere la conferma", () => {
    const linked: ItemSubject = { name: "prosciutto cotto", linkedNames: ["Prosciutto Alfa"], productName: "Alfa cotto", productRefs: ["800111"] };
    const m = mapOf([confirm(linked)]);
    expect(assessItem(linked, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("clear");
    expect(assessItem({ ...linked, productRefs: ["800222"] }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessItem({ ...linked, linkedNames: ["Prosciutto Beta"] }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessItem({ ...linked, productName: "Beta cotto" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessItem({ name: "prosciutto cotto" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
    // la conferma data senza prodotto non copre un prodotto collegato dopo
    const m2 = mapOf([confirm(ham)]);
    expect(assessItem(linked, ["glutine"], { confirmations: m2, excludedFoods: [] }).verdict).toBe("uncertain");
  });

  it("cambiare la nota fa decadere la conferma", () => {
    const m = mapOf([confirm(ham)]);
    expect(assessItem({ name: "prosciutto cotto", note: "affumicato" }, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("uncertain");
  });
});

describe("revoca e riconferma", () => {
  it("la revoca toglie la conferma; la riconferma dopo la revoca vale di nuovo", () => {
    const c1 = confirm(ham, NONE, 1);
    const r = revoke(ham, 2);
    const c2 = confirm(ham, NONE, 3);
    expect(deriveConfirmations([c1]).active).toHaveLength(1);
    const revoked = deriveConfirmations([c1, r]);
    expect(revoked.active).toEqual([]);
    expect(revoked.revokedKeys).toEqual([confirmationKey(ham)]);
    expect(assessItem(ham, ["glutine"], { confirmations: revoked.byKey, excludedFoods: [] }).verdict).toBe("uncertain");
    const again = deriveConfirmations([c1, r, c2]);
    expect(again.active).toHaveLength(1);
    expect(again.active[0]?.eventId).toBe(c2.id);
    expect(assessItem(ham, ["glutine"], { confirmations: again.byKey, excludedFoods: [] }).verdict).toBe("clear");
  });

  it("a parità di istante la revoca vince sulla conferma, qualunque sia l'id", () => {
    const c = confirm(ham, NONE, 5);
    const r = revoke(ham, 5);
    expect(c.recordedAt).toBe(r.recordedAt);
    // id della conferma maggiore di quello della revoca
    const high = { ...c, id: "zzzz" } as AllergenConfirmationEvent;
    const low = { ...r, id: "aaaa" } as AllergenConfirmationEvent;
    expect(deriveConfirmations([high, low]).active).toEqual([]);
    expect(deriveConfirmations([low, high]).active).toEqual([]);
  });

  it("una conferma più vecchia della revoca non rivive, né arrivando dopo", () => {
    const c = confirm(ham, NONE, 1);
    const r = revoke(ham, 2);
    expect(deriveConfirmations([r, c]).active).toEqual([]);
  });

  it("una revoca vale per la sua chiave soltanto", () => {
    const other: ItemSubject = { name: "sugo pronto" };
    const state = deriveConfirmations([confirm(ham, NONE, 1), confirm(other, NONE, 1), revoke(ham, 2)]);
    expect(state.active.map((a) => a.ingredient)).toEqual(["sugo pronto"]);
  });

  it("annullare con void la revoca ripristina la conferma; annullare la conferma la toglie", () => {
    const c = confirm(ham, NONE, 1);
    const r = revoke(ham, 2);
    const v1 = voidOf("v1", stamp(3), r.id);
    expect(deriveConfirmations([c, r, v1]).active).toHaveLength(1);
    const v2 = voidOf("v2", stamp(3), c.id);
    expect(deriveConfirmations([c, v2]).active).toEqual([]);
  });
});

describe("unione tra dispositivi", () => {
  const base = (): AllergenConfirmationEvent[] => {
    n = 0;
    const other: ItemSubject = { name: "sugo pronto" };
    return [
      confirm(ham, NONE, 1, "A"),
      revoke(ham, 2, "B"),
      confirm(ham, { allergens: ["glutine", "uova"], excludedFoods: [] }, 3, "A"),
      confirm(other, NONE, 2, "B"),
      revoke(other, 4, "A"),
      confirm({ name: "tonno in scatola" }, NONE, 5, "B"),
    ];
  };

  it("lo stato non dipende dall'ordine né dai duplicati", () => {
    const events = base();
    const expected = deriveConfirmations(events);
    expect(expected.active.map((a) => a.ingredient).sort()).toEqual(["Prosciutto cotto", "tonno in scatola"]);
    const random = seededRandom(7);
    for (let i = 0; i < 40; i++) {
      const order = shuffled([...events, ...events.slice(0, 3)], random);
      const state = deriveConfirmations(order);
      expect(state.active).toEqual(expected.active);
      expect(state.revokedKeys).toEqual(expected.revokedKeys);
    }
  });

  it("due dispositivi che si uniscono in ordine diverso arrivano allo stesso risultato", () => {
    const events = base();
    const a = events.filter((e) => e.deviceId === "A");
    const b = events.filter((e) => e.deviceId === "B");
    const ab = mergeAllEvents(a, b).events;
    const ba = mergeAllEvents(b, a).events;
    expect(deriveConfirmations(ab)).toEqual(deriveConfirmations(ba));
    expect(deriveConfirmations(ab).active).toEqual(deriveConfirmations(events).active);
    // unire due volte è lo stesso che unire una volta
    expect(deriveConfirmations(mergeAllEvents(ab, ab).events)).toEqual(deriveConfirmations(ab));
  });

  it("eventi di altre famiglie e voci non valide non cambiano nulla", () => {
    const events = base();
    const noise = [{ type: "water", id: "w1" }, { type: "allergenConfirmation", id: "bad" }, null, 3];
    const state = deriveConfirmations([...events, ...noise]);
    expect(state.active).toEqual(deriveConfirmations(events).active);
    expect(state.anomalies.some((x) => x.code === "invalid_event")).toBe(true);
  });
});

describe("validazione e famiglia", () => {
  const good = (): AllergenConfirmationEvent => confirm(ham);

  it("gli eventi creati sono validi e appartengono alla famiglia delle conferme", () => {
    const c = good();
    expect(validateConfirmationEvent(c)).toEqual([]);
    expect(validateAnyEvent(c)).toEqual([]);
    expect(familyOf(c)).toBe("allergenConfirmations");
    const r = revoke(ham, 9);
    expect(validateAnyEvent(r)).toEqual([]);
    expect(c.certainty).toBe("measured");
  });

  it("controlla azione, chiave, ingrediente e liste", () => {
    const c = good() as unknown as Record<string, unknown>;
    const codes = (x: Record<string, unknown>) => validateConfirmationEvent({ ...c, ...x }).map((e) => `${e.path}:${e.code}`);
    expect(codes({ action: "boh" })).toContain("action:invalid_value");
    expect(codes({ action: undefined })).toContain("action:required");
    expect(codes({ key: "" })).toContain("key:invalid_type");
    expect(codes({ ingredient: undefined })).toContain("ingredient:required");
    expect(codes({ allergens: [] })).toContain("allergens:required");
    expect(codes({ allergens: undefined })).toContain("allergens:required");
    expect(codes({ allergens: ["glutine", 3] })).toContain("allergens.1:invalid_type");
    expect(codes({ excludedFoods: "funghi" })).toContain("excludedFoods:invalid_type");
    expect(codes({ action: "revoke" })).toContain("allergens:not_allowed");
  });

  it("la revoca non porta allergeni", () => {
    const r = revoke(ham, 9) as unknown as Record<string, unknown>;
    expect(r.allergens).toBeUndefined();
    expect(validateConfirmationEvent(r)).toEqual([]);
  });
});
