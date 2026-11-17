import { NOTICE_TYPES, type NoticeType, type NotifyPrefs, type QuietHours } from "./types";

export const EXPIRY_DAYS_OPTIONS = [1, 2, 3, 5, 7] as const;

export const DEFAULT_PREFS: NotifyPrefs = {
  enabled: false,
  types: { expiry: true, prep: true, supplement: true, shopping: false, plan: false },
  quietHours: { enabled: true, from: "22:00", to: "08:00" },
  expiryDaysAhead: 3,
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minuti dalla mezzanotte di `HH:MM`, o undefined se il testo non è un orario. */
export function parseClock(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = TIME.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** True se `minutes` cade nelle ore di silenzio (inizio incluso, fine esclusa). */
export function isQuiet(minutes: number, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const from = parseClock(quiet.from);
  const to = parseClock(quiet.to);
  if (from === undefined || to === undefined || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * Preferenze lette da un archivio (quindi non fidate): ciò che manca o non è valido torna al
 * valore predefinito, il resto si conserva.
 */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  const base = DEFAULT_PREFS;
  if (typeof raw !== "object" || raw === null) return clonePrefs(base);
  const r = raw as Record<string, unknown>;
  const types = { ...base.types };
  if (typeof r.types === "object" && r.types !== null) {
    for (const t of NOTICE_TYPES) {
      const v = (r.types as Record<string, unknown>)[t];
      if (typeof v === "boolean") types[t] = v;
    }
  }
  const q = typeof r.quietHours === "object" && r.quietHours !== null ? (r.quietHours as Record<string, unknown>) : {};
  const quietHours: QuietHours = {
    enabled: typeof q.enabled === "boolean" ? q.enabled : base.quietHours.enabled,
    from: parseClock(q.from) !== undefined ? (q.from as string) : base.quietHours.from,
    to: parseClock(q.to) !== undefined ? (q.to as string) : base.quietHours.to,
  };
  const days = r.expiryDaysAhead;
  return {
    enabled: r.enabled === true,
    types,
    quietHours,
    expiryDaysAhead:
      typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 14 ? days : base.expiryDaysAhead,
  };
}

function clonePrefs(p: NotifyPrefs): NotifyPrefs {
  return { ...p, types: { ...p.types }, quietHours: { ...p.quietHours } };
}

export function withType(prefs: NotifyPrefs, type: NoticeType, on: boolean): NotifyPrefs {
  return { ...prefs, types: { ...prefs.types, [type]: on } };
}
