import { describe, expect, it } from "vitest";
import { QUERY_CATALOG, getQuery } from "./catalog";
import { meal } from "../diary/test-helpers";
import { consume, purchase, q } from "../ledger/test-helpers";
import { runQuery } from "./run";
import { EMPTY_CONTEXT, TODAY, buildContext, sampleEvents } from "./test-helpers";
import type { ParamValue, QueryResult, ViewContext } from "./types";

/** Esegue un'interrogazione con i parametri dati e i predefiniti per gli altri. */
function exec(name: string, given: Record<string, ParamValue> = {}, ctx: ViewContext = buildContext()): QueryResult {
  const def = getQuery(name);
  if (!def) throw new Error(`manca ${name}`);
  const params: Record<string, ParamValue> = {};
  for (const [key, p] of Object.entries(def.params)) {
    if (given[key] !== undefined) params[key] = given[key];
    else if (p.kind !== "text" && p.default !== undefined) params[key] = p.default;
  }
  return runQuery({ name, params }, ctx).result;
}

function number(result: QueryResult) {
  if (result.kind !== "number") throw new Error(`atteso un numero, trovato ${result.kind}: ${JSON.stringify(result)}`);
  return result;
}
function rows(result: QueryResult) {
  if (result.kind !== "rows") throw new Error(`attese righe, trovato ${result.kind}: ${JSON.stringify(result)}`);
  return result;
}
function series(result: QueryResult) {
  if (result.kind !== "series") throw new Error(`attesa una serie, trovato ${result.kind}: ${JSON.stringify(result)}`);
  return result;
}

describe("nutrienti", () => {
  it("la media conta solo i giorni tracciati per intero e dice quanti sono", () => {
    const r = number(exec("nutrient_average", { nutrient: "proteinG", period: "last_7_days" }));
    expect(r.value).toBe(38);
    expect(r.unit).toBe("g al giorno");
    expect(r.certainty).toBe("estimated");
    expect(r.basis).toContain("6 giorni tracciati per intero su 7");
  });

  it("oggi, con la giornata incompleta, non dà un numero", () => {
    const r = exec("nutrient_average", { nutrient: "proteinG", period: "today" });
    expect(r.kind).toBe("insufficient");
  });

  it("un nutriente senza dato non vale zero: dati insufficienti", () => {
    const r = exec("nutrient_average", { nutrient: "ironMg" });
    expect(r.kind).toBe("insufficient");
  });

  it("senza tabella degli alimenti caricata lo dice, non dà zero", () => {
    const r = exec("nutrient_average", { nutrient: "proteinG" }, buildContext(sampleEvents(), { intake: undefined }));
    expect(r.kind).toBe("insufficient");
  });

  it("il confronto con il riferimento dà la quota coperta", () => {
    const r = number(exec("nutrient_vs_reference", { nutrient: "proteinG", period: "last_14_days" }));
    expect(r.value).toBe(76);
    expect(r.unit).toBe("% del riferimento");
    expect(r.note).toContain("FINTO");
  });

  it("senza profilo o con pochi giorni completi il confronto è insufficiente", () => {
    expect(exec("nutrient_vs_reference", { nutrient: "proteinG" }, buildContext(sampleEvents(), { profile: null })).kind).toBe("insufficient");
    const ctx = buildContext();
    const few = { ...ctx, intake: { ...ctx.intake!, days: ctx.intake!.days.slice(0, 3) } };
    const r = exec("nutrient_vs_reference", { nutrient: "proteinG", period: "last_14_days" }, few);
    expect(r.kind).toBe("insufficient");
  });

  it("un nutriente senza riferimento è dichiarato", () => {
    expect(exec("nutrient_vs_reference", { nutrient: "ironMg" }).kind).toBe("insufficient");
    expect(exec("nutrient_vs_reference", { nutrient: "proteinG", kind: "upper_limit" }).kind).toBe("insufficient");
  });

  it("l'andamento giornaliero ha un punto per giorno completo", () => {
    const r = series(exec("nutrient_daily", { nutrient: "proteinG", period: "last_7_days" }));
    expect(r.points).toHaveLength(6);
    expect(r.points[0]).toEqual({ label: "10/11", value: 38 });
  });

  it("gli alimenti che contribuiscono di più sono in ordine e le quote sommano a uno", () => {
    const r = rows(exec("top_foods_for_nutrient", { nutrient: "proteinG", period: "last_7_days", limit: 10 }));
    expect(r.rows.map((x) => x.label)).toEqual(["Petto di pollo crudo", "Pasta di semola secca", "Latte intero"]);
    expect(r.rows.reduce((s, x) => s + (x.share ?? 0), 0)).toBeCloseTo(1, 6);
    expect(rows(exec("top_foods_for_nutrient", { nutrient: "proteinG", limit: 2 })).rows).toHaveLength(2);
  });
});

