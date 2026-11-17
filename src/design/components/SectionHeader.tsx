import Link from "next/link";
import { Label } from "./Label";
import styles from "./SectionHeader.module.css";

type SectionHeaderProps = {
  label: string;
  actionLabel?: string;
  actionHref?: string;
};

export function SectionHeader({ label, actionLabel, actionHref }: SectionHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>
        <Label>{label}</Label>
      </h2>
      {actionLabel && actionHref ? (
        <Link className={styles.action} href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
