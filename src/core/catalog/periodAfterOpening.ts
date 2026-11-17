const MAX_DAYS = 3650;

/** Giorni per unità, nelle lingue in cui Open Food Facts scrive il campo («12 M», «6 months», «12 mois», «1 anno»). */
function daysPerUnit(unit: string): number | undefined {
  if (/^(m|mo|mos|mth|mths|month|months|mese|mesi|mois|monat|monate|monaten|meses|mes|maand|maanden)$/.test(unit)) return 365 / 12;
  if (/^(y|yr|yrs|year|years|a|anno|anni|an|ans|jahr|jahre|ano|anos|jaar)$/.test(unit)) return 365;
  if (/^(w|wk|wks|week|weeks|settimana|settimane|semaine|semaines|woche|wochen|semana|semanas)$/.test(unit)) return 7;
  if (/^(d|day|days|giorno|giorni|jour|jours|tag|tage|dia|dias|dag|dagen)$/.test(unit)) return 1;
  return undefined;
}

/**
 * Il periodo di consumo dopo l'apertura che Open Food Facts riporta («12 M», «6 months»), in giorni interi.
 * `undefined` se il testo non è interpretabile: un numero senza unità non si indovina.
 */
export function parsePeriodAfterOpening(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zà-ÿ]+)\.?\s*$/i.exec(value.normalize("NFC"));
  if (!m) return undefined;
  const n = Number((m[1] as string).replace(",", "."));
  const per = daysPerUnit((m[2] as string).toLowerCase());
  if (!Number.isFinite(n) || per === undefined) return undefined;
  const days = Math.round(n * per);
  return days >= 1 && days <= MAX_DAYS ? days : undefined;
}
