"use client";

import { useId, useState } from "react";
import type { Slot } from "@/core/plan";
import { Button } from "@/design";
import { MEAL_KIND_LABELS } from "../meals";
import ui from "../ui.module.css";
import { dayHeading } from "./dates";
import { slotText } from "./moveMeal";
import { Sheet } from "./Sheet";

interface Props {
  /** I pasti che si spostano, a parole. */
  what: string;
  from: Slot;
  /** I posti liberi (vedi `slotsToMoveTo`). */
  options: readonly Slot[];
  today: string;
  /** Restituisce il testo dell'errore, oppure `null` se è andata bene. */
  onMove: (to: Slot) => Promise<string | null>;
  onClose: () => void;
}

/** «Sposta»: si sceglie un momento libero della settimana. Gli ingredienti vanno con il pasto. */
export function MoveSheet({ what, from, options, today, onMove, onClose }: Props) {
  const ids = useId();
  const [to, setTo] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!to) return;
    setBusy(true);
    setError(null);
    const failure = await onMove(to);
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <Sheet title="Sposta il pasto" onClose={onClose}>
      <p className={ui.lead}>
        {what} · {slotText(from)}
      </p>
      {options.length === 0 ? (
        <p className={ui.hint}>In questa settimana non c&apos;è un momento libero. Puoi toglierlo dal piano.</p>
      ) : (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Dove lo metto</legend>
          <div className={ui.choices}>
            {options.map((s) => (
              <label key={`${s.date}-${s.meal}`} className={ui.choice}>
                <input type="radio" name={`${ids}-to`} checked={to?.date === s.date && to.meal === s.meal} onChange={() => setTo(s)} />
                <span>
                  {dayHeading(s.date, today).replace(/, (oggi|domani)$/, "")} · {MEAL_KIND_LABELS[s.meal].toLowerCase()}
                </span>
              </label>
            ))}
          </div>
          <p className={ui.hint}>Gli ingredienti vanno con il pasto: nella spesa e nel confronto col piano contano una volta sola. Con «Annulla» torna dov&apos;era.</p>
        </fieldset>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button disabled={busy || to === null} onClick={() => void submit()}>
        Sposta
      </Button>
    </Sheet>
  );
}
