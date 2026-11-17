// Dati pronti per le schermate delle preparazioni: elenco, scadenza delle porzioni, programma della settimana. Logica pura.
import { addDays, diffDays, urgency } from "@/core/expiry";
import { weekStartOf, type PlanState } from "@/core/plan";
import {
  buildPrepSchedule,
  existingPortionsOf,
  portionLifeDays,
  type PrepRecord,
  type PrepRepairResult,
  type PrepRepairSkipReason,
  type PrepState,
  type PrepTask,
} from "@/core/prep";
import type { Lot } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import type { ExpiryLevel } from "@/design";
import { dayOf, expiryTagText, formatCalendarDate } from "../format";

export interface ExpiryView {
  level: ExpiryLevel;
  text: string;
  estimated: boolean;
  date: string;
}

/** Scadenza delle porzioni: sempre una stima, e vale come «da consumare entro» (cibo cotto). */
export function prepExpiry(prep: Pick<PrepRecord, "expiry" | "status">, now: string): ExpiryView | undefined {
  if (!prep.expiry || prep.status !== "active") return undefined;
  const u = urgency({ date: prep.expiry.date, nature: prep.expiry.kind === "best_before" ? "quality" : "safety" }, now);
  const level: ExpiryLevel =
    u.level === "expired" || u.level === "today" || u.level === "tomorrow" ? "urgent" : u.level === "past_quality" || u.level === "soon" ? "near" : "calm";
  return { level, text: expiryTagText(u), estimated: prep.expiry.kind === "estimated", date: prep.expiry.date };
}

export interface PrepRow {
  prep: PrepRecord;
  expiry?: ExpiryView;
  active: boolean;
}

/** In corso per prime, dalla scadenza più vicina; poi quelle finite, dalla più recente. */
export function prepRows(state: PrepState, now: string): { active: PrepRow[]; finished: PrepRow[] } {
  const rows = state.preps.map((prep) => ({ prep, expiry: prepExpiry(prep, now), active: prep.status === "active" && prep.remaining > 0 }));
  const active = rows
    .filter((r) => r.active)
    .sort((a, b) => (a.expiry?.date ?? "9999-12-31").localeCompare(b.expiry?.date ?? "9999-12-31") || a.prep.title.localeCompare(b.prep.title, "it"));
  const finished = rows.filter((r) => !r.active).sort((a, b) => b.prep.cookedAt.localeCompare(a.prep.cookedAt));
  return { active, finished };
}

/** "4 porzioni su 6", "ultima porzione", "finite". */
export function portionsText(prep: Pick<PrepRecord, "remaining" | "portions" | "status">): string {
  if (prep.status === "batch_missing") return "Lotto non trovato";
  if (prep.remaining <= 0) return "Finite";
  if (prep.remaining === 1) return prep.portions === 1 ? "1 porzione" : `Ultima porzione, su ${prep.portions}`;
  return `${prep.remaining} porzioni su ${prep.portions}`;
}

/** Spiegazione del rifiuto di annullare una preparazione le cui porzioni sono già state usate. */
export function portionsUsedExplanation(prep: Pick<PrepRecord, "eaten" | "discarded" | "gifted">): string {
  const parts: string[] = [];
  if (prep.eaten > 0) parts.push(`${prep.eaten} ${prep.eaten === 1 ? "mangiata" : "mangiate"}`);
  if (prep.discarded > 0) parts.push(`${prep.discarded} ${prep.discarded === 1 ? "buttata" : "buttate"}`);
  if (prep.gifted > 0) parts.push(`${prep.gifted} ${prep.gifted === 1 ? "regalata" : "regalate"}`);
  const used = parts.length > 0 ? parts.join(", ") : "alcune porzioni sono già state usate";
  return `Non posso annullare questa preparazione: ${used}. Annullarla toglierebbe anche quegli usi dal registro. Se vuoi correggere, annulla prima quegli usi, oppure segna le porzioni rimaste come buttate.`;
}

/* ---------- programma ---------- */

export interface ProgramTask {
  task: PrepTask;
  /** Nome da mostrare: quello della preparazione se esiste già, altrimenti l'identificativo scritto nel piano. */
  title: string;
  /** Preparazione già fatta con questo identificativo, se c'è. */
  existing?: PrepRecord;
  /** La data entro cui prepararla è già passata. */
  overdue: boolean;
  /** Giorni a `cookBy` (negativo se passata). */
  daysLeft: number;
}

/** Porzioni che il piano chiede per una preparazione, quelle già pronte e quelle da cucinare. */
export interface ProgramCoverage {
  prepId: string;
  title: string;
  needed: number;
  covered: number;
  toCook: number;
}

export interface Program {
  tasks: ProgramTask[];
  /** Solo le preparazioni di cui ci sono porzioni già pronte. */
  coverage: ProgramCoverage[];
}

