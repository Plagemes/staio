// Frasi per l'esito di un'importazione: logica pura, provata nei test.
import type { ImportBackupResult } from "@/data";

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
  if (parts.length === 0) return { ok: true, text: "Questa copia era già sul telefono: non c'è niente di nuovo." };
  return { ok: true, text: `${parts.join(". ")}.` };
}
