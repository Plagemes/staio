// Salvataggio di un acquisto: lo usano il modulo a mano e l'aggiunta diretta dalla scheda del prodotto.
import type { AnyEvent } from "@/core/events";
import type { LedgerEvent } from "@/core/ledger";
import { buildUndo } from "../actions";
import { buildCaptureEvents, type CaptureInput, type FieldErrors } from "../capture";

export interface SaveDeps {
  appendEvents: (events: readonly AnyEvent[]) => Promise<{ added: number }>;
  getDeviceId: () => Promise<string>;
  /** Istante corrente ISO UTC. */
  now: () => string;
}

export type SaveResult =
  | { ok: true; events: LedgerEvent[]; lotId: string; summary: string }
  | { ok: false; errors: FieldErrors };

/** Verifica i dati, scrive l'evento nel registro e restituisce gli eventi scritti. Non lancia per i dati non validi. */
export async function saveCapture(input: CaptureInput, deps: SaveDeps): Promise<SaveResult> {
  const result = buildCaptureEvents(input, { now: deps.now(), deviceId: await deps.getDeviceId() });
  if (!result.ok) return result;
  const written = await deps.appendEvents(result.events);
  if (written.added === 0) return { ok: false, errors: { form: "Non sono riuscito a salvare. Riprova." } };
  return result;
}

/** Annulla gli eventi appena scritti con un evento `void` ciascuno: il registro non cancella niente. */
export async function undoCapture(events: readonly AnyEvent[], deps: SaveDeps): Promise<void> {
  const written = await deps.appendEvents(buildUndo(events, { now: deps.now(), deviceId: await deps.getDeviceId() }));
  if (written.added === 0) throw new Error("annullamento non scritto");
}

/**
 * Mentre un'azione è in corso, una seconda chiamata riceve la stessa promessa invece di farne partire un'altra:
 * un doppio tocco non scrive due lotti.
 */
export function singleFlight<A extends unknown[], T>(action: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let pending: Promise<T> | null = null;
  return (...args) => {
    if (pending) return pending;
    const run = action(...args).finally(() => {
      pending = null;
    });
    pending = run;
    return run;
  };
}
