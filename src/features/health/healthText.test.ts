import { describe, expect, it } from "vitest";
import { createDrink, createMood, createSupplement, createSymptom, createWater, createWeight, deriveDiary, type SymptomKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { scoreAverages, supplementDays, waterWeek } from "../health";
import {
  fluidsSummary,
  lastWeightText,
  scoreLine,
  scoresNotice,
  scoresSummary,
  shortDate,
  supplementHint,
  supplementLine,
  supplementNotice,
  supplementsSummary,
  trendSummaries,
  waterLine,
  weekdayLabel,
  weightNotice,
  weightSummary,
} from "./healthText";

const TODAY = "2026-11-18";
const GOAL = 2000;
const at = (date: string, time = "09:00") => ({ deviceId: "d", at: `${date}T${time}:00.000Z`, now: () => `${date}T${time}:00.000Z` });
const weight = (date: string, kg: number, time?: string): AnyEvent => createWeight({ kg }, at(date, time));
const mood = (date: string, score: number): AnyEvent => createMood({ score }, at(date));
const symptom = (date: string, kind: SymptomKind, score: number): AnyEvent => createSymptom({ kind, score }, at(date));
const supplement = (date: string, name: string, time?: string): AnyEvent => createSupplement({ name }, at(date, time));
const water = (date: string, ml: number): AnyEvent => createWater({ ml }, at(date));

describe("date corte", () => {
  it("giorno e mese, senza anno; giorno della settimana e numero", () => {
    expect(shortDate("2026-11-18")).toBe("18 nov");
    expect(weekdayLabel("2026-11-17")).toBe("mar 17");
  });
});

describe("prima volta, nessun dato", () => {
  it("ogni riga dice che è vuota", () => {
    expect(trendSummaries(deriveDiary([]), TODAY, GOAL)).toEqual({
      weight: "nessuna pesata in 30 giorni",
      scores: "pochi dati negli ultimi 7 giorni",
      fluids: "oggi 0 ml di 2 l",
      supplements: "nessuno oggi",
    });
  });
});

describe("riepilogo di «Peso»", () => {
  it("con una o due pesate dice l'ultima, senza media", () => {
    expect(weightSummary(deriveDiary([weight("2026-11-16", 72.6), weight("2026-11-18", 72.4)]), TODAY)).toBe("72,4 kg il 18 nov");
  });

  it("con almeno tre pesate in 30 giorni aggiunge la media a 7 giorni", () => {
    const diary = deriveDiary([weight("2026-11-14", 72.2), weight("2026-11-16", 71.7), weight("2026-11-18", 72.4)]);
    expect(weightSummary(diary, TODAY)).toBe("72,4 kg il 18 nov · media a 7 giorni 72,1 kg");
  });

  it("due pesate nello stesso giorno: dice l'ultima", () => {
    const diary = deriveDiary([weight("2026-11-18", 73, "07:00"), weight("2026-11-18", 72.4, "19:00")]);
    expect(weightSummary(diary, TODAY)).toBe("72,4 kg il 18 nov");
  });

  it("una pesata più vecchia di 30 giorni non conta", () => {
    expect(weightSummary(deriveDiary([weight("2026-09-01", 75)]), TODAY)).toBe("nessuna pesata in 30 giorni");
  });
});

describe("riepilogo di «Come sto»", () => {
  it("solo le misure segnate in almeno tre giorni su sette, nell'ordine di sempre", () => {
    const diary = deriveDiary([
      mood("2026-11-13", 4),
      mood("2026-11-14", 4),
      mood("2026-11-15", 3),
      mood("2026-11-16", 4),
      mood("2026-11-18", 4),
      symptom("2026-11-16", "sleep", 4),
      symptom("2026-11-17", "sleep", 4),
      symptom("2026-11-18", "sleep", 4),
      symptom("2026-11-16", "energy", 3),
      symptom("2026-11-17", "energy", 3),
      symptom("2026-11-18", "energy", 4),
      symptom("2026-11-18", "digestion", 2),
    ]);
    expect(scoresSummary(diary, TODAY)).toBe("7 giorni: umore 3,8 · energia 3,3 · sonno 4");
  });

  it("con meno di tre giorni per ogni misura: pochi dati", () => {
    expect(scoresSummary(deriveDiary([mood("2026-11-17", 5), mood("2026-11-18", 5)]), TODAY)).toBe("pochi dati negli ultimi 7 giorni");
  });
});

describe("riepilogo di «Acqua e bevande»", () => {
  it("l'acqua di oggi rispetto all'obiettivo", () => {
    expect(fluidsSummary(deriveDiary([water(TODAY, 1400)]), TODAY, GOAL)).toBe("oggi 1,4 l di 2 l");
    expect(fluidsSummary(deriveDiary([water("2026-11-17", 1400)]), TODAY, 2500)).toBe("oggi 0 ml di 2,5 l");
  });

  it("caffeina e alcol di oggi, con la tilde se sono stime", () => {
    const diary = deriveDiary([
      water(TODAY, 600),
      createDrink({ name: "Tè", ml: 200, caffeineMg: 40 }, { ...at(TODAY, "08:00"), certainty: "estimated" }),
      createDrink({ name: "Birra", ml: 330, alcoholG: 13 }, { ...at(TODAY, "20:00"), certainty: "estimated" }),
    ]);
    expect(fluidsSummary(diary, TODAY, GOAL)).toBe("oggi 0,6 l di 2 l · caffeina ~40 mg · alcol ~13 g");
  });

  it("un valore letto dall'etichetta non ha la tilde; una bevanda senza caffeina né alcol non aggiunge niente", () => {
    const labelled = deriveDiary([createDrink({ name: "Caffè lungo", ml: 120, caffeineMg: 80 }, { ...at(TODAY), certainty: "label" })]);
    expect(fluidsSummary(labelled, TODAY, GOAL)).toBe("oggi 0 ml di 2 l · caffeina 80 mg");
    const juice = deriveDiary([createDrink({ name: "Succo", ml: 200 }, { ...at(TODAY), certainty: "label" })]);
    expect(fluidsSummary(juice, TODAY, GOAL)).toBe("oggi 0 ml di 2 l");
  });
});

describe("riepilogo di «Integratori»", () => {
  it("quelli di oggi, ognuno una volta, in minuscolo dentro la frase", () => {
    const diary = deriveDiary([
      supplement(TODAY, "Vitamina D", "08:00"),
      supplement(TODAY, "Magnesio", "09:00"),
      supplement(TODAY, "vitamina d", "21:00"),
      supplement("2026-11-17", "Ferro"),
    ]);
    expect(supplementsSummary(diary, TODAY)).toBe("oggi: vitamina D, magnesio");
  });

  it("niente oggi", () => {
    expect(supplementsSummary(deriveDiary([supplement("2026-11-17", "Ferro")]), TODAY)).toBe("nessuno oggi");
  });
});

describe("le righe dentro «Andamento»", () => {
  it("una misura con la media, e una con troppo pochi giorni", () => {
    const diary = deriveDiary([
      mood("2026-11-13", 4),
      mood("2026-11-14", 4),
      mood("2026-11-15", 3),
      mood("2026-11-16", 4),
      mood("2026-11-18", 4),
      symptom("2026-11-17", "energy", 3),
      symptom("2026-11-18", "energy", 3),
      symptom("2026-11-18", "sleep", 5),
    ]);
    // le misure mai segnate nella settimana non hanno una riga
    const shown = scoreAverages(diary, TODAY).filter((a) => a.days > 0);
    expect(shown.map((a) => scoreLine(a))).toEqual([
      "Umore · media 3,8 · 5 giorni su 7",
      "Energia · 2 giorni: troppo pochi per una media",
      "Sonno · 1 giorno: troppo poco per una media",
    ]);
  });

  it("un integratore con i suoi giorni", () => {
    const diary = deriveDiary([supplement("2026-11-14", "Vitamina D"), supplement("2026-11-16", "Vitamina D"), supplement(TODAY, "Magnesio")]);
    expect(supplementDays(diary, TODAY).map((s) => supplementLine(s))).toEqual(["Vitamina D · 2 giorni su 7", "Magnesio · 1 giorno su 7"]);
  });

  it("un giorno d'acqua; senza acqua segnata un trattino, anche oggi", () => {
    const week = waterWeek(deriveDiary([water("2026-11-17", 1400)]), TODAY);
    expect(waterLine(week[5], TODAY)).toBe("mar 17 · 1,4 l");
    expect(waterLine(week[4], TODAY)).toBe("lun 16 · —");
    expect(waterLine(week[6], TODAY)).toBe("oggi · —");
  });
});

describe("gli avvisi dei fogli", () => {
  it("peso", () => {
    expect(weightNotice(72.4)).toBe("Segnato: peso 72,4 kg.");
  });

  it("«Come sto»: solo ciò che è stato scelto, nell'ordine umore, energia, digestione, sonno", () => {
    expect(scoresNotice({ energy: 3, mood: 4 })).toBe("Segnato: umore 4, energia 3.");
    expect(scoresNotice({ sleep: 4 })).toBe("Segnato: sonno 4.");
    expect(scoresNotice({ sleep: 2, digestion: 5, energy: 3, mood: 1 })).toBe("Segnato: umore 1, energia 3, digestione 5, sonno 2.");
  });

  it("integratore, con e senza dose", () => {
    expect(supplementNotice("Vitamina D", "1 capsula")).toBe("Segnato: vitamina D, 1 capsula.");
    expect(supplementNotice("Magnesio")).toBe("Segnato: magnesio.");
    expect(supplementNotice("B12", " ")).toBe("Segnato: B12.");
  });
});

describe("i testi piccoli dei fogli", () => {
  it("la riga sotto un integratore recente", () => {
    expect(supplementHint("1 capsula", "08:15")).toBe("1 capsula · preso oggi alle 08:15");
    expect(supplementHint("1 capsula", undefined)).toBe("1 capsula");
    expect(supplementHint(undefined, "08:15")).toBe("preso oggi alle 08:15");
    expect(supplementHint(undefined, undefined)).toBe("");
  });

  it("l'ultima pesata", () => {
    expect(lastWeightText({ date: "2026-11-16", kg: 72.4 }, TODAY)).toBe("L'ultima: 72,4 kg, il 16 nov.");
    expect(lastWeightText({ date: TODAY, kg: 72.1 }, TODAY)).toBe("L'ultima: 72,1 kg, oggi.");
  });
});
