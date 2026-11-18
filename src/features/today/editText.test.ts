import { describe, expect, it } from "vitest";
import { deriveDiary, mealsWithPantry, type MealKind } from "@/core/diary";
import { consume, meal as mealEvent, purchase } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { buildChangeMoment } from "../pantry/eaten";
import { estimateOutOfHome } from "@/core/nutrition";
import { outOfHomeChoices } from "../meals";
import {
  atTime,
  consumeRemovedText,
  dayTail,
  isCompactMoment,
  itemMovedText,
  itemRemovedText,
  mealMovedText,
  mealRemovedText,
  mealSheetTitle,
  momentChoices,
  momentTargets,
  namesHint,
  outOfHomeCorrectedText,
  quantityCorrectedText,
  repeatableNames,
  revivedMealText,
  snackBlockTitle,
  type MomentRowFacts,
} from "./editText";

const TODAY = "2026-11-18";
const YESTERDAY = "2026-11-17";
const MONDAY = "2026-11-16";

describe("il giorno negli avvisi", () => {
  it("oggi non si nomina", () => {
    expect(dayTail(TODAY, TODAY)).toBe("");
  });

  it("ieri si chiama ieri, i giorni prima con il nome e il numero", () => {
    expect(dayTail(YESTERDAY, TODAY)).toBe(" di ieri");
    expect(dayTail(MONDAY, TODAY)).toBe(" di lunedì 16");
  });

  it("l'ora con l'articolo giusto", () => {
    expect(atTime("20:30")).toBe("alle 20:30");
    expect(atTime("8:05")).toBe("alle 8:05");
    expect(atTime("1:05")).toBe("all'1:05");
    expect(atTime("01:05")).toBe("all'1:05");
    expect(atTime("13:00")).toBe("alle 13:00");
  });
});

describe("quantità corretta", () => {
  const base = { name: "Spinaci", quantity: { value: 80, unit: "g" as const }, kind: "dinner" as const, date: TODAY, today: TODAY };

  it("dice che cosa, quanto e dove", () => {
    expect(quantityCorrectedText({ ...base, estimated: false })).toBe("Corretto: spinaci, 80 g a cena.");
  });

  it("porta la tilde se la quantità è una stima", () => {
    expect(quantityCorrectedText({ ...base, estimated: true })).toBe("Corretto: spinaci, ~80 g a cena.");
  });

  it("nomina il giorno se non è oggi", () => {
    expect(quantityCorrectedText({ ...base, estimated: false, date: YESTERDAY })).toBe("Corretto: spinaci, 80 g a cena di ieri.");
    expect(quantityCorrectedText({ ...base, estimated: true, date: MONDAY })).toBe("Corretto: spinaci, ~80 g a cena di lunedì 16.");
  });

  it("vale per ogni momento e per i pezzi", () => {
    expect(quantityCorrectedText({ ...base, name: "Latte", kind: "breakfast", quantity: { value: 200, unit: "ml" }, estimated: false })).toBe(
      "Corretto: latte, 200 ml a colazione.",
    );
    expect(quantityCorrectedText({ ...base, name: "pizza", kind: "lunch", quantity: { value: 2, unit: "pz" }, estimated: true })).toBe(
      "Corretto: pizza, ~2 pz a pranzo.",
    );
    expect(quantityCorrectedText({ ...base, name: "Mela", kind: "snack", quantity: { value: 1, unit: "pz" }, estimated: false })).toBe(
      "Corretto: mela, 1 pz nello spuntino.",
    );
  });

  it("una sigla resta maiuscola", () => {
    expect(quantityCorrectedText({ ...base, name: "BBQ ribs", estimated: false })).toBe("Corretto: BBQ ribs, 80 g a cena.");
  });
});

describe("voce spostata o tolta", () => {
  it("una voce libera spostata dice dove sta ora", () => {
    expect(itemMovedText({ name: "Pizza", kind: "dinner", date: TODAY, today: TODAY })).toBe("Ora a cena: pizza");
    expect(itemMovedText({ name: "Pizza", kind: "snack", date: TODAY, today: TODAY })).toBe("Ora come spuntino: pizza");
  });

  it("con il giorno, se non è oggi", () => {
    expect(itemMovedText({ name: "Pizza", kind: "lunch", date: YESTERDAY, today: TODAY })).toBe("Ora a pranzo di ieri: pizza");
    expect(itemMovedText({ name: "Pizza", kind: "breakfast", date: MONDAY, today: TODAY })).toBe("Ora a colazione di lunedì 16: pizza");
  });

  it("una voce della dispensa tolta torna in dispensa", () => {
    expect(consumeRemovedText("Spinaci", { value: 75, unit: "g" })).toBe("Tolto: 75 g di spinaci. Sono tornati in dispensa.");
  });

  it("una voce libera tolta", () => {
    expect(itemRemovedText("Pizza")).toBe("Tolto: pizza.");
  });
});

