import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { toPoints, type WeightProjectionChart as Chart } from "./charts";
import { formatKgValue } from "./present";
import styles from "./analysis.module.css";

/** Peso osservato, tendenza e proiezione a banda. Il valore atteso non compare mai senza la sua banda. */
export function WeightProjectionChart({ chart }: { chart: Chart }) {
  const hasProjection = chart.expected.length > 0;
  return (
    <div className={styles.chartBox}>
      <svg className={styles.chart} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={chart.description}>
        {chart.yTicks.map((t) => (
          <g key={t.label}>
            <line className={styles.gridLine} x1={chart.plotLeft} x2={chart.plotRight} y1={t.y} y2={t.y} />
            <text className={styles.axis} x={chart.plotLeft - 4} y={t.y + 3} textAnchor="end">
              {t.label}
            </text>
          </g>
        ))}
        {chart.xTicks.map((t) => (
          <text key={`${t.label}-${t.x}`} className={styles.axis} x={t.x} y={chart.height - 6} textAnchor={t.anchor}>
            {t.label}
          </text>
        ))}
        {hasProjection ? (
          <>
            <polygon className={styles.dailyBand} points={toPoints(chart.dailyBand)} />
            <polygon className={styles.trendBand} points={toPoints(chart.trendBand)} />
            {chart.splitX !== undefined ? (
              <line className={styles.splitLine} x1={chart.splitX} x2={chart.splitX} y1={chart.plotTop} y2={chart.plotBottom} />
            ) : null}
            <polyline className={styles.expectedLine} points={toPoints(chart.expected)} />
          </>
        ) : null}
        {chart.average.length > 1 ? <polyline className={styles.avgLine} points={toPoints(chart.average)} /> : null}
        {chart.dots.map((d) => (
          <circle key={d.date} className={styles.dot} cx={d.x} cy={d.y} r="2.5" />
        ))}
      </svg>
      <ul className={styles.legend} aria-hidden="true">
        <li>● pesate</li>
        {chart.average.length > 1 ? <li>— media a 7 giorni</li> : null}
        {hasProjection ? <li>┄ proiezione</li> : null}
        {hasProjection ? <li>banda scura: incertezza della tendenza</li> : null}
        {hasProjection ? <li>banda chiara: una singola pesata</li> : null}
      </ul>
      <p className={styles.note}>{chart.description}</p>
      {chart.table.length > 0 ? (
        <details>
          <summary className={styles.summary}>Valori della proiezione in tabella</summary>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={ui.srOnly}>Peso atteso con le bande, giorno per giorno</caption>
              <thead>
                <tr>
                  <th scope="col">Giorno</th>
                  <th scope="col">Atteso</th>
                  <th scope="col">Banda tendenza</th>
                  <th scope="col">Una pesata</th>
                </tr>
              </thead>
              <tbody>
                {chart.table.map((r) => (
                  <tr key={r.date}>
                    <th scope="row">{formatCalendarDate(r.date).replace(/ \d{4}$/, "")}</th>
                    <td>{formatKgValue(r.expectedKg)}</td>
                    <td>
                      {formatKgValue(r.trendLowKg)} – {formatKgValue(r.trendHighKg)}
                    </td>
                    <td>
                      {formatKgValue(r.dailyLowKg)} – {formatKgValue(r.dailyHighKg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
