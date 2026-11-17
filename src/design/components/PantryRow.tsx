import type { ReactNode } from "react";
import { cx } from "../cx";
import { LevelBar } from "./LevelBar";
import styles from "./PantryRow.module.css";

type PantryRowProps = {
  name: string;
  detail: ReactNode;
  /** Livello 0-100. Se omesso la barra non compare. */
  level?: number;
  levelLabel?: string;
  /** Di solito un ExpiryTag. */
  expiry: ReactNode;
};

export function PantryRow({ name, detail, level, levelLabel, expiry }: PantryRowProps) {
  return (
    <div className={cx(styles.row, level !== undefined && styles.withBar)}>
      <div className={styles.text}>
        <div className={styles.name}>{name}</div>
        <div className={styles.detail}>{detail}</div>
      </div>
      {level !== undefined ? (
        <LevelBar value={level} label={levelLabel ?? `Quantità circa ${Math.round(level)} per cento`} />
      ) : null}
      <div className={styles.expiry}>{expiry}</div>
    </div>
  );
}
