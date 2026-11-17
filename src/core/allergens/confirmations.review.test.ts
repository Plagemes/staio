// Difetti trovati dalla revisione indipendente: orologi sballati nella revoca, chiave con tutti gli alfabeti,
// dispositivo di chi ha confermato, esclusioni obbligatorie con le conferme.
import { describe, expect, it } from "vitest";
import { seededRandom, shuffled } from "../diary/test-helpers";
import { voidOf } from "../ledger/test-helpers";
import {
  assessItem,
  assessRecipe,
  confirmIngredient,
  confirmationKey,
  deriveConfirmations,
  restoredConfirmationsNotice,
  revokeConfirmation,
  validateConfirmationEvent,
  type AllergenConfirmationEvent,
  type ConfirmationMap,
  type ItemSubject,
} from "./index";

let n = 0;
const ham: ItemSubject = { name: "Prosciutto cotto" };
const NONE = { allergens: ["glutine"], excludedFoods: [] as string[] };
const key = confirmationKey(ham);
const at = (iso: string, deviceId = "A") => ({ deviceId, now: () => iso, idGenerator: () => `x${String(++n).padStart(4, "0")}` });
const confirmAt = (iso: string, deviceId = "A", item: ItemSubject = ham): AllergenConfirmationEvent => {
  const r = confirmIngredient(item, NONE, at(iso, deviceId));
  if (!r.ok) throw new Error(r.reason);
  return r.event;
};
const revokeAt = (iso: string, cites: string[], deviceId = "A"): AllergenConfirmationEvent => {
  const e = revokeConfirmation(key, ham.name, at(iso, deviceId), cites);
  if (!e) throw new Error("revoca non valida");
  return e;
};
const mapOf = (events: unknown[]): ConfirmationMap => deriveConfirmations(events).byKey;
const everyOrder = (events: unknown[]) => {
  const random = seededRandom(11);
  return Array.from({ length: 20 }, () => deriveConfirmations(shuffled([...events, ...events], random)));
};

describe("revoca che cita le conferme, con gli orologi sballati", () => {
  it("conferma con l'orologio nel futuro, revoca con l'ora giusta: la conferma non vale più", () => {
    const c = confirmAt("2030-01-01T00:00:00.000Z");
    const r = revokeAt("2026-11-01T08:00:00.000Z", [c.id]);
    for (const s of everyOrder([c, r])) {
      expect(s.active).toEqual([]);
      expect(s.byKey.size).toBe(0);
      expect(s.revokedKeys).toEqual([key]);
    }
  });

  it("revoca con l'orologio indietro rispetto alla conferma: vale lo stesso", () => {
    const c = confirmAt("2026-11-01T08:00:00.000Z");
    const r = revokeAt("2020-01-01T00:00:00.000Z", [c.id], "B");
    for (const s of everyOrder([c, r])) expect(s.active).toEqual([]);
  });

  it("una conferma successiva (evento nuovo, non citato) vale di nuovo, anche con l'orologio dietro a quello revocato", () => {
    const c1 = confirmAt("2030-01-01T00:00:00.000Z");
    const r = revokeAt("2026-11-01T08:02:00.000Z", [c1.id]);
    const c2 = confirmAt("2026-11-01T08:05:00.000Z");
    for (const s of everyOrder([c1, r, c2])) {
      expect(s.active.map((a) => a.eventId)).toEqual([c2.id]);
      expect(assessItem(ham, ["glutine"], { confirmations: s.byKey, excludedFoods: [] }).verdict).toBe("clear");
    }
  });

  it("con la revoca nel futuro, chi riconferma scrive un orologio dopo la revoca e la conferma vale", () => {
    const c1 = confirmAt("2026-11-01T08:01:00.000Z");
    const r = revokeAt("2030-01-01T00:00:00.000Z", [c1.id]);
    const again = confirmIngredient(ham, NONE, { ...at("2026-11-01T08:05:00.000Z"), notBefore: r.recordedAt });
    if (!again.ok) throw new Error(again.reason);
    expect(again.event.recordedAt).toBe("2030-01-01T00:00:00.001Z");
    for (const s of everyOrder([c1, r, again.event])) expect(s.active.map((a) => a.eventId)).toEqual([again.event.id]);
  });

  it("la revoca cita tutte le conferme note: una più vecchia e superata non rivive", () => {
    const c0 = confirmAt("2026-11-01T08:01:00.000Z");
    const c1 = confirmAt("2026-11-01T08:02:00.000Z");
    const rec = deriveConfirmations([c0, c1]).byKey.get(key);
    expect([...(rec?.eventIds ?? [])].sort()).toEqual([c0.id, c1.id].sort());
    const r = revokeAt("2026-11-01T08:03:00.000Z", [...(rec?.eventIds ?? [])]);
    for (const s of everyOrder([c0, c1, r])) expect(s.active).toEqual([]);
  });

  it("annullare la revoca con un void rimette la conferma, anche con orologi sballati", () => {
    const c = confirmAt("2030-01-01T00:00:00.000Z");
    const r = revokeAt("2026-11-01T08:00:00.000Z", [c.id]);
    const v = voidOf("vv", "2026-11-01T08:30:00.000Z", r.id);
    for (const s of everyOrder([c, r, v])) expect(s.active.map((a) => a.eventId)).toEqual([c.id]);
  });

  it("una revoca senza citazioni (formato precedente) segue ancora l'orologio", () => {
    const c = confirmAt("2026-11-01T08:00:00.000Z");
    const r = revokeConfirmation(key, ham.name, at("2026-11-01T08:01:00.000Z"));
    expect(r).toBeDefined();
    expect(deriveConfirmations([c, r]).active).toEqual([]);
  });

  it("la citazione si valida: solo nelle revoche, id non vuoti, almeno uno se c'è", () => {
    const c = confirmAt("2026-11-01T08:00:00.000Z");
    const r = revokeAt("2026-11-01T08:01:00.000Z", [c.id]) as unknown as Record<string, unknown>;
    const codes = (e: Record<string, unknown>) => validateConfirmationEvent(e).map((x) => `${x.path}:${x.code}`);
    expect(codes(r)).toEqual([]);
    expect(codes({ ...r, revokes: [] })).toContain("revokes:required");
    expect(codes({ ...r, revokes: [""] })).toContain("revokes.0:invalid_type");
    expect(codes({ ...(c as unknown as Record<string, unknown>), revokes: ["a"] })).toContain("revokes:not_allowed");
  });
});