describe("spesa", () => {
  it("la spesa totale somma i prezzi e dichiara ciò che non conta", () => {
    const r = number(exec("spend_total", { period: "last_7_days" }));
    expect(r.value).toBeCloseTo(5.7, 6);
    expect(r.unit).toBe("€");
    expect(r.note).toContain("senza prezzo");
    expect(number(exec("spend_total", { period: "last_30_days" })).value).toBeCloseTo(8.2, 6);
  });

  it("per gruppo conta solo quella categoria e avvisa degli acquisti senza categoria", () => {
    const r = number(exec("spend_total", { period: "last_30_days", group: "dairy" }));
    expect(r.value).toBeCloseTo(4, 6);
    expect(r.note).toContain("senza categoria");
    expect(exec("spend_total", { period: "last_30_days", group: "eggs" }).kind).toBe("insufficient");
  });

  it("senza acquisti nel periodo non dà zero", () => {
    expect(exec("spend_total", { period: "today" }).kind).toBe("insufficient");
    expect(exec("spend_total", {}, EMPTY_CONTEXT).kind).toBe("insufficient");
  });

  it("per negozio e per categoria", () => {
    const stores = rows(exec("spend_by_store", { period: "last_30_days" }));
    expect(stores.rows.map((r) => r.label)).toEqual(["Coop", "Negozio non indicato", "Esselunga"]);
    const cats = rows(exec("spend_by_category", { period: "last_30_days" }));
    expect(cats.rows[0].label).toBe("Latte e latticini");
    expect(cats.rows.map((r) => r.label)).toContain("Senza categoria");
  });

  it("nel tempo: un punto al giorno e la somma torna", () => {
    const r = series(exec("spend_over_time", { period: "last_7_days" }));
    expect(r.points).toHaveLength(7);
    expect(r.points.reduce((s, p) => s + (p.value ?? 0), 0)).toBeCloseTo(5.7, 6);
    // i giorni senza acquisti sono lacune, non zero euro
    expect(r.points.filter((p) => p.value === null).length).toBe(4);
    expect(r.points.some((p) => p.value === 0)).toBe(false);
    const weekly = series(exec("spend_over_time", { period: "last_90_days" }));
    expect(weekly.points).toHaveLength(13);
  });

  it("il valore della dispensa conta solo i prodotti con prezzo", () => {
    const r = number(exec("pantry_value"));
    expect(r.value).toBeGreaterThan(0);
    expect(r.note).toContain("senza prezzo");
  });
});

