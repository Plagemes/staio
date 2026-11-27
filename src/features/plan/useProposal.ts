"use client";

// Lo stato di «Proponi una settimana» nella schermata della settimana: la proposta vive qui, in memoria, finché
// l'utente la usa o la scarta. Niente si scrive nel piano prima di «Usa questa settimana».
import { useCallback, useMemo, useState } from "react";
import type { ConfirmationMap } from "@/core/allergens";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import {
  explainProposal,
  proposeWeek,
  swapPick,
  type PlannedEntry,
  type ProposalInput,
  type ProposalPick,
  type ProposalSlot,
  type WeekProposal,
} from "@/core/plan";
import type { DietGroup } from "@/core/diet";
import { buildPriceBook } from "@/core/shopping";
import { useDietAdvice } from "../diet";
import {
  buildProposalInput,
  defaultMoments,
  defaultSettings,
  dietSoFar,
  finalizeProposal,
  withDietSoFar,
  type Finalized,
  type ProposalSettings,
} from "./proposal";
import { slotsToFill } from "./moveMeal";
import type { PlanData } from "./usePlanData";

interface Snapshot {
  settings: ProposalSettings;
  input: ProposalInput;
  picks: ProposalPick[];
  /** Ci sono prezzi: l'opzione «Spendi il meno possibile» ha senso. */
  hasPrices: boolean;
  /** Da cosa dipende ciò che si è controllato: se cambia, la proposta si ricontrolla. */
  deps: readonly unknown[];
}

const NO_GAPS: Partial<Record<DietGroup, number>> = {};

/** Perché non si può proporre: senza ricette salvate, o senza posti liberi da oggi in poi. */
export type ProposalUnavailable = "no_recipes" | "no_slots";

export const PROPOSAL_UNAVAILABLE_TEXT: Record<ProposalUnavailable, string> = {
  no_recipes: "Per proporre servono ricette salvate.",
  no_slots: "Non ci sono posti liberi da oggi in poi.",
};

export interface ProposalView {
  /** Ci sono posti vuoti da riempire (con i momenti di partenza) e ciò che serve è letto. */
  available: boolean;
  /** Quando non si può proporre, il perché; null se si può o se ciò che serve non è ancora letto. */
  unavailable: ProposalUnavailable | null;
  active: boolean;
  settings: ProposalSettings | undefined;
  proposal: WeekProposal | undefined;
  hasPrices: boolean;
  /** Porzioni che mancano nella settimana, per gruppo (vuoto se la settimana non è quella in corso o non c'è lacuna). */
  dietGaps: Partial<Record<DietGroup, number>>;
  /** Ci sono lacune aperte: «Colma ciò che manca nella settimana» ha senso. */
  hasGaps: boolean;
  recipeCount: number;
  /** Una riga sotto la proposta, per esempio «non ho altre ricette per questo posto». */
  message: string | null;
  start: () => void;
  discard: () => void;
  change: (settings: ProposalSettings) => void;
  swap: (slot: ProposalSlot) => void;
  drop: (slot: ProposalSlot) => void;
  /** Le voci da scrivere, dopo l'ultimo controllo, sulle voci della settimana lette adesso. `undefined` se non c'è una proposta. */
  finalize: (currentEntries: readonly PlannedEntry[]) => Finalized | undefined;
}

interface Args {
  data: PlanData;
  weekStart: string;
  weekDates: readonly string[];
  entries: readonly PlannedEntry[];
  declared: { allergens: string[]; excludedFoods: string[] };
  /** Allergeni ed esclusioni letti: senza, non si propone niente. */
  declaredReady: boolean;
  confirmations: ConfirmationMap | undefined;
}

