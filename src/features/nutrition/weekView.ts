// Frasi delle sezioni «Proteine nella giornata» e «Varietà vegetale». Solo descrizione, nessun obiettivo.
import type { AbsentGroup, Monotony, PlantGroup, ProteinMoment, ProteinSpread, VarietyReport } from "@/core/nutrition";
import { MEAL_KIND_LABELS } from "../meals";

export const PLANT_GROUP_LABELS: Record<PlantGroup, string> = {
  vegetables: "Verdura",
  fruit: "Frutta",
  legumes: "Legumi",
  wholeGrains: "Cereali integrali",
  nutsSeeds: "Frutta a guscio e semi",
  herbs: "Erbe",
};

export const MOMENT_LABELS: Record<ProteinMoment, string> = {
  breakfast: MEAL_KIND_LABELS.breakfast,
  lunch: MEAL_KIND_LABELS.lunch,
  dinner: MEAL_KIND_LABELS.dinner,
  other: "Altro",
};

const MOMENT_WHERE: Record<ProteinMoment, string> = {
  breakfast: "a colazione",
  lunch: "a pranzo",
  dinner: "a cena",
  other: "fuori dai pasti principali",
};

const days = (n: number) => (n === 1 ? "1 giorno" : `${n} giorni`);

export function absentText(a: AbsentGroup): string {
  const what = PLANT_GROUP_LABELS[a.group].toLowerCase();
  return a.daysSince === undefined ? `Niente ${what} nei dati registrati` : `Niente ${what} da ${days(a.daysSince)}`;
}

export function monotonyText(m: Monotony): string {
  return `«${m.name}» è in ${m.meals} pasti su ${m.totalMeals}: più della metà dei pasti registrati.`;
}

export interface VarietyView {
  empty: boolean;
  headline: string;
  coverage: string;
  trend: string;
  caveat?: string;
}

export function varietyView(r: VarietyReport): VarietyView {
  const { current: c, previous: p } = r;
  if (c.daysWithData === 0) {
    return { empty: true, headline: "", coverage: "", trend: "" };
  }
  const coverage = `${days(c.daysWithData)} con dati negli ultimi 7, ${c.completeDays} completi.`;
  const trend =
    p.daysWithData === 0
      ? "Nella settimana prima non ci sono dati per un confronto."
      : `La settimana prima: ${p.partial ? "almeno " : ""}${p.count}.`;
  const reasons: string[] = [];
  if (c.completeDays < c.daysWithData) reasons.push("alcuni giorni sono incompleti");
  if (c.unrecognizedLines > 0) reasons.push(`${c.unrecognizedLines === 1 ? "una voce non è stata riconosciuta" : `${c.unrecognizedLines} voci non sono state riconosciute`} (prodotti, preparazioni o alimenti non in tabella)`);
  return {
    empty: false,
    headline: `${c.partial ? "almeno " : ""}${c.count}`,
    coverage,
    trend,
    ...(reasons.length > 0 ? { caveat: `Il conteggio può essere più alto: ${reasons.join(" e ")}.` } : {}),
  };
}

export interface SpreadView {
  empty: boolean;
  summary: string;
  coverage: string;
  caveat?: string;
}

export function spreadView(s: ProteinSpread): SpreadView {
  if (s.completeDays === 0 || s.top === undefined) {
    return {
      empty: true,
      summary: "",
      coverage:
        s.daysWithData === 0
          ? "Nessun giorno con dati negli ultimi 7."
          : "Nessun giorno completo con dati sulle proteine negli ultimi 7: contano solo i giorni con colazione, pranzo e cena tracciati.",
    };
  }
  const top = s.moments.find((m) => m.moment === s.top)!;
  const pct = Math.round((top.share ?? 0) * 100);
  const summary = s.topIsMajority
    ? `In media la maggior parte delle proteine è ${MOMENT_WHERE[s.top]} (${pct}%).`
    : `Nessun momento prevale: il più alto è ${MOMENT_WHERE[s.top] === "fuori dai pasti principali" ? "altro" : MOMENT_LABELS[s.top].toLowerCase()} (${pct}%).`;
  return {
    empty: false,
    summary,
    coverage: `Media su ${days(s.completeDays)} completi degli ultimi 7 (${days(s.daysWithData)} con dati).`,
    ...(s.partial ? { caveat: "Alcune voci non hanno il dato sulle proteine: i grammi sono un minimo." } : {}),
  };
}
