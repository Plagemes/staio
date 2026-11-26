"use client";

import { useId, useMemo, useState } from "react";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { MealKind } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import type { PlannedEntry } from "@/core/plan";
import { getPantry } from "@/data";
import { Button } from "@/design";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, TYPICAL_MEAL_TIME, buildMealEvents } from "../meals";
import { mealInstant } from "../meal/mealTarget";
import ui from "../ui.module.css";
import { itemLabel } from "./describe";
import { planEat } from "./eat";
import { StepFrame } from "./Sheet";
import type { PlanData } from "./usePlanData";
import { useWriter } from "./useWriter";
import styles from "./plan.module.css";

interface EatSheetProps {
  data: PlanData;
  entry: PlannedEntry;
  onClose: () => void;
  /** Un passo di un foglio più grande (la voce del piano), non un foglio suo. */
  embedded?: boolean;
}

const lower = (kind: MealKind) => MEAL_KIND_LABELS[kind].toLowerCase();

/**
 * «Registra come mangiato»: le voci del pasto sono già scelte; si scala la dispensa dove c'è il prodotto. Una voce di un
 * altro giorno si registra su quel giorno, all'ora tipica del pasto.
 */
export function EatSheet({ data, entry, onClose, embedded = false }: EatSheetProps) {
  const ids = useId();
  const write = useWriter();
  const [kind, setKind] = useState<MealKind>(entry.meal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planEat(entry, { lots: data.lots, preps: data.preps, expand: data.expand }), [entry, data.lots, data.preps, data.expand]);
  const timeZone = data.diary?.timeZone ?? DEFAULT_TIME_ZONE;

  async function submit() {
    setBusy(true);
    setError(null);
    let failure: string | null;
    try {
      // la dispensa si rilegge: i lotti a schermo potrebbero essere già cambiati
      const fresh = planEat(entry, { lots: activeLots(await getPantry()), preps: data.preps, expand: data.expand });
      const mealAt = entry.date === data.today ? undefined : mealInstant(entry.date, TYPICAL_MEAL_TIME[kind], timeZone);
      failure = await write(
        (ctx) => {
          const r = buildMealEvents({ ...fresh.input, kind }, { ...ctx, ...(mealAt ? { mealAt } : {}) });
          if (!r.ok) return { ok: false, error: r.errors.general ?? "Non riesco a scrivere questo pasto: controlla le quantità." };
          return { ok: true, events: r.events, message: r.message };
        },
        { beforeNotice: onClose },
      );
    } catch {
      failure = "Non sono riuscito a leggere i dati del telefono. Riprova.";
    }
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <StepFrame
      embedded={embedded}
      title={`Registra ${lower(kind)}`}
      onClose={onClose}
      busy={busy}
      footer={
        <Button onClick={() => void submit()} disabled={busy || plan.lines.length === 0}>
          {busy ? "Registro…" : `Registra ${lower(kind)}`}
        </Button>
      }
    >
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
      {plan.unresolved ? <p className={ui.error}>Non trovo più questa ricetta o preparazione: non so che voci registrare.</p> : null}
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
    </StepFrame>
  );
}
