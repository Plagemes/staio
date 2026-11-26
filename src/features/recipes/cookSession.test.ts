import { describe, expect, it } from "vitest";
import { startCook, startTimer } from "./cookMode";
import { COOK_SESSION_MAX_AGE_MS, cookFingerprint, cookProgressText, cookResumeHref, declaredKeyOf, isOutcomePending, isPassageSeen, isSessionAlive, readCookSession, type CookSession, type OutcomeInput } from "./cookSession";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function session(over: Partial<CookSession> = {}): CookSession {
  return {
    v: 1,
    recipeId: "r-1",
    servings: 2,
    subs: "",
    state: { ...startCook(7), index: 2 },
    declaredKey: "latte|",
    deviceId: "dev-a",
    startedAt: iso(NOW - 600_000),
    updatedAt: iso(NOW - 60_000),
    ...over,
  };
}

describe("readCookSession", () => {
  it("rilegge una sessione valida, uguale a come è stata scritta", () => {
    const s = session();
    expect(readCookSession(JSON.parse(JSON.stringify(s)), NOW)).toEqual(s);
  });

  it.each([
    ["niente", undefined],
    ["un testo", "x"],
    ["una lista", []],
    ["versione sconosciuta", { ...session(), v: 2 }],
    ["senza ricetta", { ...session(), recipeId: "" }],
    ["porzioni zero", { ...session(), servings: 0 }],
    ["porzioni troppe", { ...session(), servings: 5000 }],
    ["indice fuori dai passi", { ...session(), state: { index: 7, stepCount: 7, timers: {} } }],
    ["passi non interi", { ...session(), state: { index: 0, stepCount: 2.5, timers: {} } }],
    ["timer di un passo che non c'è", { ...session(), state: { index: 0, stepCount: 3, timers: { 5: { totalMs: 1000, endsAt: null, remainingMs: 1000 } } } }],
    ["timer rotto", { ...session(), state: { index: 0, stepCount: 3, timers: { 1: { totalMs: -1, endsAt: null, remainingMs: 0 } } } }],
    ["data non valida", { ...session(), updatedAt: "ieri" }],
    ["senza telefono", { ...session(), deviceId: undefined }],
  ])("forma rotta (%s): undefined", (_label, raw) => {
    expect(readCookSession(raw, NOW)).toBeUndefined();
  });

  it("scade 12 ore dopo l'ultimo cambio", () => {
    const edge = session({ updatedAt: iso(NOW - COOK_SESSION_MAX_AGE_MS) });
    expect(isSessionAlive(edge, NOW)).toBe(true);
    expect(readCookSession(edge, NOW)).toBeDefined();
    const old = session({ updatedAt: iso(NOW - 13 * 3600_000) });
    expect(isSessionAlive(old, NOW)).toBe(false);
    expect(readCookSession(old, NOW)).toBeUndefined();
  });
});

describe("cookProgressText", () => {
  it("senza timer dice solo il passo", () => {
    expect(cookProgressText(session(), NOW)).toBe("passo 3 di 7");
  });

  it("con un timer acceso dice quanto manca", () => {
    const state = startTimer({ ...startCook(7), index: 2 }, 2, 5, NOW - 48_000);
    expect(cookProgressText(session({ state }), NOW)).toBe("passo 3 di 7 · timer 4:12");
  });

  it("un timer fermo non conta; uno scaduto lo dice", () => {
    const stopped = { ...startCook(7), index: 2, timers: { 2: { totalMs: 60_000, endsAt: null, remainingMs: 30_000 } } };
    expect(cookProgressText(session({ state: stopped }), NOW)).toBe("passo 3 di 7");
    const over = startTimer({ ...startCook(7), index: 2 }, 2, 1, NOW - 120_000);
    expect(cookProgressText(session({ state: over }), NOW)).toBe("passo 3 di 7 · timer finito");
  });

  it("con più timer accesi mostra quello che finisce prima", () => {
    let state = startTimer({ ...startCook(7), index: 2 }, 2, 10, NOW);
    state = startTimer(state, 1, 2, NOW);
    expect(cookProgressText(session({ state }), NOW)).toBe("passo 3 di 7 · timer 2:00");
  });
});

describe("declaredKeyOf", () => {
  it("l'ordine, le maiuscole, gli accenti e i doppioni non contano", () => {
    const a = declaredKeyOf({ allergens: ["Latte", "uova"], excludedFoods: ["Perché", "olive"] });
    const b = declaredKeyOf({ allergens: ["UOVA", "latte", "uova"], excludedFoods: ["olive", "perche"] });
    expect(a).toBe(b);
  });
  it("cambia se cambia una voce, e distingue allergeni da alimenti esclusi", () => {
    const base = declaredKeyOf({ allergens: ["latte"], excludedFoods: [] });
    expect(declaredKeyOf({ allergens: ["latte", "soia"], excludedFoods: [] })).not.toBe(base);
    expect(declaredKeyOf({ allergens: [], excludedFoods: ["latte"] })).not.toBe(base);
  });
  it("senza dichiarazioni è sempre lo stesso testo", () => {
    expect(declaredKeyOf({ allergens: [], excludedFoods: [] })).toBe(declaredKeyOf({ allergens: [" "], excludedFoods: [] }));
  });
});

