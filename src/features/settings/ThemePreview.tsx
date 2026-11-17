import { ExpiryTag, cx, type ThemeId } from "@/design";
import styles from "./ThemePreview.module.css";

const icon = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type ThemePreviewProps = {
  theme: ThemeId;
  mode: "light" | "dark";
  className?: string;
};

/**
 * Piccolo esempio dell'interfaccia (titolo, una scheda con un alimento e la sua scadenza, un pulsante, la barra in basso)
 * reso con le variabili del tema indicato. data-palette e data-theme sul contenitore bastano: più anteprime convivono nella stessa pagina.
 * Solo elementi in linea e nessun elemento interattivo: può stare dentro l'etichetta di una scelta.
 */
export function ThemePreview({ theme, mode, className }: ThemePreviewProps) {
  return (
    <span className={cx(styles.preview, className)} data-palette={theme} data-theme={mode} aria-hidden="true">
      <span className={styles.body}>
        <span className={styles.title}>Oggi</span>
        <span className={styles.card}>
          <span className={styles.row}>
            <span className={styles.food}>Latte intero</span>
            <span className={styles.qty}>1 l</span>
          </span>
          <span className={styles.bar}>
            <span className={styles.barFill} />
          </span>
          <span className={styles.tag}>
            <ExpiryTag level="urgent">scade domani</ExpiryTag>
          </span>
        </span>
        <span className={styles.button}>Aggiungi</span>
      </span>
      <span className={styles.nav}>
        <span className={cx(styles.navItem, styles.navCurrent)}>
          <svg {...icon}>
            <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
          </svg>
          Oggi
        </span>
        <span className={styles.navItem}>
          <svg {...icon}>
            <rect x="4" y="3" width="16" height="18" rx="1.5" />
            <path d="M4 9.5h16" />
            <path d="M4 15.5h16" />
          </svg>
          Dispensa
        </span>
        <span className={styles.capture}>
          <svg {...icon}>
            <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
        <span className={styles.navItem}>
          <svg {...icon}>
            <rect x="4" y="5" width="16" height="15" rx="1.5" />
            <path d="M4 10h16" />
          </svg>
          Piano
        </span>
        <span className={styles.navItem}>
          <svg {...icon}>
            <path d="M3 12h4l3-7 4 14 3-7h4" />
          </svg>
          Salute
        </span>
      </span>
    </span>
  );
}
