"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { localMoment } from "@/core/diary";
import { dayBreakdown, type NutrientKey } from "@/core/nutrition";
import { Figure, FigureGrid, Label, ProgressLine, Value, cx } from "@/design";
import { Disclosure } from "../common";
import { BreakdownSheet } from "../common/Breakdown";
import { dayOf } from "../format";
import { nutritionSummary } from "../today/summaries";
import ui from "../ui.module.css";
import { dayBreakdownContent } from "./breakdownView";
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

/** Una cifra che si tocca: apre «Da cosa è fatto». Si legge come la cifra, non come un pulsante in più. */
function Tap({ label, onOpen, className, children }: { label: string; onOpen: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={cx(styles.tap, className)} aria-haspopup="dialog" onClick={onOpen}>
      {children}
      <span className={ui.srOnly}> · da cosa è fatto: {label}</span>
    </button>
  );
}

/**
 * Energia e macronutrienti di oggi in una riga richiusa di Oggi: chiusa dice i due numeri che contano, aperta mostra
 * il resto, con certezza e parzialità dette a parole. Ogni cifra si apre e dice da quali voci viene. Nessun obiettivo
 * di energia.
 */
export function TodayNutrition({ now }: { now: string }) {
  const { intake, ready, error, prepInfo } = useIntake();
  const [open, setOpen] = useState<NutrientKey | null>(null);
  const today = dayOf(now);
  const day = intake?.days.find((d) => d.date === today);
  // «Totale parziale» conta solo i momenti già cominciati, come lo stato del giorno
  const nowMinutes = intake ? localMoment(now, intake.timeZone)?.minutes : undefined;
  const view = useMemo(() => (intake ? dayNutritionView(day, today, { nowMinutes }) : undefined), [intake, day, today, nowMinutes]);
  const computed = ready ? view : undefined;
  const detailed = computed !== undefined && !computed.drinksOnlyText && !computed.empty;

  const cellOf = (key: NutrientKey): NutrientCell | undefined => (key === "energyKcal" ? computed?.energy : computed?.macros.find((m) => m.key === key));
  const openCell = open !== null ? cellOf(open) : undefined;
  const sheet = useMemo(() => {
    if (open === null || !day || !openCell) return undefined;
    return dayBreakdownContent(dayBreakdown(day, open), { partial: openCell.partial, certainty: openCell.certainty, prepInfo });
  }, [open, day, openCell, prepInfo]);

  return (
    <>
      <Disclosure title="Nutrienti" summary={error ? "dati non leggibili" : nutritionSummary(computed)}>
        {error ? (
          <p className={ui.paragraph}>Non riesco a leggere i dati del telefono per calcolare i nutrienti.</p>
        ) : !computed ? (
          <p className={ui.paragraph} role="status">
            Calcolo i nutrienti…
          </p>
        ) : computed.drinksOnlyText ? (
          computed.energy ? (
            <p className={ui.paragraph}>
              Per ora solo bevande:{" "}
              <Tap label={computed.energy.label} onOpen={() => setOpen("energyKcal")}>
                <CellValue cell={computed.energy} />
              </Tap>
              .
            </p>
          ) : (
            <p className={ui.paragraph}>{computed.drinksOnlyText}</p>
          )
        ) : computed.empty ? (
          <p className={ui.paragraph}>
            Niente da calcolare per ora: quando registri un pasto con alimenti che riconosco, qui compaiono energia e macronutrienti.
          </p>
        ) : (
          <>
            <div className={styles.energyRow}>
              <Label>Energia</Label>
              {computed.energy ? (
                <Tap label={computed.energy.label} className={styles.energyNumber} onOpen={() => setOpen("energyKcal")}>
                  <span className={styles.bigNumber}>
                    {computed.energy.prefix}
                    <Value certainty={computed.energy.certainty}>{Math.round(computed.energy.value).toLocaleString("it-IT")}</Value>
                  </span>
                  <span className={styles.of}>kcal</span>
                </Tap>
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
                    <Tap label={m.label} onOpen={() => setOpen(m.key)}>
                      <CellValue cell={m} />
                    </Tap>
                  </Figure>
                ))}
              </FigureGrid>
            ) : null}
            {computed.macros.length > 3 ? (
              <p className={styles.more}>
                {computed.macros.slice(3).map((m, i) => (
                  <span key={m.key}>
                    {i > 0 ? " · " : ""}
                    <Tap label={m.label} onOpen={() => setOpen(m.key)}>
                      {m.label} <CellValue cell={m} />
                    </Tap>
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
      {sheet ? <BreakdownSheet {...sheet} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
