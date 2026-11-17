// Dati di prova condivisi dai test del rilevamento da foto. Non fanno parte dell'app.
import type { ExpectedLot } from "./pantryScan";

export const FRIDGE: ExpectedLot[] = [
  { id: "L1", name: "Latte intero", remaining: { value: 1000, unit: "ml" }, initial: 1000, opened: false, category: "milk_fresh", expiry: { date: "2026-11-20", kind: "use_by" } },
  { id: "L2", name: "Yogurt bianco", remaining: { value: 4, unit: "pz" }, initial: 4, opened: false, category: "yogurt" },
  { id: "L3", name: "Passata di pomodoro", remaining: { value: 500, unit: "ml" }, initial: 700, opened: true, category: "sauces_preserves_opened" },
  { id: "L4", name: "Insalata mista", remaining: { value: 150, unit: "g" }, initial: 150, opened: false, category: "leafy_vegetables" },
  { id: "L5", name: "Mozzarella", remaining: { value: 2, unit: "pz" }, initial: 2, opened: false, category: "cheese_fresh" },
  { id: "L6", name: "Burro", remaining: { value: 200, unit: "g" }, initial: 250, opened: true, category: "butter" },
];

/** Una risposta realistica e completa. */
export const FRIDGE_RESPONSE = {
  lots: [
    { id: "L1", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.8 }, expiry: { date: "2026-11-22", kind: "best_before", confidence: 0.9 }, freshness: null, zone: "sportello" },
    { id: "L2", status: "seen", confidence: 0.95, level: null, expiry: null, freshness: null, zone: "ripiano_centrale" },
    { id: "L3", status: "absent", confidence: 0.85, level: null, expiry: null, freshness: null, zone: null },
    { id: "L4", status: "seen", confidence: 0.9, level: null, expiry: null, freshness: { state: "use_soon", confidence: 0.8 }, zone: "cassetto_verdure" },
    { id: "L5", status: "not_seen", confidence: 0.6, level: null, expiry: null, freshness: null, zone: null },
    { id: "L6", status: "not_seen", confidence: 0.4, level: null, expiry: null, freshness: null, zone: null },
  ],
  unexpected: [
    { name: "Marmellata di fragole", quantity: 1, unit: "pz", confidence: 0.9, zone: "ripiano_alto" },
    { name: "Yogurt", quantity: null, unit: null, confidence: 0.9, zone: "ripiano_centrale" },
  ],
  unreadable: ["fondo del cassetto, coperto da una busta"],
};

export const json = (value: unknown) => JSON.stringify(value);
