import type { ReactNode } from "react";
import { Label } from "@/design";
import ui from "../ui.module.css";
import { NOT_MEDICAL_NOTE } from "./config";
import { freshnessLines, type Freshness, type InsufficientView } from "./present";
import styles from "./analysis.module.css";

/** Riga fissa: queste schermate non sono pareri medici. */
export function AnalysisDisclaimer() {
  return <p className={styles.disclaimer}>{NOT_MEDICAL_NOTE}</p>;
}

/** Esito insufficiente: dice che non c'è un numero, perché, e cosa manca. Mai zero e mai vuoto. */
export function InsufficientBox({ view }: { view: InsufficientView }) {
  return (
    <div className={styles.insufficient} role="group" aria-label={view.title}>
      <p className={styles.insufficientTitle}>{view.title}</p>
      {view.reasons.length > 0 ? (
        <ul className={styles.list}>
          {view.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {view.missing.length > 0 ? (
        <>
          <Label>Cosa manca</Label>
          <ul className={styles.list}>
            {view.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Su quanti dati poggia un numero e con quale affidabilità. */
export function BasisLine({ children }: { children: ReactNode }) {
  return <p className={styles.basis}>{children}</p>;
}

export function Assumptions({ title = "Ipotesi su cui poggia", items }: { title?: string; items: readonly string[] }) {
  return (
    <div className={ui.section}>
      <Label>{title}</Label>
      <ul className={styles.list}>
        {items.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

/** Data dell'ultimo dato usato; se il risultato è datato, un avviso ben visibile. */
export function FreshnessNote({ freshness, warnings }: { freshness: Freshness; warnings: readonly string[] }) {
  const lines = freshnessLines(freshness, warnings);
  return (
    <>
      {lines.dated ? (
        <div className={ui.calloutStrong} role="status">
          <strong>Risultato datato.</strong> {lines.dated.replace(/^Risultato datato: /, "")}
        </div>
      ) : null}
      {lines.last ? <BasisLine>{lines.last}</BasisLine> : null}
      {lines.other.map((w) => (
        <p key={w} className={styles.note}>
          {w}
        </p>
      ))}
    </>
  );
}
