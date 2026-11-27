// Ingressi del motore dei consigli presi dai dati dell'app: dispensa, ricette (solo quelle senza corrispondenze con
// allergeni ed esclusioni dichiarati), alternative tra i prodotti noti, lista della spesa, lacune della settimana.
// Più il segno delle righe di Oggi. Logica pura: niente si legge né si scrive qui.
import type { ConfirmationMap } from "@/core/allergens";
import type { Product } from "@/core/catalog";
import {
  GUIDELINE_ROWS,
  LOT_CATEGORY_GROUP,
  PORTIONS,
  recipeDietFacts,
  targetFor,
  type Classifier,
  type DietGroup,
  type DietHistory,
  type EnergyLevel,
  type GroupRowId,
  type KnownAlternative,
  type LineClass,
  type MaybeClearRecipe,
  type PantryFood,
  type PlannedDiet,
  type PrepForDiet,
  type RecipeDietFacts,
} from "@/core/diet";
import { DEFAULT_TIME_ZONE, isFoodCategory } from "@/core/expiry";
import { worseCertainty, type Certainty, type Lot } from "@/core/ledger";
import type { DiaryState } from "@/core/diary";
import type { DayIntake } from "@/core/nutrition";
import { compareDayEntries, type AdherenceOptions, type PlannedEntry, type PlanState } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import { assessProduct, dimensionOf, findAlternatives, type Candidate } from "@/core/quality";
import { compareWithPantry, exclusionReasons, stockFromLots, type PantryStock, type Recipe } from "@/core/recipes";
import { normalizeName } from "@/core/shopping";
import { assessForCard } from "../barcode/safetyText";
import { evaluateLots } from "../lots";
import type { LinkOf } from "../recipes/allergenLinks";
import { safetyKind } from "../recipes/safety";

// ---------------------------------------------------------------------------------------------- segno delle righe

/** Segno di una riga di Oggi: solo per ciò che è molto lavorato (NOVA 4). */
export interface LineMark {
  level: 4;
  certainty: Certainty;
  /** La riga è una porzione di preparazione: il segno vale per la maggior parte dell'energia. */
  fromPrep: boolean;
}

/** Quota dell'energia molto lavorata oltre la quale una preparazione porta il segno (scelta dell'app). */
export const PREP_PROCESSED_SHARE = 0.5;

/**
 * Il segno di una riga: la sua parte è molto lavorata; per una preparazione, almeno metà dell'energia delle sue parti
 * viene da ingredienti molto lavorati. Una preparazione scomposta è sempre una stima.
 */
export function lineMarkOf(c: Pick<LineClass, "parts">): LineMark | undefined {
  const parts = c.parts;
  if (parts.length === 0) return undefined;
  const fromPrep = parts.some((p) => p.prepId !== undefined);
  if (!fromPrep) {
    const p = parts.find((x) => x.processing?.level === 4);
    return p?.processing ? { level: 4, certainty: p.processing.certainty, fromPrep: false } : undefined;
  }
  let total = 0;
  let processed = 0;
  let certainty: Certainty = "estimated";
  for (const p of parts) {
    if (p.energyKcal === undefined || !(p.energyKcal > 0)) continue;
    total += p.energyKcal;
    if (p.processing?.level === 4) {
      processed += p.energyKcal;
      certainty = worseCertainty(certainty, p.processing.certainty);
    }
  }
  return total > 0 && processed / total >= PREP_PROCESSED_SHARE ? { level: 4, certainty, fromPrep: true } : undefined;
}

// ---------------------------------------------------------------------------------------------- preparazioni

/** Le preparazioni per il classificatore, per lotto delle porzioni. */
export function prepsForDiet(preps: readonly PrepRecord[]): ReadonlyMap<string, PrepForDiet> {
  return new Map(preps.map((p) => [p.batchLotId, p]));
}

// ---------------------------------------------------------------------------------------------- dispensa

const isDietGroup = (g: string): g is DietGroup => g !== "unknown" && g !== "outOfHome";

/**
 * Alimenti in casa con il loro gruppo: lotti attivi, entro la data, raccolti per nome e gruppo (più lotti dello stesso
 * prodotto sono un alimento solo, con la scadenza più vicina). Il gruppo viene dal nome (con le correzioni
 * dell'utente), altrimenti dalla categoria del lotto. I lotti di porzioni di una preparazione non entrano.
 */
