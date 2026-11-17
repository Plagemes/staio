import { cx } from "../cx";
import styles from "./ExpiryTag.module.css";

export type ExpiryLevel = "urgent" | "near" | "calm";

type ExpiryTagProps = {
  level: ExpiryLevel;
  /** Testo della scadenza, per esempio "domani" o "3 giorni". */
  children: string;
  /** Se la data è stimata mostra tilde e puntini. */
  estimated?: boolean;
};

export function ExpiryTag({ level, children, estimated = false }: ExpiryTagProps) {
  return (
    <span className={cx(styles.tag, styles[level])} data-estimated={estimated ? "" : undefined}>
      {level !== "calm" ? <span className={styles.marker} aria-hidden="true" /> : null}
      <span className={estimated ? styles.estimated : undefined}>
        {estimated ? "~" : ""}
        {children}
      </span>
    </span>
  );
}
