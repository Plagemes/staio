// Testi in italiano dell'indice di qualità: esiti, motivi in una riga, totali dell'impatto, prezzi.
// Nessun punteggio: ogni funzione descrive una dimensione o un dato alla volta.

import type { Alternative, Dimension, ImpactMetric, MetricImpact, Outcome, QualityAssessment, UnitPrice } from "@/core/quality";

/** Numero con la virgola decimale e al massimo `digits` decimali, senza zeri inutili. */
export function num(n: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f).replace(".", ",");
}

export const OUTCOME_GLYPH: Readonly<Record<Outcome, string>> = {
  favorable: "+",
  intermediate: "=",
  unfavorable: "−",
  not_assessable: "?",
};

/**
 * Il perché in una riga. Dove l'esito viene da uno schema che non è una norma italiana lo dice qui,
 * accanto all'esito; la spiegazione intera e le fonti stanno nel dettaglio.
 */
export function shortReason(d: Dimension): string {
  switch (d.id) {
    case "fat":
    case "saturatedFat":
    case "sugars":
    case "salt": {
      if (d.outcome === "not_assessable" || d.value === undefined || d.lowMax === undefined || d.highAbove === undefined) {
        return d.explanation;
      }
      const per = d.per === "100ml" ? "100 ml" : "100 g";
      return `${num(d.value, 2)} g per ${per}; verde fino a ${num(d.lowMax, 2)} g, rosso oltre ${num(d.highAbove, 2)} g. Soglie del semaforo britannico, schema volontario.`;
    }
    case "nutriScore":
      if (d.grade === undefined) return d.explanation;
      return `Lettera ${d.grade.toUpperCase()} letta da Open Food Facts. Raggruppare A-B, C, D-E è una scelta di presentazione, non della fonte.`;
    case "nova":
      if (d.group === undefined) return d.explanation;
      return `Gruppo ${d.group} secondo Open Food Facts. Come riassumere i gruppi in un esito è una scelta di presentazione, sulla definizione FAO.`;
    case "additives": {
      if (d.count === undefined) return d.explanation;
      if (d.count === 0) return d.explanation;
      const flagged = d.items.filter((i) => i.statement).length;
      return flagged === 0
        ? `${d.count} ${d.count === 1 ? "additivo dichiarato" : "additivi dichiarati"}, senza un giudizio fondato: li elenco soltanto.`
        : `${d.count} ${d.count === 1 ? "additivo dichiarato" : "additivi dichiarati"}; ${flagged === 1 ? "uno ha" : `${flagged} hanno`} una dichiarazione ufficiale, gli altri nessun giudizio.`;
    }
    case "nutrientDensity":
      return d.explanation;
  }
}

/** Dimensioni con giudizio e quante non si possono valutare, in una frase. */
export function notAssessableText(a: QualityAssessment): string {
  const { notAssessable, graded } = a.summary;
  if (notAssessable === 0) return `Tutte le ${graded} dimensioni con giudizio sono valutabili.`;
  if (notAssessable === graded) return `Nessuna delle ${graded} dimensioni con giudizio è valutabile: mancano i dati.`;
  return `${notAssessable} ${notAssessable === 1 ? "dimensione non valutabile" : "dimensioni non valutabili"} su ${graded}: mancano i dati o una fonte per giudicarle.`;
}

/** Il conteggio degli esiti, scritto per esteso e senza somma. */
export function outcomeCountText(a: QualityAssessment): string {
  const s = a.summary;
  return `${s.favorable} favorevoli, ${s.intermediate} intermedie, ${s.unfavorable} sfavorevoli, ${s.notAssessable} non valutabili.`;
}

/* ---------- impatto sulla dieta ---------- */

export const METRIC_TITLE: Readonly<Record<ImpactMetric, string>> = {
  sugars: "Zuccheri",
  salt: "Sale",
  saturatedFat: "Grassi saturi",
  ultraProcessed: "Prodotti molto lavorati",
};

export const METRIC_PHRASE: Readonly<Record<ImpactMetric, string>> = {
  sugars: "di zuccheri",
  salt: "di sale",
  saturatedFat: "di grassi saturi",
  ultraProcessed: "consumi di prodotti molto lavorati",
};

/** Quantità a settimana di una metrica: grammi, o numero di consumi per i prodotti molto lavorati. */
export function metricAmountText(metric: ImpactMetric, perWeek: number): string {
  if (metric === "ultraProcessed") {
    const n = num(perWeek, 1);
    return `${n} ${perWeek === 1 ? "consumo" : "consumi"} a settimana`;
  }
  return `${num(perWeek, perWeek < 10 ? 1 : 0)} g a settimana`;
}

/** Totale di una metrica, con "almeno" quando non tutte le voci portano il dato. */
export function metricTotalText(m: MetricImpact): string {
  if (m.entriesTotal === 0) return "Nessun dato";
  if (m.entriesWithData === 0) return "Nessun consumo con il dato";
  const amount = metricAmountText(m.metric, m.totalPerWeek);
  return m.complete ? amount : `almeno ${amount}`;
}

