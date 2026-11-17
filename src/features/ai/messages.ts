// Frasi italiane per gli errori delle chiamate. Nessuna contiene la chiave: il dettaglio del fornitore è già ripulito.
import type { AiError } from "@/core/ai";
import type { ProviderId } from "./providers/types";

export interface ErrorContext {
  provider: ProviderId;
  model?: string;
}

function retryText(seconds?: number): string {
  if (seconds === undefined) return "Riprova tra un minuto.";
  if (seconds <= 1) return "Riprova tra un secondo.";
  if (seconds < 90) return `Riprova tra ${seconds} secondi.`;
  return `Riprova tra ${Math.ceil(seconds / 60)} minuti.`;
}

const SENT_NOTE =
  " La richiesta era già partita e il fornitore può averla addebitata: per prudenza l'ho contata nell'uso del mese come stima.";
const COUNTED_NOTE = " La chiamata è stata comunque contata nell'uso del mese.";

const withDetail = (text: string, detail?: string) => (detail ? `${text} Il fornitore dice: «${detail}»` : text);

export function describeAiError(error: AiError, ctx: ErrorContext): string {
  switch (error.kind) {
    case "missing_key":
      return "Manca la chiave: inseriscila nelle impostazioni dell'intelligenza artificiale.";
    case "rejected_key":
      return "Il fornitore non accetta la chiave. Controlla di averla copiata per intero e che non sia stata revocata o scaduta.";
    case "forbidden":
      return withDetail(
        "La chiave è valida, ma non ha il permesso di fare questa richiesta. Se la chiave non è legata a un'area di lavoro, serve indicarla nelle impostazioni.",
        error.detail,
      );
    case "browser_not_allowed":
      return "L'organizzazione a cui appartiene la chiave non consente le chiamate dirette dal browser (succede con alcuni account aziendali). Con questa chiave la lettura da foto non è possibile.";
    case "billing":
      return "Il conto presso il fornitore non ha credito sufficiente o ha un problema di pagamento. Controlla il saldo sulla pagina del fornitore.";
    case "rate_limited":
      return `Il fornitore ha raggiunto il limite di richieste. ${retryText(error.retryAfterSeconds)}`;
    case "network":
      return ctx.provider === "openai_compatible"
        ? "Non riesco a raggiungere il servizio: manca la rete, l'indirizzo non risponde, oppure il servizio non consente le richieste dal browser (blocco CORS)."
        : "Non riesco a raggiungere il fornitore: manca la rete o il servizio non risponde. Controlla la connessione e riprova.";
    case "timeout":
      return `Il fornitore non ha risposto in tempo. Riprova.${error.afterSend ? SENT_NOTE : ""}`;
    case "aborted":
      return `Lettura annullata.${error.afterSend ? SENT_NOTE : ""}`;
    case "model_not_found":
      return withDetail(
        ctx.model
          ? `Il fornitore non conosce il modello «${ctx.model}» o la chiave non vi ha accesso. Controllane il nome nelle impostazioni.`
          : "Il fornitore non conosce il modello scelto. Controllane il nome nelle impostazioni.",
        error.detail,
      );
    case "bad_request":
      return withDetail("Il fornitore ha rifiutato la richiesta.", error.detail);
    case "request_too_large":
      return "La foto è troppo grande per il fornitore. Riprova con una foto più piccola.";
    case "overloaded":
      return "Il servizio del fornitore è sovraccarico in questo momento. Riprova tra poco.";
    case "server":
      return "Il fornitore ha un problema in questo momento. Riprova più tardi.";
    case "refused":
      return `${withDetail("Il modello ha rifiutato di leggere questa immagine.", error.detail)}${COUNTED_NOTE}`;
    case "invalid_response":
      return `La risposta del fornitore non è nel formato atteso. Riprova; se succede ancora, prova un altro modello.${COUNTED_NOTE}`;
    case "budget":
      return error.detail ?? "Hai raggiunto il tetto di spesa del mese.";
  }
}
