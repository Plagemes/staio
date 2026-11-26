// «Proponi una settimana», lato app: dai dati dell'utente (ricette, dispensa, prezzi, obiettivi, allergeni) ai fatti che
// il generatore di `core/plan/propose` sceglie, i testi in italiano e il controllo finale prima di scrivere nel piano.
// Logica pura: niente si scrive qui.
import type { ConfirmationMap } from "@/core/allergens";
import { addDays, type MealKind } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { FoodComposition } from "@/core/nutrition";
import { nameTokens } from "@/core/nutrition";
import {
  DEFAULT_PROPOSAL_OPTIONS,
  foodKey,
  isQuickDayType,
  proposalEntries,
  dayTypeOf,
  targetsOf,
  type ExpandRef,
  type NutrientsOfEntry,
  type PlanState,
  type PlannedEntry,
  type ProposalDay,
  type ProposalIngredient,
  type ProposalInput,
  type ProposalNutrients,
  type ProposalReason,
  type ProposalRecipe,
  type ProposalSlot,
  type ProposalSummary,
  type ProposedMeal,
  type RecipeSafetyVerdict,
} from "@/core/plan";
import {
  compareWithPantry,
  exclusionReasons,
  rankByExpiring,
  recipeCost,
  stockFromLots,
  totalMinutes,
  type ExpiringFood,
  type PantryStock,
  type Recipe,
} from "@/core/recipes";
import type { PriceBook } from "@/core/shopping";
import type { Lot } from "@/core/ledger";
import { formatPrice } from "../format";
import { evaluateLots } from "../lots";
import { MEAL_KIND_ORDER } from "../meals";
import { makeContextFor, makeLookup, priceLookupFrom } from "../recipes/facts";
import { mainCandidates } from "../recipes/mainIngredient";
import { safetyKind } from "../recipes/safety";
import type { FoodOverrides } from "../nutrition/resolver";
import type { LinkOf } from "../recipes/allergenLinks";
import { whenText, weekdayName } from "./dates";
import { checkWeekConstraints } from "./safety";

/** Le scelte dell'utente per una proposta. Non si salvano: valgono per questa proposta. */
export interface ProposalSettings {
  moments: MealKind[];
  /** Giorni da riempire, `YYYY-MM-DD`. */
  days: string[];
  maxRepeats: number;
  /** Porzioni per ogni pasto proposto. */
  servings: number;
  allowUncertain: boolean;
  spendLeast: boolean;
  /** Giorni con poco tempo. */
  lowTimeDays: string[];
}

export const MAX_REPEAT_CHOICES = [1, 2, 3] as const;
export const SERVINGS_CHOICES = [1, 2, 3, 4] as const;

/** Il giorno di oggi e i successivi della settimana: quelli passati non si riempiono. */
export const remainingDays = (weekDates: readonly string[], today: string): string[] => weekDates.filter((d) => d >= today);

/**
 * I momenti di partenza: quelli della struttura del piano, ma colazione e spuntino non si riempiono da soli se ci sono
 * pranzo o cena (le ricette salvate sono di solito piatti). Senza struttura: pranzo e cena.
 */
export function defaultMoments(structureMeals: readonly MealKind[] | undefined): MealKind[] {
  const kinds = structureMeals && structureMeals.length > 0 ? [...new Set(structureMeals)] : (["lunch", "dinner"] as MealKind[]);
  const main = kinds.filter((k) => k === "lunch" || k === "dinner");
  return main.length > 0 ? main : kinds;
}

/** I momenti tra cui scegliere: quelli della struttura, altrimenti tutti. */
export function momentChoices(structureMeals: readonly MealKind[] | undefined): MealKind[] {
  const kinds = structureMeals && structureMeals.length > 0 ? structureMeals : MEAL_KIND_ORDER;
  return MEAL_KIND_ORDER.filter((k) => kinds.includes(k));
}

export function defaultSettings(args: { plan: PlanState; weekDates: readonly string[]; today: string }): ProposalSettings {
  const days = remainingDays(args.weekDates, args.today);
  return {
    moments: defaultMoments(args.plan.structure?.meals.map((m) => m.kind)),
    days,
    maxRepeats: DEFAULT_PROPOSAL_OPTIONS.maxRepeats,
    servings: 1,
    allowUncertain: false,
    spendLeast: false,
    lowTimeDays: days.filter((d) => isQuickDayType(dayTypeOf(args.plan, d))),
  };
}