describe("pasto spostato o tolto", () => {
  it("lo stesso giorno dice momento e ora", () => {
    expect(mealMovedText({ kind: "dinner", date: TODAY, today: TODAY, time: "20:30" })).toBe("Pasto spostato: ora è a cena, alle 20:30.");
    expect(mealMovedText({ kind: "snack", date: TODAY, today: TODAY, time: "16:30" })).toBe("Pasto spostato: ora è uno spuntino, alle 16:30.");
  });

  it("in un altro giorno lo nomina", () => {
    expect(mealMovedText({ kind: "dinner", date: YESTERDAY, today: TODAY, time: "20:30" })).toBe("Pasto spostato: ora è a cena di ieri, alle 20:30.");
    expect(mealMovedText({ kind: "dinner", date: MONDAY, today: TODAY, time: "20:30" })).toBe(
      "Pasto spostato: ora è a cena di lunedì 16, alle 20:30.",
    );
  });

  it("il pasto tolto si chiama con il suo nome, in minuscolo", () => {
    expect(mealRemovedText("Cena")).toBe("Tolto: cena.");
    expect(mealRemovedText("Solita colazione")).toBe("Tolto: solita colazione.");
  });

  it("il titolo del foglio porta l'ora", () => {
    expect(mealSheetTitle("Cena", "22:40")).toBe("Cena, 22:40");
    expect(mealSheetTitle("Cena", "")).toBe("Cena");
  });
});

describe("gli alimenti in una riga", () => {
  it("fino a tre nomi, in minuscolo, senza ripetizioni", () => {
    expect(namesHint(["Pasta", "Insalata", "Mela"])).toBe("pasta, insalata, mela");
    expect(namesHint(["Pasta", "Pasta", "Mela"])).toBe("pasta, mela");
  });

  it("oltre tre dice quanti altri", () => {
    expect(namesHint(["Pasta", "Insalata", "Mela", "Pane"])).toBe("pasta, insalata, mela e un altro");
    expect(namesHint(["Pasta", "Insalata", "Mela", "Pane", "Olio"])).toBe("pasta, insalata, mela e altri 2");
  });

  it("senza nomi è vuota", () => {
    expect(namesHint([])).toBe("");
    expect(namesHint(["", "  "])).toBe("");
  });
});

interface TestMeal {
  kind: MealKind;
  at: string;
  pantryConsumes: { lotId: string }[];
  items: { name: string }[];
}

const meal = (kind: MealKind, at: string, lotIds: string[], free: string[] = []): TestMeal => ({
  kind,
  at,
  pantryConsumes: lotIds.map((lotId) => ({ lotId })),
  items: free.map((name) => ({ name })),
});

const LOTS = new Map([
  ["lot-pasta", "Pasta"],
  ["lot-mela", "Mela"],
]);

describe("che cosa si può ripetere di un pasto", () => {
  it("gli alimenti della dispensa di cui si sa il nome e le voci libere", () => {
    const m = meal("lunch", "2026-11-17T12:00:00.000Z", ["lot-pasta", "lot-sparito"], ["Insalata"]);
    expect(repeatableNames(m, LOTS)).toEqual(["Pasta", "Insalata"]);
  });

  it("un pasto di soli alimenti di cui non si sa più il nome non ha niente da ripetere", () => {
    expect(repeatableNames(meal("lunch", "2026-11-17T12:00:00.000Z", ["lot-sparito"]), LOTS)).toEqual([]);
  });
});

describe("le voci di «Altro» di un momento senza pasto", () => {
  it("guardando oggi, con un pasto ieri: «Come ieri» per prima, con gli alimenti", () => {
    expect(momentChoices({ viewingToday: true, yesterdayNames: ["Pasta", "Insalata", "Mela"] })).toEqual([
      { id: "repeat", label: "Come ieri", hint: "pasta, insalata, mela" },
      { id: "skipped", label: "Saltato" },
      { id: "untracked", label: "Mangiato, senza dettagli" },
    ]);
  });

  it("senza un pasto ieri (o fatto solo di voci tolte) «Come ieri» non c'è", () => {
    expect(momentChoices({ viewingToday: true, yesterdayNames: [] }).map((c) => c.id)).toEqual(["skipped", "untracked"]);
  });

  it("in un giorno passato «Come ieri» non c'è", () => {
    expect(momentChoices({ viewingToday: false, yesterdayNames: ["Pasta"] }).map((c) => c.id)).toEqual(["skipped", "untracked"]);
  });
});