describe("revoca e conferme che chi revoca non conosceva", () => {
  const c = (iso: string, deviceId = "A") => confirmAt(iso, deviceId);

  it("conferma di un altro dispositivo, più recente di quella citata ma precedente alla revoca: ritirata anch'essa, in ogni ordine", () => {
    const known = c("2026-11-01T08:00:00.000Z", "A");
    const unknown = c("2026-11-01T09:00:00.000Z", "D");
    const r = revokeAt("2026-11-01T10:00:00.000Z", [known.id], "A");
    for (const s of everyOrder([known, unknown, r])) {
      expect(s.active).toEqual([]);
      expect(s.revokedKeys).toEqual([key]);
    }
    expect(assessItem(ham, ["glutine"], { confirmations: deriveConfirmations([known, unknown, r]).byKey, excludedFoods: [] }).verdict).toBe("uncertain");
  });

  it("a parità di istante con la revoca, anche quella non citata è ritirata", () => {
    const unknown = c("2026-11-01T10:00:00.000Z", "D");
    const r = revokeAt("2026-11-01T10:00:00.000Z", ["altro"], "A");
    for (const s of everyOrder([unknown, r])) expect(s.active).toEqual([]);
  });

  it("una revoca che cita solo id inesistenti ritira comunque le conferme precedenti", () => {
    const old = c("2026-11-01T08:00:00.000Z");
    const r = revokeAt("2026-11-01T09:00:00.000Z", ["non-esiste"]);
    const later = c("2026-11-01T09:30:00.000Z");
    for (const s of everyOrder([old, r])) expect(s.active).toEqual([]);
    for (const s of everyOrder([old, r, later])) expect(s.active.map((a) => a.eventId)).toEqual([later.id]);
  });

  it("riconferma con l'orologio indietro dopo una revoca: vale, perché scrive un istante dopo la revoca", () => {
    const first = c("2026-11-01T08:00:00.000Z");
    const r = revokeAt("2026-11-01T10:00:00.000Z", [first.id]);
    const state = deriveConfirmations([first, r]);
    expect(state.revokedAt.get(key)).toBe(r.recordedAt);
    const behind = confirmIngredient(ham, NONE, { ...at("2026-11-01T09:00:00.000Z"), notBefore: state.revokedAt.get(key) });
    if (!behind.ok) throw new Error(behind.reason);
    expect(behind.event.recordedAt).toBe("2026-11-01T10:00:00.001Z");
    for (const s of everyOrder([first, r, behind.event])) expect(s.active.map((a) => a.eventId)).toEqual([behind.event.id]);
    // senza il vincolo, la stessa riconferma con l'orologio indietro sarebbe ritirata: per questo il vincolo c'è
    const naive = c("2026-11-01T09:00:00.000Z");
    expect(deriveConfirmations([first, r, naive]).active).toEqual([]);
  });

  it("il vincolo non sposta in avanti una conferma che ha già l'orologio dopo la revoca", () => {
    const e = confirmIngredient(ham, NONE, { ...at("2026-11-01T11:00:00.000Z"), notBefore: "2026-11-01T10:00:00.000Z" });
    if (!e.ok) throw new Error(e.reason);
    expect(e.event.recordedAt).toBe("2026-11-01T11:00:00.000Z");
  });

  it("una revoca annullata con un void non ritira più niente, nemmeno le conferme non citate", () => {
    const known = c("2026-11-01T08:00:00.000Z");
    const unknown = c("2026-11-01T09:00:00.000Z", "D");
    const r = revokeAt("2026-11-01T10:00:00.000Z", [known.id]);
    const v = voidOf("vv2", "2026-11-01T10:30:00.000Z", r.id);
    for (const s of everyOrder([known, unknown, r, v])) {
      expect(s.active.map((a) => a.eventId)).toEqual([unknown.id]);
      expect([...(s.active[0]?.eventIds ?? [])].sort()).toEqual([known.id, unknown.id].sort());
    }
  });

  it("una revoca malformata (citazione vuota) è ignorata", () => {
    const known = c("2026-11-01T08:00:00.000Z");
    const bad = { ...revokeAt("2026-11-01T10:00:00.000Z", [known.id]), revokes: [] } as unknown as AllergenConfirmationEvent;
    expect(deriveConfirmations([known, bad]).active.map((a) => a.eventId)).toEqual([known.id]);
  });
});