export function useProposal({ data, weekStart, weekDates, entries, declared, declaredReady, confirmations }: Args): ProposalView {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const plan = data.plan;
  const diet = useDietAdvice();
  // le lacune valgono per la settimana in corso: per un'altra settimana la proposta resta quella di sempre
  const dietWeek = diet.planned?.weekStart === weekStart;
  const dietGaps = useMemo(() => (dietWeek ? diet.gaps : NO_GAPS), [dietWeek, diet.gaps]);
  const hasGaps = Object.keys(dietGaps).length > 0;
  const sofar = useMemo(() => (dietWeek ? dietSoFar(diet.history, diet.planned, weekStart) : NO_GAPS), [dietWeek, diet.history, diet.planned, weekStart]);
  const timeZone = data.diary?.timeZone ?? DEFAULT_TIME_ZONE;

  const slotsFor = useCallback(
    (kinds: ProposalSettings["moments"]) =>
      data.diary && data.now ? slotsToFill({ weekEntries: entries, diary: data.diary, now: data.now, timeZone, today: data.today, weekStart, kinds }) : [],
    [data.diary, data.now, data.today, entries, timeZone, weekStart],
  );

  const freeSlots = useMemo(
    () => (plan && declaredReady && data.ready ? slotsFor(defaultMoments(plan.structure?.meals.map((m) => m.kind))).length : undefined),
    [plan, declaredReady, data.ready, slotsFor],
  );
  const available = freeSlots !== undefined && freeSlots > 0;
  const unavailable: ProposalUnavailable | null = freeSlots === undefined ? null : data.recipes.length === 0 ? "no_recipes" : freeSlots === 0 ? "no_slots" : null;

  const buildInput = useCallback(
    (settings: ProposalSettings) => {
      if (!plan || !data.now) return undefined;
      const book = data.pantry ? buildPriceBook(data.pantry) : undefined;
      const hasPrices = (book?.series.length ?? 0) > 0;
      const input = buildProposalInput({
        recipes: data.recipes,
        settings: { ...settings, spendLeast: settings.spendLeast && hasPrices },
        today: data.today,
        now: data.now,
        timeZone,
        lots: data.lots,
        declared,
        linkOf: data.linkOf,
        ...(confirmations ? { confirmations } : {}),
        ...(data.foods ? { foods: data.foods } : {}),
        ...(diet.recipeFacts ? { dietFacts: diet.recipeFacts } : {}),
        ...(hasGaps ? { dietGaps } : {}),
        overrides: data.overrides,
        ...(data.nutrientsOf ? { nutrientsOf: data.nutrientsOf } : {}),
        ...(book && hasPrices ? { book } : {}),
        plan,
        weekDates,
        slots: slotsFor(settings.moments),
        entries,
      });
      return { input, hasPrices };
    },
    [plan, data, timeZone, declared, confirmations, weekDates, slotsFor, entries, diet.recipeFacts, hasGaps, dietGaps],
  );

  const deps = useMemo(() => [data.recipes, declared, confirmations, data.linkOf, entries] as const, [data.recipes, declared, confirmations, data.linkOf, entries]);

  const generate = useCallback(
    (settings: ProposalSettings) => {
      const built = buildInput(settings);
      if (!built) return;
      setSnap({ settings, input: built.input, picks: proposeWeek(built.input).picks, hasPrices: built.hasPrices, deps });
      setMessage(null);
    },
    [buildInput, deps],
  );

  // Se cambiano ricette, allergeni, esclusioni, conferme o le voci della settimana mentre la proposta è aperta, si
  // ricontrolla: restano le scelte ancora valide, le altre si tolgono e si dice quante.
  if (snap && snap.deps.some((d, i) => d !== deps[i])) {
    const built = buildInput(snap.settings);
    if (built) {
      const ok = new Map(built.input.recipes.map((r) => [r.recipeId, r]));
      const free = new Set(built.input.slots.map((x) => `${x.date}|${x.meal}`));
      const kept = snap.picks.filter((p) => {
        const r = ok.get(p.recipeId);
        return r !== undefined && free.has(`${p.slot.date}|${p.slot.meal}`) && (r.safety === "clear" || (r.safety === "uncertain" && snap.settings.allowUncertain));
      });
      const removed = snap.picks.length - kept.length;
      setSnap({ ...snap, input: built.input, picks: kept, hasPrices: built.hasPrices, deps });
      if (removed > 0) setMessage(`Ho tolto ${removed} ${removed === 1 ? "voce" : "voci"} dalla proposta: la ricetta è cambiata o ritirata, il posto è stato occupato, o il controllo di allergeni ed esclusioni non la ammette più.`);
    }
  }

  const proposal = useMemo(() => {
    if (!snap) return undefined;
    const explained = explainProposal(snap.input, snap.picks);
    return { ...explained, meals: withDietSoFar(explained.meals, sofar) };
  }, [snap, sofar]);

  const start = useCallback(() => {
    if (plan) generate(defaultSettings({ plan, weekDates, today: data.today, hasGaps }));
  }, [plan, generate, weekDates, data.today, hasGaps]);

  const swap = useCallback(
    (slot: ProposalSlot) => {
      if (!snap) return;
      const next = swapPick(snap.input, snap.picks, slot);
      if (!next) {
        setMessage("Per questo posto non ho altre ricette adatte.");
        return;
      }
      setMessage(null);
      setSnap({ ...snap, picks: next });
    },
    [snap],
  );

  const drop = useCallback(
    (slot: ProposalSlot) => {
      if (!snap) return;
      setMessage(null);
      setSnap({ ...snap, picks: snap.picks.filter((p) => !(p.slot.date === slot.date && p.slot.meal === slot.meal)) });
    },
    [snap],
  );

  const finalize = useCallback(
    (currentEntries: readonly PlannedEntry[]) => {
    if (!snap || !proposal || !plan) return undefined;
    return finalizeProposal({
      entries: currentEntries,
      activeRecipeIds: new Set(data.recipes.map((r) => r.recipeId)),
      meals: proposal.meals,
      weekStart,
      declared,
      expandForChecks: data.expandForChecks,
      linkOf: data.linkOf,
      ...(confirmations ? { confirmations } : {}),
      allowUncertain: snap.settings.allowUncertain,
    });
    },
    [snap, proposal, plan, weekStart, declared, data.recipes, data.expandForChecks, data.linkOf, confirmations],
  );

  return {
    available,
    unavailable,
    active: snap !== null,
    settings: snap?.settings,
    proposal,
    hasPrices: snap?.hasPrices ?? false,
    dietGaps,
    hasGaps,
    recipeCount: data.recipes.length,
    message,
    start,
    discard: () => {
      setSnap(null);
      setMessage(null);
    },
    change: generate,
    swap,
    drop,
    finalize,
  };
}
