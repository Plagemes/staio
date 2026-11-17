import type { ReactNode } from "react";
import { cx } from "../cx";
import { Label } from "./Label";
import styles from "./Figure.module.css";

type FigureProps = {
  label: string;
  /** Parte secondaria accanto al valore, per esempio "/ 130 g". */
  suffix?: string;
  tone?: "default" | "signal";
  className?: string;
  children: ReactNode;
};

export function Figure({ label, suffix, tone = "default", className, children }: FigureProps) {
  return (
    <div className={cx(styles.figure, className)}>
      <Label>{label}</Label>
      <div className={cx(styles.value, tone === "signal" && styles.signal)}>
        {children}
        {suffix ? <span className={styles.suffix}> {suffix}</span> : null}
      </div>
    </div>
  );
}

type FigureGridProps = { className?: string; children: ReactNode };

export function FigureGrid({ className, children }: FigureGridProps) {
  return <div className={cx(styles.grid, className)}>{children}</div>;
}
