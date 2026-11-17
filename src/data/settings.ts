import { liveQuery, type Observable } from "dexie";
import { getDb } from "./db";

/** Chiavi interne dell'archivio: non si leggono né si scrivono come impostazioni. */
const RESERVED_KEYS = new Set(["deviceId"]);
/** Prefisso delle chiavi segrete (fornitore AI): mai esportate né importate. */
export const SECRET_PREFIX = "ai.";

export const SETTINGS_FORMAT = "ledger-settings";
export const SETTINGS_VERSION = 1;

export interface SettingsExport {
  format: typeof SETTINGS_FORMAT;
  version: number;
  exportedAt: string;
  settings: Record<string, unknown>;
}

function assertWritable(key: string): void {
  if (key.length === 0) throw new Error("invalid_setting_key");
  if (RESERVED_KEYS.has(key)) throw new Error("reserved_setting_key");
}

const isExportable = (key: string): boolean =>
  !key.startsWith(SECRET_PREFIX) && !RESERVED_KEYS.has(key) && key.length > 0;

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  if (RESERVED_KEYS.has(key)) return undefined;
  return (await getDb().settings.get(key))?.value as T | undefined;
}

export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  assertWritable(key);
  await getDb().settings.put({ key, value });
}

export async function removeSetting(key: string): Promise<void> {
  assertWritable(key);
  await getDb().settings.delete(key);
}

export function liveSetting<T = unknown>(key: string): Observable<T | undefined> {
  return liveQuery(() => getSetting<T>(key));
}

/** Impostazioni non sensibili: esclude `ai.*` e l'identità del dispositivo. */
export async function exportSettings(): Promise<SettingsExport> {
  const rows = await getDb().settings.toArray();
  const settings: Record<string, unknown> = {};
  for (const row of rows.sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (isExportable(row.key)) settings[row.key] = row.value;
  }
  return {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };
}

export type ImportSettingsResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string };

/** Le chiavi `ai.*` e riservate presenti nel file sono ignorate. */
export async function importSettings(json: unknown): Promise<ImportSettingsResult> {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "not_an_object" };
  }
  const b = data as Record<string, unknown>;
  if (b.format !== SETTINGS_FORMAT) return { ok: false, error: "wrong_format" };
  if (typeof b.version !== "number" || b.version < 1 || b.version > SETTINGS_VERSION) {
    return { ok: false, error: "unsupported_version" };
  }
  if (typeof b.settings !== "object" || b.settings === null || Array.isArray(b.settings)) {
    return { ok: false, error: "invalid_settings" };
  }
  const entries = Object.entries(b.settings as Record<string, unknown>);
  const accepted = entries.filter(([key]) => isExportable(key));
  await getDb().settings.bulkPut(accepted.map(([key, value]) => ({ key, value })));
  return { ok: true, imported: accepted.length, skipped: entries.length - accepted.length };
}
