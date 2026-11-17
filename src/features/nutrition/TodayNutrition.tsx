"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Figure, FigureGrid, Label, ProgressLine, Value } from "@/design";
import { Disclosure } from "../common";
import { dayOf } from "../format";
import { nutritionSummary } from "../today/summaries";
import ui from "../ui.module.css";
import { CERTAINTY_LABELS, NUTRIENT_COLOR, NUTRITION_DISCLAIMER_SHORT, certaintyExplanation } from "./labels";
import { dayNutritionView, prepNotes, type NutrientCell } from "./prepare";
import styles from "./nutrition.module.css";
import { useIntake } from "./useNutrition";

function CellValue({ cell }: { cell: NutrientCell }) {
  return (
    <>
      {cell.prefix}
      <Value certainty={cell.certainty}>{cell.text}</Value>
    </>
  );
}

/**
 * Energia e macronutrienti di oggi in una riga richiusa di Oggi: chiusa dice i due numeri che contano, aperta mostra
 * il resto, con certezza e parzialità dette a parole. Nessun obiettivo di energia.
 */
export function TodayNutrition({ now }: { now: string }) {
  const { intake, ready, error, prepInfo } = useIntake();
  const today = dayOf(now);
  const day = intake?.days.find((d) => d.date === today);
  const view = useMemo(() => (intake ? dayNutritionView(day, today) : undefined), [intake, day, today]);
  const computed = ready ? view : undefined;
  const detailed = computed !== undefined && !computed.drinksOnlyText && !computed.empty;

  return (
    <Disclosure title="Nutrienti" summary={error ? "dati non leggibili" : nutritionSummary(computed)}>
      {error ? (
        <p className={ui.paragraph}>Non riesco a leggere i dati del telefono per calcolare i nutrienti.</p>
      ) : !computed ? (
        <p className={ui.paragraph} role="status">
          Calcolo i nutrienti…
        </p>
      ) : computed.drinksOnlyText ? (
        <p className={ui.paragraph}>{computed.drinksOnlyText}</p>
      ) : computed.empty ? (
        <p className={ui.paragraph}>
          Niente da calcolare per ora: quando registri un pasto con alimenti che riconosco, qui compaiono energia e macronutrienti.
        </p>
      ) : (
        <>
          <div className={styles.energyRow}>
            <Label>Energia</Label>
            {computed.energy ? (
              <div className={styles.energyNumber}>
                <span className={styles.bigNumber}>
                  {computed.energy.prefix}
                  <Value certainty={computed.energy.certainty}>{Math.round(computed.energy.value).toLocaleString("it-IT")}</Value>
                </span>
                <span className={styles.of}>kcal</span>
              </div>
            ) : (
              <p className={ui.hint}>Nessun dato di energia nelle voci riconosciute.</p>
            )}
            {computed.total > 0 ? (
              <ProgressLine value={computed.resolved} max={computed.total} label={`Voci con dati: ${computed.resolved} su ${computed.total}`} />
            ) : null}
          </div>

          {computed.macros.length > 0 ? (
            <FigureGrid>
              {computed.macros.slice(0, 3).map((m) => (
                <Figure key={m.key} label={m.label} nutrient={NUTRIENT_COLOR[m.key]}>
                  <CellValue cell={m} />
                </Figure>
              ))}
            </FigureGrid>
          ) : null}
          {computed.macros.length > 3 ? (
            <p className={styles.more}>
              {computed.macros.slice(3).map((m, i) => (
                <span key={m.key}>
                  {i > 0 ? " · " : ""}
                  {m.label} <CellValue cell={m} />
                </span>
              ))}
            </p>
          ) : null}

          {prepNotes(day, prepInfo).map((note) => (
            <p key={note} className={ui.hint}>
              {note}
            </p>
          ))}
          {/* cambia come si leggono i numeri: resta in vista */}
          {computed.partialText ? <p className={ui.callout}>{computed.partialText} I numeri sono una parte, non il totale della giornata.</p> : null}
        </>
      )}

      {detailed ? (
        <Disclosure quiet title="Che cosa significa">
          {computed.missingText ? <p>{computed.missingText} Per questo i numeri con «almeno» sono un minimo.</p> : null}
          {computed.coverageText ? <p>Valori {computed.coverageText}.</p> : null}
          {computed.certainty ? (
            <p>
              Certezza: {CERTAINTY_LABELS[computed.certainty]}. {certaintyExplanation(computed.certainty)}
            </p>
          ) : null}
          {/* il testo della nota fissa, senza il suo filetto: qui è una riga tra le altre */}
          <p>{NUTRITION_DISCLAIMER_SHORT}</p>
        </Disclosure>
      ) : null}

      <div>
        <Link href="/app/salute/nutrizione" className={ui.textLink}>
          Nutrizione
        </Link>
      </div>
    </Disclosure>
  );
}
