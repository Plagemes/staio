import { Button } from "@/design";
import styles from "../ui.module.css";

interface EmptyStateProps {
  title: string;
  text: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

/** Schermata vuota: dice che cosa comparirà e porta alla cattura. Nessun dato di esempio. */
export function EmptyState({ title, text, actionLabel = "Aggiungi un alimento", actionHref = "/app/cattura", secondaryLabel, secondaryHref }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyText}>{text}</p>
      <Button href={actionHref} variant="outline">
        {actionLabel}
      </Button>
      {secondaryLabel && secondaryHref ? (
        <Button href={secondaryHref} variant="text">
          {secondaryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingLine({ text = "Apro i dati del telefono…" }: { text?: string }) {
  return (
    <p className={styles.lead} role="status">
      {text}
    </p>
  );
}

export function StorageError() {
  return (
    <div className={styles.calloutStrong} role="alert">
      Non riesco ad aprire l&apos;archivio di questo dispositivo. Succede in alcune finestre private: apri l&apos;app in una
      finestra normale e riprova.
    </div>
  );
}
