// Il testo della scheda «Qualità di ciò che mangi» in Salute: due righe al massimo, dagli stessi totali e dagli stessi
// testi della pagina Qualità. Nessuna soglia nuova, nessun giudizio. Funzione pura.
import type { DietImpactView } from "../quality/consumption";
import { METRIC_PHRASE, metricTotalText, num, sharePercent } from "../quality/texts";

export interface QualityCardView {
  lines: string[];
}

/**
 * `null` quando non c'è nulla da pesare (nessun consumo di prodotti con codice a barre e valori): è lo stesso criterio
 * di «Ancora niente da pesare» in Qualità, così chi non scansiona prodotti non vede la scheda.
 */
export function qualityCardView(view: DietImpactView | undefined): QualityCardView | null {
  if (!view || view.summary.productLines === 0) return null;
  const { summary, report } = view;
  const days = `ultimi ${summary.windowDays} giorni`;
  const lines: string[] = [];

  const ultra = report.metrics.ultraProcessed;
  if (ultra.entriesWithData > 0) {
    lines.push(`Prodotti molto lavorati: ${metricTotalText(ultra)}, in media sugli ${days}.`);
  } else {
    const n = summary.productLines;
    lines.push(`${num(n, 0)} ${n === 1 ? "consumo" : "consumi"} di prodotti con codice a barre negli ${days}.`);
  }

  const top = report.changes[0];
  if (top) {
    const best = top.effects.reduce((a, b) => (b.share > a.share ? b : a));
    const of = best.metric === "ultraProcessed" ? "dei" : "del totale";
    lines.push(`Pesa di più: ${top.name}, ${sharePercent(best.share)} ${of} ${METRIC_PHRASE[best.metric]}.`);
  }
  return { lines };
}
