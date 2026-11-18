import { describe, expect, it } from "vitest";
import { deriveDiary, type MealItem, type MealKind } from "@/core/diary";
import { consume, drink, meal, purchase } from "@/core/diary/test-helpers";
import { NUTRIENT_KEYS, computeIntake, createResolver, dayBreakdown, periodBreakdown, type DayBreakdown, type NutrientKey } from "@/core/nutrition";
import { FAKE_FOODS, FAKE_PRODUCT } from "@/core/nutrition/test-helpers";
import { dayStatusLine } from "../today/dayStatus";
import type { BreakdownPart } from "@/core/nutrition";
import { averageContent, countedDaysContent, countedDaysText, dayBreakdownContent, dayCheckText, dayNoteText, notCountedText, shortDate, voceHref } from "./breakdownView";
import { averageIntake, dayNutritionView, inPeriod, topContributors } from "./prepare";

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: (ref) => (ref === FAKE_PRODUCT.barcode ? FAKE_PRODUCT : undefined) });
const HOUR: Record<MealKind, string> = { breakfast: "08:00", lunch: "13:00", dinner: "20:00", snack: "16:30" };
const g = (name: string, grams: number, certainty: MealItem["certainty"] = "measured"): MealItem => ({ name, quantity: { value: grams, unit: "g" }, certainty });
const mealOn = (date: string, kind: MealKind, items: MealItem[], hhmm = HOUR[kind]) =>
  meal(`m-${date}-${kind}`, `${date}T${hhmm}:00.000Z`, { mealId: `${date}-${kind}`, kind, items });
const outOfHome = (kcal: number): MealItem => ({ name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: kcal });
const intakeOf = (events: unknown[]) => computeIntake(events, resolver, { timeZone: "UTC" });
const fullDay = (date: string) => [mealOn(date, "breakfast", [g("Latte intero", 200)]), mealOn(date, "lunch", [g("Pasta di semola secca", 80)]), mealOn(date, "dinner", [g("Petto di pollo", 150)])];

