// Un consumo corretto lascia una catena di sostituti (`replaces`): tutti insieme sono una sola voce, e ne conta uno solo.
// Due dispositivi che correggono lo stesso consumo prima di sincronizzarsi scrivono due rami della stessa catena:
// contarli entrambi scalerebbe due volte la dispensa. Ne vale uno, lo stesso su ogni dispositivo.

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const instant = (v: unknown): number => {
  const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

const replacedBy = (e: Rec): string | undefined =>
  typeof e.replaces === "string" && e.replaces !== "" ? e.replaces : undefined;

/**
 * Per ogni `consume`, l'id del capostipite della sua famiglia: il consumo in cima alla catena dei `replaces` (se stesso,
 * se non sostituisce niente). Un sostituto può citare il capostipite o il sostituto di prima: la famiglia è la stessa.
 * - Un anello non ancora arrivato fa da capostipite provvisorio (il suo id): chi lo cita sta insieme, e quando arriva
 *   la catena si ricompone.
 * - Un consumo che cita un evento che non è un consumo (per errore, un acquisto) è capostipite di se stesso.
 * - Una catena che torna su se stessa (malformata) ha per capostipite l'id più piccolo del giro: non dipende da dove
 *   si parte.
 * Dipende solo dall'insieme degli eventi, non dal loro ordine. Annullati compresi: la catena passa quasi sempre da loro.
 */
export function consumeRoots(events: Iterable<unknown>): Map<string, string> {
  const byId = new Map<string, Rec>();
  for (const e of events) if (isRecord(e) && typeof e.id === "string") byId.set(e.id, e);

  const roots = new Map<string, string>();
  for (const start of byId.values()) {
    if (start.type !== "consume" || roots.has(start.id as string)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let cur = start;
    let root: string;
    for (;;) {
      const id = cur.id as string;
      const known = roots.get(id);
      if (known !== undefined) {
        root = known;
        break;
      }
      position.set(id, path.length);
      path.push(id);
      const target = replacedBy(cur);
      if (target === undefined) {
        root = id;
        break;
      }
      const next = byId.get(target);
      if (next === undefined) {
        root = target;
        break;
      }
      if (next.type !== "consume") {
        root = id;
        break;
      }
      const seen = position.get(target);
      if (seen !== undefined) {
        root = path.slice(seen).reduce((min, x) => (x < min ? x : min));
        break;
      }
      cur = next;
    }
    for (const id of path) roots.set(id, root);
  }
  return roots;
}

/**
 * Gli id dei `consume` che non contano perché un altro `consume` ancora valido della stessa famiglia (stesso capostipite,
 * vedi `consumeRoots`) vale al loro posto. Vale il più recente per `recordedAt`, poi per `id`: non dipende dall'ordine in
 * cui gli eventi arrivano. Se il vincitore viene annullato, vale quello che lo precede: per togliere la voce vanno
 * annullati tutti i consumi ancora validi della famiglia. `voided` sono gli eventi già annullati da un `void`.
 * Si deduplica solo tra consumi: due consumi che per errore citano un acquisto restano due consumi.
 */
export function supersededConsumes(events: Iterable<unknown>, voided: ReadonlySet<string>): Set<string> {
  const list = [...events];
  const roots = consumeRoots(list);
  const families = new Map<string, Rec[]>();
  const seen = new Set<string>();
  for (const e of list) {
    if (!isRecord(e) || e.type !== "consume" || typeof e.id !== "string" || voided.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    const root = roots.get(e.id) ?? e.id;
    const family = families.get(root);
    if (family) family.push(e);
    else families.set(root, [e]);
  }
  const out = new Set<string>();
  for (const family of families.values()) {
    if (family.length < 2) continue;
    const newest = family.reduce((best, e) => {
      const d = instant(e.recordedAt) - instant(best.recordedAt);
      return d > 0 || (d === 0 && (e.id as string) > (best.id as string)) ? e : best;
    });
    for (const e of family) if (e !== newest) out.add(e.id as string);
  }
  return out;
}
