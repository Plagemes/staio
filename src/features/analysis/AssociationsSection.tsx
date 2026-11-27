import type { Association, AssociationsResult } from "@/core/analysis";
import { OUTCOME_LABELS } from "@/core/analysis";
import { Label, Value } from "@/design";
import { ASSOCIATION_MIN, ASSOCIATION_WINDOW_DAYS } from "./config";
import {
  associationControlText,
  associationsInsufficient,
  basisText,
  days,
  exposureLabel,
  formatDecimal,
  formatPercent,
  formatRange,
  formatSigned,
  reliabilityText,
} from "./present";
import { BasisLine, InsufficientBox } from "./shared";
import styles from "./analysis.module.css";

const STRENGTH_TEXT = { small: "piccola", moderate: "media", large: "grande" } as const;

/** Titolo di un'associazione: cosa è stato osservato, senza dire che una cosa spieghi l'altra. */
export function associationTitle(a: Pick<Association, "exposure" | "outcome" | "lag">): string {
  const when = a.lag === 0 ? "lo stesso giorno" : "il giorno dopo";
  return `${exposureLabel(a.exposure)} e ${OUTCOME_LABELS[a.outcome]} ${when}`;
}

function AssociationItem({ a }: { a: Association }) {
  const higher = a.direction === "higher" ? "più alto" : "più basso";
  return (
    <li className={styles.rowItem}>
      <div className={styles.rowHead}>
        <span className={styles.rowName}>{associationTitle(a)}</span>
        <span className={styles.rowValue}>
          <Value certainty="estimated">{formatSigned(a.difference, 2)} punti</Value>
        </span>
      </div>
      <p className={styles.note}>
        Nei giorni con questa esposizione il punteggio è stato in media {higher}. Intervallo della differenza (al {formatPercent(a.interval.confidence)},
        corretto per i confronti fatti):{" "}
        <Value certainty="estimated">{formatRange(a.interval.low, a.interval.high, "punti", 2)}</Value>.
      </p>
      <p className={styles.basis}>
        Con: {days(a.withExposure.days)}, media {formatDecimal(a.withExposure.mean, 2)} · Senza: {days(a.withoutExposure.days)}, media{" "}
        {formatDecimal(a.withoutExposure.mean, 2)}
      </p>
      <p className={styles.basis}>
        Forza {STRENGTH_TEXT[a.strength]} (differenza standardizzata {formatDecimal(Math.abs(a.standardizedDifference), 2)}) · {reliabilityText(a.reliability)}
        {a.permutationPValue !== undefined ? ` · prova di rimescolamento: valore p ${formatDecimal(a.permutationPValue, 4)}` : ""}
      </p>
    </li>
  );
}

export function AssociationsSection({ result, failed = false }: { result: AssociationsResult | undefined; failed?: boolean }) {
  if (!result && failed) {
    return (
      <div className={styles.card}>
        <p className={styles.range} role="status">
          Non sono riuscito a calcolare le associazioni. Il resto della pagina non ne risente: riapri la pagina per riprovare.
        </p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className={styles.card}>
        <p className={styles.range} role="status">
          Sto calcolando: confronto alimenti e orari con umore e sintomi, può richiedere qualche secondo. Il resto della pagina è già pronto.
        </p>
      </div>
    );
  }
  if (result.status === "insufficient") {
    return (
      <div className={styles.card}>
        <InsufficientBox view={associationsInsufficient(result)} />
        <p className={styles.note}>
          Per limitare le coincidenze si guardano solo alimenti e orari presenti in almeno {ASSOCIATION_MIN.daysWith} giorni e assenti in almeno{" "}
          {ASSOCIATION_MIN.daysWithout}, negli ultimi {ASSOCIATION_WINDOW_DAYS} giorni.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <p className={styles.range}>
        Confronti fatti: <strong>{result.tested}</strong>. Quelli che superano i controlli e una differenza minima: <strong>{result.passed}</strong>
        {result.passed > result.associations.length ? ` (mostrate le ${result.associations.length} più nette)` : ""}. Con tanti confronti qualche associazione può
        comparire per caso.
      </p>
      <div>
        <Label>Come si controllano le coincidenze</Label>
        <ul className={styles.list}>
          {associationControlText(result.control).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
      {result.associations.length === 0 ? (
        <p className={styles.range}>Nessuna associazione supera la soglia: nei dati di ora non si vede nulla di netto.</p>
      ) : (
        <ul className={styles.rows}>
          {result.associations.map((a) => (
            <AssociationItem key={`${a.exposure.id}|${a.outcome}|${a.lag}`} a={a} />
          ))}
        </ul>
      )}
      <BasisLine>{basisText(result.basis, { used: "Giorni tracciati per intero", observations: { singular: "valore di umore o sintomi", plural: "valori di umore o sintomi" } })}</BasisLine>
      <div>
        <Label>Da tenere presente</Label>
        <ul className={styles.list}>
          {result.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
