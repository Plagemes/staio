// Tipi di evento delle altre famiglie che condividono il registro (piano, preparazioni, ricettario).
// Sono elencati qui, e non importati, perché quei moduli dipendono dal diario: un import
// farebbe un ciclo. `events/events.test.ts` controlla che l'elenco coincida con i loro.

export const OTHER_FAMILY_EVENT_TYPES = [
  "planTargets",
  "planStructure",
  "planWeek",
  "dayType",
  "prep",
  "recipe",
  "experiment",
  "allergenConfirmation",
] as const;

/** Il tipo dichiarato è di una delle altre famiglie note (non della dispensa né del diario). */
export function isOtherFamilyEvent(e: unknown): boolean {
  try {
    if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
    const type = (e as { type?: unknown }).type;
    return typeof type === "string" && (OTHER_FAMILY_EVENT_TYPES as readonly string[]).includes(type);
  } catch {
    return false;
  }
}
