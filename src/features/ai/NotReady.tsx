import { Button, Label } from "@/design";
import ui from "../ui.module.css";
import type { ConfigIssue } from "./settings";

interface NotReadyProps {
  issue: ConfigIssue;
  title: string;
  /** Cosa non si può fare senza la chiave, per esempio «leggere uno scontrino da una foto». */
  what: string;
  /** Dove si va se non si vuole usare l'intelligenza artificiale. */
  alternative: { href: string; label: string };
}

/** Quando la chiave o le impostazioni mancano: lo dice e porta alle impostazioni. L'app funziona anche senza. */
export function NotReady({ issue, title, what, alternative }: NotReadyProps) {
  const text =
    issue === "missing_key"
      ? `Per ${what} serve la tua chiave personale di un fornitore di intelligenza artificiale. È facoltativa: senza, l'app funziona lo stesso.`
      : issue === "missing_model"
        ? "Hai scelto il fornitore, ma manca il nome del modello da usare. Scrivilo nelle impostazioni."
        : "L'indirizzo del servizio scelto non è valido. Correggilo nelle impostazioni.";
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>{title}</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>
      <div className={ui.empty}>
        <h2 className={ui.emptyTitle}>{issue === "missing_key" ? "Manca la chiave" : "Impostazioni incomplete"}</h2>
        <p className={ui.emptyText}>{text}</p>
        <div className={ui.row}>
          <Button href="/app/impostazioni/ai">Vai alle impostazioni</Button>
          <Button href={alternative.href} variant="outline">
            {alternative.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
