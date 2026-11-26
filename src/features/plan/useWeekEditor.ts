"use client";

// Ogni modifica del piano parte dalle voci rilette dall'archivio, non da quelle che il gancio aveva a schermo: un altro
// telefono può aver cambiato la settimana nel frattempo, e `planWeek` sostituisce la settimana intera.
import { useCallback } from "react";
import { derivePlan, getWeek, type PlanState, type PlannedEntry, type PlannedItem, type Slot } from "@/core/plan";
import { getAllEvents } from "@/data";
import type { Catalog } from "./describe";
import { itemLabel } from "./describe";
import { buildWeek, withAmount, withEntry, withItem, withoutEntry, type PlanContext, type PlanResult } from "./edit";
import { findEntry, type EntryRef } from "./entryKey";
import { buildMoveMealAnywhere } from "./moveMeal";
import { useWriter, type WriteOptions } from "./useWriter";

export const ENTRY_CHANGED = "Questa voce è cambiata su un altro telefono: chiudi e riapri.";
const READ_FAILED = "Non sono riuscito a leggere i dati del telefono. Riprova.";

/** Le voci di una settimana, lette adesso dall'archivio. */
export type ReadWeek = (weekStart: string) => PlannedEntry[];
export type WeekBuilder = (read: ReadWeek, ctx: PlanContext) => PlanResult;

/** Rilegge l'archivio, costruisce gli eventi sulle voci lette e li scrive in una sola chiamata. Restituisce l'errore, o `null`. */
export function useWeekEditor(): (build: WeekBuilder, options?: WriteOptions) => Promise<string | null> {
  const write = useWriter();
  return useCallback(
    async (build, options) => {
      let plan: PlanState;
      try {
        plan = derivePlan(await getAllEvents());
      } catch {
        return READ_FAILED;
      }
      const read: ReadWeek = (weekStart) => getWeek(plan, weekStart)?.entries ?? [];
      return write((ctx) => build(read, ctx), options);
    },
    [write],
  );
}

/** Aggiunge una voce in coda alle voci lette della settimana. */
export function addBuilder(weekStart: string, entry: PlannedEntry, catalog: Catalog): WeekBuilder {
  return (read, ctx) => buildWeek(weekStart, withEntry(read(weekStart), entry), ctx, `Aggiunto al piano: ${itemLabel(entry.item, catalog)}.`);
}

/** Toglie la voce ritrovata per chiave; se non c'è più, nessuna scrittura. */
export function removeBuilder(weekStart: string, ref: EntryRef, catalog: Catalog): WeekBuilder {
  return (read, ctx) => {
    const entries = read(weekStart);
    const index = findEntry(entries, ref);
    if (index < 0) return { ok: false, error: ENTRY_CHANGED };
    return buildWeek(weekStart, withoutEntry(entries, index), ctx, `Tolto dal piano: ${itemLabel(entries[index].item, catalog)}.`);
  };
}

/** Cambia le porzioni o la quantità della voce ritrovata per chiave. */
export function amountBuilder(weekStart: string, ref: EntryRef, item: PlannedItem, catalog: Catalog): WeekBuilder {
  return (read, ctx) => {
    const entries = read(weekStart);
    const index = findEntry(entries, ref);
    if (index < 0) return { ok: false, error: ENTRY_CHANGED };
    const next = item.kind === "food" ? withItem(entries, index, item) : withAmount(entries, index, item.servings);
    return buildWeek(weekStart, next, ctx, `Piano aggiornato: ${itemLabel(item, catalog)}.`);
  };
}

/** Sposta il pasto, dentro la settimana o nella successiva, sulle voci lette di entrambe. */
export function moveBuilder(weekStart: string, nextWeekStart: string, from: Slot, to: Slot): WeekBuilder {
  return (read, ctx) =>
    buildMoveMealAnywhere({ weekStart, entries: read(weekStart) }, { weekStart: nextWeekStart, entries: read(nextWeekStart) }, from, to, ctx);
}
