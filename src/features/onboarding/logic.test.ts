import { describe, expect, it } from "vitest";
import { applyDiff, decideOnboarding, parseOnboarding, serializeOnboarding, type OnboardingInput } from "./logic";

const base: OnboardingInput = {
  pathname: "/app",
  raw: null,
  storageOk: true,
  existing: { loading: false, error: undefined, hasData: false },
};
const done = serializeOnboarding({ phase: "done" });

describe("parseOnboarding", () => {
  it("valori inattesi valgono «mai fatto»", () => {
    for (const raw of [null, "", "x", "1", "null", "[]", '{"phase":"altro"}']) expect(parseOnboarding(raw)).toEqual({ phase: "new" });
  });
  it("legge fase e punto di partenza", () => {
    expect(parseOnboarding(serializeOnboarding({ phase: "done", start: "meal" }))).toEqual({ phase: "done", start: "meal" });
    expect(parseOnboarding('{"phase":"redo","start":"x"}')).toEqual({ phase: "redo" });
  });
});

describe("decideOnboarding", () => {
  it("telefono nuovo e vuoto: lo propone", () => {
    expect(decideOnboarding(base)).toBe("offer");
  });
  it("aspetta finché non ha letto copia locale e dati", () => {
    expect(decideOnboarding({ ...base, raw: undefined })).toBe("wait");
    expect(decideOnboarding({ ...base, existing: { loading: true, error: undefined, hasData: false } })).toBe("wait");
  });
  it("chi ha già dati (copia ripristinata, sincronizzazione) non lo vede e viene segnato", () => {
    expect(decideOnboarding({ ...base, existing: { loading: false, error: undefined, hasData: true } })).toBe("skip-mark");
  });
  it("già fatto: mai due volte", () => {
    expect(decideOnboarding({ ...base, raw: done })).toBe("skip");
  });
  it("rifarlo vale anche con dei dati", () => {
    const raw = serializeOnboarding({ phase: "redo" });
    expect(decideOnboarding({ ...base, raw, existing: { loading: false, error: undefined, hasData: true } })).toBe("offer");
  });
  it("ogni dubbio apre l'app", () => {
    expect(decideOnboarding({ ...base, storageOk: false })).toBe("skip");
    expect(decideOnboarding({ ...base, existing: { loading: false, error: new Error("x"), hasData: false } })).toBe("skip");
  });
  it("solo sulla pagina iniziale", () => {
    expect(decideOnboarding({ ...base, pathname: "/app/dispensa" })).toBe("skip");
    expect(decideOnboarding({ ...base, pathname: "/app/cattura/veloce" })).toBe("skip");
  });
});

describe("applyDiff", () => {
  it("tiene ciò che è stato aggiunto altrove (altra scheda)", () => {
    expect(applyDiff(["latte", "uova"], ["latte"], ["latte", "glutine"])).toEqual(["latte", "uova", "glutine"]);
  });
  it("toglie solo ciò che è stato tolto qui", () => {
    expect(applyDiff(["latte", "uova"], ["latte", "uova"], ["uova"])).toEqual(["uova"]);
  });
  it("senza modifiche non cambia nulla, nemmeno con una lettura vuota", () => {
    expect(applyDiff(["latte"], [], [])).toEqual(["latte"]);
  });
});
