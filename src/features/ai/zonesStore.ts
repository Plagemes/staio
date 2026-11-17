// Dove sta di solito ogni alimento (ripiano, sportello, cassetto), imparato dalle conferme dell'utente.
// Dato locale: sta nella tabella `settings` del dispositivo, come le altre impostazioni, e «Cancella tutti i dati» lo toglie.
import { normalizeZoneMap, recordZone, type ZoneMap, type ZoneObservation } from "@/core/ai";
import type { SettingsStore } from "./settings";

export const AI_ZONES_KEY = "ai.zones";

export async function loadZoneMap(store: SettingsStore): Promise<ZoneMap> {
  try {
    return normalizeZoneMap(await store.read());
  } catch {
    return {};
  }
}

/** Aggiunge le conferme alla mappa, in un solo passo. */
export async function recordZones(store: SettingsStore, observations: readonly ZoneObservation[]): Promise<ZoneMap> {
  if (observations.length === 0) return loadZoneMap(store);
  const saved = await store.update((raw) => observations.reduce<ZoneMap>((map, o) => recordZone(map, o), normalizeZoneMap(raw)));
  return normalizeZoneMap(saved);
}