describe("le frasi di «Da cosa è fatto» per un giorno", () => {
  const day = intakeOf([
    mealOn("2026-03-10", "breakfast", [g("Latte intero", 200, "estimated"), g("pizza", 300)]),
    mealOn("2026-03-10", "lunch", [outOfHome(800)]),
    mealOn("2026-03-10", "dinner", [g("Petto di pollo", 150, "estimated"), g("Zucchine", 100, "estimated")]),
  ]).days[0];

  it("la somma con il totale come a schermo e le voci che non contano", () => {
    const b = dayBreakdown(day, "energyKcal");
    expect(dayCheckText(b)).toBe("Somma delle voci: 1082 kcal. 1 voce senza valori non conta: il totale è un minimo.");
    const clean: DayBreakdown = { ...b, missing: [] };
    expect(dayCheckText(clean)).toBe("Somma delle voci: 1082 kcal.");
  });

  it("5. con un totale che arrotonda, la somma è quella della schermata e le righe la fanno esattamente", () => {
    const part = (i: number): BreakdownPart => ({ label: `Voce ${i}`, value: 326.5333333, certainty: "measured", eventId: `e${i}`, date: "2026-03-10", kind: "mealItem" });
    const b: DayBreakdown = { nutrient: "energyKcal", date: "2026-03-10", total: 979.6, sum: 979.6, missing: [], parts: [part(1), part(2), part(3)] };
    expect(dayCheckText(b)).toBe("Somma delle voci: 980 kcal.");
    const content = dayBreakdownContent(b, { partial: false, certainty: "measured" });
    // ognuna arrotondata per conto suo farebbe 327 + 327 + 327 = 981
    expect(content.rows.map((r) => r.value)).toEqual(["327 kcal", "327 kcal", "326 kcal"]);
    expect(content.total).toBe("980 kcal");
  });

  it("A. le righe a schermo fanno il totale a schermo, anche con i decimali; una voce piccola non è «0 g»", () => {
    const part = (i: number, value: number): BreakdownPart => ({ label: `Voce ${i}`, value, certainty: "estimated", eventId: `e${i}`, date: "2026-03-10", kind: "mealItem" });
    const b: DayBreakdown = { nutrient: "saltG", date: "2026-03-10", total: 0.47, sum: 0.47, missing: [], parts: [part(1, 0.26), part(2, 0.17), part(3, 0.04)] };
    const content = dayBreakdownContent(b, { partial: false, certainty: "estimated" });
    expect(content.total).toBe("0,5 g");
    expect(content.rows.map((r) => r.value)).toEqual(["0,3 g", "0,2 g", "meno di 0,1 g"]);
    expect(dayCheckText(b)).toBe("Somma delle voci: 0,5 g.");
  });

  it("A. sul giorno vero: per ogni nutriente la somma delle righe come sono scritte è il totale scritto", () => {
    const num = (s: string) => (s.startsWith("meno di") ? 0 : Number(s.replace(/[^\d,]/g, "").replace(",", ".")));
    for (const key of NUTRIENT_KEYS) {
      const b = dayBreakdown(day, key);
      if (b.total === undefined) continue;
      const content = dayBreakdownContent(b, { partial: false, certainty: "estimated" });
      const rows = content.rows.reduce((s, r) => s + num(r.value), 0);
      expect(Math.round(rows * 100)).toBe(Math.round(num(content.total) * 100));
    }
  });

  it("perché è una stima: le voci a occhio e il pasto fuori casa", () => {
    const b = dayBreakdown(day, "energyKcal");
    expect(dayNoteText(b, "estimated")).toBe(
      "È una stima: 3 voci hanno la quantità a occhio o i valori da una tabella generica. Comprende una stima per un pasto fuori casa.",
    );
    expect(dayNoteText(b, "label")).toBe("Comprende una stima per un pasto fuori casa.");
  });

  it("D. per le proteine la stima fuori casa non entra nel totale: la nota non la nomina", () => {
    const note = dayNoteText(dayBreakdown(day, "proteinG"), "estimated") ?? "";
    expect(note).not.toMatch(/fuori casa/);
  });

  it("le righe: nome e quantità, il momento, il collegamento alla voce; la stima fuori casa senza quantità", () => {
    const content = dayBreakdownContent(dayBreakdown(day, "energyKcal"), { partial: true, certainty: "estimated" });
    expect(content.title).toBe("Energia di oggi");
    expect(content.total).toBe("1082 kcal");
    expect(content.totalPrefix).toBe("almeno");
    expect(content.rows[0]).toMatchObject({ label: "Fuori casa · normale", value: "800 kcal", certainty: "estimated", hint: "pranzo · stima fuori casa", href: "/app?voce=m-2026-03-10-lunch-0" });
    expect(content.rows).toContainEqual(expect.objectContaining({ label: "Petto di pollo · 150 g", value: "150 kcal", hint: "cena" }));
    expect(content.missingLabel).toBe("Senza dato (1): non contano");
    expect(content.missing).toEqual([expect.objectContaining({ label: "pizza · 300 g", value: "senza dato", hint: "colazione", href: "/app?voce=m-2026-03-10-breakfast-1" })]);
  });

  it("C. una voce scritta a mano porta alla sua riga in Oggi, con la posizione; un consumo e una bevanda al loro evento", () => {
    const content = dayBreakdownContent(dayBreakdown(day, "energyKcal"), { partial: true, certainty: "estimated" });
    expect(content.rows.find((r) => r.label.startsWith("Zucchine"))?.href).toBe("/app?voce=m-2026-03-10-dinner-1");
    expect(voceHref("c1")).toBe("/app?voce=c1");
    expect(voceHref("m-1", 2)).toBe("/app?voce=m-1-2");
  });

  it("2. per le proteine la stima fuori casa sta tra le voci senza dato, detta come stima", () => {
    const content = dayBreakdownContent(dayBreakdown(day, "proteinG"), { partial: true, certainty: "estimated" });
    expect(content.title).toBe("Proteine di oggi");
    expect(content.missing).toContainEqual(expect.objectContaining({ label: "Fuori casa · normale", hint: "pranzo · stima fuori casa: solo l'energia" }));
    expect(content.rows.some((r) => r.label.startsWith("Fuori casa"))).toBe(false);
  });

  it("1. un giorno di sole bevande: le bevande sono le righe", () => {
    const drinks = intakeOf([drink("d1", "2026-03-20T10:00:00.000Z", { name: "Succo", ml: 200, energyKcal: 90 })]).days[0];
    const content = dayBreakdownContent(dayBreakdown(drinks, "energyKcal"), { partial: false, certainty: "measured" });
    expect(content.rows).toEqual([expect.objectContaining({ label: "Succo · 200 ml", value: "90 kcal", hint: "bevanda", href: "/app?voce=d1" })]);
    expect(content.missing).toBeUndefined();
  });

  it("un consumo di dispensa senza pasto dice che sta fuori dai pasti", () => {
    const loose = intakeOf([
      purchase("p1", "2026-03-01T06:00:00.000Z", { lotId: "lot-1", productRef: FAKE_PRODUCT.barcode, quantity: { value: 500, unit: "g" }, location: "dispensa" }),
      consume("c1", "2026-03-10T16:00:00.000Z", { lotId: "lot-1", quantity: { value: 20, unit: "g" } }),
    ]).days.find((d) => d.date === "2026-03-10")!;
    const content = dayBreakdownContent(dayBreakdown(loose, "energyKcal"), { partial: false, certainty: "label" });
    expect(content.rows[0]).toMatchObject({ hint: "fuori dai pasti", certainty: "label", href: "/app?voce=c1" });
    expect(content.note).toBeUndefined();
  });

  it("nessun giudizio nei testi", () => {
    const content = dayBreakdownContent(dayBreakdown(day, "energyKcal"), { partial: true, certainty: "estimated" });
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/troppo|poco|bene|dovresti/i);
  });
});

