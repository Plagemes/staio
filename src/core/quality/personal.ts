// Voto personale: che cosa un prodotto aiuta o pesa RISPETTO A CHI LO USA. Si fonda solo sul
// confronto dell'assunzione con i riferimenti (risultato del motore nutrizionale, passato come
// parametro), sugli obiettivi indicati dall'utente e sui valori del prodotto. Non dà pareri medici.

import type { Product } from "../catalog";
import type { NutrientKey, ReferenceComparison } from "../nutrition";
import { fmt, isAmount } from "./common";
import { assessNutrient } from "./dimensions";
import type { NutrientDimensionId } from "./types";

export type PersonalNutrient =
  | "proteins"
  | "carbohydrates"
  | "sugars"
  | "fat"
  | "saturatedFat"
  | "fiber"
  | "salt";

export interface PersonalGoal {
  nutrient: PersonalNutrient;
  direction: "reduce" | "increase";
}

export type PersonalEffect = "helps" | "weighs" | "info";

export interface PersonalStatement {
  /** Assente per le note generali (per esempio confronti non utilizzabili). */
  nutrient?: PersonalNutrient;
  effect: PersonalEffect;
  /** Su che cosa si fonda: il confronto con il riferimento, un obiettivo dell'utente, il solo valore del prodotto. */
  basis: "reference" | "goal" | "label";
  text: string;
}

export interface PersonalVerdict {
  status: "ok" | "insufficient_data";
  /** Presente quando i dati non bastano. */
  reason?: string;
  helps: PersonalStatement[];
  weighs: PersonalStatement[];
  info: PersonalStatement[];
}

const NUTRIENTS: Readonly<Record<PersonalNutrient, { key: NutrientKey; name: string }>> = {
  proteins: { key: "proteinG", name: "proteine" },
  carbohydrates: { key: "carbsG", name: "carboidrati" },
  sugars: { key: "sugarsG", name: "zuccheri" },
  fat: { key: "fatG", name: "grassi" },
  saturatedFat: { key: "saturatedFatG", name: "grassi saturi" },
  fiber: { key: "fiberG", name: "fibre" },
  salt: { key: "saltG", name: "sale" },
};

const NUTRIENT_ORDER = Object.keys(NUTRIENTS) as PersonalNutrient[];
const TRAFFIC_NUTRIENTS: readonly PersonalNutrient[] = ["fat", "saturatedFat", "sugars", "salt"];

const KIND_TEXT = { PRI: "riferimento raccomandato", AI: "assunzione adeguata", UL: "livello massimo", RI: "intervallo di riferimento" } as const;

