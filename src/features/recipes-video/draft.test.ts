import { describe, expect, it } from "vitest";
import { parseVideoRecipe } from "@/core/ai/videoRecipeParse";
import { captionHasRecipe, draftFromCaption, draftFromReading } from "./draft";

const CAPTION = `Pasta al pomodoro veloce

Ingredienti
320 g spaghetti
400 ml passata
2 spicchi d'aglio
sale q.b.

Preparazione
Cuoci la pasta per 10 minuti.
Scalda la passata con l'aglio.
Unisci e servi.

#pasta #ricetta #facile`;

describe("didascalia", () => {
  it("riconosce una didascalia che contiene la ricetta", () => {
    expect(captionHasRecipe(CAPTION)).toBe(true);
  });
  it("non scambia commenti e hashtag per una ricetta", () => {
    expect(captionHasRecipe("")).toBe(false);
    expect(captionHasRecipe("Che bontà!!! Provatela subito #food #yummy")).toBe(false);
    expect(captionHasRecipe("Ricetta completa nei commenti, link in bio")).toBe(false);
  });
  it("la bozza conserva il link originale come fonte", () => {
    const d = draftFromCaption(CAPTION, "https://www.instagram.com/reel/abc/");
    expect(d?.origin?.url).toBe("https://www.instagram.com/reel/abc/");
    expect(d?.ingredients.length).toBeGreaterThanOrEqual(3);
    expect(d?.steps.length).toBeGreaterThanOrEqual(2);
  });
  it("senza niente di leggibile non c'è bozza", () => {
    expect(draftFromCaption("   ")).toBeNull();
  });
});

describe("lettura del video", () => {
  const reading = parseVideoRecipe(
    JSON.stringify({
      isRecipe: true,
      title: "Frittata",
      ingredients: [{ name: "uova", quantity: 4 }, { name: "sale" }, { name: "erba cipollina", inferred: true }],
      steps: [{ text: "Sbatti le uova." }],
    }),
  );

  it("porta la fonte e lascia assenti le quantità assenti", () => {
    const r = draftFromReading(reading, "https://youtu.be/abc");
    expect(r?.draft.origin).toEqual({ url: "https://youtu.be/abc" });
    expect(r?.draft.ingredients[1]).toMatchObject({ name: "sale", recognized: false });
    expect(r?.draft.ingredients[1]?.quantity).toBeUndefined();
    expect(r?.draft.servings).toBeUndefined();
    expect(r?.notes.some((n) => n.includes("erba cipollina"))).toBe(true);
  });

  it("senza ricetta non c'è bozza", () => {
    expect(draftFromReading(parseVideoRecipe('{"isRecipe":false}'))).toBeNull();
  });
});