const MEAL_TAGS: Record<string, MealKind> = {
  colazione: "breakfast",
  pranzo: "lunch",
  cena: "dinner",
  spuntino: "snack",
  merenda: "snack",
};

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** I momenti dichiarati nelle etichette della ricetta («cena», «pranzo»); vuoto se non ne dichiara. */
export function mealsOfTags(tags: readonly string[]): MealKind[] {
  return [...new Set(tags.flatMap((t) => (MEAL_TAGS[fold(t)] ? [MEAL_TAGS[fold(t)] as MealKind] : [])))];
}

/** L'ingrediente principale, per non ripetere lo stesso a pranzo e a cena. */
export function mainKeyOf(recipe: Pick<Recipe, "ingredients">): string | undefined {
  const index = mainCandidates(recipe.ingredients)[0];
  return index === undefined ? undefined : nameTokens(recipe.ingredients[index]?.name ?? "")[0];
}

export const EXPIRY_HORIZON_DAYS = 7;

/**
 * Alimenti in casa che scadono da oggi alla prossima settimana. I già scaduti restano fuori: non si propongono mai.
 * Dispensa e scadenze si leggono soltanto.
 */
export function expiringFoods(lots: readonly Lot[], now: string, timeZone: string = DEFAULT_TIME_ZONE): ExpiringFood[] {
  const out: ExpiringFood[] = [];
  for (const entry of evaluateLots(lots, now, timeZone)) {
    const days = entry.urgency?.daysLeft;
    if (days === undefined || days < 0 || days > EXPIRY_HORIZON_DAYS) continue;
    out.push({ name: entry.lot.productRef, daysLeft: days });
  }
  return out;
}

/** Ciò che c'è in casa da un certo giorno in poi, finché non cambia l'insieme dei lotti ancora buoni. */
export interface StockView {
  /** Primo giorno in cui vale. */
  from: string;
  /** Lotti utilizzabili: la data di sicurezza non è passata. */
  usable: PantryStock[];
  /** Lotti entro la data di qualità. */
  good: PantryStock[];
  /** `good` coincide con `usable`. */
  sameGood: boolean;
}

/**
 * La dispensa giorno per giorno: un lotto con la data di sicurezza passata non c'è più; uno con la data di qualità
 * passata c'è ancora, ma oltre la data consigliata. Le date vengono da `core/expiry` (sola lettura).
 */
export function stockViews(lots: readonly Lot[], now: string, timeZone: string, dates: readonly string[]): StockView[] {
  const info = new Map<string, { date: string; nature: "safety" | "quality" }>();
  for (const e of evaluateLots(lots, now, timeZone)) if (e.expiry) info.set(e.lot.lotId, { date: e.expiry.date, nature: e.expiry.nature });
  const views: StockView[] = [];
  let last = "";
  for (const date of [...dates].sort()) {
    const usable = lots.filter((l) => {
      const x = info.get(l.lotId);
      return !(x && x.nature === "safety" && date > x.date);
    });
    const good = lots.filter((l) => {
      const x = info.get(l.lotId);
      return !(x && date > x.date);
    });
    const key = `${usable.map((l) => l.lotId).join(",")}|${good.map((l) => l.lotId).join(",")}`;
    if (key === last) continue;
    last = key;
    views.push({ from: date, usable: stockFromLots(usable), good: stockFromLots(good), sameGood: usable.length === good.length });
  }
  return views;
}

export interface FactsArgs {
  recipes: readonly Recipe[];
  settings: ProposalSettings;
  today: string;
  now: string;
  timeZone: string;
  lots: readonly Lot[];
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  linkOf: LinkOf;
  confirmations?: ConfirmationMap;
  foods?: readonly FoodComposition[];
  overrides: FoodOverrides;
  /** Per gli obiettivi di energia e proteine. */
  nutrientsOf?: NutrientsOfEntry;
  book?: PriceBook;
  plan: PlanState;
  weekDates: readonly string[];
}

const hasDeclared = (d: FactsArgs["declared"]): boolean => d.allergens.some((a) => a.trim() !== "") || d.excludedFoods.some((a) => a.trim() !== "");

function safetyOf(recipe: Recipe, args: FactsArgs): RecipeSafetyVerdict {
  if (!hasDeclared(args.declared)) return "clear";
  const reasons = exclusionReasons(recipe, {
    allergens: args.declared.allergens,
    excludedFoods: args.declared.excludedFoods,
    linkOf: args.linkOf,
    ...(args.confirmations ? { confirmations: args.confirmations } : {}),
  });
  const kind = safetyKind(reasons);
  return kind === "contains" ? "contains" : kind === "uncertain" ? "uncertain" : "clear";
}

