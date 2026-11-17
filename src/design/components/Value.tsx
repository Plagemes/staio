import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Value.module.css";

export type Certainty = "measured" | "label" | "estimated" | "untracked";

type ValueProps = {
  certainty?: Certainty;
  className?: string;
  children?: ReactNode;
};

export function Value({ certainty = "measured", className, children }: ValueProps) {
  if (certainty === "untracked") {
    return (
      <span className={cx(styles.value, styles.untracked, className)}>
        <span aria-hidden="true">—</span>
        <span className={styles.srOnly}>non tracciato</span>
      </span>
    );
  }
  if (certainty === "estimated") {
    return (
      <span className={cx(styles.value, styles.estimated, className)}>
        <span aria-hidden="true">~</span>
        <span className={styles.srOnly}>stimato </span>
        {children}
      </span>
    );
  }
  return <span className={cx(styles.value, className)}>{children}</span>;
}
