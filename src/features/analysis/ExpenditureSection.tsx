import type { ExpenditureResult } from "@/core/analysis";
import { Label, Value } from "@/design";
import { formatCalendarDate } from "../format";
import { CERTAINTY_LABELS } from "../nutrition/labels";
import ui from "../ui.module.css";
import { EXPENDITURE_MIN, EXPENDITURE_WINDOW_DAYS } from "./config";
import {
  basisText,
  days,
  expenditureInsufficient,
  formatDecimal,
  formatKcal,
  formatKgPerWeek,
  formatPercent,
  formatRange,
  reliabilityHint,
  reliabilityText,
  weighIns,
} from "./present";
import { weightAutocorrelationText } from "./experimentsView";
import { Assumptions, BasisLine, FreshnessNote, InsufficientBox } from "./shared";
import styles from "./analysis.module.css";

export function ExpenditureSection({ result, weightSpanDays }: { result: ExpenditureResult; weightSpanDays: number }) {
  if (result.status === "insufficient") {
    return (
      <div className={styles.card}>
        <InsufficientBox view={expenditureInsufficient(result, { weightSpanDays })} />
        <p className={styles.note}>
          Il calcolo mette a confronto l&apos;energia che hai assunto con come è cambiato il peso. Servono almeno {EXPENDITURE_MIN.completeDays} giorni
          tracciati per intero e {EXPENDITURE_MIN.weighIns} pesate in {EXPENDITURE_WINDOW_DAYS} giorni, su almeno {EXPENDITURE_MIN.spanDays} giorni di
          distanza.
        </p>
      </div>
    );
  }
  const trend = result.weightTrendInterval;
  const excluded = result.exclusions.incompleteDays + result.exclusions.partialEnergyDays + result.exclusions.emptyDays;
  return (
    <div className={styles.card}>
      <div>
        <Label>Dispendio medio stimato</Label>
        <div className={styles.bigLine}>
          <span className={styles.bigNumber}>
            <Value certainty="estimated">{formatDecimal(result.expenditureKcal, 0)}</Value>
          </span>
          <span className={styles.unit}>kcal al giorno</span>
        </div>
      </div>
      <p className={styles.range}>
        Intervallo al {formatPercent(result.interval.confidence)}:{" "}
        <Value certainty="estimated">{formatRange(result.interval.low, result.interval.high, "kcal")}</Value>. Il valore centrale non va letto senza questo
        intervallo.
      </p>
      <BasisLine>
        {basisText(result.basis, { used: "Giorni usati", observations: { singular: "osservazione", plural: "osservazioni" } })} · {weighIns(result.weighIns)} · dal{" "}
        {formatCalendarDate(result.window.from)} al {formatCalendarDate(result.window.to)}
      </BasisLine>
      <FreshnessNote freshness={result.freshness} warnings={result.warnings} />
      <BasisLine>
        {reliabilityText(result.reliability)}. {reliabilityHint(result.reliability)}
      </BasisLine>

      <ul className={styles.rows}>
        <li className={styles.rowItem}>
          <div className={styles.rowHead}>
            <span className={styles.rowName}>Energia assunta, media</span>
            <span className={styles.rowValue}>
              <Value certainty={result.intakeCertainty}>{formatKcal(result.meanIntakeKcal)}</Value>
            </span>
          </div>
          <p className={styles.note}>
            Sui {days(result.basis.usedDays)} usati. Certezza dei dati: {CERTAINTY_LABELS[result.intakeCertainty]} (la peggiore tra i giorni usati);
            l&apos;intervallo include un margine per l&apos;errore sistematico di quantità e tabelle.
          </p>
        </li>
        <li className={styles.rowItem}>
          <div className={styles.rowHead}>
            <span className={styles.rowName}>Andamento del peso</span>
            <span className={styles.rowValue}>
              <Value certainty="estimated">{formatKgPerWeek(result.weightTrendKgPerWeek)}</Value>
            </span>
          </div>
          <p className={styles.note}>
            Intervallo {formatRange(trend.low, trend.high, "kg a settimana", 2)}, su {weighIns(result.weighIns)}.
          </p>
        </li>
      </ul>

      {excluded > 0 ? (
        <p className={styles.note}>
          Esclusi dal calcolo: {days(result.exclusions.incompleteDays)} non tracciati per intero, {days(result.exclusions.partialEnergyDays)} con
          energia parziale, {days(result.exclusions.emptyDays)} senza alcuna voce.
        </p>
      ) : null}
      <Assumptions
        items={[...result.assumptions, `Valore usato: ${formatDecimal(result.energyPerKgKcal, 0)} kcal per chilo di variazione di peso.`]}
      />
      <details>
        <summary className={styles.summary}>Dettagli sul calcolo</summary>
        <p className={styles.note}>{weightAutocorrelationText(result.weightAutocorrelation)}</p>
      </details>
      <p className={ui.hint}>È la media del periodo, non un valore per un singolo giorno e non un fabbisogno da seguire.</p>
    </div>
  );
}