export function personalVerdict(
  product: Product,
  comparisons: readonly ReferenceComparison[] | undefined,
  goals: readonly PersonalGoal[] = [],
): PersonalVerdict {
  const verdict: PersonalVerdict = { status: "ok", helps: [], weighs: [], info: [] };
  const nutrients = product.nutrients;
  if (!nutrients) {
    return { ...verdict, status: "insufficient_data", reason: "Il prodotto non riporta i valori nutrizionali: non posso dire come incide su di te." };
  }
  const per = nutrients.per === "100ml" ? "100 ml" : "100 g";
  const valueOf = (n: PersonalNutrient): number | undefined => {
    const v = nutrients[n];
    return isAmount(v) ? v : undefined;
  };
  const push = (s: PersonalStatement) => {
    (s.effect === "helps" ? verdict.helps : s.effect === "weighs" ? verdict.weighs : verdict.info).push(s);
  };

  const list = comparisons ?? [];
  const usable = list.filter((c) => c.status === "compared").length;
  let withoutData = 0;

  for (const nutrient of NUTRIENT_ORDER) {
    const { key, name } = NUTRIENTS[nutrient];
    const v = valueOf(nutrient);
    if (v === undefined || v <= 0) continue;
    const has = `Contiene ${fmt(v, 2)} g di ${name} per ${per}`;
    for (const c of list.filter((x) => x.nutrient === key)) {
      if (c.status === "insufficient_data") {
        withoutData += 1;
        continue;
      }
      if (c.status === "not_comparable") {
        if (c.reason === "no_amount" && c.intake !== undefined) {
          push({
            nutrient,
            effect: "info",
            basis: "reference",
            text: `${has}. La tua assunzione media di ${name} è ${fmt(c.intake, 1)} g al giorno, ma il riferimento non ha un valore numerico confrontabile: non dico se è alta o bassa.`,
          });
        }
        continue;
      }
      const o = c.outcome;
      if ((o.kind === "PRI" || o.kind === "AI") && o.coveredShare < 1) {
        push({
          nutrient,
          effect: "helps",
          basis: "reference",
          text: `${has}; la tua assunzione media di ${name} è il ${Math.round(o.coveredShare * 100)}% del ${KIND_TEXT[o.kind]}, quindi sotto il riferimento.`,
        });
      } else if (o.kind === "UL" && o.exceeds) {
        push({
          nutrient,
          effect: "weighs",
          basis: "reference",
          text: `${has}; la tua assunzione media di ${name} (${fmt(o.intake, 1)} g al giorno) supera già il livello massimo di riferimento (${fmt(o.limit, 1)} g).`,
        });
      } else if (o.kind === "RI" && o.position === "above_range") {
        push({
          nutrient,
          effect: "weighs",
          basis: "reference",
          text: `${has}; la quota di energia che ti viene da ${name} (${fmt(o.percentOfEnergy, 1)}%) è già sopra l'intervallo di riferimento.`,
        });
      } else if (o.kind === "RI" && o.position === "below_range") {
        push({
          nutrient,
          effect: "helps",
          basis: "reference",
          text: `${has}; la quota di energia che ti viene da ${name} (${fmt(o.percentOfEnergy, 1)}%) è sotto l'intervallo di riferimento.`,
        });
      }
    }
  }

  for (const goal of goals) {
    const { name } = NUTRIENTS[goal.nutrient];
    const v = valueOf(goal.nutrient);
    const verb = goal.direction === "reduce" ? "ridurre" : "aumentare";
    if (v === undefined) {
      push({ nutrient: goal.nutrient, effect: "info", basis: "goal", text: `Obiettivo: ${verb} ${name}. Il prodotto non riporta il valore, non posso dire come incide.` });
      continue;
    }
    const has = `contiene ${fmt(v, 2)} g di ${name} per ${per}`;
    if (goal.direction === "increase") {
      push(
        v > 0
          ? { nutrient: goal.nutrient, effect: "helps", basis: "goal", text: `Obiettivo: aumentare ${name}. Il prodotto ${has}.` }
          : { nutrient: goal.nutrient, effect: "info", basis: "goal", text: `Obiettivo: aumentare ${name}. Secondo l'etichetta il prodotto non ne contiene (0 g per ${per}).` },
      );
      continue;
    }
    if (TRAFFIC_NUTRIENTS.includes(goal.nutrient)) {
      const dim = assessNutrient(product, goal.nutrient as NutrientDimensionId);
      if (dim.band === "red") {
        push({ nutrient: goal.nutrient, effect: "weighs", basis: "goal", text: `Obiettivo: ridurre ${name}. Il prodotto ${has}: semaforo rosso (alto) secondo i criteri britannici per l'etichettatura frontale.` });
        continue;
      }
      if (dim.band === "green") {
        push({ nutrient: goal.nutrient, effect: "helps", basis: "goal", text: `Obiettivo: ridurre ${name}. Il prodotto ${has}: semaforo verde (basso) secondo i criteri britannici per l'etichettatura frontale.` });
        continue;
      }
      if (dim.band === "amber") {
        push({ nutrient: goal.nutrient, effect: "info", basis: "goal", text: `Obiettivo: ridurre ${name}. Il prodotto ${has}: semaforo ambra (medio), né basso né alto.` });
        continue;
      }
    }
    push({ nutrient: goal.nutrient, effect: "info", basis: "goal", text: `Obiettivo: ridurre ${name}. Il prodotto ${has}; per questo nutriente non ho una soglia ufficiale con cui giudicarlo.` });
  }

  if (withoutData > 0) {
    verdict.info.push({
      effect: "info",
      basis: "reference",
      text: `Per ${withoutData} confront${withoutData === 1 ? "o" : "i"} con i riferimenti mancano giorni completi o dati sufficienti: non li uso.`,
    });
  }

  if (usable === 0 && goals.length === 0) {
    return {
      ...verdict,
      status: "insufficient_data",
      reason: "Non ci sono confronti con i riferimenti utilizzabili (servono abbastanza giorni completi registrati) né obiettivi indicati: non posso dire come incide su di te.",
    };
  }
  return verdict;
}
