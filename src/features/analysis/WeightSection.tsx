import type { ProjectionResult } from "@/core/analysis";
import type { WeightAveragePoint, WeightPoint } from "@/core/diary";
import { Label, Value } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { buildWeightProjectionChart } from "./charts";
import {
  basisText,
  days,
  formatDecimal,
  formatKgValue,
  formatPercent,
  formatRange,
  formatSigned,
  projectionInsufficient,
  reliabilityHint,
  reliabilityText,
} from "./present";
import { weightAutocorrelationText } from "./experimentsView";
import { Assumptions, BasisLine, InsufficientBox } from "./shared";
import { WeightProjectionChart } from "./WeightProjectionChart";
import styles from "./analysis.module.css";

interface Props {
  result: ProjectionResult;
  weights: WeightPoint[];
  average: WeightAveragePoint[];
  weightSpanDays: number;
  daysSinceLastWeighIn?: number;
}

export function WeightSection({ result, weights, average, weightSpanDays, daysSinceLastWeighIn }: Props) {
  if (result.status === "insufficient") {
    const chart = buildWeightProjectionChart({ weights, average });
    return (
      <div className={styles.card}>
        <InsufficientBox view={projectionInsufficient(result, { weightSpanDays, daysSinceLastWeighIn })} />
        {chart ? (
          <>
            <Label>Pesate registrate, senza tendenza né proiezione</Label>
            <WeightProjectionChart chart={chart} />
          </>
        ) : null}
      </div>
    );
  }
  const chart = buildWeightProjectionChart({ weights, average, projection: result });
  const last = result.points[result.points.length - 1];
  const t = result.trendInterval;
  return (
    <div className={styles.card}>
      <div>
        <Label>Tendenza osservata</Label>
        <div className={styles.bigLine}>
          <span className={styles.bigNumber}>
            <Value certainty="estimated">{formatSigned(result.trendKgPerWeek, 2)}</Value>
          </span>
          <span className={styles.unit}>kg a settimana</span>
        </div>
      </div>
      <p className={styles.range}>
        Intervallo al {formatPercent(t.confidence)}: <Value certainty="estimated">{formatRange(t.low, t.high, "kg a settimana", 2)}</Value>.{" "}
        {result.trendDistinguishableFromFlat
          ? "L'intervallo non comprende lo zero: la variazione è distinguibile da un peso stabile."
          : "L'intervallo comprende lo zero: la variazione non è distinguibile da un peso stabile."}
      </p>
      {chart ? <WeightProjectionChart chart={chart} /> : null}
      <p className={styles.range}>
        Se la tendenza continuasse, tra {days(result.horizonDays)} il peso atteso sarebbe{" "}
        <Value certainty="estimated">{formatKgValue(last.expectedKg)}</Value>, con una banda tra {formatKgValue(last.trendLowKg)} e{" "}
        {formatKgValue(last.trendHighKg)}. Una singola pesata cadrebbe tra {formatKgValue(last.dailyLowKg)} e {formatKgValue(last.dailyHighKg)}.
      </p>
      {result.horizonClamped ? <p className={styles.note}>L&apos;orizzonte è stato limitato: più in là la proiezione non ha senso.</p> : null}
      <BasisLine>
        {basisText(result.basis, { used: "Giorni con una pesata", observations: { singular: "pesata", plural: "pesate" } })} · scarto dei pesi attorno alla tendenza{" "}
        {formatDecimal(result.residualSdKg, 1)} kg · ultima pesata del {formatCalendarDate(result.fromDate)}
      </BasisLine>
      <BasisLine>
        {reliabilityText(result.reliability)}. {reliabilityHint(result.reliability)} Più la proiezione guarda lontano rispetto ai giorni osservati, meno è
        affidabile.
      </BasisLine>
      <Assumptions items={result.assumptions} />
      <details>
        <summary className={styles.summary}>Dettagli sul calcolo</summary>
        <p className={styles.note}>{weightAutocorrelationText(result.autocorrelation)}</p>
      </details>
      <p className={ui.hint}>Il peso oscilla da un giorno all&apos;altro: conta la linea, non il singolo punto.</p>
    </div>
  );
}
