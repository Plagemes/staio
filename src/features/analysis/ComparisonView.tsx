import { useMemo } from "react";
import { compareExperiment, type AdherenceInfo, type Experiment, type MeasureComparison } from "@/core/analysis";
import type { DiaryState } from "@/core/diary";
import type { DayIntake } from "@/core/nutrition";
import { Label, Value } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { buildIntervalPlot } from "./charts";
import { EXPERIMENT_MIN } from "./config";
import {
  adherenceLines,
  autocorrelationLines,
  differenceText,
  formatMeasureValue,
  measureDigits,
  measureMissingText,
  multiplicityText,
  verdictText,
} from "./experimentsView";
import { days, formatDecimal, plural, reliabilityHint, reliabilityText } from "./present";
import { InsufficientBox } from "./shared";
import styles from "./analysis.module.css";

type Compared = Extract<MeasureComparison, { status: "compared" }>;

function IntervalPlot({ m }: { m: Compared }) {
  const plot = buildIntervalPlot(m.difference, m.interval.low, m.interval.high, m.unit, measureDigits(m.measure), 300, m.provisional);
  return (
    <svg className={styles.intervalSvg} viewBox={`0 0 ${plot.width} 28`} role="img" aria-label={plot.description}>
      <line className={styles.zeroLine} x1={plot.zeroX} x2={plot.zeroX} y1="2" y2="26" />
      <line className={styles.intervalBar} x1={plot.lowX} x2={plot.highX} y1="14" y2="14" />
      <circle className={styles.intervalValue} cx={plot.valueX} cy="14" r="5" />
    </svg>
  );
}

function PeriodLine({ what, m, stats }: { what: string; m: Compared; stats: Compared["reference"] }) {
  const isWeight = m.measure === "weight";
  return (
    <p className={styles.basis}>
      {what}: media {formatMeasureValue(m.measure, stats.mean)} {m.unit}, variabilità {formatMeasureValue(m.measure, stats.sd)} su{" "}
      {isWeight ? plural(stats.n, "pesata", "pesate") : days(stats.n)}
    </p>
  );
}

function MeasureBlock({ m }: { m: MeasureComparison }) {
  if (m.status === "insufficient") {
    return (
      <div className={styles.measureBlock}>
        <p className={styles.rowName}>{m.label[0].toUpperCase() + m.label.slice(1)}</p>
        <InsufficientBox view={{ title: "Dati insufficienti", reasons: [], missing: measureMissingText(m) }} />
      </div>
    );
  }
  return (
    <div className={styles.measureBlock}>
      <div className={styles.rowHead}>
        <span className={styles.rowName}>{m.label[0].toUpperCase() + m.label.slice(1)}</span>
        <span className={styles.rowValue}>
          <Value certainty="estimated">{differenceText(m)}</Value>
        </span>
      </div>
      {m.provisional ? <span className={styles.tag}>Provvisorio</span> : null}
      <IntervalPlot m={m} />
      <p className={styles.range}>
        <strong>{verdictText(m)}.</strong>{" "}
        {m.differenceInUsualSds !== undefined ? `La differenza è ${formatDecimal(Math.abs(m.differenceInUsualSds), 2)} volte la variabilità abituale del riferimento. ` : ""}
        Nel grafico la linea tratteggiata è lo zero (nessuna differenza), il segmento è l&apos;intervallo, il punto è il valore centrale.
      </p>
      <PeriodLine what="Esperimento" m={m} stats={m.experiment} />
      <PeriodLine what="Riferimento" m={m} stats={m.reference} />
      <p className={styles.basis}>{reliabilityText(m.reliability)}. {reliabilityHint(m.reliability)}</p>
      <p className={styles.note}>{m.summary}</p>
      <details>
        <summary className={styles.summary}>Perché i giorni vicini valgono come meno osservazioni</summary>
        <ul className={styles.list}>
          {autocorrelationLines(m).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

interface Props {
  experiment: Experiment;
  diary: DiaryState;
  intakeDays: readonly DayIntake[];
  today: string;
}

/** Confronto tra il periodo dell'esperimento e il periodo di riferimento, calcolato solo quando si apre la scheda. */
export function ComparisonView({ experiment, diary, intakeDays, today }: Props) {
  const comparison = useMemo(
    () =>
      compareExperiment(
        experiment,
        { diary, intakeDays },
        {
          asOf: today,
          minObservations: EXPERIMENT_MIN.observations,
          minWeighIns: EXPERIMENT_MIN.weighIns,
          minWeightSpanDays: EXPERIMENT_MIN.weightSpanDays,
        },
      ),
    [experiment, diary, intakeDays, today],
  );

  if (comparison.status === "insufficient") {
    const measures = comparison.measures ?? [];
    return (
      <div className={styles.card}>
        <InsufficientBox
          view={{
            title: "Dati insufficienti per il confronto",
            reasons: comparison.reasons.includes("not_started") ? ["L'esperimento non è ancora iniziato."] : ["Nessuna misura ha dati sufficienti in entrambi i periodi."],
            missing: comparison.reasons.includes("not_started")
              ? [`Il confronto sarà possibile dal ${formatCalendarDate(experiment.startDate)}, con almeno qualche giorno di dati.`]
              : [],
          }}
        />
        {comparison.periods ? <Periods periods={comparison.periods} /> : null}
        {measures.map((m) => (
          <MeasureBlock key={m.measure} m={m} />
        ))}
        <AdherenceAndCaveats adherence={comparison.adherence} caveats={comparison.caveats} />
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {comparison.ongoing ? <p className={styles.note}>Il confronto usa i giorni trascorsi.</p> : null}
      {comparison.provisional ? (
        <div className={ui.callout} role="status">
          <strong>Provvisorio: l&apos;esperimento è in corso.</strong> Le differenze sono quelle di oggi e possono cambiare: finché non è concluso non si
          dichiara nulla.
        </div>
      ) : null}
      <Periods periods={comparison.periods} />
      <p className={styles.note}>{multiplicityText(comparison.multiplicity, comparison.provisional)}</p>
      {comparison.measures.map((m) => (
        <MeasureBlock key={m.measure} m={m} />
      ))}
      <AdherenceAndCaveats adherence={comparison.adherence} caveats={comparison.caveats} />
      <p className={ui.hint}>Descrive i tuoi dati, non spiega perché ci sia una differenza e non è un parere medico.</p>
    </div>
  );
}

function AdherenceAndCaveats({ adherence, caveats }: { adherence?: AdherenceInfo; caveats?: string[] }) {
  return (
    <>
      {adherence ? (
        <div>
          <Label>Aderenza</Label>
          <ul className={styles.list}>
            {adherenceLines(adherence).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {caveats && caveats.length > 0 ? (
        <div>
          <Label>Da tenere presente</Label>
          <ul className={styles.list}>
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function Periods({
  periods,
}: {
  periods: { reference: { from: string; to: string; days: number; completeDays: number; excludedDays: number }; experiment: { from: string; to: string; days: number; completeDays: number; excludedDays: number } };
}) {
  const box = (title: string, p: typeof periods.reference) => (
    <div className={styles.periodBox}>
      <Label>{title}</Label>
      <span>
        {formatCalendarDate(p.from)} – {formatCalendarDate(p.to)}
      </span>
      <span>
        {days(p.completeDays)} tracciati per intero su {p.days} ({p.excludedDays} esclusi)
      </span>
    </div>
  );
  return (
    <div className={styles.periods}>
      {box("Riferimento", periods.reference)}
      {box("Esperimento", periods.experiment)}
    </div>
  );
}
