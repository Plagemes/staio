import Link from "next/link";
import styles from "./PromptCard.module.css";

type PromptCardProps = {
  title: string;
  description?: string;
  href: string;
};

export function PromptCard({ title, description, href }: PromptCardProps) {
  return (
    <Link className={styles.card} href={href}>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
