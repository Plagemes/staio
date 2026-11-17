// Una chiamata all'intelligenza artificiale: controlla impostazioni e tetto, chiama il fornitore scelto, conta l'uso.
// Parte dal browser verso il fornitore, senza server in mezzo.
//
// Il conteggio vale anche quando la lettura poi fallisce: una risposta rifiutata o illeggibile è pagata, e una richiesta
// interrotta dopo l'invio può esserlo. Se il fornitore non dice i token usati si conta una stima prudente, dichiarata tale.
import { AiError, checkBudget, estimateUsage, formatCost, isAiError, type AiRequest, type AiResponse, type AiUsage } from "@/core/ai";
import { activeModel, configIssue, costOf, isPriceKnown, loadAiSettings, providerFor, recordCall, type SettingsStore } from "./settings";
import type { ProviderId } from "./providers/types";

export interface CallArgs {
  store: SettingsStore;
  request: AiRequest;
  /** Istante corrente ISO UTC (iniettabile per i test). */
  now?: () => string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CallResult {
  response: AiResponse;
  provider: ProviderId;
  /** Modello configurato (quello del listino). */
  model: string;
  /** Costo stimato, o null se il listino non conosce il modello. */
  cost: number | null;
  currency: string;
  /** Token contati nell'uso del mese: quelli del fornitore, o la stima prudente se non li ha dichiarati. */
  usage: AiUsage;
  /** I token contati sono una stima prudente nostra: il fornitore non li ha dichiarati. */
  usageEstimated: boolean;
}

/** Lancia sempre un `AiError`. */
export async function callAi(args: CallArgs): Promise<CallResult> {
  const now = args.now ?? (() => new Date().toISOString());
  const settings = await loadAiSettings(args.store, now());

  const issue = configIssue(settings);
  if (issue === "missing_key") throw new AiError("missing_key");
  if (issue === "missing_model") throw new AiError("bad_request", { detail: "manca il nome del modello" });
  if (issue === "invalid_base_url") throw new AiError("bad_request", { detail: "l'indirizzo del servizio non è valido" });
  const provider = providerFor(settings);
  if (!provider) throw new AiError("missing_key");

  const budget = checkBudget(settings.usage, now(), settings.monthlyCap, isPriceKnown(settings));
  if (!budget.allowed) {
    throw new AiError("budget", {
      detail:
        budget.reason === "price_unknown"
          ? "Hai fissato un tetto di spesa, ma nel listino non c'è il prezzo di questo modello: senza non posso controllare il tetto. Aggiungilo nelle impostazioni."
          : `Hai raggiunto il tetto di spesa del mese (${formatCost(budget.spent, settings.currency)} su ${formatCost(budget.cap, settings.currency)}). Alzalo nelle impostazioni per continuare.`,
    });
  }

  const model = activeModel(settings);
  const count = async (usage: AiUsage, estimated: boolean): Promise<number | null> => {
    const cost = costOf(settings, model, usage);
    try {
      await recordCall(args.store, usage, cost, now(), estimated);
    } catch {
      // il conteggio è un aiuto: se non si riesce a scriverlo, la lettura già pagata non va persa
    }
    return cost;
  };

  let response: AiResponse;
  try {
    response = await provider.call(args.request, { signal: args.signal, fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs });
  } catch (error) {
    if (!isAiError(error)) {
      throw new AiError("invalid_response");
    }
    if (error.usage) {
      // risposta 200 rifiutata o illeggibile, con i token dichiarati: è pagata
      await count(error.usage, false);
    } else if (error.kind === "refused" || error.kind === "invalid_response") {
      // risposta 200 senza token dichiarati
      await count(estimateUsage(args.request), true);
    } else if (error.afterSend && (error.kind === "aborted" || error.kind === "timeout")) {
      // la richiesta era partita e non si sa se è stata addebitata: stima prudente
      await count(estimateUsage(args.request), true);
    }
    throw error;
  }

  const usageEstimated = !response.usageReported;
  const usage = usageEstimated ? estimateUsage(args.request) : response.usage;
  const cost = await count(usage, usageEstimated);
  return { response, provider: settings.provider, model, cost, currency: settings.currency, usage, usageEstimated };
}