const AMOUNTS = (n: { energyKcal?: number; proteinG?: number } | undefined): ProposalNutrients | undefined => {
  if (!n) return undefined;
  const out: ProposalNutrients = {};
  if (n.energyKcal !== undefined) out.energyKcal = n.energyKcal;
  if (n.proteinG !== undefined) out.proteinG = n.proteinG;
  return Object.keys(out).length > 0 ? out : undefined;
};

/** I fatti di ogni ricetta per il generatore. Il controllo di allergeni ed esclusioni è lo stesso del ricettario. */
export function buildProposalRecipes(args: FactsArgs): ProposalRecipe[] {
  const { settings, recipes } = args;
  const views = stockViews(args.lots, args.now, args.timeZone, args.weekDates.filter((d) => d >= args.today).length > 0 ? args.weekDates.filter((d) => d >= args.today) : [args.today]);
  const lookup = args.foods ? makeLookup(args.foods, args.overrides) : undefined;
  const contextFor = lookup ? makeContextFor(lookup) : undefined;
  const ranks = new Map(rankByExpiring(recipes, expiringFoods(args.lots, args.now, args.timeZone)).map((r) => [r.recipe.recipeId, r.uses]));
  const wantsGoals = args.weekDates.some((d) => hasGoals(args.plan, d));
  const priceOf = settings.spendLeast && args.book ? priceLookupFrom(args.book, contextFor) : undefined;
  return recipes.map((recipe) => {
    const compareOn = (stock: PantryStock[]) => compareWithPantry(recipe, stock, { servings: settings.servings, ...(contextFor ? { contextFor } : {}) });
    const usable = views.map((v) => compareOn(v.usable));
    const good = views.map((v, k) => (v.sameGood ? (usable[k] as (typeof usable)[number]) : compareOn(v.good)));
    const flags = (cmps: typeof usable, index: number): boolean[] => cmps.map((c) => c.ok && c.value.items[index]?.status === "available");
    const ingredients = recipe.ingredients.map((ing, index) => {
      const out: ProposalIngredient = { key: foodKey(ing), name: ing.name, inHome: false };
      const home = flags(usable, index);
      if (home[0] !== true) return out;
      out.inHome = true;
      const dayBefore = (k: number): string => addDays((views[k] as StockView).from, -1);
      const lastHome = home.lastIndexOf(true);
      if (lastHome < views.length - 1) out.homeUntil = dayBefore(lastHome + 1);
      const lastFresh = flags(good, index).lastIndexOf(true);
      if (lastFresh < views.length - 1) out.freshUntil = dayBefore(lastFresh + 1);
      return out;
    });
    const expiring = (ranks.get(recipe.recipeId) ?? [])
      .filter((u) => u.food.name !== undefined)
      .map((u) => ({
        key: foodKey({ name: u.food.name as string }),
        name: u.food.name as string,
        expiresOn: addDays(args.today, u.food.daysLeft),
        weight: u.weight,
      }));
    const out: ProposalRecipe = {
      recipeId: recipe.recipeId,
      title: recipe.title,
      servings: settings.servings,
      safety: safetyOf(recipe, args),
      ingredients,
      expiring,
    };
    const mainKey = mainKeyOf(recipe);
    if (mainKey !== undefined) out.mainKey = mainKey;
    const minutes = totalMinutes(recipe);
    if (minutes !== undefined) out.minutes = minutes;
    const meals = mealsOfTags(recipe.tags);
    if (meals.length > 0) out.meals = meals;
    if (wantsGoals && args.nutrientsOf) {
      const r = args.nutrientsOf({ date: args.weekDates[0] as string, meal: "lunch", item: { kind: "recipe", recipeId: recipe.recipeId, servings: settings.servings } });
      const n = r.ok ? AMOUNTS(r.nutrients) : undefined;
      if (n) out.nutrients = n;
    }
    if (priceOf) {
      const c = recipeCost({ servings: recipe.servings, ingredients: recipe.ingredients, certainty: recipe.certainty }, priceOf);
      if (c.ok) out.cost = { cents: Math.round(c.value.perServingCents * settings.servings), complete: !c.value.partial };
    }
    return out;
  });
}

function hasGoals(plan: PlanState, date: string): boolean {
  const type = dayTypeOf(plan, date);
  const t = type ? targetsOf(plan, type)?.targets : undefined;
  return Boolean(t?.energyKcal || t?.proteinG);
}

