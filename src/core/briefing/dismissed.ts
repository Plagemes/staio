// «Lascia così»: ciò che l'utente ha deciso di non rivedere più, ricordato nelle impostazioni locali.

export const DISMISSED_SETTING_KEY = "briefing.dismissed";
/** Si ricordano le ultime scelte: la lista non cresce senza fine. */
export const MAX_DISMISSED = 300;

export function isDismissedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function normalizeDismissed(raw: unknown): string[] {
  return isDismissedList(raw) ? raw.slice(-MAX_DISMISSED) : [];
}

export function rememberDismissed(list: readonly string[], key: string): string[] {
  if (list.includes(key)) return [...list];
  return [...list, key].slice(-MAX_DISMISSED);
}
