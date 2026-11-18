// La storia di un alimento dentro la sua scheda: una riga per ciò che è successo, la più recente in cima.
// Nessun comando: per annullare c'è «Ultime azioni», per correggere la riga del diario.
import Link from "next/link";
import type { ReactElement } from "react";
import type { StoryLine } from "./storyText";
import styles from "./LotSheet.module.css";

export function LotHistory({ lines }: { lines: readonly StoryLine[] }): ReactElement {
  return (
    <ul className={styles.story}>
      {lines.map((line) => (
        <li key={line.key} className={styles.storyRow}>
          <span className={styles.storyWhen}>{line.when}</span>
          <span className={styles.storyText}>
            {line.href ? (
              <Link href={line.href} className={styles.storyLink}>
                {line.text}
              </Link>
            ) : (
              line.text
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
