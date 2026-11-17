import { Label } from "@/design";
import { Section } from "./Section";
import styles from "./Data.module.css";

const ROWS = [
  {
    term: "Sul telefono",
    text: "Il registro è un archivio sul tuo dispositivo. Lo leggi e lo scrivi anche senza rete.",
  },
  {
    term: "Sul tuo Google Drive",
    text: "Una copia si sincronizza sul tuo Drive, con il tuo accesso Google. I tuoi dati non stanno su un archivio nostro.",
  },
  {
    term: "Senza rete",
    text: "L'app funziona anche quando manca la connessione. La sincronizzazione riprende quando torna.",
  },
  {
    term: "Intelligenza artificiale",
    text: "La chiave per usarla è tua, e facoltativa. Senza chiave l'app funziona lo stesso, con l'inserimento a mano.",
  },
] as const;

export function Data() {
  return (
    <Section id="dati" index="05" kicker="I tuoi dati" title="Il registro è tuo">
      <dl className={styles.rows}>
        {ROWS.map((row) => (
          <div key={row.term} className={styles.row}>
            <dt>
              <Label>{row.term}</Label>
            </dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
