// Preferenza di stato nella ricerca dell'alimento, con dati FINTI (FAKE_STATE_FOODS).
// Regola: la preferenza vale solo tra voci con lo stesso `variantOf`.
import { describe, expect, it } from "vitest";
import { createFoodMatcher, matchFood } from "./match";
import { FAKE_STATE_FOODS } from "./test-helpers";

const m = createFoodMatcher(FAKE_STATE_FOODS);
const DRIED_FIRST = ["dried", "raw", "as_sold"] as const;

describe("preferenza di stato: gemelli con alias comuni", () => {
  it("senza preferenza i gemelli con lo stesso alias sono ambigui", () => {
    expect(m.find("pasta").status).toBe("ambiguous");
    expect(m.find("petto di pollo").status).toBe("ambiguous");
  });

  it("con 'cooked' una pasta scritta a mano diventa la cotta, e lo dice", () => {
    const r = m.match("pasta", { preferStates: "cooked" });
    expect(r?.food.id).toBe("pasta-cotta-s");
    expect(r?.statePreference).toEqual({ preferred: ["cooked"], honored: true });
  });

  it("con 'dried' la pasta è la secca", () => {
    const r = m.match("pasta 80 g", { preferStates: DRIED_FIRST });
    expect(r?.food.id).toBe("pasta-secca-s");
    expect(r?.statePreference?.honored).toBe(true);
  });

  it("vale per gli alias e per i nomi senza alias", () => {
    expect(m.match("spaghetti", { preferStates: "cooked" })?.food.id).toBe("pasta-cotta-s");
    expect(m.match("riso", { preferStates: "cooked" })?.food.id).toBe("riso-cotto-s");
    expect(m.match("riso", { preferStates: DRIED_FIRST })?.food.id).toBe("riso-crudo-s");
    expect(m.match("petto di pollo", { preferStates: "cooked" })?.food.id).toBe("pollo-cotto-s");
    expect(m.match("petto di pollo", { preferStates: ["raw"] })?.food.id).toBe("pollo-crudo-s");
  });

  it("segue l'ordine delle preferenze", () => {
    expect(m.match("pasta", { preferStates: ["cooked", "dried"] })?.food.id).toBe("pasta-cotta-s");
    expect(m.match("pasta", { preferStates: ["dried", "cooked"] })?.food.id).toBe("pasta-secca-s");
  });

  it("se nel gruppo nessuno ha lo stato preferito e sono a pari merito, resta ambiguo", () => {
    expect(m.find("petto di pollo", { preferStates: "as_sold" }).status).toBe("ambiguous");
  });

  it("la preferenza può essere un'opzione del matcher, e la singola ricerca la sostituisce", () => {
    const withDefault = createFoodMatcher(FAKE_STATE_FOODS, { preferStates: "cooked" });
    expect(withDefault.match("pasta")?.food.id).toBe("pasta-cotta-s");
    expect(withDefault.match("pasta", { preferStates: "dried" })?.food.id).toBe("pasta-secca-s");
    expect(matchFood("pasta", FAKE_STATE_FOODS, { preferStates: ["cooked"] })?.food.id).toBe("pasta-cotta-s");
  });
});

describe("preferenza di stato: mai tra alimenti diversi", () => {
  it("due alimenti diversi con lo stesso alias restano ambigui, qualunque sia la preferenza", () => {
    for (const preferStates of ["raw", "cooked", "as_sold", DRIED_FIRST] as const) {
      const out = m.find("tonno", { preferStates });
      expect(out.status).toBe("ambiguous");
      if (out.status === "ambiguous") {
        expect(out.candidates.map((c) => c.food.id).sort()).toEqual(["tonno-fresco-s", "tonno-scatola-s"]);
      }
      expect(m.match("tonno", { preferStates })).toBeUndefined();
    }
  });

  it("senza variantOf restano ambigui anche se gli stati differiscono", () => {
    expect(m.find("pomodori", { preferStates: "raw" }).status).toBe("ambiguous");
    expect(m.find("pomodori", { preferStates: DRIED_FIRST }).status).toBe("ambiguous");
  });

  it("un alimento senza variantOf non subisce la preferenza", () => {
    for (const name of ["pane", "zucchine"]) {
      const r = m.match(name, { preferStates: "cooked" });
      expect(r?.food.id).toBe(name === "pane" ? "pane-s" : "zucchine-s");
      expect(r?.statePreference).toBeUndefined();
    }
  });
});

describe("preferenza di stato: nome che dichiara lo stato", () => {
  it("vale lo stato scritto, qualunque sia la preferenza", () => {
    const dried = m.match("pasta secca", { preferStates: "cooked" });
    expect(dried?.food.id).toBe("pasta-secca-s");
    expect(dried?.statePreference).toBeUndefined();
    expect(m.match("riso cotto", { preferStates: DRIED_FIRST })?.food.id).toBe("riso-cotto-s");
    expect(m.match("pasta cotta", { preferStates: "dried" })?.food.id).toBe("pasta-cotta-s");
  });
});

describe("preferenza di stato: stato preferito mancante nel gruppo", () => {
  it("cooked e solo la voce secca: non risolto con motivo dedicato, mai il valore del secco", () => {
    const out = m.find("polenta", { preferStates: "cooked" });
    expect(out).toMatchObject({ status: "state_unavailable", reason: "missing_cooked_entry" });
    if (out.status === "state_unavailable") {
      expect(out.candidates.map((c) => c.food.id)).toEqual(["farina-mais-s"]);
    }
    expect(m.match("polenta", { preferStates: "cooked" })).toBeUndefined();
  });

  it("la stessa voce secca va bene per la dispensa", () => {
    const r = m.match("polenta", { preferStates: DRIED_FIRST });
    expect(r?.food.id).toBe("farina-mais-s");
    expect(r?.statePreference?.honored).toBe(true);
  });

  it("senza preferenza di stato la polenta è la voce secca, come prima", () => {
    expect(m.match("polenta")?.food.id).toBe("farina-mais-s");
  });

  it("cooked e solo la voce cruda: si usa il crudo, con honored falso", () => {
    const r = m.match("bistecca di manzo", { preferStates: "cooked" });
    expect(r?.food.id).toBe("bistecca-s");
    expect(r?.statePreference).toEqual({ preferred: ["cooked"], honored: false });
  });
});
