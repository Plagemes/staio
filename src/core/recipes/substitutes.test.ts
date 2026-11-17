import { describe, expect, it } from "vitest";
import compact from "../taste/data/flavorgraph.json";
import { createTasteIndex, decodeTasteData, type CompactTasteData } from "../taste";
import { deriveRecipes } from "./derive";
import {
  MAX_SUBSTITUTES,
  SUBSTITUTE_FAMILIES,
  applySubstitutions,
  substitutesFor,
  type HomeFood,
  type SubstituteVerdict,
} from "./substitutes";
import { recipeEvent } from "./test-helpers";

const index = createTasteIndex(decodeTasteData(compact as unknown as CompactTasteData));
const clear = (): SubstituteVerdict => ({ status: "clear" });
const home = (...names: string[]): HomeFood[] => names.map((name) => ({ name, subject: { name } }));
const names = (ingredient: string, pantry: HomeFood[], screen: (c: { name: string }) => SubstituteVerdict = clear) =>
  substitutesFor(index, { name: ingredient }, pantry, { screen }).map((s) => s.name);

describe("famiglie", () => {
  it("usano solo chiavi che esistono nei dati di gusto", () => {
    for (const f of SUBSTITUTE_FAMILIES) for (const k of [...f.from, ...(f.to ?? [])]) expect(index.byKey.has(k), `${f.id}: ${k}`).toBe(true);
  });
  it("hanno almeno due alimenti ciascuna", () => {
    for (const f of SUBSTITUTE_FAMILIES) expect(new Set([...f.from, ...(f.to ?? [])]).size, f.id).toBeGreaterThanOrEqual(2);
  });
});

describe("casi veri, con i dati veri", () => {
  it("burro → margarina e olio, e strutto per la famiglia larga", () => {
    expect(names("Burro", home("Margarina", "Olio d'oliva", "Strutto"))).toEqual(["Margarina", "Olio d'oliva"]);
    expect(names("Burro", home("Strutto"))).toEqual(["Strutto"]);
  });
  it("burro non diventa yogurt, kefir, olio di cocco o panna: famiglia diversa o vicinanza bassa", () => {
    expect(names("Burro", home("Yogurt", "Kefir", "Olio di cocco", "Panna"))).toEqual([]);
  });
  it("l'olio non diventa burro: la sostituzione è a senso unico", () => {
    expect(names("Olio d'oliva", home("Burro", "Margarina"))).toEqual([]);
  });
  it("panna → yogurt, yogurt greco, panna acida; non latte", () => {
    expect(names("Panna", home("Yogurt", "Latte"))).toEqual(["Yogurt"]);
    expect(names("Panna", home("Yogurt greco", "Panna acida")).sort()).toEqual(["Panna acida", "Yogurt greco"]);
  });
  it("spinaci → bietola, anche se i dati non li mettono tra i primi vicini (famiglia stretta)", () => {
    expect(names("Spinaci", home("Bietola", "Broccoli", "Carota", "Funghi"))).toEqual(["Bietola"]);
  });
  it("limone → lime, non arancia (altra famiglia) né cannella (altro gruppo, vicinanza alta)", () => {
    expect(names("Limone", home("Lime", "Arancia", "Cannella", "Pomodoro"))).toEqual(["Lime"]);
  });
  it("latte → pollo, formaggi, burro, zucchero, farina non escono", () => {
    expect(names("Latte", home("Pollo", "Petto di pollo", "Parmigiano", "Mozzarella", "Burro", "Panna", "Zucchero", "Farina"))).toEqual([]);
  });
  it("latte → bevanda di soia sì", () => {
    expect(names("Latte", home("Bevanda di soia", "Pollo"))).toEqual(["Bevanda di soia"]);
  });
  it("pollo → manzo non esce anche se i dati lo danno vicinissimo: la famiglia decide", () => {
    expect(names("Pollo", home("Manzo", "Maiale", "Pasta", "Broccoli"))).toEqual([]);
    expect(names("Pollo", home("Petto di tacchino"))).toEqual(["Petto di tacchino"]);
  });
  it("una famiglia larga esige i dati: mozzarella → provolone sì, mozzarella → gouda no", () => {
    expect(names("Mozzarella", home("Provolone", "Gouda"))).toEqual(["Provolone"]);
  });
  it("il macinato non prende il posto del pezzo intero, né il contrario", () => {
    expect(names("Manzo", home("Manzo macinato", "Maiale macinato"))).toEqual([]);
    expect(names("Vitello", home("Manzo macinato"))).toEqual([]);
    expect(names("Maiale", home("Maiale macinato"))).toEqual([]);
    expect(names("Manzo macinato", home("Manzo", "Vitello"))).toEqual([]);
    expect(names("Manzo macinato", home("Maiale macinato"))).toEqual(["Maiale macinato"]);
    expect(names("Manzo", home("Vitello"))).toEqual(["Vitello"]);
  });
  it("manzo → maiale non esce, anche se i dati lo danno vicino (0,83): la famiglia larga è manzo, vitello, agnello", () => {
    expect(names("Manzo", home("Maiale", "Agnello"))).toEqual([]);
    expect(names("Maiale", home("Manzo", "Vitello", "Agnello"))).toEqual([]);
    expect(names("Vitello", home("Maiale", "Manzo"))).toEqual(["Manzo"]);
  });
  it("ostriche, vongole, cozze e capesante non hanno sostituti", () => {
    expect(names("Ostriche", home("Vongole", "Cozze", "Capesante"))).toEqual([]);
    expect(names("Vongole", home("Cozze", "Ostriche"))).toEqual([]);
  });
  it("parmigiano → pecorino; non gorgonzola né mozzarella", () => {
    expect(names("Parmigiano", home("Pecorino romano", "Gorgonzola", "Mozzarella"))).toEqual(["Pecorino romano"]);
  });
});