export function proposalDays(plan: PlanState, weekDates: readonly string[], settings: ProposalSettings): Record<string, ProposalDay> {
  const out: Record<string, ProposalDay> = {};
  for (const date of weekDates) {
    const type = dayTypeOf(plan, date);
    const t = type ? targetsOf(plan, type)?.targets : undefined;
    const targets = { ...(t?.energyKcal ? { energyKcal: t.energyKcal } : {}), ...(t?.proteinG ? { proteinG: t.proteinG } : {}) };
    out[date] = { ...(settings.lowTimeDays.includes(date) ? { lowTime: true } : {}), ...(Object.keys(targets).length > 0 ? { targets } : {}) };
  }
  return out;
}

/** L'ingresso completo del generatore. `slots` sono i posti liberi (vedi `slotsToFill`). */
export function buildProposalInput(args: FactsArgs & { slots: readonly ProposalSlot[]; entries: readonly PlannedEntry[] }): ProposalInput {
  const { settings } = args;
  const nutrientsOf = args.nutrientsOf;
  const wantsGoals = args.weekDates.some((d) => hasGoals(args.plan, d));
  return {
    slots: args.slots.filter((s) => settings.days.includes(s.date) && settings.moments.includes(s.meal)),
    existing: args.entries,
    recipes: buildProposalRecipes(args),
    days: proposalDays(args.plan, args.weekDates, settings),
    ...(wantsGoals && nutrientsOf
      ? {
          existingNutrients: (e: PlannedEntry) => {
            const r = nutrientsOf(e);
            return r.ok ? AMOUNTS(r.nutrients) : undefined;
          },
        }
      : {}),
    options: { maxRepeats: settings.maxRepeats, allowUncertain: settings.allowUncertain, spendLeast: settings.spendLeast },
  };
}

/* ------------------------------------------------------------------------------------------------ testi */

export const CRITERIA_TEXT = "Scelgo in quest'ordine: ciò che scade, ciò che hai già in casa, varietà, i tuoi obiettivi, il tempo che hai.";
export const CRITERIA_TEXT_SPEND = "Scelgo in quest'ordine: il costo stimato, ciò che scade, ciò che hai già in casa, varietà, i tuoi obiettivi, il tempo che hai.";

const lower = (s: string): string => s.toLowerCase();

function usesText(uses: readonly { name: string; expiresOn: string }[], today: string): string {
  const names = uses.slice(0, 2).map((u) => lower(u.name));
  const rest = uses.length - names.length;
  const list = rest > 0 ? `${names.join(", ")} e altri ${rest}` : names.join(" e ");
  return `Usa ${list} in scadenza ${whenText((uses[0] as { expiresOn: string }).expiresOn, today)}`;
}

export function reasonText(reason: ProposalReason, today: string): string {
  switch (reason.code) {
    case "expiring":
      return usesText(reason.uses, today);
    case "pantry":
    {
      const base = reason.inHome === reason.total && reason.stale === 0 ? "Hai già tutto" : `Hai già ${reason.inHome} ${reason.inHome === 1 ? "ingrediente" : "ingredienti"} su ${reason.total}`;
      return reason.stale > 0 ? `${base}, ${reason.stale} oltre la data consigliata` : base;
    }
    case "cost":
      return `Costa circa ${formatPrice(reason.cents)} a pasto`;
    case "goals":
      return "Vicina ai tuoi obiettivi della giornata";
    case "variety":
      return "Per variare la settimana";
  }
}

/** Il perché del posto, in una riga. */
export function reasonLine(meal: Pick<ProposedMeal, "reasons">, today: string): string {
  return meal.reasons.map((r) => `${reasonText(r, today)}.`).join(" ");
}

export const UNCERTAIN_WARNING = "Non posso controllare del tutto gli ingredienti: leggi l'etichetta.";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function headlineText(s: Pick<ProposalSummary, "filled" | "requested">): string {
  if (s.requested === 0) return "Non ci sono posti vuoti da riempire con queste scelte.";
  if (s.filled === 0) return "Non ho trovato ricette adatte ai posti vuoti.";
  return `Riempio ${plural(s.filled, "posto", "posti")} su ${s.requested} con le tue ricette.`;
}

