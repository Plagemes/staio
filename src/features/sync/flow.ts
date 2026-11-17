// Passi della schermata, decisi senza React per poterli provare.
import type { SyncReport } from "@/core/sync";

export type PassphraseStep = "connect" | "create" | "unlock" | "ready";

export interface PassphraseState {
  /** Drive è configurato in questa build. */
  driveReady: boolean;
  /** L'utente ha scelto di non usare Drive su questo dispositivo (solo file). */
  driveSkipped: boolean;
  /** Chiavi trovate su Drive; `null` finché non ci si è collegati e non le si è lette. */
  remoteKeys: number | null;
  /** Chiavi già su questo dispositivo. */
  localKeys: number;
  keysReady: boolean;
  /** L'ultima sincronizzazione con Drive ha trovato una chiave corrente diversa da quella locale. */
  remoteMismatch: boolean;
}

/**
 * Una chiave nuova si crea solo quando si sa che non ne esiste nessuna: con Drive configurato
 * bisogna prima collegarsi e leggere le chiavi che ci sono, altrimenti un errore di battitura
 * sul secondo dispositivo creerebbe una chiave diversa da quella del primo.
 */
export function passphraseStep(s: PassphraseState): PassphraseStep {
  // La frase giusta si verifica contro le chiavi di Drive: prima vanno lette.
  if (s.remoteMismatch) return s.remoteKeys === null ? "connect" : "unlock";
  if (s.keysReady) return "ready";
  if (s.localKeys > 0 || (s.remoteKeys ?? 0) > 0) return "unlock";
  if (s.remoteKeys === 0 || !s.driveReady || s.driveSkipped) return "create";
  return "connect";
}

/**
 * Modulo "un'altra frase per leggere dati più vecchi": ogni volta che restano blocchi cifrati con
 * una chiave che il dispositivo non ha. Con `key_mismatch` c'è già il modulo di sblocco principale.
 */
export function showReadOlderForm(report: Pick<SyncReport, "status" | "error" | "locked"> | undefined): boolean {
  return report !== undefined && report.locked > 0 && report.error !== "key_mismatch";
}

/** Detto prima di preparare il file, non dopo. */
export function exportNotice(encrypt: boolean): string {
  return encrypt
    ? "Il file sarà cifrato con la frase segreta: per aprirlo servirà la stessa frase."
    : "Il file non sarà cifrato: chi lo riceve può leggere tutto il registro. Mandalo solo a te stesso e cancellalo dopo.";
}
