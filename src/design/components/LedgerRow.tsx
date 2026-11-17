import type { ReactNode } from "react";
import styles from "./LedgerRow.module.css";

type LedgerRowProps = {
  time: string;
  description: ReactNode;
  value: ReactNode;
};

export function LedgerRow({ time, description, value }: LedgerRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.time}>{time}</span>
      <span className={styles.description}>{description}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