describe("spreco", () => {
  it("per motivo, con quantità e costo", () => {
    const r = rows(exec("waste_by_reason", { period: "last_7_days" }));
    const expired = r.rows.find((x) => x.label === "Scaduto");
    expect(expired?.valueText).toBe("100 g");
    expect(expired?.detail).toContain("0,24");
    const leftover = r.rows.find((x) => x.label === "Avanzato");
    expect(leftover?.detail).toBe("senza prezzo");
  });

  it("il costo conta solo gli scarti con prezzo", () => {
    const r = number(exec("waste_cost", { period: "last_7_days" }));
    expect(r.value).toBeCloseTo(0.24, 6);
    expect(r.note).toContain("senza prezzo");
  });

  it("nessuno scarto registrato non è uno zero: non so se non ho buttato nulla o non l'ho segnato", () => {
    const r = exec("waste_cost", { period: "today" });
    expect(r.kind).toBe("insufficient");
    if (r.kind === "insufficient") expect(r.reason).toContain("non l'hai segnato");
    expect(exec("waste_by_reason", { period: "today" }).kind).toBe("insufficient");
    expect(exec("waste_cost", {}, EMPTY_CONTEXT).kind).toBe("insufficient");
  });
});

describe("dispensa e consumi", () => {
  it("cosa scade: la data in etichetta di domani compare, dal più urgente", () => {
    const r = rows(exec("expiring_soon", { within_days: 3 }));
    const milk = r.rows.find((x) => x.label === "Latte fresco");
    expect(milk?.valueText).toBe("scade domani");
    expect(milk?.detail).toContain("frigo");
  });

  it("per luogo, e con la dispensa vuota è insufficiente", () => {
    const r = rows(exec("expiring_soon", { within_days: 30, location: "frigo" }));
    expect(r.rows.every((x) => x.detail?.startsWith("frigo"))).toBe(true);
    expect(exec("expiring_soon", {}, EMPTY_CONTEXT).kind).toBe("insufficient");
  });

  it("consumi di un alimento: dispensa più pasti, per unità", () => {
    const r = rows(exec("food_consumption", { food: "latte", period: "last_30_days" }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].label).toBe("Millilitri");
    expect(r.rows[0].valueText.replace(".", "")).toBe("1600 ml");
    expect(r.rows[0].detail).toContain("dalla dispensa");
    expect(r.rows[0].detail).toContain("nei pasti");
  });

  it("la ricerca è per parola intera: «uva» non trova «uvetta», e la didascalia dice cosa è stato trovato", () => {
    const events = [
      ...sampleEvents(),
      purchase("p-uvetta", "2026-11-12T10:00:00Z", { lotId: "lot-uvetta", productRef: "Uvetta sultanina", quantity: q(200, "g"), location: "dispensa" }),
      consume("c-uvetta", "2026-11-13T08:00:00Z", { lotId: "lot-uvetta", quantity: q(30, "g") }),
      purchase("p-uva", "2026-11-12T10:00:00Z", { lotId: "lot-uva", productRef: "Uva bianca", quantity: q(500, "g"), location: "frigo" }),
      consume("c-uva", "2026-11-13T09:00:00Z", { lotId: "lot-uva", quantity: q(100, "g") }),
    ];
    const ctx = buildContext(events);
    const found = runQuery({ name: "food_consumption", params: { food: "uva", period: "last_30_days" } }, ctx);
    const r = rows(found.result);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].valueText).toBe("100 g");
    expect(r.matched).toEqual(["Uva bianca"]);
    expect(found.caption).toBe("Consumi di: Uva bianca · ultimi 30 giorni");
    expect(runQuery({ name: "food_consumption", params: { food: "uvetta", period: "last_30_days" } }, ctx).result.kind).toBe("rows");
    // «latte» non trova nulla che lo contenga solo dentro un'altra parola
    expect(exec("food_consumption", { food: "lat" }).kind).toBe("insufficient");
    const none = runQuery({ name: "food_consumption", params: { food: "caviale", period: "last_30_days" } }, ctx);
    expect(none.caption).toBe("Consumi di «caviale» · ultimi 30 giorni");
  });

  it("singolare e plurale si uniscono: «uovo» trova «uova», senza unire parole diverse", () => {
    const events = [
      purchase("p-eggs", "2026-11-12T10:00:00Z", { lotId: "lot-eggs", productRef: "Uova fresche", category: "eggs", quantity: q(12, "pz"), location: "frigo" }),
      consume("c-eggs", "2026-11-13T09:00:00Z", { lotId: "lot-eggs", quantity: q(3, "pz") }),
      purchase("p-pom", "2026-11-12T10:00:00Z", { lotId: "lot-pom", productRef: "Pomodori datterini", quantity: q(500, "g"), location: "frigo" }),
      consume("c-pom", "2026-11-13T09:00:00Z", { lotId: "lot-pom", quantity: q(200, "g") }),
      purchase("p-pomi", "2026-11-12T10:00:00Z", { lotId: "lot-pomi", productRef: "Pomodoro pelato", quantity: q(400, "g"), location: "dispensa" }),
      consume("c-pomi", "2026-11-13T10:00:00Z", { lotId: "lot-pomi", quantity: q(100, "g") }),
      purchase("p-lat", "2026-11-12T10:00:00Z", { lotId: "lot-lat", productRef: "Lattina di tè", quantity: q(330, "ml"), location: "dispensa" }),
      consume("c-lat", "2026-11-13T10:00:00Z", { lotId: "lot-lat", quantity: q(330, "ml") }),
    ];
    const ctx = buildContext(events);
    const run = (food: string) => runQuery({ name: "food_consumption", params: { food, period: "last_30_days" } }, ctx);
    for (const food of ["uovo", "uova", "Uova"]) {
      const r = rows(run(food).result);
      expect(r.rows[0].valueText, food).toBe("3 pz");
      expect(r.matched).toEqual(["Uova fresche"]);
    }
    const pom = rows(run("pomodoro").result);
    expect(pom.rows[0].valueText).toBe("300 g");
    expect(pom.matched).toEqual(["Pomodori datterini", "Pomodoro pelato"]);
    // «latte» non trova «lattina»: le radici sono diverse
    expect(run("latte").result.kind).toBe("insufficient");
  });

  it("cosa scade: senza date né categorie non posso dire che nulla scade", () => {
    const ctx = buildContext([purchase("p", "2026-11-10T10:00:00Z", { lotId: "l", productRef: "Cose", quantity: q(1, "pz"), location: "dispensa" })]);
    expect(exec("expiring_soon", {}, ctx).kind).toBe("insufficient");
    const mixed = rows(exec("expiring_soon", { within_days: 1 }, buildContext([...sampleEvents(), purchase("p2", "2026-11-10T10:00:00Z", { lotId: "l2", productRef: "Cose", quantity: q(1, "pz"), location: "dispensa" })])));
    expect(mixed.note).toContain("senza data né categoria");
  });

  it("un alimento mai consumato non è uno zero", () => {
    expect(exec("food_consumption", { food: "caviale" }).kind).toBe("insufficient");
    expect(exec("food_consumption", { food: "a" }).kind).toBe("insufficient");
  });
});

