"use client";

import { useId, useMemo, useState } from "react";
import type { MealKind } from "@/core/diary";
import type { PlannedEntry } from "@/core/plan";
import { Button } from "@/design";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, buildMealEvents } from "../meals";
import ui from "../ui.module.css";
import { itemLabel } from "./describe";
import { planEat } from "./eat";
import { Sheet } from "./Sheet";
import type { PlanData } from "./usePlanData";
import { useWriter } from "./useWriter";
import styles from "./plan.module.css";

interface EatSheetProps {
  data: PlanData;
  entry: PlannedEntry;
  onClose: () => void;
}

/** «Registralo come mangiato»: le voci del pasto sono già scelte; si scala la dispensa dove c'è il prodotto. */
export function EatSheet({ data, entry, onClose }: EatSheetProps) {
  const ids = useId();
  const write = useWriter();
  const [kind, setKind] = useState<MealKind>(entry.meal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planEat(entry, { lots: data.lots, preps: data.preps, expand: data.expand }), [entry, data.lots, data.preps, data.expand]);

  async function submit() {
    setBusy(true);
    setError(null);
    const failure = await write((ctx) => {
      const r = buildMealEvents({ ...plan.input, kind }, ctx);
      if (!r.ok) return { ok: false, error: r.errors.general ?? "Non riesco a scrivere questo pasto: controlla le quantità." };
      return { ok: true, events: r.events, message: r.message };
    });
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <Sheet title="Registralo come mangiato" onClose={onClose}>
      <p className={ui.lead}>{itemLabel(entry.item, data.catalog)}</p>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Che pasto è</legend>
        <div className={ui.choices}>
          {MEAL_KIND_ORDER.map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>{MEAL_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {plan.lines.length > 0 ? (
        <ul className={styles.rows}>
          {plan.lines.map((l, i) => (
            <li key={`${l.name}-${i}`} className={styles.row}>
              {l.name}, {l.text}: {l.source === "pantry" ? "dalla dispensa" : "voce libera, stima"}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.unresolved ? (
        <p className={ui.error}>Non trovo più questa ricetta o preparazione: non so che voci registrare.</p>
      ) : null}
      {plan.missing.length > 0 ? (
        <p className={ui.hint}>
          {plan.missing.join(", ")} non {plan.missing.length === 1 ? "è" : "sono"} in dispensa nella quantità che serve: {plan.missing.length === 1 ? "lo scrivo" : "li scrivo"} come voci libere, valgono come stime. Gli ingredienti senza quantità non sono registrati.
        </p>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void submit()} disabled={busy || plan.lines.length === 0}>
        {busy ? "Registro…" : "Registra il pasto"}
      </Button>
    </Sheet>
  );
}
