// Costruttori di eventi per i test del ricettario.
import type { EventBase } from "../ledger";
import type { RecipeEvent } from "./types";

type Fields = Partial<Omit<RecipeEvent, "type">>;

export function recipeEvent(id: string, recordedAt: string, fields: Fields = {}): RecipeEvent {
  return {
    id,
    type: "recipe",
    at: recordedAt,
    recordedAt,
    deviceId: "dev-a",
    schemaVersion: 1,
    certainty: "label",
    source: "manual",
    recipeId: "r1",
    title: "Pasta al pomodoro",
    servings: 4,
    ingredients: [
      { name: "Spaghetti", quantity: { value: 320, unit: "g" }, foodId: "pasta-semola-secca" },
      { name: "Passata di pomodoro", quantity: { value: 400, unit: "ml" } },
      { name: "Sale", note: "q.b." },
    ],
    steps: [{ text: "Cuocere la pasta per 10 minuti.", durationMinutes: 10 }, { text: "Condire." }],
    ...fields,
  };
}

export function voidEvent(
  id: string,
  recordedAt: string,
  targetEventId: string,
  extra: Partial<EventBase> = {},
) {
  return {
    id,
    type: "void" as const,
    at: recordedAt,
    recordedAt,
    deviceId: "dev-a",
    schemaVersion: 1 as const,
    certainty: "measured" as const,
    source: "manual" as const,
    targetEventId,
    ...extra,
  };
}
