// Motore dei consigli: dalle regole scattate ai consigli con azioni pratiche, puro e deterministico.
// Il fatto viene dall'ultima settimana chiusa; le azioni valgono sulla settimana in corso.
import type { Certainty } from "../../ledger";
import type {
  Advice,
  AdviceAction,
  AdviceActionKind,
  AdviceInput,
  AdviceResult,
  AdviceRuleId,
  AdviceSource,
  DietGroup,
  Indicator,
  KnownAlternative,
  KnownRecipe,
  PantryFood,
  WeekFrame,
} from "../types";
import { ADVICE_RULES, SHOPPING_NAME_OF_GROUP, evaluateRule, type CatalogRule, type RuleEvaluation } from "./rules";
import { compareStrings, indicatorOf, mondayOf, normalizeName } from "./util";

/** Fattibilità di ogni azione (scelta dell'app, in FONTI.md). */
export const ACTION_FEASIBILITY: Readonly<Record<AdviceActionKind, number>> = Object.freeze({
  cookWithPantry: 1,
  openRecipe: 0.6,
  addToPlan: 0.8,
  seeAlternative: 0.7,
  addToShopping: 0.5,
  openDetail: 0.2,
});
/** Ricetta con almeno questa quota di ingredienti in casa: fattibilità più alta. */
export const RECIPE_IN_HOME_SHARE = 0.5;
export const RECIPE_IN_HOME_FEASIBILITY = 0.9;
export const CERTAINTY_FACTOR: Readonly<Record<Certainty, number>> = Object.freeze({
  measured: 1,
  label: 1,
  estimated: 0.75,
});
export const DEFAULT_MAX_ADVICE = 3;
export const MAX_ACTIONS = 2;

/** Ricetta con la marcatura facoltativa del collante: `clear: false` non viene mai proposta. */
export type MaybeClearRecipe = KnownRecipe & { clear?: boolean };

export function adviceKey(ruleId: AdviceRuleId, weekStart: string): string {
  return `diet:${ruleId}:${weekStart}`;
}

export function feasibilityOf(action: AdviceAction): number {
  if (action.kind === "openRecipe" && (action.inHomeShare ?? 0) >= RECIPE_IN_HOME_SHARE) {
    return RECIPE_IN_HOME_FEASIBILITY;
  }
  return ACTION_FEASIBILITY[action.kind];
}

/** Un consiglio ha un'azione vera (non solo «apri il dettaglio»): può andare nel riepilogo di Oggi. */
export function hasRealAction(advice: Advice): boolean {
  return advice.actions.some((a) => a.kind !== "openDetail");
}

/** Il consiglio per «Da guardare oggi»: il più alto con un'azione vera, al massimo uno. */
export function briefingAdvice(advice: readonly Advice[]): Advice | undefined {
  return advice.find(hasRealAction);
}

// ---------------------------------------------------------------------------
// Contesto preparato una volta per chiamata
// ---------------------------------------------------------------------------

interface Context {
  today: string;
  pantryByGroup: Map<DietGroup, PantryFood[]>;
  recipes: KnownRecipe[];
  alternatives: KnownAlternative[];
  shopping: Set<string>;
}

function comparePantry(a: PantryFood, b: PantryFood): number {
  if (a.expiresOn !== b.expiresOn) {
    if (a.expiresOn === undefined) return 1;
    if (b.expiresOn === undefined) return -1;
    return compareStrings(a.expiresOn, b.expiresOn);
  }
  return compareStrings(a.name, b.name) || compareStrings(a.lotIds.join(","), b.lotIds.join(","));
}

function prepareContext(input: AdviceInput): Context {
  const pantryByGroup = new Map<DietGroup, PantryFood[]>();
  for (const food of input.pantry) {
    // Un alimento già scaduto non si propone.
    if (food.expiresOn !== undefined && food.expiresOn < input.today) continue;
    if (food.lotIds.length === 0) continue;
    const list = pantryByGroup.get(food.group);
    if (list) list.push(food);
    else pantryByGroup.set(food.group, [food]);
  }
  for (const list of pantryByGroup.values()) list.sort(comparePantry);

  const recipes = (input.recipes as readonly MaybeClearRecipe[]).filter(
    (r) => r.clear !== false && r.facts.groups.length > 0,
  );
  const alternatives = [...input.alternatives].sort(
    (a, b) =>
      b.fromShare - a.fromShare ||
      compareStrings(a.fromBarcode, b.fromBarcode) ||
      compareStrings(a.toBarcode, b.toBarcode),
  );
  return {
    today: input.today,
    pantryByGroup,
    recipes,
    alternatives,
    shopping: new Set(input.shoppingNames.map(normalizeName)),
  };
}

