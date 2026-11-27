import type { ReactElement } from "react";
import { capitalize } from "./texts";
import { TrendStrip } from "./TrendStrip";
import { splitEstimate, type IndicatorView } from "./weekView";
import styles from "./diet.module.css";

/** Un testo con tilde: la tilde si vede, e per il lettore di schermo si dice «stimato». */
export function EstimateText({ text }: { text: string }): ReactElement {
  return (
    <>
      {splitEstimate(text).map((part, i) =>
        part.tilde ? (
          <span key={i}>
            <span aria-hidden="true">~</span>
            <span className={styles.srOnly}> stimato </span>
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Una riga della vista: nome, valore, indicazione della fonte, stato in parole con la sua forma (anello per «sotto» o
 * «almeno», pallino pieno per «sopra», niente per «dentro») e l'andamento. Il colore non porta mai da solo lo stato.
 */
export function IndicatorRow({ view, sectionNote }: { view: IndicatorView; sectionNote?: string }): ReactElement {
  // lo stato uguale all'avviso già scritto in testa alla sezione non si ripete riga per riga
  const status = view.status === sectionNote ? undefined : view.status;
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowName}>{view.label}</span>
        <span className={styles.rowValue}>
          <EstimateText text={view.value} />
        </span>
      </div>
      {view.target ? <p className={styles.rowTarget}>{capitalize(view.target)}</p> : null}
      {status ? (
        <p className={styles.rowStatus}>
          <span className={styles.mark} data-shape={view.shape} aria-hidden="true" />
          <span>{status}</span>
        </p>
      ) : null}
      {view.trend ? <TrendStrip points={view.trend.points} summary={view.trend.summary} caption={`${view.label}, settimane a confronto`} /> : null}
    </li>
  );
}
