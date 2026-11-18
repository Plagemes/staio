"use client";

import { useMemo } from "react";
import {
  PLANT_GROUPS,
  PROTEIN_MOMENTS,
  analyzeVariety,
  foodLookup,
  proteinSpread,
  type DayIntake,
  type FoodComposition,
} from "@/core/nutrition";
import { Label, ProgressLine, SectionHeader, Value } from "@/design";
import ui from "../ui.module.css";
import { CERTAINTY_LABELS, certaintyExplanation } from "./labels";
import styles from "./nutrition.module.css";
import { MOMENT_LABELS, PLANT_GROUP_LABELS, absentText, monotonyText, spreadView, varietyView } from "./weekView";

/** Proteine per momento della giornata nei giorni completi degli ultimi 7: descrizione, nessun obiettivo. */
export function ProteinSpreadSection({ days, today }: { days: readonly DayIntake[]; today: string }) {
  const spread = useMemo(() => proteinSpread(days, today), [days, today]);
  const view = spreadView(spread);
  return (
    <section className={ui.section}>
      <SectionHeader label="Proteine nella giornata" />
      {view.empty ? (
        <p className={styles.quiet}>{view.coverage}</p>
      ) : (
        <>
          <p className={ui.paragraph}>{view.summary}</p>
          <ul className={styles.contributors}>
            {PROTEIN_MOMENTS.map((moment) => {
              const m = spread.moments.find((x) => x.moment === moment)!;
              return (
                <li key={moment} className={styles.spreadRow}>
                  <div className={styles.contributor}>
                    <span>{MOMENT_LABELS[moment]}</span>
                    <span className={styles.contributorShare}>
                      {m.grams === undefined ? (
                        "nessun dato"
                      ) : (
                        <>
                          {m.partial ? "almeno " : ""}
                          <Value certainty={m.certainty ?? "estimated"}>{`${Math.round(m.grams)} g`}</Value>
                          {m.share !== undefined ? ` · ${Math.round(m.share * 100)}%` : ""}
                        </>
                      )}
                    </span>
                  </div>
                  {m.share !== undefined ? <ProgressLine value={m.share * 100} max={100} label={`${MOMENT_LABELS[moment]}: ${Math.round(m.grams ?? 0)} g di proteine`} /> : null}
                </li>
              );
            })}
          </ul>
          <p className={ui.hint}>{view.coverage}</p>
          {spread.dailyAverage !== undefined ? (
            <p className={ui.hint}>
              Media al giorno: {spread.partial ? "almeno " : ""}
              <Value certainty={spread.certainty ?? "estimated"}>{`${Math.round(spread.dailyAverage)} g`}</Value>.
              {spread.certainty ? ` Certezza: ${CERTAINTY_LABELS[spread.certainty]}. ${certaintyExplanation(spread.certainty)}` : ""}
            </p>
          ) : null}
          {view.caveat ? <p className={ui.hint}>{view.caveat}</p> : null}
          <p className={ui.hint}>«Altro» comprende gli spuntini. Descrive come sono distribuite, non quante ne servono.</p>
        </>
      )}
    </section>
  );
}

/** Vegetali diversi degli ultimi 7 giorni, per gruppo, con ciò che manca da più tempo e la monotonia dei pasti. */
export function VarietySection({ days, foods, today }: { days: readonly DayIntake[]; foods: readonly FoodComposition[]; today: string }) {
  const report = useMemo(() => analyzeVariety(days, foodLookup(foods), today), [days, foods, today]);
  const view = varietyView(report);
  return (
    <section className={ui.section}>
      <SectionHeader label="Varietà vegetale della settimana" />
      {view.empty ? (
        <p className={styles.quiet}>Ancora nessun dato negli ultimi 7 giorni: registra i pasti e qui compaiono i vegetali diversi che hai mangiato.</p>
      ) : (
        <>
          <div className={ui.tile}>
            <Label>Vegetali diversi, ultimi 7 giorni</Label>
            <div className={styles.energyNumber}>
              <span className={styles.bigNumber}>{view.headline}</span>
            </div>
            <p className={ui.hint}>{view.trend}</p>
          </div>
          <p className={ui.hint}>{view.coverage}</p>
          {view.caveat ? <p className={ui.hint}>{view.caveat}</p> : null}
          <ul className={styles.contributors}>
            {PLANT_GROUPS.map((g) => {
              const list = report.current.byGroup[g];
              return (
                <li key={g} className={styles.spreadRow}>
                  <div className={styles.contributor}>
                    <span>{PLANT_GROUP_LABELS[g]}</span>
                    <span className={styles.contributorShare}>{list.length}</span>
                  </div>
                  {list.length > 0 ? <span className={styles.matched}>{list.map((e) => e.name).join(", ")}</span> : null}
                </li>
              );
            })}
          </ul>
          {report.absent.length > 0 ? (
            <div>
              <Label>Cosa manca da più tempo</Label>
              <ul className={styles.contributors}>
                {report.absent.map((a) => (
                  <li key={a.group}>{absentText(a)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.monotony.length > 0 ? (
            <div>
              <Label>Sempre lo stesso</Label>
              <ul className={styles.contributors}>
                {report.monotony.map((m) => (
                  <li key={m.key}>{monotonyText(m)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className={ui.hint}>
            Conta alimenti diversi riconosciuti dalla tabella (secco e cotto sono lo stesso alimento); patate, olio e spezie non contano. È un conteggio, non un obiettivo né un giudizio.
          </p>
        </>
      )}
    </section>
  );
}
