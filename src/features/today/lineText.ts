// Che cosa dice Oggi di un alimento della dispensa dentro un pasto: i nutrienti che conta, o «senza dato». Funzioni pure.
import { DIET_GROUPS, type ClassBasis, type DietGroup, type LineClass, type ProcessingLevel } from "@/core/diet";
import type { IntakeLine } from "@/core/nutrition";
import type { LineMark } from "../diet/inputs";
import { lineMarkText, partClassText } from "../diet/texts";
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

/** Il segno sulla riga, dopo i nutrienti: «· molto lavorato ~». Niente segno se la riga non è da segnare. */
export function lineMarkSuffix(mark: LineMark | undefined): string | undefined {
  return mark ? `· ${lineMarkText(mark)}` : undefined;
}

/** Una parte della classificazione di una riga, come si legge nella scheda della voce. */
export interface ClassLine {
  /** Il nome dell'ingrediente, solo se la riga ne ha più d'una parte. */
  label?: string;
  /** «Legumi ~ · non lavorato o poco ~». */
  text: string;
}

const MAX_CLASS_LINES = 4;

/**
 * «Come la conto»: una riga per una voce semplice; per una preparazione una riga per ingrediente (al massimo 4, più
 * «e altri»). Vuoto finché la classificazione non è pronta.
 */
export function classLinesOf(cls: Pick<LineClass, "parts"> | undefined): { lines: ClassLine[]; more: number } {
  const parts = cls?.parts ?? [];
  if (parts.length === 0) return { lines: [], more: 0 };
  if (parts.length === 1) return { lines: [{ text: partClassText(parts[0]) }], more: 0 };
  const shown = parts.slice(0, MAX_CLASS_LINES).map((p) => ({ label: p.label, text: partClassText(p) }));
  return { lines: shown, more: parts.length - shown.length };
}

/** Da dove viene la classificazione: una preparazione dagli ingredienti, altrimenti dalla prima parte. */
export function classBasisOf(cls: Pick<LineClass, "parts"> | undefined): ClassBasis | undefined {
  const parts = cls?.parts ?? [];
  if (parts.length === 0) return undefined;
  return parts.some((p) => p.prepId !== undefined) ? "prep" : parts[0].basis;
}

/** Il valore di partenza del foglio di correzione: gruppo e lavorazione di una voce semplice. */
export function classCurrentOf(cls: Pick<LineClass, "parts"> | undefined): { group?: DietGroup; processing?: ProcessingLevel } {
  const part = cls?.parts.length === 1 ? cls.parts[0] : undefined;
  if (!part) return {};
  const group = (DIET_GROUPS as readonly string[]).includes(part.group) ? (part.group as DietGroup) : undefined;
  return { ...(group ? { group } : {}), ...(part.processing ? { processing: part.processing.level } : {}) };
}

/** La voce si può correggere dal foglio: ha una chiave e non è una preparazione scomposta. */
export function canCorrectClass(cls: Pick<LineClass, "parts" | "overrideKey"> | undefined): cls is Pick<LineClass, "parts" | "overrideKey"> & { overrideKey: string } {
  return cls?.overrideKey !== undefined && classBasisOf(cls) !== "prep" && classBasisOf(cls) !== "outOfHome";
}
