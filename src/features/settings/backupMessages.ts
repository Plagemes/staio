// Frasi per l'esito di un'importazione: logica pura, provata nei test.
import { restoredConfirmationsNotice } from "@/core/allergens";
import type { ImportBackupResult, ImportSettingsResult } from "@/data";

export function describeImport(result: ImportBackupResult): { ok: boolean; text: string } {
  if (!result.ok) {
    switch (result.error) {
      case "invalid_json":
        return { ok: false, text: "Il file non si legge: non è un JSON valido." };
      case "unsupported_version":
      case "invalid_version":
        return { ok: false, text: "La copia viene da una versione più recente dell'app. Aggiorna l'app e riprova." };
      case "invalid_events":
        return { ok: false, text: "La copia non contiene eventi leggibili." };
      default:
        return { ok: false, text: "Questo file non è una copia dei dati di questa app." };
    }
  }
  const parts: string[] = [];
  if (result.added > 0) parts.push(result.added === 1 ? "1 evento nuovo importato" : `${result.added} eventi nuovi importati`);
  if (result.conflicts.length > 0) {
    parts.push(
      result.conflicts.length === 1
        ? "1 evento era diverso da quello sul telefono: tenuta una sola versione"
        : `${result.conflicts.length} eventi erano diversi da quelli sul telefono: tenuta una sola versione`,
    );
  }
  if (result.rejected.length > 0) {
    parts.push(
      result.rejected.length === 1 ? "1 evento scartato perché non valido" : `${result.rejected.length} eventi scartati perché non validi`,
    );
  }
  const confirmations = restoredConfirmationsNotice(result.allergenConfirmations ?? 0);
  const tail = confirmations ? ` ${confirmations}` : "";
  if (parts.length === 0) return { ok: true, text: `Questa copia era già sul telefono: non c'è niente di nuovo.${tail}` };
  return { ok: true, text: `${parts.join(". ")}.${tail}` };
}

/** Esito dell'importazione delle sole impostazioni (mai le chiavi dell'AI). */
export function describeSettingsImport(result: ImportSettingsResult): { ok: boolean; text: string } {
  if (!result.ok) {
    switch (result.error) {
      case "invalid_json":
        return { ok: false, text: "Il file non si legge: non è un JSON valido." };
      case "unsupported_version":
        return { ok: false, text: "Queste impostazioni vengono da una versione più recente dell'app. Aggiorna l'app e riprova." };
      case "invalid_settings":
        return { ok: false, text: "Il file non contiene impostazioni leggibili." };
      default:
        return { ok: false, text: "Questo file non è una copia delle impostazioni di questa app." };
    }
  }
  const imported = result.imported === 1 ? "1 impostazione importata" : `${result.imported} impostazioni importate`;
  const skipped = result.skipped > 0 ? ` ${result.skipped === 1 ? "Una voce è stata ignorata" : `${result.skipped} voci sono state ignorate`}: le chiavi dell'intelligenza artificiale non si importano mai.` : "";
  return { ok: true, text: `${imported}.${skipped}` };
}
