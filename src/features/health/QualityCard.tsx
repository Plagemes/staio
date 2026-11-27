"use client";

import { SectionHeader } from "@/design";
import { dietHref, useDietHistory } from "../diet";
import ui from "../ui.module.css";
import styles from "./health.module.css";
import { qualityCardView } from "./qualityCardText";

/**
 * «Qualità di ciò che mangi»: una o due righe sulla settimana, da tutto ciò che è registrato, con il link alla vista
 * dettagliata. Non si vede senza voci negli ultimi 63 giorni circa.
 */
export function QualityCard() {
  const { history } = useDietHistory();
  const card = qualityCardView(history);
  if (!card) return null;
  return (
    <section className={ui.section} aria-label="Qualità di ciò che mangi">
      <SectionHeader label="Qualità di ciò che mangi" actionLabel="Vedi il dettaglio" actionHref={dietHref({ week: card.week })} />
      {card.lines.map((line) => (
        <p key={line} className={styles.qualityLine}>
          {line}
        </p>
      ))}
    </section>
  );
}
