import { LedgerRow, Value } from "@/design";
import layout from "./layout.module.css";
import { Rubric } from "./Rubric";
import { Section } from "./Section";
import styles from "./HowItWorks.module.css";

const STEPS = [
  {
    name: "Entra",
    text: "Ogni cosa che porti a casa si scrive nel registro. Se un dato manca, resta segnato come mancante.",
    tags: ["Scontrino", "Codice a barre", "Foto", "Voce"],
  },
  {
    name: "Resta",
    text: "Ciò che hai in casa è la dispensa, calcolata dal registro. Ogni voce ha la sua scadenza: stampata, oppure stimata e segnata come tale.",
    tags: ["Dispensa", "Scadenze"],
  },
  {
    name: "Esce",
    text: "Un alimento esce in due modi: lo mangi o lo butti. Si scrive anche quando lo butti, perché serve a capire cosa sprechi.",
    tags: ["Mangiato", "Buttato"],
  },
  {
    name: "Da qui, i conti",
    text: "Dal registro si ricavano i nutrienti di ogni giorno, la spesa da fare e le ricette con ciò che sta per scadere. Nulla si scrive due volte.",
    tags: ["Nutrienti", "Spesa", "Ricette"],
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="come-funziona" index="02" kicker="Come funziona" title="Una sequenza, scritta riga per riga">
      <p className={`${layout.prose} ${styles.intro}`}>
        Così funzionerà l&apos;app a lavori finiti. In fondo alla pagina trovi cosa è già pronto.
      </p>

      <ol className={styles.steps} role="list">
        {STEPS.map((step, i) => (
          <li key={step.name} className={styles.step}>
            <span className={styles.no}>{String(i + 1).padStart(2, "0")}</span>
            <div className={styles.content}>
              <h3 className={styles.name}>{step.name}</h3>
              <p className={styles.text}>{step.text}</p>
              <p className={styles.tags}>{step.tags.join(" · ")}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className={styles.example}>
        <Rubric>Una pagina del registro · dati d&apos;esempio</Rubric>
        <LedgerRow time="07:40" description="Entra · latte intero, 1 l" value="1,29 €" />
        <LedgerRow time="08:10" description="Mangiato · colazione abituale" value="420 kcal" />
        <LedgerRow
          time="13:05"
          description="Mangiato · pollo, riso, spinaci"
          value={<Value certainty="estimated">610 kcal</Value>}
        />
        <LedgerRow
          time="21:30"
          description="Buttato · spinaci appassiti"
          value={<Value certainty="estimated">150 g</Value>}
        />
      </div>
    </Section>
  );
}