describe("Giorni contati", () => {
  it("il testo della riga: il secondo numero è la durata del periodo", () => {
    expect(countedDaysText(5, 7)).toBe("Giorni contati: 5 di 7");
    expect(countedDaysText(0, 30)).toBe("Giorni contati: 0 di 30");
  });

  it("la data breve", () => {
    expect(shortDate("2026-11-17")).toBe("mar 17 nov");
  });

  it("un giorno per riga, dal più recente, con il motivo", () => {
    const intake = intakeOf([
      ...fullDay("2026-11-17"),
      mealOn("2026-11-16", "breakfast", [g("Mela", 150)]),
      mealOn("2026-11-16", "dinner", [g("Mela", 150)]),
      mealOn("2026-11-14", "breakfast", [g("Mela", 150)]),
      mealOn("2026-11-14", "lunch", [outOfHome(800)]),
      mealOn("2026-11-14", "dinner", [g("Mela", 150)]),
    ]);
    const p = periodBreakdown(intake.days, { from: "2026-11-12", to: "2026-11-18" }, "energyKcal");
    const content = countedDaysContent(p, { today: "2026-11-18", nowMinutes: 2 * 60 });
    expect(content.total).toBe("2 di 7");
    expect(content.rows.map((r) => [r.label, r.value, r.hint])).toEqual([
      ["mar 17 nov", "contato", undefined],
      ["lun 16 nov", "non contato", "manca il pranzo"],
      ["sab 14 nov", "contato", "con una stima fuori casa"],
      ["4 giorni senza pasti registrati", "non contati", undefined],
    ]);
    expect(content.rows[0].href).toBe("/app?giorno=2026-11-17");
  });

  it("7. trenta giorni con tre giorni di dati: i giorni vuoti in una riga sola, in fondo", () => {
    const intake = intakeOf([...fullDay("2026-11-17"), ...fullDay("2026-11-10"), mealOn("2026-11-05", "lunch", [g("Mela", 150)])]);
    const p = periodBreakdown(intake.days, { from: "2026-10-20", to: "2026-11-18" }, "energyKcal");
    expect(p.days).toHaveLength(30);
    const content = countedDaysContent(p, { today: "2026-11-18" });
    expect(content.total).toBe("2 di 30");
    expect(content.rows).toHaveLength(3 + 1);
    expect(content.rows[content.rows.length - 1]).toMatchObject({ label: "27 giorni senza pasti registrati", value: "non contati", muted: true });
    expect(content.rows[content.rows.length - 1].href).toBeUndefined();
  });

  it("9. oggi: ciò che non è ancora cominciato non è un motivo", () => {
    const today = "2026-11-18";
    const only = (kinds: MealKind[]) => ({ date: today, counted: false as const, why: "missing_meals" as const, missingKinds: kinds });
    expect(notCountedText(only(["breakfast", "lunch", "dinner"]), { today, nowMinutes: 2 * 60 })).toBe("la giornata non è finita");
    expect(notCountedText(only(["lunch", "dinner"]), { today, nowMinutes: 11 * 60 })).toBe("manca il pranzo");
    expect(notCountedText(only(["dinner"]), { today, nowMinutes: 22 * 60 })).toBe("manca la cena");
    // un giorno passato: tutto ciò che manca
    expect(notCountedText({ ...only(["lunch", "dinner"]), date: "2026-11-17" }, { today, nowMinutes: 2 * 60 })).toBe("mancano pranzo e cena");
    expect(notCountedText({ date: today, counted: false, why: "untracked_meals" }, { today })).toBe("un pasto senza dettagli");
    // E. anche un giorno con soli pesi o acqua: ciò che manca sono i pasti
    expect(notCountedText({ date: "2026-11-17", counted: false, why: "nothing" }, { today })).toBe("nessun pasto registrato");
  });
});

