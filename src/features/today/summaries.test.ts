import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { buildCaptureEvents, type CaptureInput } from "../capture";
import { evaluateLots, isExpiring } from "../lots";
import type { DayNutritionView, NutrientCell } from "../nutrition/prepare";
import { expiringSummary, mealSummary, movementsSummary, nutritionSummary, reviewNotices } from "./summaries";

describe("mealSummary: il riepilogo di un pasto richiuso", () => {
  it("ora, nomi in minuscolo ed energia", () => {
    expect(
      mealSummary({ time: "8:10", names: ["Latte", "Pane", "Marmellata"], energy: { value: 420, certainty: "estimated", partial: false } }),
    ).toBe("8:10 · latte, pane, marmellata · ~420 kcal");
  });

  it("al massimo tre nomi, poi quante altre", () => {
    expect(mealSummary({ time: "13:05", names: ["Pasta", "Sugo", "Insalata", "Mela"] })).toBe("13:05 · pasta, sugo, insalata e un'altra");
    expect(mealSummary({ time: "13:05", names: ["Pasta", "Sugo", "Insalata", "Mela", "Pane"] })).toBe("13:05 · pasta, sugo, insalata e altre 2");
  });

  it("senza energia non la inventa; con un dato mancante dice «almeno»; una misura non ha la tilde", () => {
    expect(mealSummary({ time: "20:00", names: ["Petto di pollo"] })).toBe("20:00 · petto di pollo");
    expect(mealSummary({ time: "20:00", names: ["Petto di pollo", "Riso"], energy: { value: 240, certainty: "label", partial: true } })).toBe(
      "20:00 · petto di pollo, riso · almeno 240 kcal",
    );
  });

  it("dice il momento quando il titolo è il nome del pasto; le sigle restano maiuscole", () => {
    expect(mealSummary({ time: "7:40", moment: "colazione", names: ["Latte", "BCAA"] })).toBe("7:40 · colazione · latte, BCAA");
    expect(mealSummary({ time: "7:40", names: [] })).toBe("7:40");
  });
});

describe("expiringSummary: il riepilogo di «In scadenza»", () => {
  const NOW = "2026-11-16T10:00:00.000Z";
  const base: CaptureInput = {
    name: "Petto di pollo",
    quantityText: "400 g",
    location: "frigo",
    category: "poultry",
    expiryKind: "use_by",
    expiryDate: "2026-11-18",
    priceText: "",
    alreadyHave: false,
  };
  const add = (over: Partial<CaptureInput>): LedgerEvent[] => {
    const r = buildCaptureEvents({ ...base, ...over }, { now: NOW, deviceId: "d" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.events;
  };
  const expiring = (events: LedgerEvent[]) => evaluateLots(derivePantry(events).lots, NOW).filter(isExpiring);

  it("con uno solo: nome e segno di scadenza", () => {
    const [first] = expiring(add({}));
    expect(expiringSummary(first, 1)).toBe("petto di pollo, 2 giorni");
  });

  it("con più d'uno: quanti sono e il primo; la stima ha la tilde", () => {
    const entries = expiring([...add({ expiryKind: "none", expiryDate: "" }), ...add({ name: "Latte intero", category: "milk_fresh", expiryDate: "2026-11-17" })]);
    expect(entries.length).toBeGreaterThan(0);
    expect(expiringSummary(entries[0], 3)).toBe("3 alimenti · latte intero, domani");
    const estimated = expiring(add({ expiryKind: "none", expiryDate: "" }));
    expect(estimated).toHaveLength(1);
    expect(expiringSummary(estimated[0], 1)).toMatch(/^petto di pollo, ~/);
  });
});

describe("nutritionSummary: il riepilogo di «Nutrienti»", () => {
  const cell = (key: NutrientCell["key"], text: string, over: Partial<NutrientCell> = {}): NutrientCell => ({
    key,
    label: key,
    text,
    prefix: "",
    value: 1,
    partial: false,
    certainty: "estimated",
    missingShare: 0,
    ...over,
  });
  const view = (over: Partial<DayNutritionView>): DayNutritionView => ({ date: "2026-11-16", empty: false, complete: true, resolved: 1, total: 1, macros: [], ...over });

  it("energia e proteine, con la tilde delle stime", () => {
    expect(nutritionSummary(view({ energy: cell("energyKcal", "241 kcal"), macros: [cell("proteinG", "45 g"), cell("carbsG", "10 g")] }))).toBe(
      "~241 kcal · ~45 g proteine",
    );
  });

  it("un totale con dati mancanti è un minimo; un valore d'etichetta non ha la tilde", () => {
    expect(nutritionSummary(view({ energy: cell("energyKcal", "241 kcal", { prefix: "almeno ", certainty: "label" }) }))).toBe("almeno 241 kcal");
  });

  it("solo bevande, niente da calcolare, calcolo in corso", () => {
    expect(nutritionSummary(view({ drinksOnlyText: "Per ora solo bevande: ~1 kcal.", energy: cell("energyKcal", "1 kcal") }))).toBe("per ora solo bevande: ~1 kcal");
    expect(nutritionSummary(view({ empty: true }))).toBe("niente da calcolare");
    expect(nutritionSummary(undefined)).toBe("calcolo…");
  });
});

describe("movementsSummary", () => {
  it("singolare e plurale", () => {
    expect(movementsSummary(1)).toBe("1 movimento");
    expect(movementsSummary(6)).toBe("6 movimenti");
  });
});

describe("reviewNotices: gli «altri avvisi» del riepilogo", () => {
  const notices = [
    { type: "shopping", key: "shopping:latte:2026-11-18", short: "Spesa: serve latte" },
    { type: "plan", key: "plan:cook:p1:2026-11-18", short: "Da cucinare: ragù" },
    { type: "plan", key: "plan:week:2026-11-23", short: "Piano della prossima settimana vuoto" },
    { type: "expiry", key: "expiry:lot1:today", short: "Yogurt: scade oggi" },
    { type: "prep", key: "prep:p2:tomorrow", short: "Ragù: domani" },
  ];

  it("spesa, «Da cucinare» e piano della settimana restano tutti: non ripetono le righe di lista e piano", () => {
    expect(reviewNotices(notices).map((n) => n.key)).toEqual([
      "shopping:latte:2026-11-18",
      "plan:cook:p1:2026-11-18",
      "plan:week:2026-11-23",
    ]);
  });

  it("nessun avviso di spesa o di piano si toglie, quanti che siano", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ type: i % 2 ? "plan" : "shopping", key: `k${i}` }));
    expect(reviewNotices(many)).toHaveLength(5);
  });

  it("scadenze e preparazioni non si contano tra gli altri avvisi: il riepilogo le dice nella sua riga", () => {
    expect(reviewNotices(notices).some((n) => n.type === "expiry" || n.type === "prep")).toBe(false);
  });
});