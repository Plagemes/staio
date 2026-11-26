"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { cx } from "@/design";
import ui from "../ui.module.css";
import styles from "./Disclosure.module.css";

export interface DisclosureProps {
  title: string;
  /** Che cosa c'è dentro, in una riga: si legge a sezione chiusa. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Stato controllato, se serve (per esempio per aprirla quando dentro c'è un errore). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Variante piccola per le spiegazioni («Che cosa significa»): una riga di testo, senza riepilogo. */
  quiet?: boolean;
  /** Una classe in più sulla sezione (per esempio per darle un fondo di un tema). */
  className?: string;
}

/** Una sezione richiusa: la riga dice che cosa contiene, un tocco su tutta la riga la apre. */
export function Disclosure({ title, summary, children, defaultOpen = false, open, onOpenChange, quiet = false, className }: DisclosureProps): ReactElement {
  const controlled = open !== undefined;
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = controlled ? open : inner;

  return (
    <details
      className={cx(quiet ? styles.quiet : styles.disclosure, className)}
      open={isOpen}
      // anche il browser può aprirla da solo (la ricerca nella pagina): lo stato lo segue
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === isOpen) return;
        if (!controlled) setInner(next);
        onOpenChange?.(next);
      }}
    >
      <summary
        className={styles.row}
        onClick={(event) => {
          if (!controlled) return;
          // controllata: decide chi la usa, il browser non la apre per conto suo
          event.preventDefault();
          onOpenChange?.(!isOpen);
        }}
      >
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {summary !== undefined && summary !== null && !quiet ? <span className={styles.summary}>{summary}</span> : null}
        </span>
        <svg className={styles.arrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      <div className={quiet ? cx(ui.hint, styles.content) : styles.content}>{children}</div>
    </details>
  );
}
