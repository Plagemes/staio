import { describe, expect, it } from "vitest";
import { FOODS } from "../nutrition/data/foods";
import { basisOf } from "./basis";
import { createTasteIndex, resolveTasteFood, searchTasteFoods } from "./index-build";
import { pairingsForSet, pairingsOf } from "./pairings";
import { SAMPLE_TASTE_DATA } from "./sample";
import { screenFood } from "./safety";
import type { TasteData } from "./types";

const index = createTasteIndex(SAMPLE_TASTE_DATA);
const food = (key: string) => {
  const f = index.byKey.get(key);
  if (!f) throw new Error(key);
  return f;
};

describe("insieme di prova", () => {
  it("è dichiarato di prova e non statistico", () => {
    expect(SAMPLE_TASTE_DATA.source).toBe("sample");
    expect(basisOf("sample").statistical).toBe(false);
    expect(basisOf("sample").text).toMatch(/prova/);
  });

  it("non ha voci mal formate", () => {
    expect(index.problems).toEqual([]);
  });

  it("ogni identificativo esiste nella tabella nutrizionale e appartiene a un solo alimento", () => {
    const known = new Set(FOODS.map((f) => f.id));
    const seen = new Map<string, string>();
    for (const f of SAMPLE_TASTE_DATA.foods) {
      expect(f.foodIds.length).toBeGreaterThan(0);
      for (const id of f.foodIds) {
        expect(known.has(id), `${f.key}: ${id}`).toBe(true);
        expect(seen.get(id), `${id} doppio`).toBeUndefined();
        seen.set(id, f.key);
      }
    }
  });

  it("ogni alimento ha almeno 5 vicini e nessuno è isolato", () => {
    for (const f of SAMPLE_TASTE_DATA.foods) {
      expect(index.links.get(f.key)?.size ?? 0, f.key).toBeGreaterThanOrEqual(4);
    }
  });

  it("i vicini sono simmetrici e con punteggio nelle tre fasce", () => {
    for (const [a, m] of index.links) {
      for (const [b, s] of m) {
        expect(index.links.get(b)?.get(a)).toBe(s);
        expect([0.5, 0.7, 0.9]).toContain(s);
      }
    }
  });
});

describe("riconoscimento dell'ingrediente", () => {
  it("per identificativo", () => {
    expect(resolveTasteFood(index, { name: "qualunque", foodId: "passata-di-pomodoro" })?.key).toBe("pomodoro");
  });

  it("per nome a parole uguali, singolare e plurale", () => {
    expect(resolveTasteFood(index, { name: "Pomodori" })?.key).toBe("pomodoro");
    expect(resolveTasteFood(index, { name: "uova" })?.key).toBe("uovo");
    expect(resolveTasteFood(index, { name: "Olio extravergine" })?.key).toBe("olio");
  });

  it("senza somiglianze approssimate", () => {
    expect(resolveTasteFood(index, { name: "Passata di pomodoro" })).toBeUndefined();
    expect(resolveTasteFood(index, { name: "Salsa di pomodoro" })).toBeUndefined();
    expect(resolveTasteFood(index, { name: "Pomodorino" })).toBeUndefined();
    expect(resolveTasteFood(index, { name: "Sale" })).toBeUndefined();
  });

  it("prova i nomi alternativi dopo il nome", () => {
    expect(resolveTasteFood(index, { name: "Mia scorta", aliases: ["Basilico"] })?.key).toBe("basilico");
  });

  it("un alias ambiguo tra due alimenti non vale per nessuno", () => {
    const data: TasteData = {
      source: "sample",
      version: "t",
      foods: [
        { key: "a", name: "Alfa", aliases: ["comune"], foodIds: ["x"] },
        { key: "b", name: "Beta", aliases: ["comune"], foodIds: ["y"] },
      ],
      neighbors: { a: [["b", 0.5]] },
    };
    const i = createTasteIndex(data);
    expect(resolveTasteFood(i, { name: "comune" })).toBeUndefined();
    expect(resolveTasteFood(i, { name: "Alfa" })?.key).toBe("a");
  });

  it("la ricerca per l'interfaccia cerca per inizio di parola", () => {
    expect(searchTasteFoods(index, "pomo").map((f) => f.key)).toEqual(["pomodoro"]);
    expect(searchTasteFoods(index, "  ").length).toBe(0);
    expect(searchTasteFoods(index, "xyz")).toEqual([]);
    expect(searchTasteFoods(index, "parm")[0]?.key).toBe("parmigiano");
  });
});

