// Che cosa si sincronizza e che cosa resta sempre sul dispositivo.
import { validateAnyEvent } from "../events";

/**
 * Si sincronizzano solo gli eventi del registro, cioè ciò che passa `validateAnyEvent` (tutte le
 * famiglie, comprese quelle aggiunte in futuro). Le impostazioni non viaggiano mai con la
 * sincronizzazione: alcune sono segrete o legate al dispositivo, le altre si copiano con il file
 * delle impostazioni.
 */
export function isSyncableEvent(value: unknown): boolean {
  return validateAnyEvent(value).length === 0;
}

/** Prefissi e chiavi delle impostazioni che non devono mai lasciare il dispositivo. */
export const NEVER_SYNCED_SETTING_PREFIXES = ["ai.", "appearance.", "sync."] as const;
export const NEVER_SYNCED_SETTING_KEYS = ["deviceId"] as const;

export function isNeverSyncedSetting(key: string): boolean {
  return (
    (NEVER_SYNCED_SETTING_KEYS as readonly string[]).includes(key) ||
    NEVER_SYNCED_SETTING_PREFIXES.some((p) => key.startsWith(p))
  );
}

export type ScopeItemId =
  | "events"
  | "ai"
  | "token"
  | "appearance"
  | "passphrase"
  | "device"
  | "otherSettings"
  | "photos";

export interface ScopeItem {
  id: ScopeItemId;
  synced: boolean;
}

/** Elenco per la schermata: l'ordine è quello di lettura. */
export const SYNC_SCOPE: readonly ScopeItem[] = [
  { id: "events", synced: true },
  { id: "ai", synced: false },
  { id: "token", synced: false },
  { id: "passphrase", synced: false },
  { id: "appearance", synced: false },
  { id: "device", synced: false },
  { id: "otherSettings", synced: false },
  { id: "photos", synced: false },
];
