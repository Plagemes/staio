"use client";

import { useId, useMemo, useState } from "react";
import { derivePlan, getWeek, weekStartOf } from "@/core/plan";
import { RECIPE_LIMITS } from "@/core/recipes";
import { appendEvents, getAllEvents, getDeviceId, usePlan } from "@/data";
import { Button } from "@/design";
import { Sheet, closeSheetThen } from "../common";
import { readAmount, writeAmount } from "../common/quantity";
import { dayOf } from "../format";
import { localTime } from "../meals";
import { useNotice } from "../notice";
import { buildWeek, entryOf, withEntry } from "../plan/edit";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { defaultSlot, plannedMessage, planSlots, type PlanSlot } from "./planSlots";

/** «08:05» in minuti dalla mezzanotte; se non si legge, l'inizio del giorno (così nessun momento di oggi sparisce). */
const minutesOf = (time: string | undefined): number => {
  const m = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

const keyOf = (slot: Pick<PlanSlot, "date" | "meal">): string => `${slot.date}|${slot.meal}`;

/** «Metti nel piano»: sceglie il pasto da adesso ai prossimi giorni e aggiunge la ricetta, accanto a ciò che c'è già. */
export function PlanSheet({ recipeId, title, servings, onClose }: { recipeId: string; title: string; servings: number; onClose: () => void }) {
  const ids = useId();
  const now = useNow();
  const plan = usePlan();
  const notice = useNotice();
  const [chosen, setChosen] = useState<string | null>(null);
  const [servingsText, setServingsText] = useState(() => writeAmount(servings));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots = useMemo(() => {
    if (!now) return [];
    return planSlots({ today: dayOf(now), nowMinutes: minutesOf(localTime(now)), meals: plan.data?.structure?.meals.map((m) => m.kind) });
  }, [now, plan.data]);
  const occupied = useMemo(() => {
    const taken = new Set<string>();
    for (const week of plan.data?.weeks ?? []) for (const entry of week.entries) taken.add(keyOf(entry));
    return taken;
  }, [plan.data]);
  const fallback = useMemo(() => defaultSlot(slots, (slot) => occupied.has(keyOf(slot))), [slots, occupied]);
  const selected = slots.find((s) => keyOf(s) === chosen) ?? fallback;

  const amount = readAmount(servingsText);
  const amountOk = amount !== null && amount > 0 && amount <= RECIPE_LIMITS.servingsMax;

  async function submit() {
    if (!selected || busy) return;
    if (!amountOk || amount === null) return setError("Scrivi quante porzioni, per esempio 2.");
    setBusy(true);
    setError(null);
    try {
      // il piano si rilegge dall'archivio: la settimana può essere cambiata (anche da un altro telefono) dopo che il foglio si è aperto
      const state = derivePlan(await getAllEvents());
      const weekStart = weekStartOf(selected.date);
      const entries = getWeek(state, weekStart)?.entries ?? [];
      const message = plannedMessage(title, selected);
      const built = buildWeek(weekStart, withEntry(entries, entryOf(selected.date, selected.meal, { kind: "recipe", recipeId, servings: amount })), {
        now: new Date().toISOString(),
        deviceId: await getDeviceId(),
      }, message);
      if (!built.ok) return setError(built.error);
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) return setError("Non sono riuscito a salvare. Riprova.");
      // scritto: il foglio si chiude e solo dopo compare l'avviso
      closeSheetThen(() => notice.show({ message: built.message, undo: built.events, link: { label: "Vedi nel piano", href: `/app/piano/settimana?giorno=${selected.date}` } }));
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Metti nel piano"
      onClose={onClose}
      busy={busy}
      footer={
        <Button disabled={busy || !selected} onClick={() => void submit()}>
          {busy ? "Salvo…" : "Metti nel piano"}
        </Button>
      }
    >
      <div className={ui.form}>
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Quando</legend>
          {slots.length === 0 ? (
            <p className={ui.hint}>Un attimo…</p>
          ) : (
            <div className={ui.choices}>
              {slots.map((slot) => (
                <label key={keyOf(slot)} className={ui.choice}>
                  <input type="radio" name={`${ids}-when`} checked={selected !== undefined && keyOf(selected) === keyOf(slot)} onChange={() => setChosen(keyOf(slot))} />
                  <span>{slot.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-serv`}>
            Porzioni
          </label>
          <input
            id={`${ids}-serv`}
            className={ui.input}
            inputMode="decimal"
            value={servingsText}
            onChange={(e) => {
              setServingsText(e.target.value);
              setError(null);
            }}
            aria-invalid={amountOk ? undefined : true}
          />
        </div>
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