function bestPantry(ctx: Context, groups: readonly DietGroup[]): PantryFood | undefined {
  let best: PantryFood | undefined;
  for (const g of groups) {
    const first = ctx.pantryByGroup.get(g)?.[0];
    if (first && (best === undefined || comparePantry(first, best) < 0)) best = first;
  }
  return best;
}

function bestRecipe(
  ctx: Context,
  lookFor: readonly DietGroup[],
  avoid: readonly DietGroup[] | undefined,
): KnownRecipe | undefined {
  if (lookFor.length === 0) return undefined;
  let best: KnownRecipe | undefined;
  let bestServings = 0;
  for (const r of ctx.recipes) {
    const groups = r.facts.groups;
    if (!lookFor.some((g) => groups.includes(g))) continue;
    if (avoid && avoid.some((g) => groups.includes(g))) continue;
    let servings = 0;
    for (const g of lookFor) servings += r.facts.servingsByGroup[g] ?? 0;
    const better =
      best === undefined ||
      r.inHomeShare > best.inHomeShare ||
      (r.inHomeShare === best.inHomeShare &&
        (servings > bestServings || (servings === bestServings && compareStrings(r.recipeId, best.recipeId) < 0)));
    if (better) {
      best = r;
      bestServings = servings;
    }
  }
  return best;
}

function openRecipe(r: KnownRecipe): AdviceAction {
  return { kind: "openRecipe", recipeId: r.recipeId, title: r.title, inHomeShare: r.inHomeShare };
}

function shoppingAction(ctx: Context, lookFor: readonly DietGroup[]): AdviceAction | undefined {
  for (const g of lookFor) {
    const name = SHOPPING_NAME_OF_GROUP[g];
    if (name && !ctx.shopping.has(normalizeName(name))) return { kind: "addToShopping", names: [name] };
  }
  return undefined;
}

