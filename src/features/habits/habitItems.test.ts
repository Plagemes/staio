import { describe, expect, it } from "vitest";
import type { MealItem } from "@/core/diary";
import { NO_ITEMS, habitItemRows, readHabitItems } from "./habitItems";

const items: MealItem[] = [
  { name: "Latte", quantity: { value: 200, unit: "ml" }, certainty: "measured" },
  { name: "Fette biscottate", quantity: { value: 2, unit: "pz" }, certainty: "estimated", foodId: "fette" },
];

describe("Cambia gli alimenti", () => {
  it("le righe di partenza: «200 ml», «2 pz»", () => {
    expect(habitItemRows(items).map((r) => [r.name, r.quantityText])).toEqual([
      ["Latte", "200 ml"],
      ["Fette biscottate", "2 pz"],
    ]);
  });

  it("quantità cambiata, voce tolta, voce nuova: le voci tengono certezza e alimento della tabella, la nuova è una stima", () => {
    const rows = habitItemRows(items);
    const r = readHabitItems([{ ...rows[0], quantityText: "250 ml" }, { name: "Miele", quantityText: "10 g" }, { name: "", quantityText: "" }]);
    expect(r).toEqual({
      ok: true,
      items: [
        { name: "Latte", quantity: { value: 250, unit: "ml" }, certainty: "measured" },
        { name: "Miele", quantity: { value: 10, unit: "g" }, certainty: "estimated" },
      ],
    });
    const kept = readHabitItems(rows);
    expect(kept.ok && kept.items[1]).toEqual(items[1]);
  });

  it("19. una quantità che non si legge: errore sotto quel campo, niente da salvare", () => {
    const rows = habitItemRows(items);
    const r = readHabitItems([rows[0], { ...rows[1], quantityText: "boh" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors)).toEqual(["1"]);
      expect(r.general).toBeUndefined();
    }
    const nameless = readHabitItems([{ name: "", quantityText: "10 g" }]);
    expect(nameless.ok === false && nameless.errors[0]).toBe("Scrivi come si chiama.");
  });

  it("un pasto abituale senza voci non si salva", () => {
    expect(readHabitItems([])).toEqual({ ok: false, errors: {}, general: NO_ITEMS });
    expect(readHabitItems([{ name: "", quantityText: "" }])).toEqual({ ok: false, errors: {}, general: NO_ITEMS });
    expect(NO_ITEMS).toBe("Lascia almeno un alimento, oppure ritira il pasto.");
  });
});