function labelOf(prepId: string): string {
  // un identificativo generato non è un nome: meglio dirlo che mostrare una stringa illeggibile
  return /\s/.test(prepId) || prepId.length <= 24 ? prepId : "Preparazione del piano";
}

/**
 * Cosa preparare e entro quando, per la settimana in corso e la successiva. La durata delle porzioni è quella
 * del luogo in cui si tengono (frigo se la preparazione non esiste ancora). Le porzioni già pronte si usano prima:
 * coprono la settimana in corso, i compiti riguardano solo il resto. Escluso ciò che il piano ha già finito di usare.
 */
export function programTasks(plan: PlanState, preps: PrepState, now: string): Program {
  const today = dayOf(now);
  const week = weekStartOf(today);
  const byId = new Map(preps.preps.map((p) => [p.prepId, p]));
  const lifeDays = (prepId: string): number | undefined => {
    const existing = byId.get(prepId);
    try {
      return portionLifeDays({ location: existing?.location ?? "frigo", cookedOn: existing ? dayOf(existing.cookedAt) : today });
    } catch {
      return undefined;
    }
  };
  const first = buildPrepSchedule(plan, week, { portionLifeDays: lifeDays, existingPortions: existingPortionsOf(preps) });
  const second = buildPrepSchedule(plan, addDays(week, 7), { portionLifeDays: lifeDays });

  const tasks = [...first.tasks, ...second.tasks]
    .filter((t) => t.lastUse >= today)
    .map((task) => {
      const existing = byId.get(task.prepId);
      const daysLeft = diffDays(task.cookBy, today);
      return { task, title: existing?.title ?? labelOf(task.prepId), ...(existing ? { existing } : {}), overdue: daysLeft < 0, daysLeft };
    })
    .sort((a, b) => a.task.cookBy.localeCompare(b.task.cookBy) || a.title.localeCompare(b.title, "it"));

  const sums = new Map<string, ProgramCoverage>();
  for (const c of [...first.coverage, ...second.coverage]) {
    const cur = sums.get(c.prepId);
    sums.set(c.prepId, {
      prepId: c.prepId,
      title: byId.get(c.prepId)?.title ?? labelOf(c.prepId),
      needed: (cur?.needed ?? 0) + c.needed,
      covered: (cur?.covered ?? 0) + c.covered,
      toCook: (cur?.toCook ?? 0) + c.toCook,
    });
  }
  const coverage = [...sums.values()].filter((c) => c.covered > 0).sort((a, b) => a.title.localeCompare(b.title, "it"));
  return { tasks, coverage };
}

const portions = (n: number): string => (n === 1 ? "1 porzione" : `${n} porzioni`);

/** "3 porzioni già pronte, 2 da cucinare" / "Le 4 porzioni che servono sono già pronte". */
export function coverageText(c: Pick<ProgramCoverage, "needed" | "covered" | "toCook">): string {
  if (c.toCook <= 0) return `${c.needed === 1 ? "La porzione che serve è già pronta" : `Le ${c.needed} porzioni che servono sono già pronte`}: non c'è da cucinare`;
  return `${portions(c.covered)} già ${c.covered === 1 ? "pronta" : "pronte"}, ${c.toCook} da cucinare`;
}

/** "entro domani", "entro lun 17 nov", "entro oggi", "era da fare entro ieri". */
export function cookByText(t: Pick<ProgramTask, "daysLeft" | "task">): string {
  if (t.daysLeft < 0) return t.daysLeft === -1 ? "Era da fare entro ieri" : `Era da fare entro ${formatCalendarDate(t.task.cookBy)}`;
  if (t.daysLeft === 0) return "Da fare entro oggi";
  if (t.daysLeft === 1) return "Da fare entro domani";
  return `Da fare entro ${formatCalendarDate(t.task.cookBy)}`;
}

/* ---------- riparazione ---------- */

/**
 * Perché una preparazione è da sistemare. Ognuna ha la sua frase in `repairItemText`:
 * - `pending`: annullata, ma alcune porzioni sono state usate altrove e la dispensa non ne tiene conto;
 * - `overlap`: due correzioni coprono lo stesso uso;
 * - `stale`: una correzione copre un uso poi annullato;
 * - `active`: la preparazione è stata ripristinata, ma le correzioni scritte prima sono ancora attive.
 */
export type RepairKind = "pending" | "overlap" | "stale" | "active";

const KIND_OF: Partial<Record<string, RepairKind>> = {
  voided_prep_portions_used: "pending",
  prep_repair_overlap: "overlap",
  prep_repair_stale_use: "stale",
  prep_repair_on_active_prep: "active",
};

export interface RepairItem {
  prepId: string;
  title: string;
  usedPortions: number;
  portions: number;
  /** Porzioni usate che la dispensa non tiene ancora conto (0 se non c'è niente da riscalare). */
  pendingPortions: number;
  kinds: RepairKind[];
}