export function pantryFoods(
  lots: readonly Lot[],
  classifier: Pick<Classifier, "name">,
  now: string,
  options: { timeZone?: string; preps?: ReadonlyMap<string, unknown> } = {},
): PantryFood[] {
  const active = lots.filter((l) => l.status === "active" && l.remaining > 0 && !options.preps?.has(l.lotId));
  const byKey = new Map<string, { lotIds: string[]; name: string; group: DietGroup; certainty: Certainty; expiresOn?: string }>();
  for (const entry of evaluateLots(active, now, options.timeZone ?? DEFAULT_TIME_ZONE)) {
    // oltre la data (di sicurezza o di qualità) non si propone: il motore scarterebbe l'alimento intero
    if (entry.urgency?.level === "expired" || entry.urgency?.level === "past_quality") continue;
    const lot = entry.lot;
    const part = classifier.name(lot.productRef);
    let group = part.group;
    let certainty = part.certainty;
    if (!isDietGroup(group) && lot.category !== undefined && isFoodCategory(lot.category)) {
      const byCategory = LOT_CATEGORY_GROUP[lot.category];
      if (byCategory !== "unknown") {
        group = byCategory;
        certainty = "estimated";
      }
    }
    if (!isDietGroup(group) || group === "mixedDish") continue;
    const key = `${group}|${normalizeName(lot.productRef)}`;
    const cur = byKey.get(key);
    const expiresOn = entry.expiry?.date;
    if (cur) {
      cur.lotIds.push(lot.lotId);
      cur.certainty = worseCertainty(cur.certainty, certainty);
      if (expiresOn !== undefined && (cur.expiresOn === undefined || expiresOn < cur.expiresOn)) cur.expiresOn = expiresOn;
    } else {
      byKey.set(key, { lotIds: [lot.lotId], name: lot.productRef, group, certainty, ...(expiresOn !== undefined ? { expiresOn } : {}) });
    }
  }
  return [...byKey.values()].map((f) => ({ ...f, lotIds: [...f.lotIds].sort() }));
}

// ---------------------------------------------------------------------------------------------- ricette

export interface KnownRecipesArgs {
  recipes: readonly Recipe[];
  /** Allergeni ed esclusioni dichiarati (la lettura unica, `declaredLists`). */
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  confirmations?: ConfirmationMap;
  linkOf?: LinkOf;
  classifier: Pick<Classifier, "name">;
  lots: readonly Lot[];
  /** I gruppi di una ricetta, se già calcolati altrove (memoria per `Recipe.eventId`). */
  factsOf?: (recipe: Recipe) => RecipeDietFacts;
}

const hasDeclared = (d: KnownRecipesArgs["declared"]): boolean =>
  d.allergens.some((a) => a.trim() !== "") || d.excludedFoods.some((a) => a.trim() !== "");

/**
 * Nessuna corrispondenza con allergeni ed esclusioni dichiarati, con lo stesso controllo di «Proponi una settimana»
 * (`features/plan/proposal.ts`): un dubbio vale come una corrispondenza. Non vuol dire che la ricetta sia adatta.
 */
export function recipeIsClear(recipe: Recipe, args: Pick<KnownRecipesArgs, "declared" | "confirmations" | "linkOf">): boolean {
  if (!hasDeclared(args.declared)) return true;
  const reasons = exclusionReasons(recipe, {
    allergens: args.declared.allergens,
    excludedFoods: args.declared.excludedFoods,
    ...(args.linkOf ? { linkOf: args.linkOf } : {}),
    ...(args.confirmations ? { confirmations: args.confirmations } : {}),
  });
  const kind = safetyKind(reasons);
  return kind === "none" || kind === "other";
}

