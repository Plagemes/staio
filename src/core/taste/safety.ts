// Gli abbinamenti proposti passano dal motore degli allergeni: `contains` esclude, `uncertain` si segnala.
import { FINDING_REASON_TEXT, allergenLabels, assessItem, itemMatchesExclusion, type ItemSubject } from "../allergens";
import type { PairingDoubt, TasteFood } from "./types";

export type PairingVerdict = { status: "excluded"; reason: string } | { status: "uncertain"; doubt: PairingDoubt } | { status: "clear" };

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

/**
 * Controlla un alimento dell'elenco: il nome e ciascun identificativo della tabella nutrizionale. Basta un `contains`
 * per escluderlo; un `uncertain` lo lascia in elenco con il segno di incertezza. `clear` non vuol dire «compatibile»:
 * il motore guarda solo i nomi.
 */
export function screenFood(
  food: TasteFood,
  options: { allergens?: readonly string[]; excludedFoods?: readonly string[] },
): PairingVerdict {
  const allergens = (options.allergens ?? []).filter((a) => a.trim() !== "");
  const subjects: ItemSubject[] = [{ name: food.name }, ...food.foodIds.map((id) => ({ name: food.name, foodId: id }))];

  for (const excluded of options.excludedFoods ?? []) {
    if (excluded.trim() === "") continue;
    if (subjects.some((s) => itemMatchesExclusion(s, excluded) !== undefined)) {
      return { status: "excluded", reason: `alimento escluso: ${excluded.trim()}` };
    }
  }
  if (allergens.length === 0) return { status: "clear" };

  const uncertain: { allergen: string; reason: string }[] = [];
  for (const subject of subjects) {
    const result = assessItem(subject, allergens);
    for (const f of result.findings) {
      if (f.verdict === "contains") return { status: "excluded", reason: `contiene ${allergenLabels([f.allergen])[0] ?? f.allergen}` };
      uncertain.push({ allergen: f.allergen, reason: FINDING_REASON_TEXT[f.reason] });
    }
  }
  if (uncertain.length === 0) return { status: "clear" };
  return {
    status: "uncertain",
    doubt: {
      allergens: unique(uncertain.flatMap((u) => allergenLabels([u.allergen]))),
      reasons: unique(uncertain.map((u) => u.reason)),
    },
  };
}
