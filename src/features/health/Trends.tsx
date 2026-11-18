"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getDay, type DiaryState } from "@/core/diary";
import { Disclosure } from "../common";
import { drinkCounts } from "../drinks";
import { TREND_DAYS, buildWeightChart, scoreAverages, supplementDays, waterWeek } from "../health";
import ui from "../ui.module.css";
import { scoreLine, supplementLine, trendSummaries, waterLine } from "./healthText";
import { WeightTrend } from "./WeightCard";
import styles from "./health.module.css";

interface Props {
  diary: DiaryState;
  /** Oggi, `YYYY-MM-DD`, nel fuso del diario. */
  today: string;
  /** L'obiettivo d'acqua scelto in Oggi. */
  waterGoalMl: number;
}

/**
 * «Andamento»: quattro righe richiuse, ognuna dice che cosa contiene senza aprirla. Qui si guarda soltanto: peso, come
 * sto e integratori si segnano dai fogli di «Segna», acqua e bevande da Oggi.
 */
export function Trends({ diary, today, waterGoalMl }: Props) {
  const summaries = useMemo(() => trendSummaries(diary, today, waterGoalMl), [diary, today, waterGoalMl]);
  const chart = useMemo(() => buildWeightChart(diary, today), [diary, today]);
  const scores = useMemo(() => scoreAverages(diary, today).filter((a) => a.days > 0), [diary, today]);
  // dal giorno più vicino: oggi è la prima riga
  const water = useMemo(() => [...waterWeek(diary, today)].reverse(), [diary, today]);
  const supplements = useMemo(() => supplementDays(diary, today), [diary, today]);
  const drinksToday = drinkCounts(getDay(diary, today)?.drinks ?? []);

  return (
    <div className={styles.trends}>
      <Disclosure title="Peso" summary={summaries.weight}>
        <WeightTrend chart={chart} summary={summaries.weight} />
      </Disclosure>

      <Disclosure title="Come sto" summary={summaries.scores}>
        {scores.length > 0 ? (
          <ul className={styles.facts}>
            {scores.map((average) => (
              <li key={average.measure}>{scoreLine(average)}</li>
            ))}
          </ul>
        ) : (
          <p className={ui.hint}>Niente segnato negli ultimi {TREND_DAYS} giorni.</p>
        )}
      </Disclosure>

      <Disclosure title="Acqua e bevande" summary={summaries.fluids}>
        <ul className={styles.facts} aria-label={`Acqua degli ultimi ${TREND_DAYS} giorni`}>
          {water.map((day) => (
            <li key={day.date}>{waterLine(day, today)}</li>
          ))}
        </ul>
        {drinksToday !== "" ? <p className={ui.paragraph}>Bevande di oggi: {drinksToday}</p> : null}
        <div className={styles.goTo}>
          <p className={ui.hint}>Acqua, bevande e obiettivo si cambiano in Oggi.</p>
          <Link href="/app" className={ui.textLink}>
            Segna in Oggi
          </Link>
        </div>
      </Disclosure>

      <Disclosure title="Integratori" summary={summaries.supplements}>
        {supplements.length > 0 ? (
          <ul className={styles.facts}>
            {supplements.map((entry) => (
              <li key={entry.name}>{supplementLine(entry)}</li>
            ))}
          </ul>
        ) : (
          <p className={ui.hint}>Nessun integratore negli ultimi {TREND_DAYS} giorni.</p>
        )}
      </Disclosure>
    </div>
  );
}