describe("cookResumeHref", () => {
  it("porta id, porzioni e sostituzioni", () => {
    expect(cookResumeHref(session())).toBe("/app/ricette/cucina?id=r-1&porzioni=2");
    const href = cookResumeHref(session({ subs: "1:Margarina\n3:Latte di soia", servings: 1.5 }));
    const q = new URL(href, "http://x").searchParams;
    expect(q.get("id")).toBe("r-1");
    expect(q.get("porzioni")).toBe("1.5");
    expect(q.getAll("sost")).toEqual(["1:Margarina", "3:Latte di soia"]);
  });
});

const OUTCOME: OutcomeInput = {
  declared: { allergens: ["latte"], excludedFoods: [] },
  incomplete: false,
  verdict: "uncertain",
  contains: [],
  uncertain: ["«Crema»: non so cosa contiene"],
  confirmed: [],
  flags: [{ index: 1, verdict: "uncertain", text: "non so cosa contiene" }],
  ingredients: ["Pasta", "Crema"],
  steps: 4,
};

describe("cookFingerprint", () => {
  it("è sempre lo stesso per lo stesso esito e non contiene le liste in chiaro", () => {
    const key = cookFingerprint(OUTCOME);
    expect(cookFingerprint({ ...OUTCOME })).toBe(key);
    expect(key).toMatch(/^h1:[0-9a-f]+$/);
    expect(key).not.toContain("latte");
  });

  it("cambia se si dà o si toglie una conferma", () => {
    const base = cookFingerprint(OUTCOME);
    const confirmed = cookFingerprint({ ...OUTCOME, verdict: "clear", uncertain: [], confirmed: [{ key: "crema", text: "confermato da te il 3 novembre" }], flags: [{ index: 1, verdict: "confirmed", text: "confermato da te" }] });
    expect(confirmed).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, confirmed: [{ key: "crema", text: "x" }] })).not.toBe(base);
  });

  it("cambia se cambiano liste, esito completo, ingredienti segnalati o ricetta", () => {
    const base = cookFingerprint(OUTCOME);
    expect(cookFingerprint({ ...OUTCOME, declared: { allergens: ["latte", "soia"], excludedFoods: [] } })).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, incomplete: true })).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, verdict: "contains", contains: ["«Burro»: contiene latte"] })).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, flags: [{ index: 0, verdict: "uncertain", text: "non so cosa contiene" }] })).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, ingredients: ["Pasta", "Panna"] })).not.toBe(base);
    expect(cookFingerprint({ ...OUTCOME, steps: 5 })).not.toBe(base);
  });

  it("l'ordine e gli accenti nelle liste non contano", () => {
    expect(cookFingerprint({ ...OUTCOME, declared: { allergens: ["Latte", "UOVA"], excludedFoods: [] } })).toBe(cookFingerprint({ ...OUTCOME, declared: { allergens: ["uova", "latte"], excludedFoods: [] } }));
  });
});

describe("isPassageSeen", () => {
  const key = cookFingerprint(OUTCOME);
  it("senza niente di dichiarato non c'è niente da vedere", () => {
    expect(isPassageSeen({ nothingDeclared: true, currentKey: key, incomplete: false, ack: null })).toBe(true);
  });
  it("salta solo se l'impronta è la stessa di quella vista", () => {
    expect(isPassageSeen({ nothingDeclared: false, currentKey: key, incomplete: false, ack: { key, byUser: false } })).toBe(true);
    expect(isPassageSeen({ nothingDeclared: false, currentKey: cookFingerprint({ ...OUTCOME, steps: 9 }), incomplete: false, ack: { key, byUser: false } })).toBe(false);
  });
  it("una sessione senza visto, con l'impronta in chiaro di prima o con il controllo non letto mostra il passaggio", () => {
    expect(isPassageSeen({ nothingDeclared: false, currentKey: key, incomplete: false, ack: null })).toBe(false);
    expect(isPassageSeen({ nothingDeclared: false, currentKey: key, incomplete: false, ack: { key: "latte|", byUser: false } })).toBe(false);
    expect(isPassageSeen({ nothingDeclared: false, currentKey: null, incomplete: false, ack: { key, byUser: true } })).toBe(false);
  });
  it("con il controllo incompleto vale solo ciò che si è visto adesso", () => {
    expect(isPassageSeen({ nothingDeclared: false, currentKey: key, incomplete: true, ack: { key, byUser: false } })).toBe(false);
    expect(isPassageSeen({ nothingDeclared: false, currentKey: key, incomplete: true, ack: { key, byUser: true } })).toBe(true);
  });
});

describe("isOutcomePending", () => {
  const ready = { safetyLoading: false, chosenCount: 0, substitutesLoading: false, pantryRead: true };
  it("senza sostituzioni conta solo il controllo", () => {
    expect(isOutcomePending(ready)).toBe(false);
    expect(isOutcomePending({ ...ready, safetyLoading: true })).toBe(true);
    expect(isOutcomePending({ ...ready, substitutesLoading: true, pantryRead: false })).toBe(false);
  });
  it("con sostituzioni scelte aspetta i sostituti e la dispensa", () => {
    expect(isOutcomePending({ ...ready, chosenCount: 1, substitutesLoading: true })).toBe(true);
    expect(isOutcomePending({ ...ready, chosenCount: 1, pantryRead: false })).toBe(true);
    expect(isOutcomePending({ ...ready, chosenCount: 1 })).toBe(false);
  });
});