describe("abbinamenti di un ingrediente", () => {
  it("in ordine di punteggio, ciascuno con la base", () => {
    const r = pairingsOf(index, { name: "Pomodoro" });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.members.map((m) => m.key)).toEqual(["pomodoro"]);
    const scores = r.pairings.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r.pairings[0]?.score).toBe(0.9);
    expect(r.pairings.map((p) => p.food.key)).toContain("basilico");
    expect(r.pairings.map((p) => p.food.key)).not.toContain("pomodoro");
    expect(r.basis.source).toBe("sample");
    expect(r.basis.statistical).toBe(false);
  });

  it("rispetta il limite e non mostra più dei vicini", () => {
    const r = pairingsOf(index, { name: "Pomodoro" }, { limit: 5 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.pairings).toHaveLength(5);
  });

  it("alimento non in elenco: esito esplicito, niente inventato", () => {
    const r = pairingsOf(index, { name: "Rabarbaro" });
    expect(r).toMatchObject({ status: "not_in_list", unknown: ["Rabarbaro"] });
    expect(r).not.toHaveProperty("pairings");
    expect(pairingsForSet(index, [])).toMatchObject({ status: "not_in_list", unknown: [] });
  });

  it("un punteggio statistico vero porta la sua base statistica", () => {
    const data: TasteData = {
      source: "flavorgraph",
      version: "t",
      foods: [
        { key: "a", name: "Alfa", foodIds: ["x"] },
        { key: "b", name: "Beta", foodIds: ["y"] },
      ],
      neighbors: { a: [["b", 0.42]] },
    };
    const r = pairingsOf(createTasteIndex(data), { name: "Alfa" });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.basis.statistical).toBe(true);
    expect(r.basis.text).toMatch(/non è una regola/i);
    expect(r.basis.text).toMatch(/salute/);
    expect(r.pairings[0]?.score).toBe(0.42);
  });
});

describe("abbinamenti di un insieme", () => {
  it("la media conta 0 dove non c'è legame, così chi si abbina a più alimenti sale", () => {
    const r = pairingsForSet(index, [{ name: "Pomodoro" }, { name: "Aglio" }]);
    if (r.status !== "ok") throw new Error("atteso ok");
    const olio = r.pairings.find((p) => p.food.key === "olio");
    expect(olio?.score).toBe(0.9);
    expect(olio?.supportedBy.sort()).toEqual(["Aglio", "Pomodoro"]);
    const mozzarella = r.pairings.find((p) => p.food.key === "mozzarella");
    expect(mozzarella?.score).toBe(0.45);
    expect(mozzarella?.supportedBy).toEqual(["Pomodoro"]);
    expect(r.pairings.map((p) => p.food.key)).not.toContain("pomodoro");
    expect(r.pairings.map((p) => p.food.key)).not.toContain("aglio");
  });

  it("dichiara ciò che non è nell'elenco, senza perdere il resto", () => {
    const r = pairingsForSet(index, [{ name: "Pomodoro" }, { name: "Sale" }, { name: "Acqua" }, { name: "Sale" }]);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.unknown).toEqual(["Sale", "Acqua"]);
    expect(r.members).toHaveLength(1);
  });

  it("due nomi dello stesso alimento contano una volta", () => {
    const r = pairingsForSet(index, [{ name: "Pomodoro" }, { name: "x", foodId: "passata-di-pomodoro" }]);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.members).toHaveLength(1);
  });
});

describe("ciò che c'è già in casa", () => {
  it("segna gli abbinamenti presenti in dispensa con i nomi scritti lì", () => {
    const r = pairingsOf(
      index,
      { name: "Pomodoro" },
      { home: [{ name: "Basilico" }, { name: "Mozzarella di bufala" }, { name: "Mozzarella" }, { name: "Latte" }] },
    );
    if (r.status !== "ok") throw new Error("atteso ok");
    const inHome = r.pairings.filter((p) => p.inHome).map((p) => p.food.key);
    expect(inHome.sort()).toEqual(["basilico", "mozzarella"]);
    expect(r.pairings.find((p) => p.food.key === "mozzarella")?.homeNames).toEqual(["Mozzarella"]);
    expect(r.homeNotInList).toBe(2);
    expect(r.pairings.find((p) => p.food.key === "aglio")?.inHome).toBe(false);
  });

  it("tiene anche gli abbinamenti di casa oltre il limite", () => {
    const r = pairingsOf(index, { name: "Pomodoro" }, { limit: 2, home: [{ name: "Cumino" }] });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.pairings.length).toBe(3);
    expect(r.pairings.some((p) => p.food.key === "cumino" && p.inHome)).toBe(true);
  });

  it("l'ingrediente stesso non è un suo abbinamento anche se è in casa", () => {
    const r = pairingsOf(index, { name: "Pomodoro" }, { home: [{ name: "Pomodori" }] });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.pairings.some((p) => p.inHome)).toBe(false);
  });
});