/**
 * Preparazioni la cui dispensa è da sistemare dopo una sincronizzazione tra dispositivi. Una voce per
 * preparazione, da mostrare con «Sistema». Anche una preparazione attiva può comparire (`active`).
 */
export function repairItems(state: PrepState, events: Iterable<unknown>): RepairItem[] {
  const titles = new Map<string, string>();
  const preps = new Map<string, string>();
  for (const e of events as Iterable<{ type?: unknown; id?: unknown; title?: unknown; prepId?: unknown }>) {
    if (e?.type === "prep" && typeof e.id === "string" && typeof e.title === "string") {
      titles.set(e.id, e.title);
      if (typeof e.prepId === "string") preps.set(e.prepId, e.title);
    }
  }
  const byPrep = new Map<string, RepairItem>();
  for (const a of state.anomalies) {
    const kind = KIND_OF[a.code];
    if (!kind || !a.prepId) continue;
    const o = a.orphanUse;
    const cur = byPrep.get(a.prepId);
    const kinds = [...(cur?.kinds ?? [])];
    if (!kinds.includes(kind)) kinds.push(kind);
    byPrep.set(a.prepId, {
      prepId: a.prepId,
      title: (o ? titles.get(o.prepEventId) : undefined) ?? preps.get(a.prepId) ?? labelOf(a.prepId),
      usedPortions: o?.usedPortions ?? cur?.usedPortions ?? 0,
      portions: o?.portions ?? cur?.portions ?? 0,
      pendingPortions: o?.pendingPortions ?? cur?.pendingPortions ?? 0,
      kinds,
    });
  }
  return [...byPrep.values()];
}

/** Una frase chiara per ogni motivo, in ordine. */
export function repairItemText(r: RepairItem): string {
  const parts: string[] = [];
  const n = r.pendingPortions;
  if (r.kinds.includes("pending")) {
    parts.push(
      `«${r.title}» è stata annullata su un dispositivo, ma ${n === 1 ? "1 porzione" : `${n} porzioni`} su ${r.portions} ${n === 1 ? "risulta usata" : "risultano usate"} su un altro e la dispensa non ne tiene conto: gli ingredienti sono tornati per intero.`,
    );
  }
  if (r.kinds.includes("overlap")) {
    parts.push(`Per «${r.title}» due correzioni coprono lo stesso uso: la dispensa è scalata due volte.`);
  }
  if (r.kinds.includes("stale")) {
    parts.push(`Per «${r.title}» una correzione copre una porzione il cui uso è stato poi annullato: la dispensa è scalata di troppo.`);
  }
  if (r.kinds.includes("active")) {
    parts.push(`«${r.title}» è stata ripristinata dopo essere stata sistemata, ma le correzioni di prima sono ancora attive: gli ingredienti sono scalati due volte.`);
  }
  return parts.join(" ");
}

const SKIP_TEXT: Record<PrepRepairSkipReason, string> = {
  lot_missing: "l'alimento non c'è più in dispensa",
  unit_mismatch: "l'unità non coincide",
};

export interface RepairView {
  /** "Farina 150 g". */
  lines: string[];
  /** Quante correzioni doppie verrebbero annullate. */
  redundant: number;
  /** "Del riso restano 50 g, ne andrebbero scalati 100 g". */
  shortfalls: string[];
  /** Ingredienti che non si possono riparare, con il motivo. */
  skipped: string[];
  explanation: string;
}

/** Ciò che la riparazione scriverebbe, scritto per l'utente prima di confermare. */
export function describeRepair(
  repair: Extract<PrepRepairResult, { ok: true }>,
  lots: readonly Pick<Lot, "lotId" | "productRef" | "unit">[],
): RepairView {
  const lot = (lotId: string) => lots.find((l) => l.lotId === lotId);
  const name = (lotId: string) => lot(lotId)?.productRef ?? "Ingrediente";
  const amount = (lotId: string, value: number) => {
    const unit = lot(lotId)?.unit;
    return unit ? formatQuantity({ value, unit }) : String(value);
  };
  const explanation =
    repair.repairedPortions > 0
      ? `Restano da coprire ${repair.repairedPortions === 1 ? "1 porzione" : `${repair.repairedPortions} porzioni`} su ${repair.portions}: tolgo dalla dispensa la stessa quota degli ingredienti (circa il ${Math.round(repair.fraction * 100)}%). È una stima in proporzione, non una misura.`
      : "Non resta niente da scalare.";
  return {
    lines: repair.events.map((e) => `${name(e.lotId)} ${formatQuantity(e.quantity)}`),
    redundant: repair.voids.length,
    shortfalls: repair.shortfalls.map(
      (f) => `Di ${name(f.lotId).toLowerCase()} restano ${amount(f.lotId, f.available)}, ne andrebbero scalati ${amount(f.lotId, f.requested)}: scalo solo ciò che c'è`,
    ),
    skipped: repair.skipped.map((s) => `${name(s.lotId)}: ${SKIP_TEXT[s.reason]}`),
    explanation,
  };
}
