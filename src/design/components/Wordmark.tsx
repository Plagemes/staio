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
      {/* la spiga si vede solo in Grano: negli altri temi `hidden` la tiene fuori */}
      <span className={styles.ear} aria-hidden="true" hidden>
        <svg viewBox="0 0 24 32" fill="currentColor" width="100%" height="100%">
          <path d="M3.5 31.2c.6-7.6 3.4-14.6 8.4-20.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12.3 4.2c1.9 1.9 2.6 4 1.7 6.5-2.1-.8-3-3.1-1.7-6.5z" />
          <path d="M9.6 10.3C7 9.6 5.2 8 4.7 5.4c2.9.1 4.6 1.7 4.9 4.9z" />
          <path d="M13.9 11.2c2.5-1.1 4.7-.8 6.4 1-2.1 1.6-4.6 1.5-6.4-1z" />
          <path d="M7.6 15.6c-2.7-.4-4.6-1.9-5.2-4.5 3 .1 4.8 1.7 5.2 4.5z" />
          <path d="M11.6 16.4c2.4-1.5 4.7-1.5 6.6.1-1.9 2-4.4 2.1-6.6-.1z" />
          <path d="M6 21.4c-2.6-.6-4.2-2.3-4.5-4.9 2.9.3 4.4 2 4.5 4.9z" />
          <path d="M9.4 22c2.2-1.7 4.5-2 6.5-.5-1.7 2.2-4.2 2.5-6.5.5z" />
        </svg>
      </span>
      {APP_NAME}
      <span className={styles.dot} aria-hidden="true">
        .
      </span>
    </span>
  );
}