describe("una media: gli stessi numeri di averageIntake", () => {
  const intake = intakeOf([
    ...fullDay("2026-11-17"),
    ...fullDay("2026-11-16"),
    mealOn("2026-11-15", "breakfast", [g("pizza", 200)]),
    mealOn("2026-11-15", "lunch", [outOfHome(700)]),
    mealOn("2026-11-15", "dinner", [g("Mela", 150)]),
    mealOn("2026-11-14", "breakfast", [g("Mela", 150)]),
  ]);
  const range = { from: "2026-11-12", to: "2026-11-18" };
  const periodDays = inPeriod(intake.days, range.from, range.to);

  it("stessa media e stessi giorni contati, per ogni nutriente", () => {
    for (const key of NUTRIENT_KEYS) {
      const p = periodBreakdown(intake.days, range, key);
      const avg = averageIntake(periodDays, key);
      expect(p.average).toBe(avg?.value);
      expect(p.counted).toBe(avg?.days ?? 0);
    }
  });

  it("il foglio: i giorni con il valore, le voci che pesano di più, la riga di controllo", () => {
    const key: NutrientKey = "energyKcal";
    const p = periodBreakdown(intake.days, range, key);
    const avg = averageIntake(periodDays, key)!;
    const content = averageContent(p, avg, { today: "2026-11-18", contributors: topContributors(periodDays, key, 5) });
    expect(content.title).toBe("Energia, media dei giorni contati");
    expect(content.rows.map((r) => r.label)).toEqual(["mar 17 nov", "lun 16 nov", "dom 15 nov"]);
    expect(content.rows[2].hint).toMatch(/stima fuori casa/);
    expect(content.extra?.label).toBe("Le voci che pesano di più");
    expect(content.extra?.rows.length).toBeLessThanOrEqual(5);
    expect(content.check).toBe("Media di 3 giorni con il dato (dei 3 contati, su 7).");
    expect(content.note).toMatch(/Comprende stime per pasti fuori casa/);
  });

  it("B. «contati» ha un solo significato: 5 giorni contati, uno senza energia", () => {
    const noEnergy = (date: string) => [mealOn(date, "breakfast", [g("pizza", 100)]), mealOn(date, "lunch", [g("pizza", 100)]), mealOn(date, "dinner", [g("pizza", 100)])];
    const five = intakeOf([...fullDay("2026-11-17"), ...fullDay("2026-11-16"), ...fullDay("2026-11-15"), ...fullDay("2026-11-14"), ...noEnergy("2026-11-13")]);
    const days = inPeriod(five.days, range.from, range.to);
    const p = periodBreakdown(five.days, range, "energyKcal");
    expect(countedDaysText(p.complete, 7)).toBe("Giorni contati: 5 di 7");
    const content = averageContent(p, averageIntake(days, "energyKcal")!, { today: "2026-11-18", contributors: [] });
    expect(content.title).toBe("Energia, media dei giorni contati");
    expect(content.check).toBe("Media di 4 giorni con il dato (dei 5 contati, su 7).");
    expect(content.missing?.map((r) => r.label)).toEqual(["ven 13 nov"]);
  });

  it("A. la media delle righe, come sono scritte, è la media scritta", () => {
    const num = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));
    for (const key of NUTRIENT_KEYS) {
      const p = periodBreakdown(intake.days, range, key);
      const avg = averageIntake(periodDays, key);
      if (!avg) continue;
      const content = averageContent(p, avg, { today: "2026-11-18", contributors: [] });
      const rows = content.rows.map((r) => (r.value.startsWith("meno di") ? 0 : num(r.value)));
      expect(Math.round((rows.reduce((s, x) => s + x, 0) / rows.length) * 100)).toBe(Math.round(num(content.total) * 100));
    }
  });

  it("8. nessun giorno contato: niente media", () => {
    const p = periodBreakdown(intake.days, { from: "2026-11-18", to: "2026-11-18" }, "energyKcal");
    expect(p.average).toBeUndefined();
    expect(averageIntake([], "energyKcal")).toBeUndefined();
    expect(countedDaysContent(p, { today: "2026-11-18" }).total).toBe("0 di 1");
  });
});

