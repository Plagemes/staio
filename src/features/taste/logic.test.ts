import { describe, expect, it } from "vitest";
import { createFoodMatcher } from "@/core/nutrition";
import { FOODS } from "@/core/nutrition/data/foods";
import { createTasteIndex, pairingsForSet } from "@/core/taste";
import { SAMPLE_TASTE_DATA } from "@/core/taste/sample";
import {
  daysText,
  doubtText,
  expiringPicks,
  hiddenText,
  homeSubjects,
  homeText,
  recipeSubjects,
  scoreText,
  strengthText,
  supportText,
  unknownText,
  type FoodIdOf,
} from "./logic";

const index = createTasteIndex(SAMPLE_TASTE_DATA);
const matcher = createFoodMatcher(FOODS);
// come nella schermata: solo corrispondenze a parole uguali
const foodIdOf: FoodIdOf = (name) => {
  const m = matcher.match(name);
  return m && m.confidence >= 0.95 ? m.food.id : undefined;
};

describe("soggetti", () => {
  it("la dispensa: nome del lotto, nome del prodotto, identificativo se il lotto lo è", () => {
    const s = homeSubjects(
      [
        { name: "Pomodori", allergens: [] },
        { name: "basilico-fresco", allergens: [] },
        { name: "Mozzarella Vallelata", productName: "Mozzarella", allergens: ["latte"] },
      ],
      foodIdOf,
    );
    expect(s[1]?.foodId).toBe("basilico-fresco");
    expect(s[2]?.aliases).toEqual(["Mozzarella"]);
    const r = pairingsForSet(index, [{ name: "Pomodoro" }], { home: s });
    if (r.status !== "ok") throw new Error("atteso ok");
    const home = r.pairings.filter((p) => p.inHome).map((p) => p.food.key);
    expect(home).toContain("basilico");
    expect(home).toContain("mozzarella");
    expect(home).not.toContain("pomodoro");
  });

  it("la ricetta: l'identificativo scritto vale più del nome", () => {
    const s = recipeSubjects(
      { ingredients: [{ name: "Passata", foodId: "passata-di-pomodoro" }, { name: "Sale" }, { name: "Cipolle" }] },
      foodIdOf,
    );
    expect(s[0]?.foodId).toBe("passata-di-pomodoro");
    const r = pairingsForSet(index, s);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.members.map((m) => m.key).sort()).toEqual(["cipolla", "pomodoro"]);
    expect(r.unknown).toEqual(["Sale"]);
  });
});

describe("ciò che scade", () => {
  it("raggruppa per alimento, dal più urgente, e dichiara ciò che non è in elenco", () => {
    const r = expiringPicks(
      index,
      [
        { name: "Latte", daysLeft: 0 },
        { name: "Pomodori", daysLeft: 3 },
        { name: "Basilico", daysLeft: 1 },
        { name: "pomodoro-crudo", daysLeft: 2 },
        { name: "Latte", daysLeft: 1 },
      ],
      foodIdOf,
    );
    expect(r.picks.map((p) => p.food.key)).toEqual(["basilico", "pomodoro"]);
    expect(r.picks[1]).toMatchObject({ daysLeft: 2, names: ["pomodoro-crudo", "Pomodori"] });
    expect(r.notInList).toEqual(["Latte"]);
  });

  it("nessuna scadenza: nulla", () => {
    expect(expiringPicks(index, [], foodIdOf)).toEqual({ picks: [], notInList: [] });
  });
});

describe("testi", () => {
  it("giorni", () => {
    expect(daysText(-1)).toBe("scaduto");
    expect(daysText(0)).toBe("scade oggi");
    expect(daysText(1)).toBe("scade domani");
    expect(daysText(3)).toBe("scade tra 3 giorni");
  });

  it("punteggio e forza: le fasce hanno nome solo per l'insieme di prova", () => {
    expect(scoreText(0.9)).toBe("0,90");
    expect(strengthText(0.9, "sample")).toBe("classico");
    expect(strengthText(0.5, "sample")).toBe("possibile");
    expect(strengthText(0.42, "flavorgraph")).toBe("somiglianza 0,42");
  });

  it("il dubbio non suona come un via libera", () => {
    const t = doubtText({ allergens: ["latte", "uova"], reasons: ["ingrediente generico o composto"] });
    expect(t).toMatch(/Non so se contiene latte e uova/);
    expect(t).toMatch(/controlla l'etichetta/);
    expect(t).not.toMatch(/compatibil|sicur/i);
  });

  it("casa, sostegno, nascosti, sconosciuti", () => {
    expect(homeText({ homeNames: ["Basilico", "Pesto"] })).toBe("Ce l'hai in casa: Basilico, Pesto");
    expect(supportText({ supportedBy: ["A", "B"] }, 1)).toBeUndefined();
    expect(supportText({ supportedBy: ["A", "B"] }, 2)).toBe("Si abbina a: A, B");
    expect(hiddenText(0)).toBeUndefined();
    expect(hiddenText(1)).toMatch(/^1 abbinamento non è mostrato/);
    expect(hiddenText(4)).toMatch(/^4 abbinamenti non sono mostrati/);
    expect(unknownText([])).toBeUndefined();
    expect(unknownText(["Sale", "Acqua", "Pepe"])).toBe("Non sono nell'elenco degli abbinamenti: Sale, Acqua e Pepe.");
  });
});
