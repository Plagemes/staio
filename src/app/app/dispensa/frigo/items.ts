import { MODEL_CATEGORY_OF } from "@/features/labels";
import { expiryTagView, isExpiring, isFoodCategory, levelPercent, type PantryEntry } from "@/features/lots";
import { recipeForUnknown } from "@/models3d/fallback";
import type { SceneItem } from "@/models3d/fridge/fridge-engine";

const DRAWER_CATEGORIES = new Set(["frutta", "verdura", "erbe"]);
const DOOR_CATEGORIES = new Set(["bevande", "condimenti"]);
/** Bottiglie e cartoni stanno nei balconcini dello sportello. */
const DOOR_ID = /bottiglia|brick|latte|succo|bibita|acqua|birra|vino|olio|aceto|spumante|sciroppo|kefir/;

/** Due varianti per ricetta, scelte dal lotto: alimenti uguali condividono la geometria. */
function variantOf(lotId: string): number {
  let sum = 0;
  for (let i = 0; i < lotId.length; i++) sum = (sum + lotId.charCodeAt(i)) % 1009;
  return sum % 2;
}

/**
 * Alimenti per la scena, dall'elenco già in ordine «da mangiare prima»: la priorità è la posizione nell'elenco.
 * Scade presto (già scaduto o entro tre giorni) = colore segnale.
 */
export function sceneItemsFor(entries: readonly PantryEntry[]): SceneItem[] {
  return entries.map((entry, index) => {
    const { lot } = entry;
    const recipe = recipeForUnknown({
      name: lot.productRef,
      category: isFoodCategory(lot.category) ? MODEL_CATEGORY_OF[lot.category] : undefined,
      quantity: { value: lot.initial, unit: lot.unit },
    }).recipe;
    const tag = expiryTagView(entry);
    return {
      id: lot.lotId,
      name: lot.productRef,
      recipe,
      seed: `${recipe.id}:${variantOf(lot.lotId)}`,
      signal: isExpiring(entry),
      level: levelPercent(lot) / 100,
      priority: index,
      prefer: DRAWER_CATEGORIES.has(recipe.category) ? "drawer" : DOOR_CATEGORIES.has(recipe.category) || DOOR_ID.test(recipe.id) ? "door" : undefined,
      caption: tag ? `${lot.productRef}, ${tag.text}` : `${lot.productRef}, senza data`,
    };
  });
}
