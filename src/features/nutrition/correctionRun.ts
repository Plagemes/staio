// Il cambio d'alimento di una voce già registrata, senza React né archivio: chi lo usa passa come si legge il
// registro, come si scrive e che cosa si dice. Così si prova da solo.
import type { AnyEvent } from "@/core/events";
import type { FoodOption } from "./candidates";
import { correctMealItems } from "./corrections";
import type { LineRefs } from "./prepare";
import { overrideKeyOf, type FoodOverrides } from "./resolver";

export interface CorrectionDeps {
  /** Il registro dell'archivio, letto adesso: non quello a schermo, che un altro telefono può aver superato. */
  readLog: () => Promise<readonly AnyEvent[]>;
  append: (events: AnyEvent[]) => Promise<{ rejected: readonly unknown[] }>;
  deviceId: () => Promise<string>;
  saveOverrides: (next: FoodOverrides) => Promise<void>;
  notify: (n: { message: string; undo?: AnyEvent[] }) => void;
  now: () => string;
  /** Vero mentre una scrittura è in corso: un secondo tocco non scrive niente. */
  busy: { current: boolean };
}

/** Restituisce un messaggio d'errore, o null se è andata bene (o se una scrittura era già in corso). */
export async function runCorrection(
  deps: CorrectionDeps,
  overrides: FoodOverrides,
  refs: LineRefs,
  label: string,
  option: FoodOption,
): Promise<string | null> {
  if (deps.busy.current) return null;
  deps.busy.current = true;
  try {
    let wroteMeal = false;
    if (refs.mealRefs.length > 0) {
      const log = await deps.readLog();
      const result = correctMealItems(log, refs.mealRefs, option.id, { now: deps.now(), deviceId: await deps.deviceId() });
      if (!result.ok) return result.error;
      const written = await deps.append(result.events);
      if (written.rejected.length > 0) return "Non sono riuscito a salvare la correzione.";
      deps.notify({ message: `Alimento aggiornato: «${label}» è «${option.name}».`, undo: result.events });
      wroteMeal = true;
    }
    if (refs.pantry) {
      await deps.saveOverrides({ ...overrides, [overrideKeyOf(label)]: option.id });
      if (!wroteMeal) deps.notify({ message: `Ricorderò «${label}» come «${option.name}».` });
    }
    return null;
  } catch {
    return "Non sono riuscito a salvare la scelta. Riprova.";
  } finally {
    deps.busy.current = false;
  }
}
