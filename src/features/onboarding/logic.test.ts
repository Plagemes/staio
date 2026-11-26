import { describe, expect, it } from "vitest";
import { applyDiff, declarationDiff, splitVoices, decideOnboarding, parseOnboarding, serializeOnboarding, type OnboardingInput } from "./logic";

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
  it("legge fase, giorno di fine e «Lascia così»", () => {
    expect(parseOnboarding(serializeOnboarding({ phase: "done", since: "2026-11-26", stepsHidden: true }))).toEqual({
      phase: "done",
      since: "2026-11-26",
      stepsHidden: true,
    });
    expect(parseOnboarding('{"phase":"done"}')).toEqual({ phase: "done" });
  });
  it("una memoria vecchia con `start` si legge senza errori e `start` si ignora", () => {
    expect(parseOnboarding('{"phase":"done","start":"meal"}')).toEqual({ phase: "done" });
    expect(parseOnboarding('{"phase":"redo","start":"x"}')).toEqual({ phase: "redo" });
  });
  it("scarta giorno e «Lascia così» malformati", () => {
    for (const since of [20261126, "2026-11-6", "oggi", "", null, {}]) {
      expect(parseOnboarding(JSON.stringify({ phase: "done", since }))).toEqual({ phase: "done" });
    }
    expect(parseOnboarding('{"phase":"done","stepsHidden":"yes"}')).toEqual({ phase: "done" });
    expect(parseOnboarding('{"phase":"done","stepsHidden":false}')).toEqual({ phase: "done" });
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

describe("declarationDiff", () => {
  it("toglie latte e aggiunge soia in una sola lista di cambi", () => {
    expect(declarationDiff("allergens", ["latte"], ["latte"], ["soia"])).toEqual([
      { action: "remove", list: "allergens", text: "latte" },
      { action: "add", list: "allergens", text: "soia" },
    ]);
  });
  it("non tocca ciò che è cambiato altrove e non ripete ciò che c'è già", () => {
    expect(declarationDiff("excludedFoods", ["funghi", "Olive"], ["funghi"], ["funghi", "olive"])).toEqual([]);
    expect(declarationDiff("excludedFoods", [], ["funghi"], [])).toEqual([]);
  });
  it("niente cambiato: niente da scrivere", () => {
    expect(declarationDiff("allergens", ["latte"], ["Latte"], ["latte"])).toEqual([]);
  });
});

describe("splitVoices", () => {
  it("non taglia le voci lunghe e non mette un tetto", () => {
    const long = "a".repeat(90);
    expect(splitVoices(`funghi, ${long}; Funghi`)).toEqual(["funghi", long]);
    expect(splitVoices(Array.from({ length: 50 }, (_, i) => `v${i}`).join(","))).toHaveLength(50);
  });
  it("un'esclusione già dichiarata con una virgola resta una voce sola", () => {
    const existing = ["pesce crudo, sushi", "funghi"];
    expect(splitVoices("pesce crudo, sushi, funghi", existing)).toEqual(["pesce crudo, sushi", "funghi"]);
    expect(declarationDiff("excludedFoods", existing, existing, splitVoices("pesce crudo, sushi, funghi", existing))).toEqual([]);
  });
});
