"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { createWeight } from "@/core/diary";
import { useDiary } from "@/data";
import { Button, Label } from "@/design";
import { dayOf, formatCalendarDate } from "../format";
import { WEIGHT_WINDOW_DAYS, averageChange, buildWeightChart, formatKg, parseWeightKg } from "../health";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import styles from "./health.module.css";

export function WeightCard() {
  const diary = useDiary();
  const now = useNow();
  const { record, busy } = useRecord();
  const ids = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const today = now ? dayOf(now) : null;
  const chart = useMemo(() => (diary.data && today ? buildWeightChart(diary.data, today) : null), [diary.data, today]);
  if (!chart) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const read = parseWeightKg(text);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    const result = await record((o) => [createWeight({ kg: read.value }, o)], `Peso registrato: ${formatKg(read.value)}.`);
    if (result.ok) {
      setText("");
      setError(null);
    } else setError(result.error);
  }

  const change = averageChange(chart);
  const summary = chart.last
    ? `Ultima pesata ${formatKg(chart.last.kg)} il ${formatCalendarDate(chart.last.date)}.` +
      (chart.enough && chart.lastAverage ? ` Media a 7 giorni ${formatKg(chart.lastAverage.kg)}.` : "")
    : "";

  return (
    <div className={styles.card}>
      <form className={ui.field} onSubmit={onSubmit} noValidate>
        <label className={ui.fieldLabel} htmlFor={`${ids}-kg`}>
          Peso di oggi
        </label>
        <div className={styles.inline}>
          <input
            id={`${ids}-kg`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="71,4 kg"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-kg-error` : undefined}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            Registra peso
          </Button>
        </div>
        {error ? (
          <p className={ui.error} id={`${ids}-kg-error`}>
            {error}
          </p>
        ) : null}
      </form>

      {chart.count === 0 ? (
        <p className={ui.hint}>Nessuna pesata negli ultimi {WEIGHT_WINDOW_DAYS} giorni. Con qualche pesata comparirà l&apos;andamento.</p>
      ) : !chart.enough ? (
        <>
          <p className={ui.paragraph}>
            {chart.count === 1 ? "Hai 1 pesata" : `Hai ${chart.count} pesate`} negli ultimi {WEIGHT_WINDOW_DAYS} giorni: troppo poche per
            mostrare un andamento. Servono almeno 3 pesate.
          </p>
          <ul className={styles.todayList}>
            {chart.dots.map((d) => (
              <li key={d.date}>
                {formatCalendarDate(d.date)} · {formatKg(d.kg)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={styles.chartBox}>
          <Label>Ultimi {WEIGHT_WINDOW_DAYS} giorni</Label>
          <svg
            className={styles.chart}
            viewBox={`0 0 ${chart.width} ${chart.height + 14}`}
            role="img"
            aria-label={`Peso negli ultimi ${WEIGHT_WINDOW_DAYS} giorni, ${chart.count} pesate. ${summary}`}
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
            {chart.average.length > 0 ? (
              <circle className={styles.lastDot} cx={chart.average[chart.average.length - 1].x} cy={chart.average[chart.average.length - 1].y} r="4" />
            ) : null}
          </svg>
          <div className={styles.legend}>
            <span>● pesate</span>
            <span>— media a 7 giorni</span>
          </div>
          <p className={ui.paragraph}>{summary}</p>
          {change !== undefined ? (
            <p className={ui.hint}>
              Nel periodo la media è {change === 0 ? "rimasta uguale" : change < 0 ? `scesa di ${formatKg(-change)}` : `salita di ${formatKg(change)}`}.
              Il peso oscilla da un giorno all&apos;altro: conta la linea, non il singolo punto. Staio non dà indicazioni mediche.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