describe("riga compatta di un momento", () => {
  const past: MomentRowFacts = { pastDay: false, current: false, empty: true, drinks: 0, loose: 0, planned: false };

  it("un momento di oggi già passato e senza niente sta in una riga (alle 22: colazione e pranzo)", () => {
    expect(isCompactMoment(past)).toBe(true);
  });

  it("il momento in corso tiene la riga intera (alle 8: colazione; alle 22: cena)", () => {
    expect(isCompactMoment({ ...past, current: true })).toBe(false);
  });

  it("con un pasto pianificato resta la riga con «nel piano: …»", () => {
    expect(isCompactMoment({ ...past, planned: true })).toBe(false);
  });

  it("un giorno passato tiene tutti i momenti con «Registra» a contorno", () => {
    expect(isCompactMoment({ ...past, pastDay: true })).toBe(false);
  });

  it("un momento con un pasto, una dichiarazione, una bevanda o una voce sciolta non è vuoto", () => {
    expect(isCompactMoment({ ...past, empty: false })).toBe(false);
    expect(isCompactMoment({ ...past, drinks: 1 })).toBe(false);
    expect(isCompactMoment({ ...past, loose: 1 })).toBe(false);
  });
});

describe("il titolo del quarto blocco", () => {
  it("un solo spuntino registrato non ha titolo: basta la sua riga", () => {
    expect(snackBlockTitle({ meals: 1, others: 0 })).toBeNull();
  });

  it("con più cose il titolo è «Spuntini»", () => {
    expect(snackBlockTitle({ meals: 2, others: 0 })).toBe("Spuntini");
    expect(snackBlockTitle({ meals: 1, others: 1 })).toBe("Spuntini");
    expect(snackBlockTitle({ meals: 0, others: 3 })).toBe("Spuntini");
  });

  it("una cosa sola che non è un pasto (una bevanda) ha il titolo al singolare", () => {
    expect(snackBlockTitle({ meals: 0, others: 1 })).toBe("Spuntino");
  });

  it("non si chiama mai «Fuori pasto»", () => {
    for (const meals of [0, 1, 2]) for (const others of [0, 1, 2]) expect(snackBlockTitle({ meals, others }) ?? "").not.toMatch(/fuori/i);
  });
});

describe("un pasto tolto altrove a cui è rimasta una voce", () => {
  it("dice quante voci sono rimaste", () => {
    expect(revivedMealText(1)).toBe("Questo pasto era stato tolto su un altro dispositivo: è rimasta questa voce.");
    expect(revivedMealText(2)).toBe("Questo pasto era stato tolto su un altro dispositivo: sono rimaste queste voci.");
  });
});


