import { APP_TAGLINE } from "@/config";
import { Label, Wordmark } from "@/design";
import layout from "./layout.module.css";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={layout.wrap}>
        <div className={styles.inner}>
          <div className={styles.brand}>
            <Wordmark />
            <p className={styles.tagline}>{APP_TAGLINE}</p>
          </div>
          <div className={styles.notes}>
            <p className={styles.notice}>
              L&apos;app non dà pareri medici. Confronta ciò che mangi con valori di riferimento e non sostituisce un
              medico o un dietista.
            </p>
            <Label as="p">Composto in Instrument Serif, Instrument Sans e IBM Plex Mono</Label>
          </div>
        </div>
      </div>
    </footer>
  );
}
