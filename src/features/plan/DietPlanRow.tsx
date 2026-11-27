"use client";

// «Nel piano di questa settimana: legumi 2 volte (indicate 2–4) · pesce 1 (indicate 2–3).»: ciò che il piano porta ai
// gruppi con un'indicazione a settimana, con il rimando a «Proponi la settimana» se qualcosa manca ancora. Una sezione
// senza dati non occupa spazio: niente riga se la settimana non è quella in corso o non ci sono gruppi da dire.
import Link from "next/link";
import { useDietAdvice, useDietLevel, plannedRowText } from "../diet";
import ui from "../ui.module.css";
import { dietPlanItems } from "./proposal";
import styles from "./dietPlanRow.module.css";

interface Props {
  /** Lunedì della settimana mostrata. */
  weekStart: string;
  /** Avvia la proposta nella schermata della settimana. */
  onPropose?: () => void;
  /** Alternativa a `onPropose` dove la proposta si apre da un'altra schermata. */
  proposeHref?: string;
}

export function DietPlanRow({ weekStart, onPropose, proposeHref }: Props) {
  const { ready, planned, gaps } = useDietAdvice();
  const { level } = useDietLevel();
  if (!ready) return null;
  const items = dietPlanItems(planned, gaps, level, weekStart);
  if (items.length === 0) return null;
  const hasGaps = items.some((i) => (gaps[i.group] ?? 0) > 0);
  const label = "Proponi la settimana";

  return (
    <div className={styles.row} role="group" aria-label="Qualità del piano">
      <p className={styles.text}>{plannedRowText(items)}</p>
      {hasGaps && onPropose ? (
        <button type="button" className={ui.textLink} onClick={onPropose}>
          {label}
        </button>
      ) : null}
      {hasGaps && !onPropose && proposeHref ? (
        <Link href={proposeHref} className={ui.textLink}>
          {label}
        </Link>
      ) : null}
    </div>
  );
}