describe("«Cambia momento»: dove può andare una voce", () => {
  it("una voce di un pasto registrato per lunedì resta a lunedì: contano giorno e ora del pasto, non l'ora del consumo", () => {
    // il pasto è di lunedì a pranzo; il consumo è stato scritto mercoledì sera, quando l'ho registrato
    const lot = purchase("p1", `${MONDAY}T08:00:00.000Z`, { lotId: "lot-1", productRef: "Spinaci", quantity: { value: 400, unit: "g" }, location: "frigo" });
    const lunch = mealEvent("m1", `${MONDAY}T12:00:00.000Z`, { mealId: "meal-1", kind: "lunch" });
    const eaten = consume("c1", `${TODAY}T20:00:00.000Z`, { lotId: "lot-1", quantity: { value: 75, unit: "g" }, mealId: "meal-1" });
    const log: AnyEvent[] = [lot, lunch, eaten];
    const state = deriveDiary(log, { timeZone: "UTC" });

    const targets = momentTargets({ date: MONDAY, minutes: 12 * 60, today: TODAY, kind: "lunch" }, true);
    // tutte di lunedì, senza il pranzo in cui sta già
    expect(targets).toEqual([
      { kind: "breakfast", date: MONDAY, label: "Colazione" },
      { kind: "dinner", date: MONDAY, label: "Cena" },
      { kind: "snack", date: MONDAY, label: "Spuntino" },
    ]);

    const marked = { consumes: [eaten], mealId: "meal-1", kind: "lunch" as const, date: MONDAY, joined: false, name: "spinaci", amount: "75 g" };
    const moved = buildChangeMoment(marked, targets[1], { now: `${TODAY}T20:05:00.000Z`, deviceId: "d" }, state);
    if (!moved.ok) throw new Error(moved.error);
    const after = [...log, ...moved.events];
    const meals = mealsWithPantry(deriveDiary(after, { timeZone: "UTC" }), after);
    expect(meals.map((m) => [m.date, m.kind, m.pantryConsumes.length])).toEqual([[MONDAY, "dinner", 1]]);
    // e l'avviso dice che non è di oggi
    expect(moved.message).toBe("Ora a cena · 2 giorni fa: 75 g di spinaci");
  });

  it("una voce mangiata di notte può andare anche alla sera prima, e l'etichetta dice il giorno", () => {
    const night = momentTargets({ date: TODAY, minutes: 30, today: TODAY, kind: "snack" }, true);
    expect(night.map((t) => [t.date, t.label])).toEqual([
      [TODAY, "Colazione"],
      [TODAY, "Pranzo"],
      [TODAY, "Cena"],
      [YESTERDAY, "Ieri · pranzo"],
      [YESTERDAY, "Ieri · cena"],
      [YESTERDAY, "Ieri · spuntino"],
    ]);
    // guardando un giorno passato non è «ieri»
    expect(momentTargets({ date: YESTERDAY, minutes: 30, today: TODAY, kind: "snack" }, true).slice(3).map((t) => [t.date, t.label])).toEqual([
      [MONDAY, "Il giorno prima · pranzo"],
      [MONDAY, "Il giorno prima · cena"],
      [MONDAY, "Il giorno prima · spuntino"],
    ]);
  });

  it("di giorno, e per una voce libera, restano solo gli altri momenti dello stesso giorno", () => {
    expect(momentTargets({ date: TODAY, minutes: 13 * 60, today: TODAY, kind: "lunch" }, true).map((t) => t.label)).toEqual(["Colazione", "Cena", "Spuntino"]);
    expect(momentTargets({ date: TODAY, minutes: 30, today: TODAY, kind: "dinner" }, false).map((t) => t.label)).toEqual(["Colazione", "Pranzo", "Spuntino"]);
    // un consumo senza pasto non sta in nessun momento: li può prendere tutti
    expect(momentTargets({ date: TODAY, minutes: 13 * 60, today: TODAY }, false)).toHaveLength(4);
  });
});

describe("pasto fuori casa", () => {
  const personal = [600, 650, 700, 700, 750, 800];

  it("la taglia corretta: momento, taglia e stima nuova", () => {
    expect(outOfHomeCorrectedText({ kind: "lunch", size: "large", energyKcal: 1200 })).toBe("Corretto: pranzo fuori casa, abbondante (~1200 kcal, stima).");
    expect(outOfHomeCorrectedText({ kind: "dinner", size: "light", energyKcal: estimateOutOfHome("dinner", "light", personal).energyKcal })).toBe(
      "Corretto: cena fuori casa, leggero (~420 kcal, stima).",
    );
  });

  it("in «Altro» le tre voci stanno dopo «Come ieri» e prima di «Saltato»", () => {
    const outOfHome = outOfHomeChoices("lunch", []);
    expect(momentChoices({ viewingToday: true, yesterdayNames: ["Pasta"], outOfHome })).toEqual([
      { id: "repeat", label: "Come ieri", hint: "pasta" },
      { id: "out-light", label: "Fuori casa · leggero", hint: "~480 kcal, stima generica" },
      { id: "out-normal", label: "Fuori casa · normale", hint: "~800 kcal, stima generica" },
      { id: "out-large", label: "Fuori casa · abbondante", hint: "~1200 kcal, stima generica" },
      { id: "skipped", label: "Saltato" },
      { id: "untracked", label: "Mangiato, senza dettagli" },
    ]);
  });

  it("valgono anche per i giorni passati, dove «Come ieri» non c'è", () => {
    const outOfHome = outOfHomeChoices("dinner", personal);
    expect(momentChoices({ viewingToday: false, yesterdayNames: ["Pasta"], outOfHome }).map((c) => c.id)).toEqual([
      "out-light",
      "out-normal",
      "out-large",
      "skipped",
      "untracked",
    ]);
  });

  it("13. «Mangiato, senza dettagli» resta, e senza la stima pronta le tre voci non compaiono", () => {
    expect(momentChoices({ viewingToday: true, yesterdayNames: [], outOfHome: [] }).map((c) => c.id)).toEqual(["skipped", "untracked"]);
    expect(momentChoices({ viewingToday: true, yesterdayNames: [], outOfHome: outOfHomeChoices("lunch", []) }).at(-1)).toEqual({
      id: "untracked",
      label: "Mangiato, senza dettagli",
    });
  });
});