export function metricCoverageText(m: MetricImpact): string {
  if (m.entriesTotal === 0) return "";
  if (m.complete) return `Calcolato su tutti i ${m.entriesTotal} consumi del periodo.`;
  const missing = m.entriesTotal - m.entriesWithData;
  return `Il dato c'è per ${m.entriesWithData} consumi su ${m.entriesTotal}: per ${missing} manca, quindi è un minimo, non il totale.`;
}

/** Che cosa cambia togliendo un prodotto: quanto in meno a settimana e quale quota del totale. */
export function changeEffectText(metric: ImpactMetric, perWeek: number, share: number): string {
  const tail = `il ${sharePercent(share)} del totale che risulta dai tuoi consumi`;
  if (metric === "ultraProcessed") return `${num(perWeek, 1)} ${perWeek === 1 ? "consumo" : "consumi"} in meno a settimana di prodotti molto lavorati, ${tail}`;
  return `${num(perWeek, perWeek < 10 ? 1 : 0)} g in meno a settimana ${METRIC_PHRASE[metric]}, ${tail}`;
}

export function sharePercent(share: number): string {
  if (!(share > 0)) return "0%";
  return share < 0.01 ? "meno dell'1%" : `${Math.round(share * 100)}%`;
}

/**
 * Frasi su un'alternativa, dalle voci strutturate della logica. "Senza peggiorare" si scrive solo se la logica
 * dice che nessuna dimensione è peggiore né non confrontabile; altrimenti si elencano le voci con il motivo.
 * Le differenze descrittive (densità, numero di additivi) si mostrano sempre, come sole informazioni.
 */
export function alternativeSentences(alt: Alternative, dimensionLabel: string): string[] {
  const clean = alt.worseOn !== undefined && alt.notComparableOn !== undefined && alt.worseOn.length === 0 && alt.notComparableOn.length === 0;
  const out = [`${dimensionLabel}: da ${alt.before} a ${alt.after}${clean ? ", senza peggiorare le altre dimensioni." : "."}`];
  const list = (items: readonly { label: string; reason: string }[]) => items.map((d) => `${d.label.toLowerCase()} (${d.reason})`).join("; ");
  if (alt.worseOn && alt.worseOn.length > 0) out.push(`Peggiora: ${list(alt.worseOn)}.`);
  if (alt.notComparableOn && alt.notComparableOn.length > 0) out.push(`Non confrontabile: ${list(alt.notComparableOn)}; non posso dire che non peggiori.`);
  if (alt.notComparableOn === undefined && alt.notComparable.length > 0) out.push("Alcune dimensioni non sono confrontabili per dato mancante: non posso dire che non peggiori.");
  if (alt.descriptive && alt.descriptive.length > 0) out.push(`Solo descrittivo, senza giudizio: ${alt.descriptive.map((d) => `${d.label.toLowerCase()}, ${d.text}`).join("; ")}.`);
  return out;
}

/* ---------- prezzi e dispensa ---------- */

export function euro(cents: number): string {
  return `${num(cents / 100, 2)} €`;
}

export function perUnitText(per: UnitPrice["per"]): string {
  return per === "pz" ? "al pezzo" : `al ${per}`;
}

export function unitPriceText(price: UnitPrice): string {
  return `${euro(price.cents)} ${perUnitText(price.per)}${price.store ? ` (${price.store})` : ""}`;
}

/** Confronto del prezzo per unità con il prodotto di partenza; dice quando non si può confrontare. */
export function priceLine(alt: Alternative, referencePrice: UnitPrice | undefined): string {
  if (!alt.unitPrice) return "Prezzo: non ho acquisti registrati di questo prodotto con il prezzo.";
  const own = `Prezzo osservato: ${unitPriceText(alt.unitPrice)}`;
  if (alt.priceDifferenceCents === undefined) {
    return referencePrice
      ? `${own}. Non confrontabile con quello del prodotto: unità diverse.`
      : `${own}. Del prodotto di partenza non ho un prezzo con cui confrontarlo.`;
  }
  const diff = alt.priceDifferenceCents;
  if (diff === 0) return `${own}, uguale a quello del prodotto di partenza.`;
  return `${own}, ${euro(Math.abs(diff))} ${diff < 0 ? "in meno" : "in più"} ${perUnitText(alt.unitPrice.per)} del prodotto di partenza.`;
}

/* ---------- provenienza dei dati ---------- */

export const DATA_NOTE =
  "I dati vengono da Open Food Facts, un archivio compilato da volontari: possono essere incompleti o non aggiornati. Controlla sulla confezione.";

export const NOT_MEDICAL =
  "Non è un parere medico: confronta i valori del prodotto con soglie e riferimenti dichiarati, e dice quando non può farlo.";