describe("la conferma sa chi l'ha data", () => {
  it("il record porta il dispositivo dell'evento che vale", () => {
    const a = confirmAt("2026-11-01T08:01:00.000Z", "A");
    const b = confirmAt("2026-11-01T08:02:00.000Z", "B");
    expect(deriveConfirmations([a, b]).active[0]?.deviceId).toBe("B");
    expect(deriveConfirmations([a]).active[0]?.deviceId).toBe("A");
  });
});

describe("chiave con tutti gli alfabeti", () => {
  it("nomi che differiscono solo per lettere non latine hanno chiavi diverse", () => {
    expect(confirmationKey({ name: "salsa Молоко" })).not.toBe(confirmationKey({ name: "salsa Сыр" }));
    expect(confirmationKey({ name: "salsa 牛奶" })).not.toBe(confirmationKey({ name: "salsa 奶酪" }));
    expect(confirmationKey({ name: "Молоко" })).not.toBe("");
  });

  it("œ, æ, ø e ß non scompaiono", () => {
    expect(confirmationKey({ name: "bœuf" })).not.toBe(confirmationKey({ name: "bf" }));
    expect(confirmationKey({ name: "smør" })).not.toBe(confirmationKey({ name: "smr" }));
    expect(confirmationKey({ name: "straße" })).not.toBe(confirmationKey({ name: "strae" }));
    expect(confirmationKey({ name: "æble" })).not.toBe(confirmationKey({ name: "ble" }));
  });

  it("maiuscole, punteggiatura e forme Unicode equivalenti restano la stessa chiave; gli accenti no", () => {
    expect(confirmationKey({ name: "SALSA  Молоко!" })).toBe(confirmationKey({ name: "salsa молоко" }));
    expect(confirmationKey({ name: "café" })).toBe(confirmationKey({ name: "café" }));
    expect(confirmationKey({ name: "ｓａｌｓａ" })).toBe(confirmationKey({ name: "salsa" }));
    expect(confirmationKey({ name: "pâté" })).not.toBe(confirmationKey({ name: "pate" }));
  });

  it("la conferma non si dà se il nome resta vuoto dopo la normalizzazione", () => {
    expect(confirmIngredient({ name: " ?! — " }, NONE, at("2026-11-01T08:00:00.000Z"))).toEqual({ ok: false, reason: "no_name" });
  });

  it("un'esclusione in un altro alfabeto conta per la copertura", () => {
    const m = mapOf([confirmAt("2026-11-01T08:00:00.000Z")]);
    expect(assessItem(ham, ["glutine"], { confirmations: m, excludedFoods: [] }).verdict).toBe("clear");
    expect(assessItem(ham, ["glutine"], { confirmations: m, excludedFoods: ["Молоко"] }).verdict).toBe("uncertain");
  });
});

describe("esclusioni obbligatorie con le conferme", () => {
  it("a livello di tipi, con le conferme servono anche le esclusioni", () => {
    const m = mapOf([confirmAt("2026-11-01T08:00:00.000Z")]);
    // @ts-expect-error con `confirmations` serve `excludedFoods`
    assessItem(ham, ["glutine"], { confirmations: m });
    // @ts-expect-error anche per la ricetta
    assessRecipe({ ingredients: [ham] }, { allergens: ["glutine"], confirmations: m });
  });

  it("se le esclusioni mancano a runtime la conferma non conta (prudenza)", () => {
    const m = mapOf([confirmAt("2026-11-01T08:00:00.000Z")]);
    expect(assessItem(ham, ["glutine"], { confirmations: m } as never).verdict).toBe("uncertain");
    expect(assessRecipe({ ingredients: [ham] }, { allergens: ["glutine"], confirmations: m } as never).verdict).toBe("uncertain");
  });
});

describe("avviso dopo il ripristino di una copia", () => {
  it("dice quante conferme contiene e dove guardarle; con zero non dice niente", () => {
    expect(restoredConfirmationsNotice(0)).toBeUndefined();
    expect(restoredConfirmationsNotice(1)).toBe("Questa copia contiene 1 conferma di allergeni data in precedenza: controllala in Obiettivi.");
    expect(restoredConfirmationsNotice(3)).toBe("Questa copia contiene 3 conferme di allergeni date in precedenza: controllale in Obiettivi.");
  });
});
