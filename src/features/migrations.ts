// Migrazioni dei dati locali, scritte come funzioni pure: restituiscono gli eventi da aggiungere.
import type { AnyEvent } from "@/core/events";
import { correctLot, derivePantry, type LedgerEvent } from "@/core/ledger";
import { findCreationEvent } from "./actions";
import { ledgerEventsOf } from "./events";

export const BARCODE_MIGRATION_KEY = "migrations.barcodeFromNote";

/**
 * La nota degli eventi che l'app scrive da sola, senza un tocco dell'utente (una migrazione dei dati). «Ultime azioni»
 * mostra solo ciò che l'utente ha fatto: questi eventi restano fuori dall'elenco.
 */
export const AUTOMATIC_NOTE = "automatico";

/**
 * Il testo esatto che la cattura scriveva nella nota prima del campo `barcode`: "Codice a barre N",
 * eventualmente seguito da " · marca". La nota di una riga di scontrino inizia con "Riga scontrino:" e non
 * corrisponde, così come qualunque testo che contenga il codice altrove.
 */
const LEGACY_NOTE = /^Codice a barre (\d{8,14})(?: · [^\n]*)?$/;

export function legacyBarcodeOfNote(note: string | undefined): string | undefined {
  return note ? LEGACY_NOTE.exec(note)?.[1] : undefined;
}

/**
 * Per i lotti senza `barcode` la cui nota di creazione è quella scritta dalla cattura, un `updateLot` che
 * imposta il codice. Un lotto che ha già il codice, o la cui creazione è annullata, non produce niente:
 * rifarlo dà una lista vuota.
 *
 * Si salta ogni lotto in cui il codice della nota potrebbe non valere più: il nome attuale è diverso da quello
 * dell'ingresso (potrebbe essere un altro prodotto), c'è un `updateLot` che tocca `barcode` (anche per toglierlo, anche
 * se poi annullato), o una correzione dell'ingresso che ha cambiato il `barcode` (o di cui non si trova l'originale).
 */
export function legacyBarcodeUpdates(
  events: readonly AnyEvent[],
  ctx: { now: string; deviceId: string },
): LedgerEvent[] {
  const state = derivePantry(ledgerEventsOf(events));
  const touched = new Set<string>();
  for (const e of events) if (e.type === "updateLot" && e.patch.barcode !== undefined) touched.add(e.lotId);
  const byId = new Map(events.map((e) => [e.id, e]));

  const out: LedgerEvent[] = [];
  for (const lot of state.lots) {
    if (lot.barcode || touched.has(lot.lotId)) continue;
    const creation = findCreationEvent(events, lot.lotId, state.voidedEventIds);
    const code = legacyBarcodeOfNote(creation?.note);
    if (!creation || !code) continue;
    if (lot.productRef !== creation.productRef) continue;
    if (creation.replaces !== undefined) {
      const original = byId.get(creation.replaces);
      const originalBarcode = original && (original.type === "purchase" || original.type === "declare") ? original.barcode : undefined;
      // l'originale non c'è più, o aveva un codice diverso da quello della correzione: non si indovina
      if (!original || originalBarcode !== creation.barcode) continue;
    }
    for (const e of correctLot(creation, { barcode: code }, { lot, deviceId: ctx.deviceId, now: () => ctx.now })) {
      out.push({ ...e, note: AUTOMATIC_NOTE });
    }
  }
  return out;
}
