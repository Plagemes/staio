import { describe, expect, it } from "vitest";
import { formFromTargets, parseAmount, referenceHint, targetsFromForm } from "./targets";

describe("targets", () => {
  it("legge i numeri all'italiana", () => {
    expect(parseAmount("90")).toBe(90);
    expect(parseAmount("1,5")).toBe(1.5);
    expect(parseAmount("1.800")).toBe(1800);
    expect(parseAmount("1.800,5")).toBe(1800.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
  });

  it("parte da campi vuoti: nessun obiettivo predefinito", () => {
    const form = formFromTargets(undefined);
    expect(form.proteinG).toEqual({ min: "", max: "" });
    expect(targetsFromForm(form)).toEqual({ ok: true, targets: {} });
  });

  it("trasforma i campi compilati e li rimanda indietro", () => {
    const form = formFromTargets(undefined);
    form.proteinG = { min: "90", max: "" };
    form.energyKcal = { min: "1.800", max: "2.200" };
    const r = targetsFromForm(form);
    expect(r).toEqual({ ok: true, targets: { proteinG: { min: 90 }, energyKcal: { min: 1800, max: 2200 } } });
    if (r.ok) expect(formFromTargets(r.targets).energyKcal).toEqual({ min: "1800", max: "2200" });
  });

  it("segnala numeri non validi e minimi sopra i massimi", () => {
    const form = formFromTargets(undefined);
    form.proteinG = { min: "x", max: "" };
    form.fatG = { min: "80", max: "60" };
    const r = targetsFromForm(form);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["fatG", "proteinG"]);
  });

  it("il riferimento è solo un'informazione e non c'è per l'energia", () => {
    const source = { body: "EFSA", document: "x", url: "x" };
    const resolved = [
      { reference: { nutrient: "proteinG", kind: "PRI", ageMin: 18, amount: 63, source } },
      { reference: { nutrient: "energyKcal", kind: "AI", ageMin: 18, amount: 2000, source } },
    ];
    expect(referenceHint(resolved as never, "proteinG")).toContain("63 g");
    expect(referenceHint(resolved as never, "energyKcal")).toBeUndefined();
    expect(referenceHint(resolved as never, "fiberG")).toBeUndefined();
  });
});
