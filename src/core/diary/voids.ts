// Annullamenti: stesse regole del libro mastro. Un evento annullato non conta;
// un annullamento annullato a sua volta ripristina l'evento originale.

export interface VoidRef {
  id: string;
  targetEventId: string;
}

export interface VoidFinding {
  code: "void_cycle" | "void_target_missing";
  eventId: string;
  targetEventId: string;
}

export interface VoidResolution {
  /** Id degli eventi annullati da un `void` efficace. */
  voided: Set<string>;
  /** Problemi trovati (cicli e bersagli sconosciuti), in ordine non garantito. */
  findings: VoidFinding[];
}

/**
 * Risolve gli annullamenti. Il risultato dipende solo dall'insieme dei `void`
 * (non dal loro ordine). `knownIds` sono gli id di tutti gli eventi del registro.
 */
export function resolveVoids(
  refs: readonly VoidRef[],
  knownIds: ReadonlySet<string>,
): VoidResolution {
  const voids = new Map<string, VoidRef>();
  for (const v of refs) voids.set(v.id, v);

  // Ogni void ha un solo bersaglio: seguendo i bersagli i cicli sono semplici.
  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const start of voids.keys()) {
    const position = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && voids.has(cur) && !done.has(cur)) {
      const seen = position.get(cur);
      if (seen !== undefined) {
        for (const id of path.slice(seen)) cyclic.add(id);
        break;
      }
      position.set(cur, path.length);
      path.push(cur);
      cur = voids.get(cur)!.targetEventId;
    }
    for (const id of path) done.add(id);
  }

  const findings: VoidFinding[] = [];
  const effective: VoidRef[] = [];
  for (const v of voids.values()) {
    if (cyclic.has(v.id)) {
      findings.push({ code: "void_cycle", eventId: v.id, targetEventId: v.targetEventId });
    } else {
      effective.push(v);
      if (!knownIds.has(v.targetEventId)) {
        findings.push({
          code: "void_target_missing",
          eventId: v.id,
          targetEventId: v.targetEventId,
        });
      }
    }
  }

  // Un void è attivo se nessun void attivo lo annulla: si risolve dalle foglie verso l'alto.
  const incoming = new Map<string, VoidRef[]>();
  for (const v of effective) {
    const list = incoming.get(v.targetEventId);
    if (list) list.push(v);
    else incoming.set(v.targetEventId, [v]);
  }
  const pending = new Map<string, number>();
  const queue: VoidRef[] = [];
  for (const v of effective) {
    const n = incoming.get(v.id)?.length ?? 0;
    pending.set(v.id, n);
    if (n === 0) queue.push(v);
  }
  const active = new Map<string, boolean>();
  const voided = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    const isActive = !(incoming.get(v.id) ?? []).some((s) => active.get(s.id));
    active.set(v.id, isActive);
    if (isActive) voided.add(v.targetEventId);
    const left = pending.get(v.targetEventId);
    if (left !== undefined) {
      pending.set(v.targetEventId, left - 1);
      if (left - 1 === 0) queue.push(voids.get(v.targetEventId)!);
    }
  }
  return { voided, findings };
}
