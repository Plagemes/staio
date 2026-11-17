import { ExpiryTag, Figure, FigureGrid, PantryRow, Value } from "@/design";
import layout from "./layout.module.css";
import { Rubric } from "./Rubric";
import { Section } from "./Section";
import styles from "./Certainty.module.css";

export function Certainty() {
  return (
    <Section id="certezza" index="03" kicker="La certezza del dato" title="Ogni numero dice quanto ci si può fidare">
      <FigureGrid>
        <Figure label="Misurato">
          <Value>92 g</Value>
        </Figure>
        <Figure label="Stimato">
          <Value certainty="estimated">6 mg</Value>
        </Figure>
        <Figure label="Non tracciato">
          <Value certainty="untracked" />
        </Figure>
      </FigureGrid>

      <div className={`${layout.prose} ${styles.explain}`}>
        <p>
          Un numero senza segni è stato pesato o letto da un&apos;etichetta. Con la tilde e i puntini è una stima, e
          l&apos;app lo dice. Un trattino vuol dire che quel dato non è tracciato.
        </p>
        <p>L&apos;app non finge una precisione che non ha: un vuoto non diventa mai uno zero.</p>
      </div>

      <div className={styles.example}>
        <Rubric>Anche nella dispensa</Rubric>
        <PantryRow
          name="Latte intero"
          detail={
            <>
              Frigo · aperto ieri · <Value>0,6 l</Value>
            </>
          }
          level={60}
          expiry={<ExpiryTag level="urgent">2 giorni</ExpiryTag>}
        />
        <PantryRow
          name="Spinaci freschi"
          detail={
            <>
              Frigo · <Value certainty="estimated">150 g</Value>
            </>
          }
          level={85}
          expiry={
            <ExpiryTag level="calm" estimated>
              4 giorni
            </ExpiryTag>
          }
        />
      </div>
    </Section>
  );
}