/** Le note sotto il titolo: ricette poche, escluse, posti vuoti, scadenze, costo. Una riga ciascuna. */
export function summaryNotes(summary: ProposalSummary, unfilled: number): string[] {
  const out: string[] = [];
  if (summary.fewRecipes) {
    out.push(`Hai poche ricette utilizzabili (${summary.candidates}): riempio ciò che posso senza ripetere troppo. Aggiungine altre nel ricettario.`);
  } else if (unfilled > 0 && summary.requested > 0) {
    out.push(`Per ${plural(unfilled, "posto", "posti")} non ho trovato una ricetta adatta con i limiti che hai scelto.`);
  }
  if (summary.excluded.contains > 0) {
    const n = summary.excluded.contains;
    out.push(`${plural(n, "ricetta non entra", "ricette non entrano")} perché ${n === 1 ? "contiene" : "contengono"} ciò che hai dichiarato.`);
  }
  if (summary.excluded.uncertain > 0) {
    const n = summary.excluded.uncertain;
    out.push(`${plural(n, "ricetta non si può", "ricette non si possono")} controllare del tutto: ${n === 1 ? "la lascio" : "le lascio"} fuori, a meno che tu non le voglia.`);
  }
  if (summary.expiring.usable > 0) out.push(`Uso ${summary.expiring.used} su ${plural(summary.expiring.usable, "alimento", "alimenti")} in scadenza.`);
  if (summary.cost) {
    const c = summary.cost;
    if (c.knownMeals > 0) out.push(`Costo stimato: ${c.unknownMeals > 0 ? "almeno " : ""}${formatPrice(c.cents)}.`);
    out.push(
      c.recipesWithoutCost === 0
        ? "Tutte le ricette hanno un costo calcolabile."
        : `${c.recipesWithoutCost} ${c.recipesWithoutCost === 1 ? "ricetta" : "ricette"} su ${c.recipes} ${c.recipesWithoutCost === 1 ? "non ha" : "non hanno"} un costo calcolabile: ${c.recipesWithoutCost === 1 ? "non la favorisco" : "non le favorisco"}.`,
    );
  }
  return out;
}

export const shortDay = (date: string): string => weekdayName(date).slice(0, 3);

/* ------------------------------------------------------------------------------------------------ scrittura */

export interface FinalizeArgs {
  /** Le voci della settimana adesso, non quelle di quando è nata la proposta. */
  entries: readonly PlannedEntry[];
  meals: readonly ProposedMeal[];
  weekStart: string;
  /** Allergeni ed esclusioni dalla lettura unica (`declaredLists`). */
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  expandForChecks: ExpandRef;
  linkOf: LinkOf;
  confirmations?: ConfirmationMap;
  allowUncertain: boolean;
  /** Le ricette ancora nel ricettario: una ritirata dopo la proposta non si scrive. */
  activeRecipeIds: ReadonlySet<string>;
}

export interface Finalized {
  /** Tutta la settimana da scrivere: le voci dell'utente come sono, più le proposte rimaste. */
  entries: PlannedEntry[];
  added: number;
  /** Proposte non scritte: il posto nel frattempo è stato occupato, la ricetta è stata ritirata, o il controllo finale le ha fermate. */
  dropped: number;
}

/**
 * L'ultima guardia prima di scrivere: un posto occupato nel frattempo non si tocca, e ogni ricetta passa dal controllo
 * di allergeni ed esclusioni del piano con tutto ciò che l'utente ha dichiarato (la lettura unica). Una
 * violazione toglie la proposta; un dubbio la toglie se l'utente non ha permesso le ricette incerte.
 */
export function finalizeProposal(args: FinalizeArgs): Finalized {
  const taken = new Set(args.entries.map((e) => `${e.date}|${e.meal}`));
  const free = args.meals.filter((m) => !taken.has(`${m.slot.date}|${m.slot.meal}`) && args.activeRecipeIds.has(m.recipeId));
  const combined = [...args.entries, ...proposalEntries(free)];
  const result = checkWeekConstraints(args.declared, { weekStart: args.weekStart, entries: combined, eventId: "", recordedAt: "" }, {
    expandForChecks: args.expandForChecks,
    linkOf: args.linkOf,
    ...(args.confirmations ? { confirmations: args.confirmations } : {}),
  });
  const blocked = new Set<string>();
  for (const v of result.violations) blocked.add(`${v.date}|${v.meal}`);
  // una ricetta che non si riesce a leggere non entra mai; un dubbio sugli ingredienti solo se l'utente non l'ha permesso
  for (const u of result.unverified) if (!args.allowUncertain || u.code === "unresolved_ref") blocked.add(`${u.date}|${u.meal}`);
  const kept = free.filter((m) => !blocked.has(`${m.slot.date}|${m.slot.meal}`));
  return {
    entries: [...args.entries, ...proposalEntries(kept)],
    added: kept.length,
    dropped: args.meals.length - kept.length,
  };
}
