// Una funzione per dimensione. Regola di fondo: senza il dato (o senza una fonte per il giudizio)
// l'esito è "non valutabile"; l'assenza di dati non è mai favorevole.

import type { Product } from "../catalog";
import { NOVA_DEFINITIONS, NOVA_OFF_SOURCE, NOVA_SOURCE, NUTRI_SCORE_DATA_ORIGIN, NUTRI_SCORE_OUTCOME, NUTRI_SCORE_SOURCE } from "./data/definitions";
import { statementFor, normalizeAdditiveCode } from "./data/additives";
import { TRAFFIC_LIGHT_SOURCE, TRAFFIC_LIGHT_TABLES, TRAFFIC_LIGHT_PORTION_NOTE } from "./data/thresholds";
import { NUTRIENT_DIMENSION_LABEL, NUTRIENT_FIELD, fmt, isAmount } from "./common";
import {
  OUTCOME_RANK,
  type AdditiveEntry,
  type AdditivesDimension,
  type DensityDimension,
  type NovaDimension,
  type NutriScoreDimension,
  type NutrientDimension,
  type NutrientDimensionId,
  type Outcome,
  type SourceRef,
  type TrafficBand,
} from "./types";

const BAND_OUTCOME: Readonly<Record<TrafficBand, Exclude<Outcome, "not_assessable">>> = {
  green: "favorable",
  amber: "intermediate",
  red: "unfavorable",
};

const BAND_TEXT: Readonly<Record<TrafficBand, string>> = {
  green: "verde (basso)",
  amber: "ambra (medio)",
  red: "rosso (alto)",
};

/** Il prodotto è una bevanda se ha la categoria Open Food Facts "beverages" (gli antenati sono inclusi). */
export function isDrink(product: Pick<Product, "categories">): boolean {
  return (product.categories ?? []).includes("beverages");
}

/** Grassi, grassi saturi, zuccheri o sale per 100 g o 100 ml, con le soglie ufficiali del semaforo. */
export function assessNutrient(product: Product, id: NutrientDimensionId): NutrientDimension {
  const label = NUTRIENT_DIMENSION_LABEL[id];
  const missing = (why: string): NutrientDimension => ({
    id,
    kind: "graded",
    label,
    outcome: "not_assessable",
    explanation: why,
    sources: [],
  });

  const nutrients = product.nutrients;
  if (!nutrients) return missing("Il prodotto non riporta i valori nutrizionali.");
  const value = nutrients[NUTRIENT_FIELD[id]];
  if (!isAmount(value)) return missing(`Il prodotto non riporta il valore di ${label.toLowerCase()}.`);

  const per = nutrients.per;
  if (per === "100ml" && !isDrink(product)) {
    return missing(
      "I valori sono per 100 ml ma il prodotto non è classificato come bevanda: la fonte ha soglie diverse per alimenti (per 100 g) e bevande (per 100 ml) e non so quale applicare.",
    );
  }
  const table = TRAFFIC_LIGHT_TABLES[per === "100ml" ? "drink" : "food"];
  const cutoff = table.cutoffs[id];
  const band: TrafficBand = value <= cutoff.lowMax ? "green" : value > cutoff.highAbove ? "red" : "amber";
  const unit = per === "100ml" ? "100 ml" : "100 g";
  const bound =
    band === "green"
      ? `entro la soglia bassa (${fmt(cutoff.lowMax, 2)} g)`
      : band === "red"
        ? `oltre la soglia alta (${fmt(cutoff.highAbove, 2)} g)`
        : `tra ${fmt(cutoff.lowMax, 2)} g e ${fmt(cutoff.highAbove, 2)} g`;
  return {
    id,
    kind: "graded",
    label,
    outcome: BAND_OUTCOME[band],
    explanation: `${label}: ${fmt(value, 2)} g per ${unit}, ${bound}: semaforo ${BAND_TEXT[band]} secondo i criteri britannici per l'etichettatura frontale (${table.location}). ${TRAFFIC_LIGHT_PORTION_NOTE}`,
    sources: [TRAFFIC_LIGHT_SOURCE],
    value,
    per,
    table: table.id,
    lowMax: cutoff.lowMax,
    highAbove: cutoff.highAbove,
    band,
  };
}

/** Nutri-Score: la lettera già presente nel prodotto (da Open Food Facts), mai ricalcolata. */
export function assessNutriScore(product: Product): NutriScoreDimension {
  const grade = product.nutriScore;
  if (!grade) {
    return {
      id: "nutriScore",
      kind: "graded",
      label: "Nutri-Score",
      outcome: "not_assessable",
      explanation: "Open Food Facts non riporta un Nutri-Score per questo prodotto e non lo calcolo io.",
      sources: [],
    };
  }
  return {
    id: "nutriScore",
    kind: "graded",
    label: "Nutri-Score",
    outcome: NUTRI_SCORE_OUTCOME[grade],
    explanation: `Nutri-Score ${grade.toUpperCase()}, valore presente nel prodotto da ${NUTRI_SCORE_DATA_ORIGIN}. L'esito raggruppa la scala A-E per posizione (A e B favorevole, C intermedio, D ed E sfavorevole); la lettera è sempre quella.`,
    sources: [NUTRI_SCORE_SOURCE],
    grade,
  };
}

