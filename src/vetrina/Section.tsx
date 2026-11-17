import type { ReactNode } from "react";
import { Label } from "@/design";
import layout from "./layout.module.css";
import styles from "./Section.module.css";

type SectionProps = {
  id: string;
  /** Numero d'ordine, per esempio "01". */
  index: string;
  kicker: string;
  title: string;
  children: ReactNode;
};

/** Sezione della pagina: filetto pieno in apertura, titolo nel margine a sinistra su schermo largo. */
export function Section({ id, index, kicker, title, children }: SectionProps) {
  const headingId = `${id}-titolo`;
  return (
    <section id={id} aria-labelledby={headingId} className={styles.section}>
      <div className={layout.wrap}>
        <div className={styles.inner}>
          <header className={styles.head}>
            <Label as="p">
              {index} · {kicker}
            </Label>
            <h2 id={headingId} className={styles.title}>
              {title}
            </h2>
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </section>
  );
}
