import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISSED_SETTING_KEY } from "@/core/briefing";
import type { AdviceAction } from "@/core/diet";
import { getSetting, setSetting, wipeAll } from "@/data";
import { SETTING_KEYS } from "../shopping/settings";
import { dismissAdvice, hrefOf, runAdviceAction, SHOPPING_PATH } from "./actions";
import { LEVEL_KEY, levelOf, saveDietLevel } from "./level";
import { DIET_PATH, dietHref, lineHref } from "./links";
import { CLASS_OVERRIDES_KEY, isClassOverrides, normalizeClassOverrides, saveClassOverride, withClassOverride } from "./overrides";

beforeEach(async () => {
  await wipeAll();
});

describe("correzioni di classificazione (quality.classOverrides)", () => {
  it("forma: chiavi b:/n:, gruppo noto, lavorazione 1..4", () => {
    expect(isClassOverrides({ "n:cracker": { group: "refinedGrains", processing: 4 }, "b:8001234567890": { processing: 3 } })).toBe(true);
    expect(isClassOverrides({ cracker: { group: "refinedGrains" } })).toBe(false);
    expect(isClassOverrides({ "n:x": { group: "pizza" } })).toBe(false);
    expect(isClassOverrides({ "n:x": { processing: 5 } })).toBe(false);
    expect(isClassOverrides({ "n:x": {} })).toBe(false);
    expect(normalizeClassOverrides({ "n:a": { group: "fish" }, bad: 1, "n:b": { processing: 9 } })).toEqual({ "n:a": { group: "fish" } });
    expect(normalizeClassOverrides(null)).toEqual({});
    expect(withClassOverride({ "n:a": { group: "fish" } }, "n:a", undefined)).toEqual({});
  });

  it("rilegge prima di scrivere: una correzione fatta altrove nel frattempo resta; «Annulla» rimette solo la sua chiave", async () => {
    await setSetting(CLASS_OVERRIDES_KEY, { "n:altro": { group: "fish" } });
    const { undo } = await saveClassOverride("n:cracker integrali", { group: "wholeGrains", processing: 4 });
    expect(await getSetting(CLASS_OVERRIDES_KEY)).toEqual({ "n:altro": { group: "fish" }, "n:cracker integrali": { group: "wholeGrains", processing: 4 } });
    // un'altra scrittura arriva prima dell'annullamento
    await setSetting(CLASS_OVERRIDES_KEY, { ...(await getSetting<object>(CLASS_OVERRIDES_KEY)), "n:terzo": { processing: 1 } });
    await undo();
    expect(await getSetting(CLASS_OVERRIDES_KEY)).toEqual({ "n:altro": { group: "fish" }, "n:terzo": { processing: 1 } });
  });

  it("«Torna alla stima» toglie la chiave; l'ultima tolta svuota l'impostazione; «Annulla» la rimette", async () => {
    await saveClassOverride("b:8001234567890", { processing: 3 });
    const { undo } = await saveClassOverride("b:8001234567890", undefined);
    expect(await getSetting(CLASS_OVERRIDES_KEY)).toBeUndefined();
    await undo();
    expect(await getSetting(CLASS_OVERRIDES_KEY)).toEqual({ "b:8001234567890": { processing: 3 } });
  });

  it("rifiuta chiavi e valori non validi", async () => {
    await expect(saveClassOverride("cracker", { group: "fish" })).rejects.toThrow();
    await expect(saveClassOverride("n:x", { processing: 7 as never })).rejects.toThrow();
  });
});

describe("livello energetico (quality.eaten.level)", () => {
  it("predefinito 2000; si cambia con «Annulla»", async () => {
    expect(levelOf(undefined)).toBe(2000);
    expect(levelOf(1800)).toBe(2000);
    const first = await saveDietLevel(2500);
    expect(await getSetting(LEVEL_KEY)).toBe(2500);
    const second = await saveDietLevel(1500);
    await second.undo();
    expect(await getSetting(LEVEL_KEY)).toBe(2500);
    await first.undo();
    expect(await getSetting(LEVEL_KEY)).toBeUndefined();
  });
});

