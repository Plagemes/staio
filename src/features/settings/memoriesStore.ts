"use client";

// Le memorie nell'archivio locale: leggerle (vive), dimenticarle, rimetterle. Le impostazioni non sono eventi: l'«Annulla»
// passa da `onUndo` dell'avviso. Si leggono solo le chiavi che il catalogo conosce: le altre (la chiave dell'AI, il token del
// servizio video, le dichiarazioni) non si aprono nemmeno.
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/data/db";
import { MEMORIES, listMemories, memoryKeys, keysOf, mergeForUndo, type MemorySummary } from "./memories";

export interface ForgottenRow {
  key: string;
  value: unknown;
}

/** Le memorie presenti con le loro voci. */
export async function readMemories(): Promise<MemorySummary[]> {
  const db = getDb();
  const keys = memoryKeys((await db.settings.toCollection().primaryKeys()) as string[]);
  const rows = (await db.settings.bulkGet(keys)).flatMap((row) => (row === undefined ? [] : [{ key: row.key, value: row.value }]));
  return listMemories(rows);
}

/** Come `readMemories`, aggiornata quando le impostazioni cambiano. `memories` è `undefined` finché non sono lette. */
export function useMemories(): { memories: MemorySummary[] | undefined; error: boolean } {
  const [state, setState] = useState<{ memories: MemorySummary[] | undefined; error: boolean }>({ memories: undefined, error: false });
  useEffect(() => {
    const sub = liveQuery(readMemories).subscribe({
      next: (memories) => setState({ memories, error: false }),
      error: () => setState({ memories: undefined, error: true }),
    });
    return () => sub.unsubscribe();
  }, []);
  return state;
}

/**
 * Toglie le chiavi delle memorie indicate (`"all"`: tutte) in una sola operazione: o tutte o nessuna. Le chiavi si
 * rileggono qui dentro, non da ciò che era a schermo. Restituisce i valori tolti, per rimetterli.
 */
export async function forgetMemories(ids: readonly string[] | "all"): Promise<ForgottenRow[]> {
  const db = getDb();
  return db.transaction("rw", db.settings, async () => {
    const all = (await db.settings.toCollection().primaryKeys()) as string[];
    const keys = ids === "all" ? memoryKeys(all) : [...new Set(MEMORIES.filter((m) => ids.includes(m.id)).flatMap((m) => keysOf(m, all)))];
    const rows = (await db.settings.bulkGet(keys)).flatMap((row) => (row === undefined ? [] : [{ key: row.key, value: row.value }]));
    await db.settings.bulkDelete(rows.map((r) => r.key));
    return rows;
  });
}

/** Rimette ciò che «Dimentica» aveva tolto, senza cancellare ciò che nel frattempo è stato imparato di nuovo. */
export async function restoreMemories(rows: readonly ForgottenRow[]): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.settings, async () => {
    for (const row of rows) {
      const current = await db.settings.get(row.key);
      await db.settings.put({ key: row.key, value: mergeForUndo(row.value, current?.value) });
    }
  });
}