/** Ricette note per il motore: solo quelle «clear», marcate come tali; con i gruppi di una porzione e la quota in casa. */
export function knownRecipes(args: KnownRecipesArgs): MaybeClearRecipe[] {
  const stock: PantryStock[] = stockFromLots(args.lots);
  const factsOf = args.factsOf ?? ((r: Recipe) => recipeDietFacts(r, args.classifier, PORTIONS));
  const out: MaybeClearRecipe[] = [];
  for (const recipe of args.recipes) {
    if (!recipeIsClear(recipe, args)) continue;
    const facts = factsOf(recipe);
    if (facts.groups.length === 0) continue;
    const cmp = compareWithPantry(recipe, stock, { servings: recipe.servings });
    out.push({
      recipeId: recipe.recipeId,
      title: recipe.title,
      servings: recipe.servings,
      facts,
      inHomeShare: cmp.ok ? cmp.value.coverage : 0,
      clear: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- alternative

/** Giorni su cui si guardano i prodotti consumati di recente. */
export const RECENT_PRODUCT_DAYS = 28;
/** Prodotti di partenza esaminati al massimo (i più consumati). */
export const MAX_ALTERNATIVE_SOURCES = 10;

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Quota di ogni prodotto con codice a barre tra le voci mangiate negli ultimi `windowDays` giorni. */
export function recentProductShares(days: readonly DayIntake[], today: string, windowDays: number = RECENT_PRODUCT_DAYS): Map<string, number> {
  const from = addDays(today, -(windowDays - 1));
  const counts = new Map<string, number>();
  let total = 0;
  for (const day of days) {
    if (day.date < from || day.date > today) continue;
    for (const line of [...day.meals.flatMap((m) => m.lines), ...day.standalone]) {
      total++;
      if (line.status === "ok" && line.composition.selection === "product" && line.composition.ref) {
        counts.set(line.composition.ref, (counts.get(line.composition.ref) ?? 0) + 1);
      }
    }
  }
  const out = new Map<string, number>();
  if (total === 0) return out;
  for (const [barcode, n] of counts) out.set(barcode, n / total);
  return out;
}

const DIMENSIONS = ["nova", "salt", "sugars"] as const;

const nameOf = (p: Product): string => p.name?.trim() || p.barcode;

/** Allergeni ed esclusioni con cui si controllano le alternative; `complete: false` se un posto delle dichiarazioni non si legge. */
export interface AlternativeSafety {
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  complete: boolean;
}

/**
 * Un prodotto si propone come alternativa solo se il controllo della scheda (lo stesso di «Controlla» sul codice a barre)
 * dice «non risulta» per ogni voce dichiarata. Nel dubbio si esclude: contano anche tracce, scheda senza ingredienti o
 * senza allergeni noti, codice interno del negozio. Con dichiarazioni che non si leggono per intero non si propone nulla,
 * perché una voce non letta potrebbe essere proprio quella contenuta.
 */
export function productIsClear(product: Product, safety: AlternativeSafety): boolean {
  if (!safety.complete) return false;
  const { allergens, excludedFoods } = safety.declared;
  if (![...allergens, ...excludedFoods].some((d) => d.trim() !== "")) return true;
  const verdict = assessForCard(product, { allergens, excludedFoods }).verdict;
  return verdict === "none" || verdict === "not_found";
}

/**
 * Alternative note: per i prodotti mangiati di recente (i più frequenti), su ogni dimensione dove il prodotto è
 * intermedio o sfavorevole, il primo candidato migliore che `findAlternatives` trova tra i prodotti già letti o
 * comprati, senza peggiorare le altre dimensioni e senza corrispondenze con allergeni ed esclusioni dichiarati
 * (`productIsClear`). Nessun prodotto inventato.
 */
export function knownAlternatives(candidates: readonly Candidate[], shares: ReadonlyMap<string, number>, safety: AlternativeSafety): KnownAlternative[] {
  const byBarcode = new Map(candidates.map((c) => [c.product.barcode, c]));
  // il prodotto di partenza resta com'è (lo mangia già); solo ciò che si propone al suo posto passa il controllo
  const proposable = candidates.filter((c) => productIsClear(c.product, safety));
  const sources = [...shares]
    .filter(([barcode]) => byBarcode.has(barcode))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_ALTERNATIVE_SOURCES);
  const out: KnownAlternative[] = [];
  for (const [barcode, fromShare] of sources) {
    const reference = byBarcode.get(barcode) as Candidate;
    const assessment = assessProduct(reference.product);
    for (const dimension of DIMENSIONS) {
      const d = dimensionOf(assessment, dimension);
      if (!d || (d.outcome !== "intermediate" && d.outcome !== "unfavorable")) continue;
      const best = findAlternatives(reference, proposable, dimension).alternatives[0];
      if (!best) continue;
      out.push({
        fromBarcode: barcode,
        fromName: nameOf(reference.product),
        toBarcode: best.product.barcode,
        toName: nameOf(best.product),
        dimension,
        fromShare,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- spesa

/** Nomi normalizzati già nella lista della spesa scritta a mano. */
export function shoppingNames(manual: readonly { product: string }[] | undefined): string[] {
  return [...new Set((manual ?? []).map((m) => normalizeName(m.product)).filter((n) => n !== ""))];
}

// ---------------------------------------------------------------------------------------------- piano e lacune

/** Per escludere dal piano di oggi ciò che il diario mostra già mangiato: il diario e i criteri dell'aderenza del piano. */
export interface EatenToday {
  diary: DiaryState;
  adherence: AdherenceOptions;
}

/**
 * Le voci del piano della settimana da `from` (oggi) in poi: quelle passate sono già nel mangiato.
 *
 * Doppio conteggio: il mangiato di oggi è già nel quadro, quindi le voci di oggi che il diario mostra già mangiate (come
 * pianificato, anche in un altro momento del giorno) o sostituite da altro nello stesso momento non si contano di nuovo
 * come pianificate. Serve `eaten`; senza, le voci di oggi restano tutte. Le voci dei giorni dopo oggi restano sempre.
 *
 * Porzioni: la voce di una ricetta o di una preparazione dice quante porzioni si cucinano (per la spesa), non quante ne
 * mangia l'utente, e il piano non sa per quante persone si cucina. Per l'utente conta una porzione per voce (meno, se
 * ne ha pianificata meno di una): le altre vanno ad altri.
 */
export function plannedEntriesFrom(plan: PlanState | undefined, weekStart: string, from: string, eaten?: EatenToday): PlannedEntry[] {
  const week = plan?.weeks.find((w) => w.weekStart === weekStart);
  if (!week) return [];
  const todayEaten = new Set<PlannedEntry["item"]>();
  if (eaten && week.entries.some((e) => e.date === from)) {
    for (const r of compareDayEntries(from, week.entries, eaten.diary, eaten.adherence).entries) {
      if (r.status === "respected" || r.status === "substituted") todayEaten.add(r.planned);
    }
  }
  const out: PlannedEntry[] = [];
  for (const e of week.entries) {
    if (e.date < from || todayEaten.has(e.item)) continue;
    const item = e.item;
    out.push(item.kind === "food" || item.servings <= 1 ? e : { ...e, item: { ...item, servings: 1 } });
  }
  return out;
}

/** Righe delle linee guida per cui il piano può colmare ciò che manca: quelle che i consigli chiedono di aumentare. */
export const DIET_GAP_ROWS: readonly GroupRowId[] = ["vegetables", "fruit", "legumes", "fish", "nutsSeeds"];

const half = (n: number): number => Math.ceil(n * 2) / 2;

/**
 * Porzioni che mancano nella settimana in corso, per gruppo: indicazione minima della settimana (al giorno × 7)
 * meno quanto mangiato finora meno quanto già nel piano. Solo le lacune aperte; vuoto senza settimana in corso.
 */
export function dietGaps(history: Pick<DietHistory, "weeks">, planned: PlannedDiet | undefined, level: EnergyLevel): Partial<Record<DietGroup, number>> {
  const current = history.weeks[history.weeks.length - 1];
  const out: Partial<Record<DietGroup, number>> = {};
  if (!current || !current.inProgress) return out;
  for (const rowId of DIET_GAP_ROWS) {
    const row = GUIDELINE_ROWS.find((r) => r.id === rowId);
    const target = targetFor(rowId, level);
    const group = row?.groups[0];
    if (!row || !target || target.min === undefined || group === undefined) continue;
    const need = target.kind === "perDay" ? target.min * 7 : target.kind === "perWeek" ? target.min : undefined;
    if (need === undefined) continue;
    const eaten = current.rowTallies[rowId]?.servings ?? 0;
    const inPlan = planned && planned.weekStart === current.weekStart ? row.groups.reduce((s, g) => s + (planned.servingsByGroup[g] ?? 0), 0) : 0;
    const gap = need - eaten - inPlan;
    if (gap > 0) out[group] = Math.max(out[group] ?? 0, half(gap));
  }
  return out;
}
