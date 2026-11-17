// Come le proteine si distribuiscono nei momenti della giornata, nei giorni completi.
// Solo descrizione: nessun consiglio su quanto mangiarne.

import { addDays, type MealKind } from "../diary";
import type { Certainty } from "../ledger";
import type { DayIntake, IntakeLine } from "./intake";

export const PROTEIN_MOMENTS = ["breakfast", "lunch", "dinner", "other"] as const;
export type ProteinMoment = (typeof PROTEIN_MOMENTS)[number];

const momentOfKind = (kind: MealKind): ProteinMoment => (kind === "snack" ? "other" : kind);

const WORSE: Record<Certainty, number> = { measured: 0, label: 1, estimated: 2 };

export interface MomentProtein {
  moment: ProteinMoment;
  /** Media dei grammi nei giorni completi in cui il momento ha dati. Assente se nessun giorno li ha. */
  grams?: number;
  /** Giorni completi su cui è calcolata la media di questo momento. */
  days: number;
  /** Alcune voci del momento non hanno il dato: la media è un minimo. */
  partial: boolean;
  /** La peggiore certezza tra le voci: `estimated` va mostrato come stima. */
  certainty?: Certainty;
  /** Quota sul totale delle medie dei momenti, da 0 a 1. */
  share?: number;
}

export interface ProteinSpread {
  from: string;
  to: string;
  /** Giorni con dati nella finestra, e quanti completi: solo questi ultimi entrano nelle medie. */
  daysWithData: number;
  completeDays: number;
  moments: MomentProtein[];
  /** Media giornaliera (somma delle medie dei momenti); assente senza giorni completi con dati. */
  dailyAverage?: number;
  /** Momento con la quota maggiore. */
  top?: ProteinMoment;
  /** Vero se `top` ha più della metà del totale. */
  topIsMajority: boolean;
  partial: boolean;
  certainty?: Certainty;
}

interface Cell {
  grams: number;
  known: boolean;
  partial: boolean;
  certainty?: Certainty;
}

function cellOf(lines: readonly IntakeLine[]): Cell {
  const cell: Cell = { grams: 0, known: false, partial: false };
  for (const line of lines) {
    const g = line.status === "ok" ? line.nutrients.proteinG : undefined;
    if (g === undefined) {
      cell.partial = true;
      continue;
    }
    cell.known = true;
    cell.grams += g;
    const c = (line as { certainty: Certainty }).certainty;
    if (cell.certainty === undefined || WORSE[c] > WORSE[cell.certainty]) cell.certainty = c;
  }
  return cell;
}

/**
 * Proteine per momento (colazione, pranzo, cena, altro) negli ultimi `days` giorni fino a `today`.
 * - Solo i giorni completi secondo la nutrizione; gli altri non entrano, e un giorno senza dati non conta.
 * - «Altro» raccoglie spuntini e consumi senza pasto.
 * - Un momento senza voci con il dato (per esempio «ho mangiato fuori») non entra nella media di quel momento.
 */
export function proteinSpread(days: readonly DayIntake[], today: string, span = 7): ProteinSpread {
  const from = addDays(today, -(span - 1));
  const inside = days.filter((d) => d.date >= from && d.date <= today && d.meals.length + d.standalone.length > 0);
  const complete = inside.filter((d) => d.complete);

  const sums = new Map<ProteinMoment, { total: number; days: number; partial: boolean; certainty?: Certainty }>();
  for (const day of complete) {
    for (const moment of PROTEIN_MOMENTS) {
      const lines =
        moment === "other"
          ? [...day.meals.filter((m) => m.kind === "snack").flatMap((m) => m.lines), ...day.standalone]
          : day.meals.filter((m) => momentOfKind(m.kind) === moment).flatMap((m) => m.lines);
      const cell = cellOf(lines);
      // «altro» assente in un giorno completo vale zero; un pasto principale senza dati è sconosciuto.
      if (!cell.known && !(moment === "other" && lines.length === 0)) {
        const s = sums.get(moment) ?? { total: 0, days: 0, partial: false };
        s.partial ||= cell.partial;
        sums.set(moment, s);
        continue;
      }
      const s = sums.get(moment) ?? { total: 0, days: 0, partial: false };
      s.total += cell.grams;
      s.days++;
      s.partial ||= cell.partial;
      if (cell.certainty && (s.certainty === undefined || WORSE[cell.certainty] > WORSE[s.certainty])) {
        s.certainty = cell.certainty;
      }
      sums.set(moment, s);
    }
  }

  const moments: MomentProtein[] = PROTEIN_MOMENTS.map((moment) => {
    const s = sums.get(moment);
    if (!s || s.days === 0) return { moment, days: 0, partial: s?.partial ?? false };
    return {
      moment,
      grams: s.total / s.days,
      days: s.days,
      partial: s.partial,
      ...(s.certainty !== undefined ? { certainty: s.certainty } : {}),
    };
  });
  const total = moments.reduce((t, m) => t + (m.grams ?? 0), 0);
  const withShare = moments.map((m) => (m.grams !== undefined && total > 0 ? { ...m, share: m.grams / total } : m));
  const ranked = withShare.filter((m) => m.share !== undefined).sort((a, b) => b.share! - a.share!);
  const top = ranked[0];
  const certainties = withShare.flatMap((m) => (m.certainty ? [m.certainty] : []));
  const worst = certainties.sort((a, b) => WORSE[b] - WORSE[a])[0];
  return {
    from,
    to: today,
    daysWithData: inside.length,
    completeDays: complete.length,
    moments: withShare,
    ...(total > 0 ? { dailyAverage: total } : {}),
    ...(top ? { top: top.moment } : {}),
    topIsMajority: top?.share !== undefined && top.share > 0.5,
    partial: withShare.some((m) => m.partial),
    ...(worst !== undefined ? { certainty: worst } : {}),
  };
}