describe("corpo", () => {
  it("acqua: media sui giorni registrati", () => {
    const r = number(exec("water_average", { period: "last_7_days" }));
    expect(r.value).toBe(1000);
    expect(r.basis).toContain("3 giorni");
    expect(series(exec("water_daily", { period: "last_7_days" })).points).toHaveLength(3);
  });

  it("acqua con troppo pochi giorni: insufficiente", () => {
    expect(exec("water_average", { period: "today" }).kind).toBe("insufficient");
  });

  it("peso: l'ultimo e la variazione nel periodo", () => {
    const r = number(exec("weight_latest", { period: "last_7_days" }));
    expect(r.value).toBe(71);
    expect(r.note).toContain("-0,5 kg");
    expect(series(exec("weight_trend", { period: "last_30_days" })).points.map((p) => p.value)).toEqual([72, 71.5, 71]);
    expect(exec("weight_latest", {}, EMPTY_CONTEXT).kind).toBe("insufficient");
  });

  it("umore e sintomi", () => {
    expect(number(exec("mood_average", { period: "last_7_days" })).value).toBe(3);
    expect(series(exec("mood_daily", { period: "last_7_days" })).points).toHaveLength(3);
    const r = rows(exec("symptoms_summary", { period: "last_7_days" }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].label).toBe("Energia");
    expect(exec("symptoms_summary", {}, EMPTY_CONTEXT).kind).toBe("insufficient");
  });

  it("giorni tracciati: quelli completi su quelli del periodo", () => {
    const r = number(exec("tracked_days", { period: "last_7_days" }));
    expect(r.value).toBe(6);
    expect(r.basis).toContain("su 7");
  });
});

