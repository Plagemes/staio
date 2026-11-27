import type { ReactElement } from "react";
import type { TrendPoint } from "./weekView";
import styles from "./diet.module.css";

const WIDTH = 160;
const HEIGHT = 32;
const PAD_X = 6;
const PAD_Y = 5;

interface Dot {
  x: number;
  y: number;
  partial: boolean;
  key: string;
}

/**
 * L'andamento di un indicatore sulle ultime settimane: una linea con un punto per settimana. Una lacuna (dati
 * insufficienti) resta vuota e spezza la linea, mai 0. Un punto vuoto è una settimana in corso o un minimo. Il grafico
 * ha un nome per il lettore di schermo e, accanto, la stessa cosa in una tabella.
 */
export function TrendStrip({ points, summary, caption }: { points: readonly TrendPoint[]; summary: string; caption: string }): ReactElement {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const top = Math.max(1e-9, ...values);
  const step = points.length > 1 ? (WIDTH - 2 * PAD_X) / (points.length - 1) : 0;
  const slots: (Dot | null)[] = points.map((p, i) =>
    p.value === null ? null : { x: PAD_X + i * step, y: HEIGHT - PAD_Y - (p.value / top) * (HEIGHT - 2 * PAD_Y), partial: p.partial, key: p.weekStart },
  );
  // tratti di settimane consecutive con dati
  const runs: Dot[][] = [];
  for (const slot of slots) {
    if (slot === null) runs.push([]);
    else if (runs.length === 0 || runs[runs.length - 1] === undefined) runs.push([slot]);
    else runs[runs.length - 1].push(slot);
  }

  return (
    <div className={styles.trend}>
      <svg className={styles.trendSvg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary.replace(/~/g, "stimato ")} focusable="false">
        <line className={styles.trendBase} x1={PAD_X} x2={WIDTH - PAD_X} y1={HEIGHT - PAD_Y} y2={HEIGHT - PAD_Y} />
        {runs
          .filter((run) => run.length > 1)
          .map((run) => (
            <polyline key={run[0].key} className={styles.trendLine} points={run.map((d) => `${d.x},${d.y}`).join(" ")} />
          ))}
        {slots.map((d) =>
          d ? <circle key={d.key} className={d.partial ? styles.trendDotPartial : styles.trendDot} cx={d.x} cy={d.y} r={2.5} /> : null,
        )}
      </svg>
      <table className={styles.srOnly}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Settimana dal</th>
            <th scope="col">Valore</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.weekStart}>
              <th scope="row">{p.weekLabel}</th>
              <td>{p.text.replace(/~/g, "stimato ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
