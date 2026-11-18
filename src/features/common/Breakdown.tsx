"use client";

// «Da cosa è fatto»: il foglio che apre un numero calcolato e ne mostra le parti. Non sa niente del dato: riceve
// testi già pronti (nutrienti oggi, poi costi e valore della dispensa).
import Link from "next/link";
import type { ReactElement } from "react";
import { Label, Value, cx, type Certainty } from "@/design";
import ui from "../ui.module.css";
import styles from "./Breakdown.module.css";
import { Sheet } from "./Sheet";

export interface BreakdownRow {
  id: string;
  label: string;
  value: string;
  hint?: string;
  /** La riga si tocca per intero: chiude il foglio e porta lì. */
  href?: string;
  muted?: boolean;
  /** Certezza del valore: con `estimated` il valore si scrive come stima (la tilde la mette `Value`). */
  certainty?: Certainty;
}

/** Un gruppo di righe in più, sotto un'etichetta (per esempio «Le voci che pesano di più»). */
export interface BreakdownGroup {
  label: string;
  rows: readonly BreakdownRow[];
}

export interface BreakdownSheetProps {
  /** «Energia di oggi» */
  title: string;
  /** «980 kcal»: senza la tilde quando c'è `totalCertainty`. */
  total: string;
  /** Una parola prima del totale, fuori dalla stima: «almeno». */
  totalPrefix?: string;
  totalCertainty?: Certainty;
  /** Una riga: che cosa misura. */
  lead?: string;
  rows: readonly BreakdownRow[];
  /** Righe in più dopo le parti, sotto la loro etichetta. */
  extra?: BreakdownGroup;
  /** Le voci che non contano, sotto un'etichetta: «Senza dato (2): non contano». */
  missingLabel?: string;
  missing?: readonly BreakdownRow[];
  /** «Somma delle voci: 980 kcal.» */
  check?: string;
  /** Perché è una stima e come renderla certa. */
  note?: string;
  onClose: () => void;
}

function Row({ row }: { row: BreakdownRow }) {
  const content = (
    <>
      <span className={styles.text}>
        <span className={styles.label}>{row.label}</span>
        {row.hint ? <span className={styles.hint}>{row.hint}</span> : null}
      </span>
      <span className={styles.value}>
        <Value certainty={row.certainty ?? "measured"}>{row.value}</Value>
      </span>
    </>
  );
  const rowClass = cx(styles.row, row.muted ? styles.muted : undefined);
  return (
    <li className={styles.item}>
      {/* il foglio chiude sé stesso e poi naviga (`closeSheetThen`) per ogni collegamento interno che contiene */}
      {row.href !== undefined ? (
        <Link className={cx(rowClass, styles.link)} href={row.href}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function Rows({ rows }: { rows: readonly BreakdownRow[] }) {
  return (
    <ul className={cx(styles.list, ui.group)}>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </ul>
  );
}

/** Il foglio «Da cosa è fatto»: il totale in testa, una riga per parte, le voci che non contano, la riga di controllo. */
export function BreakdownSheet({ title, total, totalPrefix, totalCertainty, lead, rows, extra, missingLabel, missing, check, note, onClose }: BreakdownSheetProps): ReactElement {
  const head = (
    <div className={styles.head}>
      <p className={styles.total}>
        {totalPrefix ? `${totalPrefix} ` : null}
        <Value certainty={totalCertainty ?? "measured"}>{total}</Value>
      </p>
      {lead ? <p className={ui.hint}>{lead}</p> : null}
    </div>
  );
  return (
    <Sheet title={title} head={head} onClose={onClose}>
      {rows.length > 0 ? <Rows rows={rows} /> : null}
      {extra && extra.rows.length > 0 ? (
        <div className={styles.group}>
          <Label>{extra.label}</Label>
          <Rows rows={extra.rows} />
        </div>
      ) : null}
      {missing && missing.length > 0 ? (
        <div className={styles.group}>
          {missingLabel ? <Label>{missingLabel}</Label> : null}
          <Rows rows={missing.map((row) => ({ ...row, muted: true }))} />
        </div>
      ) : null}
      {check || note ? (
        <div className={styles.foot}>
          {check ? <p className={ui.hint}>{check}</p> : null}
          {note ? <p className={ui.hint}>{note}</p> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