describe("tutto il catalogo", () => {
  const sample: Record<string, ParamValue> = { nutrient: "proteinG", food: "latte" };

  function params(name: string) {
    const def = getQuery(name)!;
    const out: Record<string, ParamValue> = {};
    for (const [key, p] of Object.entries(def.params)) out[key] = sample[key] ?? (p.kind !== "text" && p.default !== undefined ? p.default : "");
    return out;
  }

  for (const state of ["popolato", "vuoto"] as const) {
    it(`ogni interrogazione dà un risultato ben formato sullo stato ${state}`, () => {
      const ctx = state === "popolato" ? buildContext() : EMPTY_CONTEXT;
      for (const def of QUERY_CATALOG) {
        const { result, caption } = runQuery({ name: def.name, params: params(def.name) }, ctx);
        expect(typeof caption).toBe("string");
        if (result.kind !== "insufficient") expect(result.kind).toBe(def.result);
        const json = JSON.stringify(result);
        expect(json).not.toMatch(/NaN|Infinity|undefined/);
      }
    });
  }

  it("sullo stato vuoto nessuna interrogazione dà un numero inventato", () => {
    for (const def of QUERY_CATALOG) {
      const { result } = runQuery({ name: def.name, params: params(def.name) }, EMPTY_CONTEXT);
      if (result.kind === "number") expect(["tracked_days"]).toContain(def.name);
    }
  });

  it("i periodi sono relativi a oggi", () => {
    expect(TODAY).toBe("2026-11-16");
    const r = number(exec("tracked_days", { period: "last_month" }));
    expect(r.basis).toContain("su 31");
    expect(number(exec("tracked_days", { period: "this_month" })).basis).toContain("su 16");
  });
});