/** Al massimo due azioni, in ordine di fattibilità, mai due sulla stessa ricetta. */
function actionsFor(rule: CatalogRule, ctx: Context, offerPlan: boolean): AdviceAction[] {
  const candidates: AdviceAction[] = [];
  if (rule.direction === "increase") {
    const food = bestPantry(ctx, rule.lookFor);
    if (food) {
      candidates.push({
        kind: "cookWithPantry",
        foodName: food.name,
        lotIds: food.lotIds,
        ...(food.expiresOn !== undefined ? { expiresOn: food.expiresOn } : {}),
      });
    }
    const recipe = bestRecipe(ctx, rule.lookFor, undefined);
    if (recipe) {
      candidates.push(openRecipe(recipe));
      if (offerPlan) {
        candidates.push({ kind: "addToPlan", recipeId: recipe.recipeId, title: recipe.title, servings: recipe.servings });
      }
    }
    const shop = shoppingAction(ctx, rule.lookFor);
    if (shop) candidates.push(shop);
  } else {
    if (rule.alternativeDimension) {
      const alt = ctx.alternatives.find((a) => a.dimension === rule.alternativeDimension);
      if (alt) {
        candidates.push({
          kind: "seeAlternative",
          fromBarcode: alt.fromBarcode,
          fromName: alt.fromName,
          toBarcode: alt.toBarcode,
          toName: alt.toName,
          dimension: alt.dimension,
        });
      }
    }
    const recipe = bestRecipe(ctx, rule.lookFor, rule.avoid);
    if (recipe) candidates.push(openRecipe(recipe));
  }

  // Ordinamento stabile per fattibilità: a parità resta l'ordine di costruzione.
  const ranked = candidates
    .map((action, i) => ({ action, i, f: feasibilityOf(action) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  const out: AdviceAction[] = [];
  const recipesUsed = new Set<string>();
  for (const { action } of ranked) {
    if (out.length >= MAX_ACTIONS) break;
    if (action.kind === "openRecipe" || action.kind === "addToPlan") {
      if (recipesUsed.has(action.recipeId)) continue;
      recipesUsed.add(action.recipeId);
    }
    out.push(action);
  }
  if (out.length === 0) out.push({ kind: "openDetail", anchor: "consigli" });
  return out;
}

// ---------------------------------------------------------------------------
// Piano della settimana in corso
// ---------------------------------------------------------------------------

/** Porzioni a settimana indicate, se l'unità dell'indicatore è in porzioni. */
function weeklyNeed(ind: Indicator): number | undefined {
  const min = ind.target?.min;
  if (min === undefined) return undefined;
  if (ind.unit === "servingsPerWeek") return min;
  if (ind.unit === "servingsPerDay") return min * 7;
  return undefined;
}

function sumGroups(byGroup: Partial<Record<DietGroup, number>>, groups: readonly DietGroup[]): number {
  let s = 0;
  for (const g of groups) s += byGroup[g] ?? 0;
  return s;
}

function eatenSoFar(current: WeekFrame | undefined, groups: readonly DietGroup[]): number {
  if (!current) return 0;
  let s = 0;
  for (const g of groups) s += current.tallies?.[g]?.servings ?? 0;
  return s;
}

// ---------------------------------------------------------------------------
// buildAdvice
// ---------------------------------------------------------------------------

function sourceOf(rule: CatalogRule, ind: Indicator): AdviceSource {
  if (rule.source === "ownTrend") return "ownTrend";
  return rule.sourceFromTarget && ind.target ? ind.target.source : rule.source;
}

export function buildAdvice(input: AdviceInput, rules: readonly CatalogRule[] = ADVICE_RULES): AdviceResult {
  const targetWeekStart = mondayOf(input.today);
  const weeks = input.history.weeks;
  const current = weeks.find((w) => w.weekStart === targetWeekStart);
  const closed = weeks.filter((w) => !w.inProgress && w.weekStart < targetWeekStart);
  const factWeek = closed[closed.length - 1];
  const pastOfFact = closed.slice(0, -1);
  const dismissed = new Set(input.dismissed);
  const planned = input.planned && input.planned.weekStart === targetWeekStart ? input.planned : undefined;
  const ctx = prepareContext(input);

  const skipped: AdviceResult["skipped"] = [];
  const candidates: Advice[] = [];

  for (const rule of rules) {
    let evaluation: RuleEvaluation = factWeek ? evaluateRule(rule, factWeek, pastOfFact) : { kind: "insufficient" };
    let frame = factWeek;
    if (evaluation.kind !== "fired" && rule.countBased && current && current !== factWeek) {
      const now = evaluateRule(rule, current, closed);
      if (now.kind === "fired") {
        evaluation = now;
        frame = current;
      }
    }
    if (evaluation.kind !== "fired" || !frame) {
      skipped.push({ ruleId: rule.id, reason: evaluation.kind === "insufficient" ? "insufficient" : "not_triggered" });
      continue;
    }

    const key = adviceKey(rule.id, frame.weekStart);
    // «Lascia così» sulla settimana chiusa vale anche se ora la regola scatta sulla settimana in corso.
    if (dismissed.has(key) || (factWeek && dismissed.has(adviceKey(rule.id, factWeek.weekStart)))) {
      skipped.push({ ruleId: rule.id, reason: "dismissed" });
      continue;
    }

    const ind = evaluation.indicator;
    let plannedServings: number | undefined;
    let offerPlan = true;
    if (rule.direction === "increase") {
      plannedServings = planned ? sumGroups(planned.servingsByGroup, rule.lookFor) : undefined;
      const need = weeklyNeed(ind);
      if (need !== undefined && plannedServings !== undefined) {
        if (plannedServings + eatenSoFar(current, rule.lookFor) >= need) {
          skipped.push({ ruleId: rule.id, reason: "already_planned" });
          continue;
        }
      } else if (need === undefined && plannedServings !== undefined && plannedServings > 0) {
        offerPlan = false;
      }
    }

    const actions = actionsFor(rule, ctx, offerPlan);
    const certainty = ind.certainty;
    const priority = evaluation.severity * feasibilityOf(actions[0]) * CERTAINTY_FACTOR[certainty];
    const progressInd = current && current !== frame ? indicatorOf(current, ind.id) : undefined;

    candidates.push({
      key,
      ruleId: rule.id,
      weekStart: frame.weekStart,
      targetWeekStart,
      fact: {
        indicator: ind,
        weekStart: frame.weekStart,
        ...(current && current !== frame
          ? { progress: { ...(progressInd?.value !== undefined ? { value: progressInd.value } : {}), daysElapsed: current.daysElapsed } }
          : {}),
        ...(plannedServings !== undefined ? { planned: plannedServings } : {}),
      },
      source: sourceOf(rule, ind),
      actions,
      priority,
      certainty,
    });
  }

  candidates.sort((a, b) => b.priority - a.priority || compareStrings(a.key, b.key));
  // Una regola per indicatore: vince quella con la priorità più alta.
  const seen = new Set<string>();
  const unique = candidates.filter((a) => {
    if (seen.has(a.fact.indicator.id)) return false;
    seen.add(a.fact.indicator.id);
    return true;
  });
  const max = Math.max(0, Math.floor(input.maxAdvice ?? DEFAULT_MAX_ADVICE));
  return { advice: unique.slice(0, max), skipped };
}