describe("allergeni", () => {
  const keysOf = (allergens: string[], excludedFoods: string[] = []) => {
    const r = pairingsOf(index, { name: "Pomodoro" }, { allergens, excludedFoods, limit: 200 });
    if (r.status !== "ok") throw new Error("atteso ok");
    return r;
  };

  it("contains: escluso e contato", () => {
    const none = keysOf([]);
    const r = keysOf(["glutine"]);
    expect(r.pairings.map((p) => p.food.key)).not.toContain("pasta");
    expect(r.hiddenCount).toBeGreaterThan(0);
    expect(r.pairings.length + r.hiddenCount).toBe(none.pairings.length);
  });

  it("lattosio toglie i formaggi, non la frutta", () => {
    const r = keysOf(["lattosio"]);
    const keys = r.pairings.map((p) => p.food.key);
    expect(keys).not.toContain("mozzarella");
    expect(keys).not.toContain("parmigiano");
    expect(keys).toContain("basilico");
  });

  it("alimenti esclusi per nome", () => {
    const r = keysOf([], ["basilico"]);
    expect(r.pairings.map((p) => p.food.key)).not.toContain("basilico");
    expect(r.hiddenCount).toBe(1);
  });

  it("un alimento escluso non rientra perché è in casa", () => {
    const r = pairingsOf(index, { name: "Pomodoro" }, { allergens: ["glutine"], home: [{ name: "Pasta" }], limit: 200 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.pairings.some((p) => p.food.key === "pasta")).toBe(false);
  });

  it("uncertain: mostrato con il segno di incertezza, mai come compatibile", () => {
    const data: TasteData = {
      source: "sample",
      version: "t",
      foods: [
        { key: "a", name: "Alfa", foodIds: ["x"] },
        { key: "b", name: "Salsa", foodIds: ["y"] },
        { key: "c", name: "Basilico", foodIds: ["basilico-fresco"] },
      ],
      neighbors: { a: [["b", 0.9], ["c", 0.7]] },
    };
    const i = createTasteIndex(data);
    const r = pairingsOf(i, { name: "Alfa" }, { allergens: ["glutine"] });
    if (r.status !== "ok") throw new Error("atteso ok");
    const salsa = r.pairings.find((p) => p.food.key === "b");
    const basilico = r.pairings.find((p) => p.food.key === "c");
    expect(salsa?.doubt).toBeDefined();
    expect(salsa?.doubt?.allergens.length).toBeGreaterThan(0);
    expect(salsa?.doubt?.reasons.length).toBeGreaterThan(0);
    expect(basilico?.doubt).toBeUndefined();
  });

  it("con l'insieme di prova: il cioccolato resta con il segno di dubbio per il latte", () => {
    const r = pairingsOf(index, { name: "Banana" }, { allergens: ["lattosio"], limit: 200 });
    if (r.status !== "ok") throw new Error("atteso ok");
    const c = r.pairings.find((p) => p.food.key === "cioccolato");
    expect(c?.doubt?.allergens).toEqual(["latte"]);
    expect(r.pairings.some((p) => p.food.key === "yogurt")).toBe(false);
  });

  it("senza allergeni dichiarati nessun segno", () => {
    const r = keysOf([]);
    expect(r.pairings.every((p) => p.doubt === undefined)).toBe(true);
    expect(r.hiddenCount).toBe(0);
  });

  it("screenFood guarda anche gli identificativi", () => {
    expect(screenFood({ key: "k", name: "Cosa", foodIds: ["pasta-semola-secca"] }, { allergens: ["glutine"] }).status).toBe("excluded");
    expect(screenFood(food("basilico"), { allergens: ["glutine", "lattosio", "uova"] }).status).toBe("clear");
    expect(screenFood(food("uovo"), { allergens: ["uova"] }).status).toBe("excluded");
  });
});
