import styles from "./ProgressLine.module.css";

export type ProgressTone = "water" | "protein" | "carbs" | "fat" | "fiber" | "ok" | "near" | "expired";

type ProgressLineProps = {
  value: number;
  max: number;
  label: string;
  /** Nel tema Vivo il riempimento prende il colore con questo significato; negli altri temi resta l'accento. */
  tone?: ProgressTone;
};

export function ProgressLine({ value, max, label, tone }: ProgressLineProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      data-tone={tone}
    >
      <div className={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  );
}
