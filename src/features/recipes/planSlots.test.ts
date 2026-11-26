import { describe, expect, it } from "vitest";
import { defaultSlot, plannedMessage, planSlots } from "./planSlots";

const TODAY = "2026-11-16"; // lunedì

describe("planSlots", () => {
  it("alle 11:00: pranzo e cena di oggi, poi i giorni dopo; la colazione di oggi è passata", () => {
    const slots = planSlots({ today: TODAY, nowMinutes: 11 * 60, meals: undefined });
    expect(slots.slice(0, 4).map((s) => s.label)).toEqual(["Oggi · pranzo", "Stasera · cena", "Domani · colazione", "Domani · pranzo"]);
    expect(slots.at(-1)).toMatchObject({ date: "2026-11-23", meal: "dinner" });
    expect(slots.find((s) => s.date === "2026-11-18" && s.meal === "dinner")?.label).toBe("Mer 18 · cena");
  });

  it("alle 23:30 non resta niente di oggi", () => {
    const slots = planSlots({ today: TODAY, nowMinutes: 23 * 60 + 30, meals: undefined });
    expect(slots.every((s) => s.date !== TODAY)).toBe(true);
  });

  it("segue i pasti della struttura del piano", () => {
    const slots = planSlots({ today: TODAY, nowMinutes: 8 * 60, meals: ["lunch", "dinner", "snack"] });
    expect(slots.filter((s) => s.date === TODAY).map((s) => s.meal)).toEqual(["lunch", "snack", "dinner"]);
  });
});

describe("defaultSlot", () => {
  const slots = planSlots({ today: TODAY, nowMinutes: 11 * 60, meals: undefined });
  it("è il primo pranzo o la prima cena libera da adesso", () => {
    expect(defaultSlot(slots, () => false)?.label).toBe("Oggi · pranzo");
    expect(defaultSlot(slots, (s) => s.date === TODAY && s.meal === "lunch")?.label).toBe("Stasera · cena");
  });
  it("se sono tutti occupati, il primo", () => {
    expect(defaultSlot(slots, () => true)?.label).toBe("Oggi · pranzo");
  });
});

describe("plannedMessage", () => {
  it("dice che cosa, quando e per quale pasto", () => {
    expect(plannedMessage("Pasta al forno", { date: "2026-11-17", meal: "dinner" })).toBe("Aggiunto al piano: Pasta al forno, martedì 17, cena.");
  });
});
