import { cx } from "../cx";
import type { ProgressTone } from "./ProgressLine";
import styles from "./ProgressRing.module.css";

type ProgressRingProps = {
  value: number;
  max: number;
  tone: ProgressTone;
  className?: string;
};

const R = 22;
const C = 2 * Math.PI * R;

/**
 * Anello di avanzamento, solo decorativo: il numero è sempre scritto accanto e la barra con il suo nome resta.
 * Si vede solo nel tema Vivo; negli altri temi non occupa spazio.
 */
export function ProgressRing({ value, max, tone, className }: ProgressRingProps) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <svg className={cx(styles.ring, className)} data-tone={tone} viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <circle className={styles.track} cx="28" cy="28" r={R} />
      <circle className={styles.fill} cx="28" cy="28" r={R} strokeDasharray={`${C * share} ${C}`} transform="rotate(-90 28 28)" />
    </svg>
  );
}