describe("pasti fuori casa stimati", () => {
  const measured = (name: string, value: number, unit: "g" | "ml") => ({ name, quantity: q(value, unit), certainty: "measured" as const });
  const estimate = (kcal: number) => ({ name: "Fuori casa · normale", quantity: q(1, "pz"), certainty: "estimated" as const, energyKcal: kcal });
  /**
   * Dal 10 al 15 novembre: latte a colazione (120 kcal, 6 g di proteine), pollo a cena (100 kcal, 20 g) e a pranzo una
   * stima fuori casa. Con 880 kcal stimate su 1100 il pranzo vale l'80% dell'energia del giorno.
   */
  function daysWithLunchOut(kcal = 880) {
    const events = [];
    for (let day = 10; day <= 15; day++) {
      const d = `2026-11-${day}`;
      events.push(
        meal(`ob${day}`, `${d}T07:00:00Z`, { mealId: `omb${day}`, kind: "breakfast", items: [measured("Latte intero", 200, "ml")] }),
        meal(`ol${day}`, `${d}T12:00:00Z`, { mealId: `oml${day}`, kind: "lunch", certainty: "estimated", items: [estimate(kcal)] }),
        meal(`od${day}`, `${d}T19:00:00Z`, { mealId: `omd${day}`, kind: "dinner", items: [measured("Petto di pollo crudo", 100, "g")] }),
      );
    }
    return events;
  }
  const ctx = buildContext(daysWithLunchOut());

  it("i giorni contano come tracciati per intero, e l'energia comprende la stima come stima", () => {
    const r = number(exec("nutrient_average", { nutrient: "energyKcal", period: "last_7_days" }, ctx));
    expect(r.value).toBe(1100);
    expect(r.certainty).toBe("estimated");
    expect(r.basis).toContain("6 giorni tracciati per intero");
    expect(r.note).toBeUndefined();
  });

  it("la media delle proteine dice che per circa l'80% manca il dato, non «una voce su tre»", () => {
    const r = number(exec("nutrient_average", { nutrient: "proteinG", period: "last_7_days" }, ctx));
    expect(r.value).toBe(26);
    expect(r.note).toBe("Per circa il 80% di ciò che hai mangiato manca il dato: il valore può essere più basso del reale.");
  });

  it("il confronto con il riferimento porta la stessa nota", () => {
    const r = number(exec("nutrient_vs_reference", { nutrient: "proteinG", period: "last_14_days" }, ctx));
    expect(r.value).toBe(52);
    expect(r.note).toContain("Per circa il 80% manca il dato: il valore può essere più basso del reale.");
  });

  it("anche una stima che conta per una voce su dieci ma vale un terzo dell'energia fa scrivere la nota", () => {
    // un giorno con nove voci misurate (900 kcal) e una stima da 450: per voci sarebbe il 10%, per energia un terzo
    const events = [];
    for (let day = 10; day <= 15; day++) {
      const d = `2026-11-${day}`;
      const chicken = (n: number) => Array.from({ length: n }, () => measured("Petto di pollo crudo", 100, "g"));
      events.push(
        meal(`pb${day}`, `${d}T07:00:00Z`, { mealId: `pmb${day}`, kind: "breakfast", items: chicken(4) }),
        meal(`pl${day}`, `${d}T12:00:00Z`, { mealId: `pml${day}`, kind: "lunch", certainty: "estimated", items: [estimate(450)] }),
        meal(`pd${day}`, `${d}T19:00:00Z`, { mealId: `pmd${day}`, kind: "dinner", items: chicken(5) }),
      );
    }
    const r = number(exec("nutrient_vs_reference", { nutrient: "proteinG", period: "last_14_days" }, buildContext(events)));
    expect(r.note).toContain("Per circa il 33% manca il dato");
  });

  it("«Fuori casa» non compare tra gli alimenti da cui viene un nutriente, e la nota dice quanti pasti restano fuori", () => {
    const energy = rows(exec("top_foods_for_nutrient", { nutrient: "energyKcal", period: "last_7_days", limit: 10 }, ctx));
    expect(energy.rows.map((x) => x.label)).toEqual(["Latte intero", "Petto di pollo crudo"]);
    expect(energy.rows.reduce((s, x) => s + (x.share ?? 0), 0)).toBeCloseTo(1, 6);
    expect(energy.note).toBe(
      "6 pasti fuori casa stimati non sono tra gli alimenti: di quei pasti non si conosce il contenuto, e le quote riguardano solo il resto.",
    );
    const protein = rows(exec("top_foods_for_nutrient", { nutrient: "proteinG", period: "last_7_days", limit: 10 }, ctx));
    expect(protein.rows.map((x) => x.label)).toEqual(["Petto di pollo crudo", "Latte intero"]);
    // senza pasti fuori casa la nota non ne parla
    expect(rows(exec("top_foods_for_nutrient", { nutrient: "energyKcal", period: "last_7_days", limit: 10 })).note ?? "").not.toMatch(/fuori casa/);
  });

  it("i consumi di un alimento non contano la stima come «1 pz» di qualcosa", () => {
    const r = exec("food_consumption", { food: "casa", period: "last_30_days" }, ctx);
    expect(r.kind).toBe("insufficient");
    expect(exec("food_consumption", { food: "fuori", period: "last_30_days" }, ctx).kind).toBe("insufficient");
    const milk = rows(exec("food_consumption", { food: "latte", period: "last_30_days" }, ctx));
    expect(milk.rows.map((x) => x.label)).toEqual(["Millilitri"]);
  });
});
