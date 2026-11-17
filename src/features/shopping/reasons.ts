// Le ragioni di una voce della lista, scritte in chiaro. Ogni stima si presenta come stima. Logica pura.
import { diffDays } from "@/core/expiry";
import type { Unit } from "@/core/ledger";
import type { ConsumptionForecast, ItemNote, ListReason } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { whenText } from "../plan/dates";

const qty = (value: number, unit: Unit) => formatQuantity({ value, unit });

/** "finisce tra 3 giorni", "sotto la scorta minima", "serve per giovedì", "aggiunta da te"... */
export function reasonText(reason: ListReason, today: string, unit: Unit): string {
  const base = ((): string => {
    switch (reason.kind) {
      case "manual":
        return "aggiunta da te";
      case "plan":
        return `serve per ${whenText(reason.earliestDate, today)}`;
      case "below_minimum":
        return `sotto la scorta minima (ne hai ${qty(reason.stock, unit)}, il minimo è ${qty(reason.minimum, unit)})`;
      case "running_out": {
        const days = Math.max(0, diffDays(reason.runoutDate, today));
        const when = days === 0 ? "finisce oggi" : days === 1 ? "finisce domani" : `finisce tra ${days} giorni`;
        return `${when} (stima dai tuoi consumi)`;
      }
      case "completes_expiring": {
        const when = reason.expiresOn ? ` ${whenText(reason.expiresOn, today)}` : "";
        return `per usare «${reason.forProduct}» che scade${when}`;
      }
    }
  })();
  return reason.rejections > 0.05 && reason.kind !== "manual" ? `${base}; l'hai già rifiutata in passato` : base;
}

export function noteText(note: ItemNote, unit: Unit): string {
  switch (note.code) {
    case "shelf_life_cap":
      return `Dura circa ${note.days} giorni: propongo quanto ne consumi in quel tempo.`;
    case "waste_caution":
      return `Ne hai buttato spesso (circa ${Math.round(note.wasteShare * 100)}%): quantità arrotondata per difetto.`;
    case "format_too_big":
      return note.suggestedMaxSize !== null
        ? `La confezione da ${qty(note.size, unit)} spesso è troppo grande per te: meglio al massimo ${qty(note.suggestedMaxSize, unit)}.`
        : `La confezione da ${qty(note.size, unit)} spesso è troppo grande per te.`;
    case "pack_exceeds_shelf_life":
      return `La confezione abituale (${qty(note.packSize, unit)}) è più grande di quanto ne consumi prima che scada.`;
    case "consumption_unknown":
      return "Non so ancora quanto ne consumi: servono più registrazioni.";
  }
}

/** Dove lo storico non basta lo dice, invece di mostrare un numero. */
export function forecastNote(forecast: ConsumptionForecast | undefined): string | undefined {
  if (!forecast || forecast.sufficient) return undefined;
  const parts: string[] = [];
  if (forecast.reasons.includes("few_observations")) parts.push(`ci sono ${forecast.observations} ${forecast.observations === 1 ? "consumo registrato" : "consumi registrati"}, ne servono almeno 4`);
  if (forecast.reasons.includes("short_history")) parts.push(`lo storico copre ${forecast.spanDays} ${forecast.spanDays === 1 ? "giorno" : "giorni"}, ne servono almeno 7`);
  return `Non so quando finirà: ${parts.join("; ")}.`;
}
