"use client";

import Link from "next/link";
import { IMPACT_METRICS, type MetricImpact } from "@/core/quality";
import { Button, Label, SectionHeader } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { GOAL_OPTIONS, hasGoal, toggleGoal } from "./goals";
import { KNOWN_PRODUCTS_PATH, SHELF_PATH, qualityHref } from "./links";
import {
  METRIC_TITLE,
  NOT_MEDICAL,
  changeEffectText,
  metricAmountText,
  metricCoverageText,
  metricTotalText,
  num,
  sharePercent,
} from "./texts";
import { saveGoals, useDietImpact, useGoals } from "./useQuality";
import styles from "./quality.module.css";

function MetricBlock({ m }: { m: MetricImpact }) {
  return (
    <li className={styles.metric}>
      <Label>{METRIC_TITLE[m.metric]}</Label>
      <p className={styles.metricTotal}>{metricTotalText(m)}</p>
      {m.metric === "ultraProcessed" && m.distinctProducts !== undefined && m.distinctProducts > 0 ? (
        <p className={styles.small}>
          {m.distinctProducts} {m.distinctProducts === 1 ? "prodotto diverso" : "prodotti diversi"}, del gruppo NOVA 4 secondo Open Food Facts.
        </p>
      ) : null}
      {m.contributors.length > 0 ? (
        <>
          <p className={styles.groupTitle}>Pesano di più</p>
          {m.contributors.map((c) => (
            <div key={c.barcode} className={styles.contributor}>
              <Link href={qualityHref(c.barcode)}>{c.name}</Link>
              <span className={styles.share}>
                {sharePercent(c.share)} · {metricAmountText(m.metric, c.perWeek)}
              </span>
            </div>
          ))}
        </>
      ) : null}
      <p className={styles.small}>{metricCoverageText(m)}</p>
    </li>
  );
}

function Goals() {
  const { goals, ready } = useGoals();
  return (
    <section className={ui.section} aria-label="Obiettivi">
      <SectionHeader label="I tuoi obiettivi" />
      <p className={styles.small}>
        Facoltativi. Servono solo a dire se un prodotto ti aiuta o ti pesa rispetto a ciò che vuoi ottenere; restano sul telefono. Un nutriente ha un solo
        obiettivo.
      </p>
      {GOAL_OPTIONS.map((o) => (
        <label key={`${o.nutrient}:${o.direction}`} className={ui.switch}>
          <input
            type="checkbox"
            checked={hasGoal(goals, o.nutrient, o.direction)}
            disabled={!ready}
            onChange={() => void saveGoals(toggleGoal(goals, o.nutrient, o.direction))}
          />
          <span className={ui.switchText}>{o.label}</span>
        </label>
      ))}
    </section>
  );
}

function Impact() {
  const impact = useDietImpact();
  if (impact.error) return <StorageError />;
  if (!impact.ready || !impact.view) return <LoadingLine text="Calcolo i consumi…" />;
  const { summary, report } = impact.view;

  if (summary.productLines === 0) {
    return (
      <div className={ui.empty}>
        <h3 className={ui.emptyTitle}>Ancora niente da pesare</h3>
        <p className={ui.emptyText}>
          Nel registro non ci sono consumi di prodotti con codice a barre e valori nutrizionali negli ultimi {summary.windowDays} giorni. Leggi il codice
          dei prodotti che compri e segna quando li mangi: poi qui vedi quali pesano di più.
        </p>
        <Button href="/app/cattura/codice" variant="outline">
          Leggi un codice
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className={styles.small}>
        Media a settimana sugli ultimi {summary.windowDays} giorni ({num(summary.productLines, 0)} {summary.productLines === 1 ? "consumo" : "consumi"} di
        prodotti con codice a barre).
        {summary.unusableLines > 0
          ? ` ${summary.unusableLines} ${summary.unusableLines === 1 ? "consumo" : "consumi"} di dispensa non si possono contare (senza valori nutrizionali, in pezzi o prodotto non più salvato).`
          : ""}
        {summary.otherLines > 0 ? ` Non entrano ${summary.otherLines} voci di alimenti generici dei pasti, che non sono prodotti con codice.` : ""} Se non
        registri tutto ciò che mangi, i totali sono più bassi del vero.
      </p>
      <ul className={styles.list}>
        {IMPACT_METRICS.map((metric) => (
          <MetricBlock key={metric} m={report.metrics[metric]} />
        ))}
      </ul>

      <SectionHeader label="I pochi cambi che spostano di più" />
      {report.changes.length === 0 ? (
        <p className={styles.quiet}>Nessun prodotto porta una quota misurabile di questi totali: non ho cambi da proporre.</p>
      ) : (
        <>
          <p className={styles.small}>
            Toglierne del tutto uno: dimezzarne la frequenza sposta la metà. Calcolo sui soli consumi con il dato, quindi sono minimi.
          </p>
          <ul className={styles.list}>
            {report.changes.map((c) => (
              <li key={c.barcode} className={styles.metric}>
                <Link className={styles.altName} href={qualityHref(c.barcode)}>
                  {c.name}
                </Link>
                <ul className={styles.bullets}>
                  {c.effects.map((e) => (
                    <li key={e.metric}>{changeEffectText(e.metric, e.perWeek, e.share)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.excluded.length > 0 ? (
        <p className={styles.small}>{report.excluded.length} consumi esclusi perché la quantità o la frequenza non sono valide.</p>
      ) : null}
    </>
  );
}

/** Ingresso `/app/qualita`: che cosa pesa di più nella dieta, i cambi che contano, scaffale e prodotti conosciuti. */
export function Quality() {
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Qualità</h1>
        <Link href="/app/spesa" className={ui.textLink}>
          Torna alla spesa
        </Link>
      </div>
      <p className={ui.lead}>
        Ogni prodotto si guarda dimensione per dimensione, con il suo perché e la sua fonte. Non c&apos;è un voto unico, e ciò che non si può valutare resta
        «non valutabile».
      </p>

      <div className={ui.row}>
        <Button href={SHELF_PATH}>Modalità scaffale</Button>
        <Button href={KNOWN_PRODUCTS_PATH} variant="outline">
          Prodotti che conosci
        </Button>
      </div>

      <section className={ui.section} aria-label="Che cosa pesa di più nella tua dieta">
        <SectionHeader label="Cosa pesa di più nella tua dieta" />
        <Impact />
      </section>

      <Goals />

      <p className={ui.hint}>{NOT_MEDICAL}</p>
    </div>
  );
}
