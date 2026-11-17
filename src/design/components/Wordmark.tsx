import { APP_NAME } from "@/config";
import { cx } from "../cx";
import styles from "./Wordmark.module.css";

type WordmarkProps = {
  size?: "md" | "lg";
  className?: string;
};

export function Wordmark({ size = "md", className }: WordmarkProps) {
  return (
    <span className={cx(styles.mark, size === "lg" && styles.lg, className)}>
      {APP_NAME}
      <span className={styles.dot} aria-hidden="true">
        .
      </span>
    </span>
  );
}
