import { describe, expect, it } from "vitest";
import { deriveDeclarations } from "@/core/allergens";
import { declarationsView, legacyOf, readPrefsDeclarations } from "./declarationsRead";

describe("readPrefsDeclarations", () => {
  it("tiene le voci leggibili e dice che il resto non si legge", () => {
    expect(readPrefsDeclarations({ allergens: ["latte", 3], excludedFoods: ["funghi"] })).toEqual({
      allergens: ["latte"],
      excludedFoods: ["funghi"],
      partial: true,
    });
    expect(readPrefsDeclarations({ allergens: "latte" })).toEqual({ allergens: ["latte"], excludedFoods: [], partial: true });
    expect(readPrefsDeclarations({ allergens: { x: 1 }, excludedFoods: ["olive"] })).toEqual({ allergens: [], excludedFoods: ["olive"], partial: true });
  });

  it("niente oggetto: non si legge; niente valore: niente", () => {
    expect(readPrefsDeclarations("latte")).toBe("unreadable");
    expect(readPrefsDeclarations(undefined)).toBeUndefined();
    expect(readPrefsDeclarations({ allergens: ["latte"] })).toEqual({ allergens: ["latte"], excludedFoods: [] });
  });

  it("il latte letto in parte conta, e il controllo è incompleto", () => {
    const state = deriveDeclarations([], legacyOf([], { allergens: ["latte", 3] }));
    expect(state.allergens.map((v) => v.text)).toEqual(["latte"]);
    expect(state.complete).toBe(false);
  });
});

describe("declarationsView", () => {
  it("niente esito finché non è letto; con un posto illeggibile, l'elenco va con l'avviso", () => {
    expect(declarationsView(undefined)).toEqual({ status: "loading" });
    const partial = deriveDeclarations([], legacyOf([], { allergens: ["latte", 3] }));
    expect(declarationsView(partial)).toEqual({ status: "ready", lists: { allergens: ["latte"], excludedFoods: [] }, incomplete: true });
    const whole = deriveDeclarations([], legacyOf([], { allergens: ["latte"] }));
    expect(declarationsView(whole)).toMatchObject({ status: "ready", incomplete: false });
  });
});
