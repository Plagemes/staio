"use client";

import { useId, useState } from "react";
import { getWeek } from "@/core/plan";
import { Button } from "@/design";
import ui from "../ui.module.css";
import { WEEK_LABELS, weekChoices, weekRangeText, type WeekChoice, type WeekId } from "./dates";
import { buildWeek, copyWeek } from "./edit";
import { Sheet } from "./Sheet";
import type { PlanData } from "./usePlanData";
import { useWeekEditor } from "./useWeekEditor";

interface Props {
  data: PlanData;
  /** La settimana su cui si copia: ciò che c'è si sostituisce. */
  target: WeekChoice;
  /** Quale settimana è già scelta all'apertura (se ha voci). */
  initial?: WeekId;
  onClose: () => void;
}

/** «Copia una settimana»: la usano Settimana e Piano. Scrive la settimana di destinazione, sulle voci rilette della scelta. */
export function CopyWeekSheet({ data, target, initial, onClose }: Props) {
  const ids = useId();
  const edit = useWeekEditor();
  const plan = data.plan;
  const weeks = weekChoices(data.today).filter((w) => w.start !== target.start);
  const usable = weeks.filter((w) => (plan ? (getWeek(plan, w.start)?.entries.length ?? 0) > 0 : false));
  const [from, setFrom] = useState<string | null>(() => usable.find((w) => w.id === initial)?.start ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = usable.find((w) => w.start === from);

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const failure = await edit(
      (read, ctx) => {
        const source = read(chosen.start);
        if (source.length === 0) return { ok: false, error: "In quella settimana non c'è più niente da copiare." };
        return buildWeek(target.start, copyWeek(source, chosen.start, target.start), ctx, `Copiata la settimana ${weekRangeText(chosen.start)}.`);
      },
      { beforeNotice: onClose },
    );
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <Sheet
      title="Copia una settimana"
      onClose={onClose}
      busy={busy}
      footer={
        <Button disabled={!chosen || busy} onClick={() => void submit()}>
          Copia la settimana
        </Button>
      }
    >
      {usable.length === 0 ? (
        <p className={ui.lead}>Nelle altre settimane non c&apos;è ancora niente di pianificato da copiare.</p>
      ) : (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Quale settimana copio su {weekRangeText(target.start)}</legend>
          <div className={ui.choices}>
            {usable.map((w) => (
              <label key={w.start} className={ui.choice}>
                <input type="radio" name={`${ids}-from`} checked={from === w.start} onChange={() => setFrom(w.start)} />
                <span>
                  {WEEK_LABELS[w.id]}, {weekRangeText(w.start)}
                </span>
              </label>
            ))}
          </div>
          <p className={ui.hint}>Sostituisce tutto ciò che è pianificato in questa settimana.</p>
        </fieldset>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
