import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { compareWithReferences, computeIntake, type ReferenceWithVariant } from "@/core/nutrition";
import { REFERENCE_VALUES } from "@/core/nutrition/data/reference";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import { buildMealEvents } from "../meals";
import { buildNutritionRows, dayNutritionView, missingPercentText } from "./prepare";
import { toEngineProfile } from "./profile";
import { buildResolver } from "./resolver";

const REFS = REFERENCE_VALUES as readonly ReferenceWithVariant[];
const at = (date: string, hour = 9) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;

function free(date: string, hour: number, kind: "breakfast" | "lunch" | "dinner" | "snack", items: { name: string; quantityText: string }[]): AnyEvent[] {
  const r = buildMealEvents({ kind, picks: [], freeItems: items }, { now: at(date, hour), deviceId: "d" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

function completeDay(date: string, extra: { name: string; quantityText: string }[] = []): AnyEvent[] {
  return [
    ...free(date, 7, "breakfast", [{ name: "Latte intero", quantityText: "200 ml" }]),
    ...free(date, 12, "lunch", [{ name: "Pasta di semola secca", quantityText: "80 g" }, ...extra]),
    ...free(date, 19, "dinner", [{ name: "Petto di pollo crudo", quantityText: "150 g" }]),
  ];
}

const resolverFor = () => buildResolver({ foods: FAKE_FOODS, products: new Map(), barcodes: new Map(), overrides: {} });

describe("totali parziali ben visibili", () => {
  const profile = toEngineProfile({ sex: "female", age: 40, savedOn: "2026-11-01", variants: {} }, "2026-11-16");

  it("il giorno elenca i nutrienti con dato mancante, da qualunque valore maggiore di zero", () => {
    const events = completeDay("2026-11-10", [{ name: "Cibo misterioso", quantityText: "1 g" }]);
    const view = dayNutritionView(computeIntake(events, resolverFor()).days[0], "2026-11-10");
    expect(view.missingText).toMatch(/^Dato mancante per:/);
    expect(view.missingText).toMatch(/energia/);
    expect(view.missingText).toMatch(/meno dell'1%|1%/);
    expect(view.energy?.prefix).toBe("almeno ");
  });

  it("l'energia, presente in ogni voce, non compare tra i dati mancanti", () => {
    const view = dayNutritionView(computeIntake(completeDay("2026-11-10"), resolverFor()).days[0], "2026-11-10");
    expect(view.energy?.prefix).toBe("");
    expect(view.missingText ?? "").not.toMatch(/energia/);
  });

  it("nel confronto il titolo dice «almeno» e la quota mancante si vede a riga chiusa", () => {
    const events: AnyEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(...completeDay(`2026-11-${String(10 + i).padStart(2, "0")}`, [{ name: "Cibo misterioso", quantityText: "10 g" }]));
    const intake = computeIntake(events, resolverFor());
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    const partial = rows.compared.filter((r) => r.partial);
    expect(partial.length).toBeGreaterThan(0);
    for (const r of partial) {
      expect(r.headline.toLowerCase()).toMatch(/^almeno /);
      expect(r.missingShort).toMatch(/^dato mancante /);
      expect(r.missingText).toBeTruthy();
    }
    for (const r of rows.compared.filter((x) => !x.partial)) expect(r.headline.toLowerCase()).not.toMatch(/^almeno /);
  });

  it("la quota mancante non si arrotonda a niente", () => {
    expect(missingPercentText(0.12)).toBe("12%");
    expect(missingPercentText(0.001)).toBe("meno dell'1%");
    expect(missingPercentText(0)).toBe("0%");
  });
});
