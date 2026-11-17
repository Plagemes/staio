"use client";

import { appendEvents, getDeviceId, useEventLog } from "@/data";
import { useNotice } from "../notice";
import type { FoodOption } from "./candidates";
import { correctMealItems } from "./corrections";
import type { LineRefs } from "./prepare";
import { overrideKeyOf, type FoodOverrides } from "./resolver";
import { saveFoodOverrides } from "./useNutrition";

/**
 * Cambia l'alimento di una voce già registrata. Per le voci libere di un pasto si scrive una correzione del
 * pasto (con «Annulla»); per i consumi di dispensa resta la scelta ricordata per nome nelle impostazioni locali.
 * Restituisce un messaggio d'errore, o null se è andata bene.
 */
export function useFoodCorrection(overrides: FoodOverrides) {
  const log = useEventLog();
  const notice = useNotice();

  return async function apply(refs: LineRefs, label: string, option: FoodOption): Promise<string | null> {
    try {
      const messages: string[] = [];
      if (refs.mealRefs.length > 0) {
        if (!log.data) return "I dati non sono ancora pronti. Riprova.";
        const result = correctMealItems(log.data, refs.mealRefs, option.id, { now: new Date().toISOString(), deviceId: await getDeviceId() });
        if (!result.ok) return result.error;
        const written = await appendEvents(result.events);
        if (written.rejected.length > 0) return "Non sono riuscito a salvare la correzione.";
        notice.show({ message: `Alimento aggiornato: «${label}» è «${option.name}».`, undo: result.events });
        messages.push("meal");
      }
      if (refs.pantry) {
        await saveFoodOverrides({ ...overrides, [overrideKeyOf(label)]: option.id });
        if (messages.length === 0) notice.show({ message: `Ricorderò «${label}» come «${option.name}».` });
      }
      return null;
    } catch {
      return "Non sono riuscito a salvare la scelta. Riprova.";
    }
  };
}
