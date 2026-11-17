import type { ReactNode } from "react";
import { cx } from "../cx";
import { Label } from "./Label";
import styles from "./Figure.module.css";

type FigureProps = {
  label: string;
  /** Parte secondaria accanto al valore, per esempio "/ 130 g". */
  suffix?: string;
  tone?: "default" | "signal";
  /** Nel tema Vivo colora la cifra con il colore del nutriente; negli altri temi non cambia nulla. */
  nutrient?: FigureNutrient;
  className?: string;
  children: ReactNode;
};

export type FigureNutrient = "protein" | "carbs" | "fat" | "fiber" | "water";

export function Figure({ label, suffix, tone = "default", nutrient, className, children }: FigureProps) {
  return (
    <div className={cx(styles.figure, className)} data-nutrient={nutrient}>
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
