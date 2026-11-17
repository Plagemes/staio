// Due dispositivi che correggono lo stesso consumo prima di sincronizzarsi scrivono due sostituti con lo stesso `replaces`:
// contarli entrambi scalerebbe due volte la dispensa. Ne vale uno solo, lo stesso su ogni dispositivo.

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const instant = (v: unknown): number => {
  const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * Gli id dei `consume` che non contano perché un altro `consume` ancora valido sostituisce lo stesso evento (`replaces`
 * uguale). Vale il più recente per `recordedAt`, poi per `id`: non dipende dall'ordine in cui gli eventi arrivano. Se il
 * vincitore viene annullato, vale quello che lo precede. `voided` sono gli eventi già annullati da un `void`.
 * Si deduplica solo se l'evento sostituito è un consumo, o non è ancora arrivato: due consumi che per errore citano un
 * acquisto restano due consumi.
 */
export function supersededConsumes(events: Iterable<unknown>, voided: ReadonlySet<string>): Set<string> {
  const byTarget = new Map<string, Rec[]>();
  const typeOf = new Map<string, unknown>();
  for (const e of events) {
    if (isRecord(e) && typeof e.id === "string") typeOf.set(e.id, e.type);
    if (!isRecord(e) || e.type !== "consume" || typeof e.id !== "string" || voided.has(e.id)) continue;
    if (typeof e.replaces !== "string" || e.replaces === "") continue;
    const list = byTarget.get(e.replaces);
    if (list) list.push(e);
    else byTarget.set(e.replaces, [e]);
  }
  const out = new Set<string>();
  for (const [target, list] of byTarget) {
    if (list.length < 2) continue;
    if (typeOf.has(target) && typeOf.get(target) !== "consume") continue;
    const newest = list.reduce((best, e) => {
      const d = instant(e.recordedAt) - instant(best.recordedAt);
      return d > 0 || (d === 0 && (e.id as string) > (best.id as string)) ? e : best;
    });
    for (const e of list) if (e !== newest) out.add(e.id as string);
  }
  return out;
}
