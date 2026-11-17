import Link from "next/link";
import { safeAppPath, type NoticeFact } from "@/core/notify";
import { cx } from "@/design";
import ui from "../ui.module.css";
import styles from "./Notices.module.css";

interface NoticesListProps {
  facts: readonly NoticeFact[];
  /** Quante voci mostrare; le altre si contano. */
  limit?: number;
  /** Testo se non c'è nulla; senza, la lista vuota non mostra niente. */
  emptyText?: string;
  label?: string;
}

/** Elenco di avvisi, già calcolati. Ogni voce porta alla pagina giusta; le stime sono segnate come tali. */
export function NoticesList({ facts, limit, emptyText, label = "Avvisi di oggi" }: NoticesListProps) {
  if (facts.length === 0) {
    return emptyText ? <p className={ui.hint}>{emptyText}</p> : null;
  }
  const shown = limit === undefined ? facts : facts.slice(0, limit);
  const hidden = facts.length - shown.length;
  return (
    <>
      <ul className={styles.list} aria-label={label}>
        {shown.map((f) => (
          <li key={f.key} className={cx(styles.item, f.level === "urgent" && styles.urgent)} data-level={f.level}>
            <Link href={safeAppPath(f.url)} className={styles.link}>
              <span className={styles.heading}>
                {f.heading}
                {f.certainty === "estimated" ? <span className={styles.estimate}>stima</span> : null}
              </span>
              <span className={styles.text}>{f.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className={cx(ui.hint, styles.more)}>e altri {hidden}</p> : null}
    </>
  );
}
