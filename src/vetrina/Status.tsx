import { Label } from "@/design";
import layout from "./layout.module.css";
import { Rubric } from "./Rubric";
import { Section } from "./Section";
import styles from "./Status.module.css";

const BUILT = [
  { name: "Registro a eventi", text: "Ogni fatto è un evento; dispensa e conti se ne ricavano." },
  { name: "Scadenze", text: "Calcolo della scadenza, stampata o stimata." },
  { name: "Unità di misura", text: "Conversioni e quantità, con il livello di certezza." },
  { name: "Modelli", text: "Il generatore delle figure a incisione e il primo catalogo." },
] as const;

const COMING = [
  { name: "Cattura", text: "Scontrino, codice a barre, foto e voce." },
  { name: "Dispensa", text: "La vista di ciò che hai in casa, con le scadenze." },
  { name: "Nutrienti e salute", text: "I conti di ogni giorno, senza pareri medici." },
  { name: "Spesa", text: "La lista di ciò che manca." },
  { name: "Ricette", text: "Idee con ciò che sta per scadere." },
  { name: "Archivio sul telefono e Google Drive", text: "Salvataggio, uso senza rete e sincronizzazione." },
] as const;

type Item = { name: string; text: string };

function Rows({ items, mark }: { items: readonly Item[]; mark: string }) {
  return (
    <ul className={styles.rows} role="list">
      {items.map((item) => (
        <li key={item.name} className={styles.row}>
          <span className={styles.mark}>{mark}</span>
          <span className={styles.name}>{item.name}</span>
          <span className={styles.text}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Status() {
  return (
    <Section id="stato" index="06" kicker="Stato del progetto" title="L'app è in costruzione">
      <p className={`${layout.prose} ${styles.intro}`}>
        Per ora non si può ancora registrare il cibo. Puoi installare l&apos;app, ma oggi mostra solo questa pagina.
        Questo è lo stato dei lavori.
      </p>

      <div className={styles.block}>
        <Rubric>Costruito</Rubric>
        <Rows items={BUILT} mark="Fatto" />
      </div>

      <div className={styles.block}>
        <Rubric>In arrivo</Rubric>
        <Rows items={COMING} mark="Da fare" />
      </div>

      <Label as="p">Nessuna data promessa</Label>
    </Section>
  );
}
