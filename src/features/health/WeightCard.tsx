"use client";

import { Label } from "@/design";
import { WEIGHT_WINDOW_DAYS, averageChange, formatKg, type WeightChart } from "../health";
import ui from "../ui.module.css";
import { shortDate } from "./healthText";
import styles from "./health.module.css";

/**
 * Dentro la riga «Peso» di «Andamento»: il grafico degli ultimi trenta giorni, o l'elenco delle pesate quando sono
 * troppo poche per un andamento. Qui non si segna niente: il peso si segna dal foglio «Peso».
 */
export function WeightTrend({ chart, summary }: { chart: WeightChart; summary: string }) {
  if (chart.count === 0) return <p className={ui.hint}>Nessuna pesata negli ultimi {WEIGHT_WINDOW_DAYS} giorni.</p>;

  if (!chart.enough) {
    return (
      <>
        <ul className={styles.facts}>
          {chart.dots.map((d) => (
            <li key={d.date}>
              {shortDate(d.date)} · {formatKg(d.kg)}
            </li>
          ))}
        </ul>
        <p className={ui.hint}>Servono almeno 3 pesate per un andamento.</p>
      </>
    );
  }

  const change = averageChange(chart);
  const lastAverage = chart.average.at(-1);
  return (
    <div className={styles.chartBox}>
      <Label>Ultimi {WEIGHT_WINDOW_DAYS} giorni</Label>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${chart.width} ${chart.height + 14}`}
        role="img"
        aria-label={`Peso negli ultimi ${WEIGHT_WINDOW_DAYS} giorni, ${chart.count} pesate: ${summary}.`}
      >
        <line className={styles.gridLine} x1="0" x2={chart.width} y1="8" y2="8" />
        <line className={styles.gridLine} x1="0" x2={chart.width} y1={chart.height - 8} y2={chart.height - 8} />
        <text className={styles.axis} x="0" y="6">
          {formatKg(chart.yMax)}
        </text>
        <text className={styles.axis} x="0" y={chart.height + 6}>
          {formatKg(chart.yMin)}
        </text>
        <text className={styles.axis} x={chart.width} y={chart.height + 12} textAnchor="end">
          oggi
        </text>
        <polyline className={styles.avgLine} points={chart.average.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
        {chart.dots.map((p) => (
          <circle key={p.date} className={styles.dot} cx={p.x} cy={p.y} r="3" />
        ))}
        {lastAverage ? <circle className={styles.lastDot} cx={lastAverage.x} cy={lastAverage.y} r="4" /> : null}
      </svg>
      <div className={styles.legend}>
        <span>● pesate</span>
        <span>— media a 7 giorni</span>
      </div>
      {change !== undefined ? (
        <p className={ui.paragraph}>
          Nel periodo la media è {change === 0 ? "rimasta uguale" : change < 0 ? `scesa di ${formatKg(-change)}` : `salita di ${formatKg(change)}`}.
        </p>
      ) : null}
    </div>
  );
}
