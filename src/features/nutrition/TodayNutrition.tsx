"use client";

import { useMemo } from "react";
import { Figure, FigureGrid, Label, ProgressLine, SectionHeader, Value } from "@/design";
import { dayOf } from "../format";
import ui from "../ui.module.css";
import { NutritionDisclaimer } from "./Disclaimer";
import { CERTAINTY_LABELS, certaintyExplanation } from "./labels";
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

/** Energia e macronutrienti di oggi, con certezza e parzialità dette a parole. Nessun obiettivo di energia. */
export function TodayNutrition({ now }: { now: string }) {
  const { intake, ready, error, prepInfo } = useIntake();
  const today = dayOf(now);
  const view = useMemo(() => (intake ? dayNutritionView(intake.days.find((d) => d.date === today), today) : undefined), [intake, today]);

  return (
    <section className={ui.section}>
      <SectionHeader label="Nutrienti di oggi" actionLabel="Nutrizione" actionHref="/app/salute/nutrizione" />
      {error ? (
        <p className={styles.quiet}>Non riesco a leggere i dati del telefono per calcolare i nutrienti.</p>
      ) : !ready || !view ? (
        <p className={styles.quiet} role="status">
          Calcolo i nutrienti…
        </p>
      ) : view.drinksOnlyText ? (
        <p className={styles.quiet}>{view.drinksOnlyText}</p>
      ) : view.empty ? (
        <p className={styles.quiet}>
          Niente da calcolare per ora: quando registri un pasto con alimenti che riconosco, qui compaiono energia e macronutrienti.
        </p>
      ) : (
        <div className={styles.dayBlock}>
          <div className={styles.energyRow}>
            <Label>Energia</Label>
            {view.energy ? (
              <div className={styles.energyNumber}>
                <span className={styles.bigNumber}>
                  {view.energy.prefix}
                  <Value certainty={view.energy.certainty}>{Math.round(view.energy.value).toLocaleString("it-IT")}</Value>
                </span>
                <span className={styles.of}>kcal</span>
              </div>
            ) : (
              <p className={styles.quiet}>Nessun dato di energia nelle voci riconosciute.</p>
            )}
            {view.total > 0 ? (
              <ProgressLine value={view.resolved} max={view.total} label={`Voci con dati: ${view.resolved} su ${view.total}`} />
            ) : null}
          </div>

          {view.macros.length > 0 ? (
            <FigureGrid>
              {view.macros.slice(0, 3).map((m) => (
                <Figure key={m.key} label={m.label}>
                  <CellValue cell={m} />
                </Figure>
              ))}
            </FigureGrid>
          ) : null}
          {view.macros.length > 3 ? (
            <p className={styles.more}>
              {view.macros.slice(3).map((m, i) => (
                <span key={m.key}>
                  {i > 0 ? " · " : ""}
                  {m.label} <CellValue cell={m} />
                </span>
              ))}
            </p>
          ) : null}

          {prepNotes(intake?.days.find((d) => d.date === today), prepInfo).map((note) => (
            <p key={note} className={ui.hint}>
              {note}
            </p>
          ))}
          {view.partialText ? <p className={ui.callout}>{view.partialText} I numeri sono una parte, non il totale della giornata.</p> : null}
          {view.missingText ? <p className={ui.hint}>{view.missingText} Per questo i numeri con «almeno» sono un minimo.</p> : null}
          {view.coverageText ? <p className={ui.hint}>Valori {view.coverageText}.</p> : null}
          {view.certainty ? (
            <p className={ui.hint}>
              Certezza: {CERTAINTY_LABELS[view.certainty]}. {certaintyExplanation(view.certainty)}
            </p>
          ) : null}
          <NutritionDisclaimer short />
        </div>
      )}
    </section>
  );
}
