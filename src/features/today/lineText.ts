// Che cosa dice Oggi di un alimento della dispensa dentro un pasto: i nutrienti che conta, o «senza dato». Funzioni pure.
import type { IntakeLine } from "@/core/nutrition";
import { formatNutrient } from "../nutrition/labels";

/**
 * «~120 kcal · 24 g proteine», con la tilde se il valore è una stima; «senza dato» se l'alimento non ha valori
 * nutrizionali (non vale zero: resta fuori dai totali). `undefined` se il calcolo non è ancora pronto.
 */
export function lineNutrientText(line: IntakeLine | undefined): string | undefined {
  if (!line) return undefined;
  if (line.status !== "ok") return "senza dato";
  const tilde = line.certainty === "estimated" ? "~" : "";
  const parts: string[] = [];
  const { energyKcal, proteinG } = line.nutrients;
  if (typeof energyKcal === "number") parts.push(`${tilde}${formatNutrient("energyKcal", energyKcal)}`);
  if (typeof proteinG === "number") parts.push(`${tilde}${formatNutrient("proteinG", proteinG)} proteine`);
  return parts.length > 0 ? parts.join(" · ") : "senza dato";
}
