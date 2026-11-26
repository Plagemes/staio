import { describe, expect, it } from "vitest";
import type { CatchUpEntry } from "@/core/diary";
import {
  CATCHUP_EXPLAIN,
  alreadyThereText,
  catchUpDayHref,
  catchUpLineText,
  catchUpOperationText,
  dayName,
  dayRangeText,
  habitLabel,
  momentLine,
  namesText,
  rejectedText,
  repeatLabel,
  savedMessage,
  stepTitle,
} from "./catchupText";

const entry = (date: string, kind: CatchUpEntry["kind"], choice: CatchUpEntry["choice"]): CatchUpEntry => ({ date, kind, choice });
const lunch: CatchUpEntry["choice"] = { kind: "meal", items: [{ name: "Pasta", quantity: { value: 100, unit: "g" }, certainty: "estimated" }], source: "manual" };

describe("i testi di «Mettiamoci in pari»", () => {
  it("la riga in Oggi", () => {
    expect(catchUpLineText(3)).toBe("3 giorni senza niente nel diario · Mettiamoci in pari");
    expect(catchUpLineText(2)).toBe("2 giorni senza niente nel diario · Mettiamoci in pari");
  });

  it("il giorno e il titolo del passo", () => {
    expect(dayName("2026-11-16")).toBe("lunedì 16");
    expect(dayName("2026-11-15")).toBe("domenica 15");
    expect(stepTitle("2026-11-16", 0, 3)).toBe("Lunedì 16 · 1 di 3");
    expect(stepTitle("2026-11-18", 2, 3)).toBe("Mercoledì 18 · 3 di 3");
  });

  it("le scelte in una riga", () => {
    expect(habitLabel(" Solito pranzo ")).toBe("Il solito: Solito pranzo");
    expect(repeatLabel("2026-11-09", "pasta al pomodoro, insalata")).toBe("Come lunedì 9: pasta al pomodoro, insalata");
    expect(repeatLabel("2026-11-09", "")).toBe("Come lunedì 9");
    expect(momentLine("lunch", "Come lunedì 9: pasta")).toBe("Pranzo · Come lunedì 9: pasta");
    expect(namesText(["Pasta", "pasta", "Insalata"])).toBe("pasta, insalata");
    expect(namesText(["A", "Bb", "Cc", "Dd"])).toBe("A, bb, cc e un altro");
    expect(namesText(["Aa", "Bb", "Cc", "Dd", "Ee"])).toBe("aa, bb, cc e altri 2");
  });

  it("l'avviso dopo «Salva», singolari e plurali, senza le parti a zero", () => {
    const three = [
      ...["2026-11-14", "2026-11-15", "2026-11-16"].flatMap((d) => [entry(d, "breakfast", lunch), entry(d, "lunch", lunch)]),
      entry("2026-11-14", "dinner", { kind: "unknown" }),
      entry("2026-11-15", "dinner", { kind: "skipped" }),
      entry("2026-11-16", "dinner", { kind: "skipped" }),
    ];
    expect(savedMessage(three)).toBe("Messo in pari: 3 giorni, 7 pasti, 2 saltati.");
    expect(savedMessage([entry("2026-11-14", "lunch", lunch)])).toBe("Messo in pari: 1 giorno, 1 pasto.");
    expect(savedMessage([entry("2026-11-14", "lunch", { kind: "skipped" })])).toBe("Messo in pari: 1 giorno, 1 saltato.");
    expect(savedMessage([entry("2026-11-14", "lunch", { kind: "unknown" }), entry("2026-11-15", "lunch", { kind: "skipped" })])).toBe("Messo in pari: 2 giorni, 1 pasto, 1 saltato.");
  });

  it("ciò che era già nel diario", () => {
    expect(alreadyThereText([])).toBe("");
    expect(alreadyThereText([{ date: "2026-11-16", kind: "lunch" }])).toBe("Lunedì 16, pranzo era già nel diario: l'ho lasciato com'era.");
    expect(alreadyThereText([{ date: "2026-11-16", kind: "dinner" }, { date: "2026-11-16", kind: "lunch" }])).toBe("Lunedì 16, pranzo e cena erano già nel diario: li ho lasciati com'erano.");
    expect(alreadyThereText([{ date: "2026-11-17", kind: "breakfast" }, { date: "2026-11-16", kind: "lunch" }])).toBe(
      "Lunedì 16, pranzo e martedì 17, colazione erano già nel diario: li ho lasciati com'erano.",
    );
  });

  it("ciò che una scrittura a metà non ha fatto entrare", () => {
    expect(rejectedText([])).toBe("");
    expect(rejectedText([{ date: "2026-11-17", kind: "dinner" }])).toBe("Martedì 17, cena non è entrata nel diario: riprova da Oggi.");
    expect(rejectedText([{ date: "2026-11-17", kind: "lunch" }])).toBe("Martedì 17, pranzo non è entrato nel diario: riprova da Oggi.");
    expect(rejectedText([{ date: "2026-11-17", kind: "lunch" }, { date: "2026-11-16", kind: "dinner" }])).toBe(
      "Lunedì 16, cena e martedì 17, pranzo non sono entrati nel diario: riprova da Oggi.",
    );
  });

  it("la riga di «Ultime azioni» e il suo collegamento", () => {
    expect(catchUpOperationText(["2026-11-16", "2026-11-14", "2026-11-15"])).toBe("Messo in pari: 14-16 nov");
    expect(catchUpOperationText(["2026-11-16", "2026-11-16"])).toBe("Messo in pari: lunedì 16");
    expect(dayRangeText(["2026-10-30", "2026-11-02"])).toBe("30 ott-2 nov");
    expect(dayRangeText(["2025-12-30", "2026-01-02"])).toBe("30 dic 2025-2 gen 2026");
    expect(dayRangeText([])).toBe("");
    expect(catchUpDayHref("2026-11-14")).toBe("/app?giorno=2026-11-14");
  });

  it("la spiegazione", () => {
    expect(CATCHUP_EXPLAIN).toBe('Sono stime: non tolgono niente dalla dispensa. "Non ricordo" toglie il giorno dalle medie dei nutrienti.');
  });
});