/** Grado di lavorazione: gruppo NOVA presente nel prodotto, con la definizione della FAO. */
export function assessNova(product: Product): NovaDimension {
  const group = product.nova;
  if (group === undefined) {
    return {
      id: "nova",
      kind: "graded",
      label: "Grado di lavorazione (NOVA)",
      outcome: "not_assessable",
      explanation: "Il prodotto non ha un gruppo NOVA in Open Food Facts e non lo deduco io.",
      sources: [],
    };
  }
  const def = NOVA_DEFINITIONS[group];
  return {
    id: "nova",
    kind: "graded",
    label: "Grado di lavorazione (NOVA)",
    outcome: def.outcome,
    explanation: `Gruppo NOVA ${group}, ${def.name.toLowerCase()}, come attribuito da Open Food Facts. Definizione FAO: ${def.definition} ${def.basis}`,
    sources: [NOVA_SOURCE, NOVA_OFF_SOURCE],
    group,
  };
}

/**
 * Additivi: elenco e numero. Un giudizio c'è solo per gli additivi con una dichiarazione ufficiale
 * verificata (vedi `data/additives.ts`); per gli altri si mostra la presenza, senza allarmi.
 */
export function assessAdditives(
  product: Product,
  options: { ingredientsAnalysed?: boolean } = {},
): AdditivesDimension {
  const label = "Additivi";
  // Elenco vuoto esplicito, o ingredienti analizzati senza additivi: dato vero, non dato mancante.
  if ((product.additives !== undefined && product.additives.length === 0) || (product.additives === undefined && options.ingredientsAnalysed === true)) {
    return {
      id: "additives",
      kind: "descriptive",
      label,
      outcome: "not_assessable",
      explanation: "Nessun additivo tra gli ingredienti dichiarati. È un'informazione, non un giudizio.",
      sources: [],
      count: 0,
      items: [],
    };
  }
  if (product.additives === undefined) {
    return {
      id: "additives",
      kind: "graded",
      label,
      outcome: "not_assessable",
      explanation: "Il prodotto non riporta l'elenco degli additivi.",
      sources: [],
      items: [],
    };
  }
  const codes = [...new Set(product.additives.map(normalizeAdditiveCode))];
  const items: AdditiveEntry[] = codes.map((code) => {
    const s = statementFor(code);
    return s ? { code, statement: { kind: s.kind, outcome: s.outcome, name: s.name, text: s.text, source: s.source } } : { code };
  });
  const flagged = items.filter((i) => i.statement);
  const countText = `${codes.length} additiv${codes.length === 1 ? "o" : "i"}: ${codes.join(", ")}`;
  if (flagged.length === 0) {
    return {
      id: "additives",
      kind: "graded",
      label,
      outcome: "not_assessable",
      explanation: `${countText}. Il dato c'è, ma nessuno di questi additivi è tra quelli per cui ho una dichiarazione ufficiale verificata (E171 e sei coloranti): non c'è un giudizio e si mostra solo l'elenco.`,
      sources: [],
      count: codes.length,
      items,
    };
  }
  const worst = flagged.reduce<"intermediate" | "unfavorable">(
    (acc, i) => (i.statement && OUTCOME_RANK[i.statement.outcome] > OUTCOME_RANK[acc] ? i.statement.outcome : acc),
    "intermediate",
  );
  const sources: SourceRef[] = [];
  for (const i of flagged) {
    if (i.statement && !sources.some((s) => s.url === i.statement?.source.url)) sources.push(i.statement.source);
  }
  const notes = flagged.map((i) => `${i.code} (${i.statement?.name}): ${i.statement?.text}`).join(" ");
  return {
    id: "additives",
    kind: "graded",
    label,
    outcome: worst,
    explanation: `${countText}. ${notes} Per gli altri additivi non c'è un giudizio, solo la presenza.`,
    sources,
    count: codes.length,
    items,
  };
}

/** Proteine e fibre per 100 kcal: valori descrittivi, senza soglie. */
export function assessDensity(product: Product): DensityDimension {
  const label = "Densità di nutrienti";
  const n = product.nutrients;
  const energy = n?.energyKcal;
  const base: Omit<DensityDimension, "explanation"> = {
    id: "nutrientDensity",
    kind: "descriptive",
    label,
    outcome: "not_assessable",
    sources: [],
  };
  if (!n || !isAmount(energy) || energy <= 0) {
    return { ...base, explanation: "Senza l'energia (maggiore di zero) non si possono calcolare proteine e fibre per 100 kcal." };
  }
  const protein = isAmount(n.proteins) ? Math.round((n.proteins / energy) * 100 * 100) / 100 : undefined;
  const fiber = isAmount(n.fiber) ? Math.round((n.fiber / energy) * 100 * 100) / 100 : undefined;
  const parts: string[] = [];
  if (protein !== undefined) parts.push(`${fmt(protein, 2)} g di proteine`);
  if (fiber !== undefined) parts.push(`${fmt(fiber, 2)} g di fibre`);
  if (parts.length === 0) {
    return { ...base, explanation: "Il prodotto non riporta né proteine né fibre." };
  }
  return {
    ...base,
    explanation: `Ogni 100 kcal: ${parts.join(" e ")}. Sono valori descrittivi, senza soglie né giudizio.`,
    ...(protein !== undefined ? { proteinGPer100Kcal: protein } : {}),
    ...(fiber !== undefined ? { fiberGPer100Kcal: fiber } : {}),
  };
}