describe("azioni dei consigli", () => {
  it("indirizzi", () => {
    expect(hrefOf({ kind: "cookWithPantry", foodName: "Ceci", lotIds: ["l"] })).toBe("/app/ricette/idee?alimento=Ceci");
    expect(hrefOf({ kind: "openRecipe", recipeId: "r 1", title: "x" })).toBe("/app/ricette/vedi?id=r%201");
    expect(hrefOf({ kind: "seeAlternative", fromBarcode: "1", fromName: "a", toBarcode: "8001234567890", toName: "b", dimension: "salt" })).toBe(
      "/app/qualita/prodotto?codice=8001234567890",
    );
    expect(hrefOf({ kind: "openDetail", anchor: "consigli" })).toBe(`${DIET_PATH}#consigli`);
    expect(hrefOf({ kind: "addToPlan", recipeId: "r", title: "x", servings: 2 })).toBeUndefined();
    expect(dietHref({ week: "2026-11-16", anchor: "come" })).toBe("/app/salute/mangiato?settimana=2026-11-16#come");
    expect(lineHref("ev1#2", "2026-11-20", "2026-11-25")).toBe("/app?giorno=2026-11-20&voce=ev1");
    expect(lineHref("ev1", "2026-11-25", "2026-11-25")).toBe("/app?voce=ev1");
  });

  it("«Metti nel piano» apre il foglio con la ricetta, senza scrivere", async () => {
    const notice = { show: vi.fn() };
    const action: AdviceAction = { kind: "addToPlan", recipeId: "r1", title: "Pasta e lenticchie", servings: 2 };
    expect(await runAdviceAction(action, { notice })).toEqual({ sheet: "plan", recipeId: "r1", servings: 2, title: "Pasta e lenticchie" });
    expect(notice.show).not.toHaveBeenCalled();
  });

  it("«Aggiungi alla spesa» scrive nella lista, con avviso, «Annulla» e «Apri la spesa»", async () => {
    const notice = { show: vi.fn() };
    const result = await runAdviceAction({ kind: "addToShopping", names: ["lenticchie"] }, { notice });
    expect(result).toEqual({ added: 1 });
    const list = await getSetting<{ product: string }[]>(SETTING_KEYS.manual);
    expect(list?.map((m) => m.product.toLowerCase())).toEqual(["lenticchie"]);
    const shown = notice.show.mock.calls[0][0];
    expect(shown.message).toBe("Aggiunto alla spesa: lenticchie");
    expect(shown.link).toEqual({ label: "Apri la spesa", href: SHOPPING_PATH });
    await shown.onUndo();
    expect(await getSetting(SETTING_KEYS.manual)).toEqual([]);
  });

  it("se la scrittura non riesce lo dice", async () => {
    const notice = { show: vi.fn() };
    const result = await runAdviceAction({ kind: "addToShopping", names: ["pesce"] }, { notice, addToList: () => Promise.reject(new Error("x")) });
    expect(result).toEqual({ failed: true });
    expect(notice.show.mock.calls[0][0].message).toMatch(/Riprova/);
  });

  it("«Lascia così» ricorda la chiave rileggendo la lista; «Annulla» toglie solo quella", async () => {
    await setSetting(DISMISSED_SETTING_KEY, ["catchup:x"]);
    const { undo } = await dismissAdvice("diet:legumesLow:2026-11-16");
    expect(await getSetting(DISMISSED_SETTING_KEY)).toEqual(["catchup:x", "diet:legumesLow:2026-11-16"]);
    await setSetting(DISMISSED_SETTING_KEY, [...((await getSetting<string[]>(DISMISSED_SETTING_KEY)) ?? []), "altro"]);
    await undo();
    expect(await getSetting(DISMISSED_SETTING_KEY)).toEqual(["catchup:x", "altro"]);
  });
});