describe("Totale parziale di oggi: solo i momenti già cominciati, come lo stato del giorno", () => {
  const date = "2026-11-18";
  const tz = { timeZone: "UTC" };
  const view = (events: unknown[], hours: number) => dayNutritionView(computeIntake(events, resolver, tz).days[0], date, { nowMinutes: hours * 60 });
  const status = (events: unknown[], hours: number) => dayStatusLine(deriveDiary(events, tz).days[0], { nowMinutes: hours * 60 });

  it("alle 2:00 con uno spuntino: non mancano colazione, pranzo e cena", () => {
    const events = [mealOn(date, "snack", [g("Mela", 150)], "01:30")];
    expect(status(events, 2)).toBe("Fin qui tutto registrato.");
    expect(view(events, 2).partialText).toBe("Totale parziale: la giornata non è finita.");
  });

  it("alle 11:00 con la colazione: manca il pranzo", () => {
    const events = [mealOn(date, "breakfast", [g("Mela", 150)])];
    expect(status(events, 11)).toBe("Manca il pranzo.");
    expect(view(events, 11).partialText).toBe("Totale parziale: manca il pranzo.");
  });

  it("alle 22:00 con colazione e pranzo: manca la cena", () => {
    const events = [mealOn(date, "breakfast", [g("Mela", 150)]), mealOn(date, "lunch", [g("Mela", 150)])];
    expect(status(events, 22)).toBe("Manca la cena.");
    expect(view(events, 22).partialText).toBe("Totale parziale: manca la cena.");
  });

  it("senza l'ora (un giorno passato) la frase è quella di sempre", () => {
    const events = [mealOn(date, "breakfast", [g("Mela", 150)])];
    expect(dayNutritionView(computeIntake(events, resolver, tz).days[0], date).partialText).toBe("Totale parziale: mancano pranzo, cena.");
  });
});
