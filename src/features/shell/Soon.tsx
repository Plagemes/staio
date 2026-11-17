import { Button, Label } from "@/design";
import styles from "../ui.module.css";

interface SoonProps {
  title: string;
  /** Che cosa conterrà la sezione, in frasi brevi. */
  items: string[];
  note: string;
}

/** Sezione non ancora costruita: lo dice chiaramente e spiega che cosa ci sarà. */
export function Soon({ title, items, note }: SoonProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <Label>Non ancora pronta</Label>
      </div>
      <p className={styles.lead}>Questa sezione non è ancora stata costruita. Ecco che cosa conterrà.</p>
      <ul className={styles.bullets}>
        {items.map((item) => (
          <li key={item} className={styles.paragraph}>
            {item}
          </li>
        ))}
      </ul>
      <p className={styles.emptyText}>{note}</p>
      <div className={styles.row}>
        <Button href="/app/cattura" variant="outline">
          Aggiungi un alimento
        </Button>
        <Button href="/app/dispensa" variant="text">
          Vai alla dispensa
        </Button>
      </div>
    </div>
  );
}
