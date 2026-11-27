"use client";

import { SectionHeader } from "@/design";
import { QUALITY_PATH } from "../quality/links";
import { useDietImpact } from "../quality/useQuality";
import ui from "../ui.module.css";
import styles from "./health.module.css";
import { qualityCardView } from "./qualityCardText";

/**
 * «Qualità di ciò che mangi»: due righe dall'impatto sulla dieta, con il link alla pagina completa. Non si vede senza
 * consumi di prodotti con codice a barre. Si monta solo qui, così diario e prodotti si leggono una volta e il calcolo
 * si rifà soltanto quando cambiano.
 */
export function QualityCard() {
  const impact = useDietImpact();
  const card = qualityCardView(impact.view);
  if (!card) return null;
  return (
    <section className={ui.section} aria-label="Qualità di ciò che mangi">
      <SectionHeader label="Qualità di ciò che mangi" actionLabel="Vedi la qualità" actionHref={QUALITY_PATH} />
      {card.lines.map((line) => (
        <p key={line} className={styles.qualityLine}>
          {line}
        </p>
      ))}
    </section>
  );
}
