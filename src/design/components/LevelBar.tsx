import styles from "./LevelBar.module.css";

type LevelBarProps = {
  /** Livello da 0 a 100. */
  value: number;
  label: string;
};

export function LevelBar({ value, label }: LevelBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={styles.track} role="img" aria-label={label}>
      <div className={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  );
}
