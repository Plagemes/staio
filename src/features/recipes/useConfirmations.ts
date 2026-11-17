"use client";

// Le conferme dell'utente sugli ingredienti non verificabili: lettura dal registro e scrittura di conferma e revoca.
// Una conferma è una dichiarazione dell'utente: l'app non verifica nulla. Si dà per un ingrediente alla volta.
import { useCallback, useMemo } from "react";
import {
  confirmationKey,
  confirmIngredient,
  deriveConfirmations,
  revokeConfirmation,
  type ConfirmationMap,
  type ConfirmationRefusal,
  type ConfirmationsState,
  type DeclaredCriteria,
  type ItemSubject,
} from "@/core/allergens";
import { appendEvents, getAllEvents, getDeviceId, useEventLog } from "@/data";
import { useNotice } from "../notice";

/** Le conferme attive. `undefined` finché il registro non è letto: in quel caso nessuna schermata deve dare un esito. */
export function useConfirmations(): { state: ConfirmationsState | undefined; byKey: ConfirmationMap | undefined } {
  const log = useEventLog();
  const state = useMemo(() => (log.data ? deriveConfirmations(log.data) : undefined), [log.data]);
  return { state, byKey: state?.byKey };
}

const REFUSALS: Record<ConfirmationRefusal, string> = {
  nothing_declared: "Non hai dichiarato nessun allergene: non c'è niente da confermare.",
  contains: "Qui c'è qualcosa che hai dichiarato: non si può confermare.",
  not_uncertain: "Su questo ingrediente non ho dubbi: non serve confermarlo.",
  no_name: "L'ingrediente non ha un nome.",
  mixed_script: "Il testo ha lettere di alfabeti diversi: riscrivilo, poi potrai confermarlo.",
  invalid: "Non sono riuscito a registrare la conferma.",
};

export interface ConfirmationActions {
  /** Registra «ho letto l'etichetta, per me va bene» per un ingrediente. Restituisce il testo dell'errore, o `null`. */
  confirm: (item: ItemSubject, criteria: DeclaredCriteria) => Promise<string | null>;
  /** Ritira la conferma. Restituisce il testo dell'errore, o `null`. */
  revoke: (key: string, ingredient: string) => Promise<string | null>;
}

export function useConfirmationActions(): ConfirmationActions {
  const notice = useNotice();
  const confirm = useCallback<ConfirmationActions["confirm"]>(
    async (item, criteria) => {
      try {
        // la conferma scrive un istante dopo l'ultima revoca nota per questo ingrediente: con l'orologio indietro non è ritirata
        const revokedAt = deriveConfirmations(await getAllEvents()).revokedAt.get(confirmationKey(item));
        const result = confirmIngredient(item, criteria, { deviceId: await getDeviceId(), ...(revokedAt ? { notBefore: revokedAt } : {}) });
        if (!result.ok) return REFUSALS[result.reason];
        const written = await appendEvents([result.event]);
        if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
        notice.show({ message: `Confermato da te: «${item.name.trim()}». L'app non ha verificato nulla.`, undo: [result.event] });
        return null;
      } catch {
        return "Non sono riuscito a salvare sul telefono. Riprova.";
      }
    },
    [notice],
  );
  const revoke = useCallback<ConfirmationActions["revoke"]>(
    async (key, ingredient) => {
      try {
        // la revoca cita tutte le conferme valide di quella chiave note adesso: vale qualunque sia l'orologio dei dispositivi
        const record = deriveConfirmations(await getAllEvents()).byKey.get(key);
        if (!record) return "Questa conferma non c'è più.";
        const event = revokeConfirmation(key, ingredient, { deviceId: await getDeviceId() }, record.eventIds);
        if (!event) return "Non sono riuscito a revocare la conferma.";
        const written = await appendEvents([event]);
        if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
        notice.show({ message: `Conferma revocata: «${ingredient}» torna da verificare.`, undo: [event] });
        return null;
      } catch {
        return "Non sono riuscito a salvare sul telefono. Riprova.";
      }
    },
    [notice],
  );
  return useMemo(() => ({ confirm, revoke }), [confirm, revoke]);
}
