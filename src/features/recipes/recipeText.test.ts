import { describe, expect, it, vi } from "vitest";
import { cookedSummary, haveText, shareRecipe, shareText, statusLine, stepsSummary } from "./recipeText";

describe("riga di stato", () => {
  it("dice tempo, porzioni e ciò che hai", () => {
    expect(statusLine({ minutes: 35, servings: 2, have: haveText({ total: 8, missing: 2, pending: 0 }) })).toBe("35 min · 2 porzioni · hai 6 ingredienti su 8");
  });
  it("senza tempo, senza quella parte", () => {
    expect(statusLine({ servings: 1, have: "hai tutto" })).toBe("1 porzione · hai tutto");
  });
  it("hai tutto solo se non manca niente e niente è da confermare", () => {
    expect(haveText({ total: 5, missing: 0, pending: 0 })).toBe("hai tutto");
    expect(haveText({ total: 5, missing: 0, pending: 1 })).toBe("hai 4 ingredienti su 5");
    expect(haveText({ total: 1, missing: 1, pending: 0 })).toBe("hai 0 ingredienti su 1");
    expect(haveText({ total: 0, missing: 0, pending: 0 })).toBeUndefined();
  });
});

describe("riassunti", () => {
  it("passi e volte cucinata", () => {
    expect(stepsSummary(7, 35)).toBe("7 passi · 35 min");
    expect(stepsSummary(1, undefined)).toBe("1 passo");
    expect(cookedSummary(3, "2 nov")).toBe("3 volte · ultima il 2 nov");
    expect(cookedSummary(1, undefined)).toBe("1 volta");
    expect(cookedSummary(0, undefined)).toBe("Non ancora cucinata");
  });
});

const RECIPE = {
  title: "Pasta al forno",
  servings: 4,
  ingredients: [
    { name: "Pasta", quantity: { value: 400, unit: "g" as const } },
    { name: "Basilico", note: "fresco" },
  ],
  steps: [{ text: "Cuoci la pasta." }, { text: "Inforna." }],
};

describe("shareText", () => {
  it("titolo, porzioni, ingredienti e passi, senza indirizzi", () => {
    const text = shareText(RECIPE as never, 2);
    expect(text).toBe("Pasta al forno\n2 porzioni\n\nIngredienti\n- 400 g Pasta\n- Basilico (fresco)\n\nPassi\n1. Cuoci la pasta.\n2. Inforna.");
    expect(text).not.toMatch(/https?:/);
  });
});

describe("shareRecipe", () => {
  const payload = { title: "T", text: "testo" };
  it("condivide se può", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareRecipe(payload, { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith(payload);
  });
  it("chiudere il foglio di condivisione non copia niente", async () => {
    const copy = vi.fn();
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    expect(await shareRecipe(payload, { share, copy })).toBe("cancelled");
    expect(copy).not.toHaveBeenCalled();
  });
  it("senza condivisione copia negli appunti", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    expect(await shareRecipe(payload, { copy })).toBe("copied");
    expect(copy).toHaveBeenCalledWith("testo");
  });
  it("se la condivisione fallisce prova gli appunti; se nemmeno quelli, lo dice", async () => {
    const share = vi.fn().mockRejectedValue(new Error("no"));
    expect(await shareRecipe(payload, { share, copy: vi.fn().mockResolvedValue(undefined) })).toBe("copied");
    expect(await shareRecipe(payload, { share, copy: vi.fn().mockRejectedValue(new Error("no")) })).toBe("failed");
    expect(await shareRecipe(payload, {})).toBe("failed");
  });
});
