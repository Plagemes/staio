// Quando è stata fatta l'ultima copia di sicurezza. Conta solo la copia degli eventi, cioè di ciò che hai registrato:
// la copia delle impostazioni non la aggiorna, altrimenti la riga direbbe «Ultima copia: oggi» senza che gli eventi
// siano mai stati copiati.
import { exportSettings, setSetting, type SettingsExport } from "@/data";

/** Impostazione di questo telefono: non entra nella copia delle impostazioni (vedi `data/settings.ts`). */
export const LAST_EXPORT_KEY = "backup.lastExportAt";

/** La copia degli eventi è stata scritta: se la data non si scrive, la copia resta buona e la riga dice «Mai fatta». */
export async function rememberEventsBackup(now: () => Date = () => new Date()): Promise<void> {
  try {
    await setSetting(LAST_EXPORT_KEY, now().toISOString());
  } catch {
    // niente da dire: il file è già stato scritto
  }
}

/** La copia delle impostazioni: non tocca la data dell'ultima copia di sicurezza. */
export function exportSettingsCopy(): Promise<SettingsExport> {
  return exportSettings();
}
