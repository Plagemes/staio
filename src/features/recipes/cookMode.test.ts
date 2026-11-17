import { describe, expect, it } from "vitest";
import {
  finishedSteps,
  formatClock,
  goTo,
  ingredientsForStep,
  isFirst,
  isLast,
  isRunning,
  move,
  pauseTimer,
  remaining,
  resetTimer,
  startCook,
  startTimer,
} from "./cookMode";

describe("navigazione tra i passi", () => {
  it("parte dal primo e non esce mai dall'intervallo", () => {
    let s = startCook(3);
    expect(s.index).toBe(0);
    expect(isFirst(s)).toBe(true);
    s = move(s, -1);
    expect(s.index).toBe(0);
    s = move(move(s, 1), 1);
    expect(s.index).toBe(2);
    expect(isLast(s)).toBe(true);
    expect(move(s, 1)).toBe(s);
    expect(goTo(s, 0).index).toBe(0);
    expect(goTo(s, 99).index).toBe(2);
  });

  it("una ricetta senza passi non rompe niente", () => {
    const s = startCook(0);
    expect(move(s, 1).index).toBe(0);
    expect(isLast(s)).toBe(true);
  });
});

describe("timer", () => {
  it("parte con la durata del passo, scende col tempo e finisce a zero", () => {
    let s = startCook(2);
    s = startTimer(s, 0, 10, 1_000);
    const t = s.timers[0];
    expect(t?.totalMs).toBe(600_000);
    expect(remaining(t!, 1_000)).toBe(600_000);
    expect(remaining(t!, 301_000)).toBe(300_000);
    expect(remaining(t!, 700_000)).toBe(0);
    expect(finishedSteps(s, 300_000)).toEqual([]);
    expect(finishedSteps(s, 601_000)).toEqual([0]);
  });

  it("un passo senza durata non ha timer", () => {
    const s = startCook(1);
    expect(startTimer(s, 0, undefined, 0)).toBe(s);
    expect(startTimer(s, 0, 0, 0)).toBe(s);
  });

  it("pausa e ripresa conservano ciò che resta", () => {
    let s = startTimer(startCook(1), 0, 5, 0);
    s = pauseTimer(s, 0, 120_000);
    const t = s.timers[0]!;
    expect(isRunning(t)).toBe(false);
    expect(remaining(t, 999_999)).toBe(180_000);
    s = startTimer(s, 0, 5, 500_000);
    expect(remaining(s.timers[0]!, 500_000)).toBe(180_000);
    expect(remaining(s.timers[0]!, 560_000)).toBe(120_000);
  });

  it("riavviare un timer in corso non lo sposta", () => {
    const s = startTimer(startCook(1), 0, 5, 0);
    expect(startTimer(s, 0, 5, 100_000)).toBe(s);
  });

  it("azzerare lo toglie; i timer di altri passi restano in corso mentre si cambia passo", () => {
    let s = startTimer(startCook(3), 0, 10, 0);
    s = move(s, 1);
    s = startTimer(s, 1, 2, 10_000);
    expect(Object.keys(s.timers)).toEqual(["0", "1"]);
    expect(finishedSteps(s, 140_000)).toEqual([1]);
    s = resetTimer(s, 1);
    expect(s.timers[1]).toBeUndefined();
    expect(s.timers[0]).toBeDefined();
    expect(resetTimer(s, 2)).toBe(s);
  });

  it("l'orologio si legge come in cucina", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(425_000)).toBe("7:05");
    expect(formatClock(3_750_000)).toBe("1:02:30");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("ingredienti del passo", () => {
  const ings = [
    { name: "Spaghetti" },
    { name: "Passata di pomodoro" },
    { name: "Olio extravergine d'oliva" },
    { name: "Basilico" },
    { name: "Sale" },
  ];

  it("trova quelli nominati, anche al plurale o con un nome più corto", () => {
    expect(ingredientsForStep({ text: "Cuoci gli spaghetti in acqua salata." }, ings)).toEqual([0]);
    expect(ingredientsForStep({ text: "Versa la passata e aggiungi il basilico." }, ings)).toEqual([1, 3]);
    expect(ingredientsForStep({ text: "Scalda l'olio extravergine d'oliva." }, ings)).toEqual([2]);
  });

  it("un passo che non nomina niente non mostra ingredienti", () => {
    expect(ingredientsForStep({ text: "Lascia riposare per dieci minuti." }, ings)).toEqual([]);
  });

  it("non confonde parole diverse", () => {
    expect(ingredientsForStep({ text: "Taglia la cipolla." }, ings)).toEqual([]);
  });
});