describe("regole", () => {
  it("mai più di due proposte", () => {
    expect(names("Mozzarella", home("Provolone", "Fontina", "Cheddar", "Emmental"))).toHaveLength(MAX_SUBSTITUTES);
  });
  it("le famiglie strette vengono prima delle larghe", () => {
    const r = substitutesFor(index, { name: "Burro" }, home("Strutto", "Olio d'oliva", "Margarina"), { screen: clear, max: 5 });
    expect(r.map((s) => s.closeness)).toEqual(["tight", "tight", "loose"]);
    expect(r.at(-1)?.name).toBe("Strutto");
    expect(r.at(-1)?.score).toBeCloseTo(0.3);
  });
  it("un ingrediente fuori dall'elenco di gusto, o in casa fuori dall'elenco, non dà niente", () => {
    expect(names("Pane di segale invisibile", home("Margarina"))).toEqual([]);
    expect(names("Burro", home("Qualcosa di inventato"))).toEqual([]);
    expect(names("Burro", [])).toEqual([]);
  });
  it("non propone sé stesso", () => {
    expect(names("Burro", home("Burro"))).toEqual([]);
  });
  it("riconosce l'alimento anche dall'identificativo della tabella nutrizionale", () => {
    const r = substitutesFor(
      index,
      { name: "x", foodId: "burro" },
      [{ name: "Marg. vegetale", subject: { name: "Marg. vegetale", foodId: "margarina" } }],
      { screen: clear },
    );
    expect(r.map((s) => s.name)).toEqual(["Marg. vegetale"]);
  });

  it("chi è escluso dal controllo non esce e non occupa un posto", () => {
    const screen = (c: { name: string }): SubstituteVerdict => (c.name === "Margarina" ? { status: "excluded" } : { status: "clear" });
    expect(names("Burro", home("Margarina", "Olio d'oliva", "Olio di girasole"), screen)).toEqual(["Olio d'oliva", "Olio di girasole"]);
  });
  it("se tutto è escluso, nessuna proposta", () => {
    expect(names("Burro", home("Margarina", "Olio d'oliva"), () => ({ status: "excluded" }))).toEqual([]);
  });
  it("l'incerto esce con il suo avviso, il chiaro con la sua nota", () => {
    const screen = (c: { name: string }): SubstituteVerdict =>
      c.name === "Margarina" ? { status: "uncertain", notes: ["controlla l'etichetta"] } : { status: "clear", note: "confermato da te" };
    const r = substitutesFor(index, { name: "Burro" }, home("Margarina", "Olio d'oliva"), { screen });
    expect(r.find((s) => s.name === "Margarina")?.doubt).toEqual(["controlla l'etichetta"]);
    expect(r.find((s) => s.name === "Olio d'oliva")?.doubt).toBeUndefined();
    expect(r.find((s) => s.name === "Olio d'oliva")?.note).toBe("confermato da te");
  });
  it("due lotti dello stesso alimento: vale quello senza dubbi", () => {
    const screen = (c: { name: string }): SubstituteVerdict => (c.name === "Margarina A" ? { status: "uncertain", notes: ["?"] } : { status: "clear" });
    const r = substitutesFor(
      index,
      { name: "Burro" },
      [
        { name: "Margarina A", subject: { name: "Margarina A", foodId: "margarina" } },
        { name: "Margarina B", subject: { name: "Margarina B", foodId: "margarina" } },
      ],
      { screen },
    );
    expect(r.map((s) => s.name)).toEqual(["Margarina B"]);
  });
});

describe("applySubstitutions", () => {
  const recipe = deriveRecipes([
    recipeEvent("e1", "2026-11-10T10:00:00.000Z", {
      ingredients: [
        { name: "Burro", quantity: { value: 100, unit: "g" }, foodId: "burro", note: "morbido" },
        { name: "Farina", quantity: { value: 200, unit: "g" } },
      ],
    }),
  ]).recipes[0]!;

  it("cambia nome e toglie l'identificativo dell'originale, tenendo quantità e nota", () => {
    const r = applySubstitutions(recipe, [{ index: 0, name: " Margarina " }]);
    expect(r.ingredients[0]).toEqual({ name: "Margarina", quantity: { value: 100, unit: "g" }, note: "morbido" });
    expect(r.ingredients[1]).toBe(recipe.ingredients[1]);
    expect(recipe.ingredients[0]?.name).toBe("Burro");
  });
  it("un nome che è già un identificativo lo diventa", () => {
    expect(applySubstitutions(recipe, [{ index: 0, name: "margarina" }]).ingredients[0]?.foodId).toBe("margarina");
  });
  it("ignora indici fuori dalla ricetta e nomi vuoti", () => {
    expect(applySubstitutions(recipe, [{ index: 9, name: "X" }, { index: -1, name: "X" }, { index: 0, name: "  " }, { index: 1.5, name: "X" }])).toBe(recipe);
  });
});
