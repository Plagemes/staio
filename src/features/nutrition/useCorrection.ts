"use client";

import { useRef } from "react";
import { appendEvents, getAllEvents, getDeviceId } from "@/data";
import { useNotice } from "../notice";
import type { FoodOption } from "./candidates";
import { runCorrection } from "./correctionRun";
import type { LineRefs } from "./prepare";
import type { FoodOverrides } from "./resolver";
import { saveFoodOverrides } from "./useNutrition";

/**
 * Cambia l'alimento di una voce già registrata. Per le voci libere di un pasto si scrive una correzione del
 * pasto (con «Annulla»), partendo dal registro dell'archivio riletto in quel momento; per i consumi di dispensa resta
 * la scelta ricordata per nome nelle impostazioni locali. Un secondo tocco durante la scrittura non scrive niente.
 * Restituisce un messaggio d'errore, o null se è andata bene.
 */
export function useFoodCorrection(overrides: FoodOverrides) {
  const notice = useNotice();
  const busy = useRef(false);

  return function apply(refs: LineRefs, label: string, option: FoodOption): Promise<string | null> {
    return runCorrection(
      {
        readLog: getAllEvents,
        append: appendEvents,
        deviceId: getDeviceId,
        saveOverrides: saveFoodOverrides,
        notify: (n) => notice.show(n),
        now: () => new Date().toISOString(),
        busy,
      },
      overrides,
      refs,
      label,
      option,
    );
  };
}
