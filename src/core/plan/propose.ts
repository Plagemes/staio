// «Proponi una settimana»: riempie i posti vuoti della settimana con le ricette salvate dell'utente. Senza AI e senza
// rete, deterministico: stesse ricette e stessa dispensa, stesso piano. Logica pura: i fatti di ogni ricetta (esito del
// controllo di allergeni, ingredienti in casa, scadenze, nutrienti, costo) li calcola chi chiama; qui si sceglie.
//
// Vincoli duri, mai violati:
// - una ricetta con esito «contiene» non entra mai; «incerto» entra solo se l'utente lo permette, e porta l'avviso;
// - i posti già occupati non si toccano (e non si propongono mai);
// - la stessa ricetta non più di `maxRepeats` volte a settimana, mai nello stesso giorno né in giorni consecutivi
//   (contano anche le voci scritte dall'utente);
// - nei giorni con poco tempo non entrano ricette di cui si sa che sono lunghe;
// - se la ricetta dichiara per quali momenti va bene, solo quelli.
//
// Criteri da ottimizzare, in quest'ordine (ogni criterio pesa il doppio del successivo, ciascuno su una scala da 0 a 1):
// costo (solo con «Spendi il meno possibile», allora in cima) > scadenze > ciò che c'è già in casa > lacune della
// settimana per gruppo alimentare (solo se chi chiama le passa) > varietà > obiettivi.
//
// Algoritmo: scelta golosa posto per posto in ordine di calendario (ogni posto prende il candidato con il guadagno
// maggiore, dato ciò che è già stato scelto), poi tre passate di miglioramento locale: ogni posto viene ricalcolato
// come se fosse l'ultimo e cambia solo se un'altra ricetta guadagna di più. Parità: vince l'id più basso.

import { MEAL_KINDS, daysBetween, type MealKind } from "../diary";
import type { DietGroup } from "../diet/types";
import type { PlannedEntry, TargetRange } from "./types";

export type RecipeSafetyVerdict = "clear" | "uncertain" | "contains";

export interface ProposalIngredient {
  /** Chiave di confronto dell'alimento (la stessa per lo stesso alimento in ricette diverse). */
  key: string;
  name: string;
  /** In casa, in quantità sufficiente per le porzioni proposte, nel primo giorno della proposta. */
  inHome: boolean;
  /**
   * Ultimo giorno in cui ciò che c'è in casa è ancora utilizzabile (data di sicurezza dei lotti): dopo, l'ingrediente
   * non c'è più. Assente = non scade nella settimana.
   */
  homeUntil?: string;
  /** Ultimo giorno entro la data di qualità: dopo, c'è ancora ma oltre la data consigliata. Assente = sempre buono. */
  freshUntil?: string;
}

/** L'ingrediente è in casa, e ancora utilizzabile, in quel giorno. */
export const inHomeOn = (ing: ProposalIngredient, date: string): boolean => ing.inHome && (ing.homeUntil === undefined || date <= ing.homeUntil);

/** In casa ma oltre la data di qualità in quel giorno. */
export const staleOn = (ing: ProposalIngredient, date: string): boolean => inHomeOn(ing, date) && ing.freshUntil !== undefined && date > ing.freshUntil;

export interface ProposalExpiring {
  /** Chiave dell'alimento in scadenza. */
  key: string;
  name: string;
  /** Ultimo giorno in cui va usato, `YYYY-MM-DD`. */
  expiresOn: string;
  /** Urgenza, da 0 (esclusa) a 1 (scade oggi). */
  weight: number;
}

export interface ProposalNutrients {
  energyKcal?: number;
  proteinG?: number;
}

export interface ProposalRecipe {
  recipeId: string;
  title: string;
  /** Porzioni che si proporranno nel posto. */
  servings: number;
  safety: RecipeSafetyVerdict;
  /** Ingrediente principale (normalizzato), per non ripetere lo stesso a pranzo e a cena. */
  mainKey?: string;
  /** Tempo totale in minuti, se noto. */
  minutes?: number;
  /** Momenti per cui la ricetta è pensata (dalle etichette), se li dichiara. */
  meals?: readonly MealKind[];
  ingredients: readonly ProposalIngredient[];
  /** Gruppi alimentari che la ricetta porta in tavola (una porzione per gruppo e per pasto), se si sanno. */
  dietGroups?: readonly DietGroup[];
  /** Alimenti in scadenza che la ricetta usa. */
  expiring?: readonly ProposalExpiring[];
  /** Nutrienti dell'intera voce (porzioni comprese), solo se il dato è completo. */
  nutrients?: ProposalNutrients;
  /** Costo dell'intera voce in centesimi; `complete: false` = mancano prezzi, il costo vero è più alto. */
  cost?: { cents: number; complete: boolean };
}

export interface ProposalSlot {
  date: string;
  meal: MealKind;
}

export interface ProposalDay {
  /** Giorno con poco tempo: niente ricette di cui si sa che sono lunghe. */
  lowTime?: boolean;
  /** Obiettivi del tipo di giornata, se l'utente li ha scritti. */
  targets?: { energyKcal?: TargetRange; proteinG?: TargetRange };
}

export interface ProposalOptions {
  /** Quante volte al massimo la stessa ricetta nella settimana. */
  maxRepeats: number;
  /** Fa entrare anche le ricette che non si possono controllare del tutto, con l'avviso. */
  allowUncertain: boolean;
  /** Il costo stimato passa in cima ai criteri. */
  spendLeast: boolean;
  /** Oltre questi minuti una ricetta è «lunga» nei giorni con poco tempo. */
  lowTimeMaxMinutes: number;
}

export const DEFAULT_PROPOSAL_OPTIONS: ProposalOptions = {
  maxRepeats: 2,
  allowUncertain: false,
  spendLeast: false,
  lowTimeMaxMinutes: 30,
};

/** Peso dei criteri: ognuno vale il doppio del successivo. */
export const PROPOSAL_WEIGHTS = { cost: 64, expiry: 32, pantry: 16, diet: 8, variety: 4, goals: 2 } as const;

/**
 * I pesi di prima che esistesse il criterio dei gruppi alimentari. Si usano finché non c'è nessuna lacuna da colmare,
 * così l'esito senza `dietGaps` resta identico a quello di sempre (il rapporto tra dispensa e varietà non cambia).
 */
const BASE_WEIGHTS = { cost: 32, expiry: 16, pantry: 8, diet: 0, variety: 4, goals: 2 } as const;

/** Sotto questo numero di ricette utilizzabili la proposta lo dice. */
export const FEW_RECIPES = 5;

export interface ProposalInput {
  /** Posti da riempire. Quelli già occupati da `existing` si scartano. */
  slots: readonly ProposalSlot[];
  /** Voci già scritte nella settimana: non si toccano, contano per ripetizioni e obiettivi. */
  existing: readonly PlannedEntry[];
  recipes: readonly ProposalRecipe[];
  /** Per data. */
  days?: Readonly<Record<string, ProposalDay>>;
  /** Nutrienti di una voce già scritta, se si sanno. */
  existingNutrients?: (entry: PlannedEntry) => ProposalNutrients | undefined;
  /**
   * Porzioni che mancano nella settimana per gruppo: indicazione minima meno mangiato finora meno già pianificato
   * (le voci di `existing` sono quindi già contate qui). Ogni ricetta scelta ne colma una per gruppo. Assente, vuoto o
   * senza valori positivi = il criterio non agisce.
   */
  dietGaps?: Partial<Record<DietGroup, number>>;
  options?: Partial<ProposalOptions>;
}

export interface ProposalPick {
  slot: ProposalSlot;
  recipeId: string;
}

export type ProposalReason =
  | { code: "cost"; cents: number }
  | { code: "expiring"; uses: { name: string; expiresOn: string }[] }
  | { code: "pantry"; inHome: number; total: number; /** Di quelli in casa, quanti oltre la data di qualità. */ stale: number }
  | { code: "diet"; groups: DietGroup[] }
  | { code: "goals" }
  | { code: "variety" };

export interface ProposedMeal {
  slot: ProposalSlot;
  recipeId: string;
  title: string;
  servings: number;
  /** Il perché, al massimo due motivi, i più importanti per primi. */
  reasons: ProposalReason[];
  /** Presente se la ricetta non si è potuta controllare del tutto. */
  warning?: "uncertain";
}

export interface ProposalSummary {
  /** Posti da riempire. */
  requested: number;
  filled: number;
  /** Ricette utilizzabili (dopo il controllo di allergeni ed esclusioni). */
  candidates: number;
  /** Ricette tolte dal controllo. `uncertain` conta solo quelle non ammesse. */
  excluded: { contains: number; uncertain: number };
  /** Meno di `FEW_RECIPES` ricette utilizzabili. */
  fewRecipes: boolean;
  /** Alimenti in scadenza che si potevano usare e quanti la proposta ne usa. */
  expiring: { usable: number; used: number };
  /** Solo con «Spendi il meno possibile». */
  cost?: {
    /** Somma dei costi noti dei pasti proposti: un minimo se `unknownMeals` > 0. */
    cents: number;
    knownMeals: number;
    unknownMeals: number;
    /** Ricette utilizzabili senza un costo calcolabile, e il loro totale. */
    recipesWithoutCost: number;
    recipes: number;
  };
}

export interface WeekProposal {
  picks: ProposalPick[];
  meals: ProposedMeal[];
  /** Posti rimasti vuoti perché nessuna ricetta rispettava i vincoli. */
  unfilled: ProposalSlot[];
  summary: ProposalSummary;
}

const MEAL_INDEX = new Map<string, number>(MEAL_KINDS.map((k, i) => [k, i]));
const EPS = 1e-9;
const PASSES = 3;
const MAX_EXPIRY_GAIN = 2;
const slotKey = (s: ProposalSlot): string => `${s.date}|${s.meal}`;
const coverKey = (u: ProposalExpiring): string => `${u.key}@${u.expiresOn}`;
const sameSlot = (a: ProposalSlot, b: ProposalSlot): boolean => a.date === b.date && a.meal === b.meal;

/** Parole che dicono «giornata con poco tempo» nel nome di un tipo di giornata scelto dall'utente. */
export function isQuickDayType(name: string | undefined): boolean {
  if (!name) return false;
  const n = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return /poco tempo|di corsa|veloce|fretta|impegnat|rapid/.test(n);
}

function bump(map: Map<string, number>, key: string, by: 1 | -1): void {
  const next = (map.get(key) ?? 0) + by;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function pushOrRemove<T>(map: Map<string, T[]>, key: string, value: T, sign: 1 | -1): void {
  const list = map.get(key) ?? [];
  if (sign > 0) list.push(value);
  else {
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
  }
  if (list.length === 0) map.delete(key);
  else map.set(key, list);
}

type AmountKey = "energyKcal" | "proteinG";
const AMOUNT_KEYS: readonly AmountKey[] = ["energyKcal", "proteinG"];

class State {
  readonly assigned: (ProposalRecipe | undefined)[];
  private readonly count = new Map<string, number>();
  private readonly days = new Map<string, number[]>();
  private readonly covered = new Map<string, number>();
  private readonly home = new Map<string, number>();
  private readonly buy = new Map<string, number>();
  private readonly mains = new Map<string, string[]>();
  private readonly amounts = new Map<string, Record<AmountKey, number>>();
  private readonly dietCovered = new Map<DietGroup, number>();

  constructor(private readonly engine: Engine) {
    this.assigned = new Array<ProposalRecipe | undefined>(engine.slots.length).fill(undefined);
  }

  timesUsed(recipeId: string): number {
    return this.count.get(recipeId) ?? 0;
  }

  isCovered(u: ProposalExpiring): boolean {
    return this.covered.has(coverKey(u));
  }

  coveredCount(): number {
    return this.covered.size;
  }

  /** La ricetta compare già nello stesso giorno o in uno adiacente. */
  nearby(recipeId: string, date: string): boolean {
    const here = this.engine.dayNo(date);
    return (this.days.get(recipeId) ?? []).some((d) => Math.abs(d - here) <= 1);
  }

  homeUses(key: string): number {
    return this.home.get(key) ?? 0;
  }

  buyUses(key: string): number {
    return this.buy.get(key) ?? 0;
  }

  mainsOf(date: string): readonly string[] {
    return this.mains.get(date) ?? [];
  }

  amount(date: string, key: AmountKey): number {
    return this.amounts.get(date)?.[key] ?? 0;
  }

  addAmounts(date: string, n: ProposalNutrients | undefined, sign: 1 | -1): void {
    if (!n) return;
    const cur = this.amounts.get(date) ?? { energyKcal: 0, proteinG: 0 };
    for (const k of AMOUNT_KEYS) cur[k] += sign * (n[k] ?? 0);
    this.amounts.set(date, cur);
  }

  /** Mette (o toglie) una ricetta in un giorno. `recipe` è assente per una ricetta che non conosciamo. */
  applyRecipe(sign: 1 | -1, date: string, recipeId: string, recipe: ProposalRecipe | undefined): void {
    bump(this.count, recipeId, sign);
    pushOrRemove(this.days, recipeId, this.engine.dayNo(date), sign);
    if (!recipe) return;
    for (const u of recipe.expiring ?? []) if (date <= u.expiresOn) bump(this.covered, coverKey(u), sign);
    for (const ing of recipe.ingredients) bump(inHomeOn(ing, date) ? this.home : this.buy, ing.key, sign);
    if (recipe.mainKey !== undefined) pushOrRemove(this.mains, date, recipe.mainKey, sign);
  }

  assign(i: number, recipe: ProposalRecipe): void {
    this.assigned[i] = recipe;
    const slot = this.engine.slots[i] as ProposalSlot;
    this.applyRecipe(1, slot.date, recipe.recipeId, recipe);
    this.addAmounts(slot.date, recipe.nutrients, 1);
    this.coverDiet(recipe, 1);
  }

  unassign(i: number): void {
    const recipe = this.assigned[i];
    if (!recipe) return;
    this.assigned[i] = undefined;
    const slot = this.engine.slots[i] as ProposalSlot;
    this.applyRecipe(-1, slot.date, recipe.recipeId, recipe);
    this.addAmounts(slot.date, recipe.nutrients, -1);
    this.coverDiet(recipe, -1);
  }

  /** Porzioni ancora mancanti di un gruppo, dato ciò che la proposta ha già scelto. */
  dietOpen(group: DietGroup): number {
    return (this.engine.dietGaps.get(group) ?? 0) - (this.dietCovered.get(group) ?? 0);
  }

  /** Quanti gruppi hanno ancora una lacuna aperta. */
  openDietGroups(): number {
    let n = 0;
    for (const g of this.engine.dietGaps.keys()) if (this.dietOpen(g) > 0) n++;
    return n;
  }

  private coverDiet(recipe: ProposalRecipe, sign: 1 | -1): void {
    if (this.engine.dietGaps.size === 0) return;
    for (const g of new Set(recipe.dietGroups ?? [])) {
      const next = (this.dietCovered.get(g) ?? 0) + sign;
      if (next === 0) this.dietCovered.delete(g);
      else this.dietCovered.set(g, next);
    }
  }

  /** Quanti posti dello stesso giorno restano da riempire oltre al posto `i`. */
  openOthers(i: number): number {
    const slot = this.engine.slots[i] as ProposalSlot;
    return (this.engine.slotsByDate.get(slot.date) ?? []).filter((j) => j !== i && this.assigned[j] === undefined).length;
  }
}

function closeness(value: number, ideal: number): number {
  return ideal <= 0 ? 0 : Math.max(0, 1 - Math.abs(value - ideal) / ideal);
}

class Engine {
  readonly options: ProposalOptions;
  readonly slots: ProposalSlot[];
  readonly recipes: ProposalRecipe[];
  readonly byId = new Map<string, ProposalRecipe>();
  readonly eligible: ProposalRecipe[];
  readonly slotsByDate = new Map<string, number[]>();
  /** Solo le lacune positive e finite. */
  readonly dietGaps = new Map<DietGroup, number>();
  /** Almeno una lacuna da colmare: solo allora vale la tabella dei pesi con i gruppi alimentari. */
  readonly dietActive: boolean;
  private readonly dayNos = new Map<string, number>();
  private readonly cost: { min: number; max: number } | undefined;

  constructor(readonly input: ProposalInput) {
    this.options = { ...DEFAULT_PROPOSAL_OPTIONS, ...input.options };
    for (const [g, n] of Object.entries(input.dietGaps ?? {}) as [DietGroup, number | undefined][]) {
      if (n !== undefined && Number.isFinite(n) && n > 0) this.dietGaps.set(g, n);
    }
    this.dietActive = this.dietGaps.size > 0;
    this.recipes = [...input.recipes].sort((a, b) => (a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0));
    for (const r of this.recipes) if (!this.byId.has(r.recipeId)) this.byId.set(r.recipeId, r);
    this.eligible = this.recipes.filter(
      (r, i) => this.recipes.findIndex((x) => x.recipeId === r.recipeId) === i && (r.safety === "clear" || (r.safety === "uncertain" && this.options.allowUncertain)),
    );
    const taken = new Set(input.existing.map((e) => `${e.date}|${e.meal}`));
    const seen = new Set<string>();
    this.slots = input.slots
      .filter((s) => {
        const k = slotKey(s);
        if (taken.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s) => ({ date: s.date, meal: s.meal }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (MEAL_INDEX.get(a.meal) ?? 9) - (MEAL_INDEX.get(b.meal) ?? 9)));
    this.slots.forEach((s, i) => this.slotsByDate.set(s.date, [...(this.slotsByDate.get(s.date) ?? []), i]));
    const costs = this.eligible.flatMap((r) => (r.cost?.complete ? [r.cost.cents] : []));
    this.cost = costs.length > 0 ? { min: Math.min(...costs), max: Math.max(...costs) } : undefined;
  }

  dayNo(date: string): number {
    let n = this.dayNos.get(date);
    if (n === undefined) {
      n = daysBetween("2000-01-01", date);
      this.dayNos.set(date, n);
    }
    return n;
  }

  /** Stato con le voci dell'utente e le scelte date. Le scelte fuori dai posti da riempire si ignorano. */
  stateWith(picks: readonly ProposalPick[], except?: ProposalSlot): State {
    const state = new State(this);
    for (const e of this.input.existing) {
      const nutrients = this.input.existingNutrients?.(e);
      if (e.item.kind === "recipe") state.applyRecipe(1, e.date, e.item.recipeId, this.byId.get(e.item.recipeId));
      state.addAmounts(e.date, nutrients, 1);
    }
    for (const p of picks) {
      if (except && sameSlot(p.slot, except)) continue;
      const i = this.slots.findIndex((s) => sameSlot(s, p.slot));
      const recipe = this.byId.get(p.recipeId);
      if (i >= 0 && recipe && state.assigned[i] === undefined) state.assign(i, recipe);
    }
    return state;
  }

  allowed(i: number, r: ProposalRecipe, state: State): boolean {
    const slot = this.slots[i] as ProposalSlot;
    if (r.meals && r.meals.length > 0 && !r.meals.includes(slot.meal)) return false;
    if (state.timesUsed(r.recipeId) >= this.options.maxRepeats) return false;
    if (state.nearby(r.recipeId, slot.date)) return false;
    if (this.input.days?.[slot.date]?.lowTime && r.minutes !== undefined && r.minutes > this.options.lowTimeMaxMinutes) return false;
    return true;
  }

  expiryGain(i: number, r: ProposalRecipe, state: State): number {
    const slot = this.slots[i] as ProposalSlot;
    let sum = 0;
    for (const u of r.expiring ?? []) if (slot.date <= u.expiresOn && !state.isCovered(u)) sum += u.weight;
    return Math.min(sum, MAX_EXPIRY_GAIN);
  }

  pantryGain(i: number, r: ProposalRecipe, state: State): number {
    if (r.ingredients.length === 0) return 0.5;
    const date = (this.slots[i] as ProposalSlot).date;
    let credit = 0;
    for (const ing of r.ingredients) {
      if (inHomeOn(ing, date)) credit += state.homeUses(ing.key) === 0 ? 1 : 0.5;
      else if (state.buyUses(ing.key) > 0) credit += 0.5;
    }
    return credit / r.ingredients.length;
  }

  varietyGain(i: number, r: ProposalRecipe, state: State): number {
    const slot = this.slots[i] as ProposalSlot;
    const differentMain = r.mainKey === undefined || !state.mainsOf(slot.date).includes(r.mainKey) ? 1 : 0;
    const fresh = state.timesUsed(r.recipeId) === 0 ? 1 : 0;
    return 0.6 * differentMain + 0.4 * fresh;
  }

  /** Da 0 a 1, `undefined` se il giorno non ha obiettivi di energia o proteine. Senza dato sulla ricetta vale 0,5. */
  goalsGain(i: number, r: ProposalRecipe, state: State): number | undefined {
    const slot = this.slots[i] as ProposalSlot;
    const targets = this.input.days?.[slot.date]?.targets;
    if (!targets) return undefined;
    const parts: number[] = [];
    const share = state.openOthers(i) + 1;
    for (const key of AMOUNT_KEYS) {
      const range = targets[key];
      if (!range || (range.min === undefined && range.max === undefined)) continue;
      const value = r.nutrients?.[key];
      if (value === undefined) {
        parts.push(0.5);
        continue;
      }
      const consumed = state.amount(slot.date, key);
      if (range.min !== undefined && range.max !== undefined) {
        parts.push(closeness(value, ((range.min + range.max) / 2 - consumed) / share));
      } else if (range.min !== undefined) {
        const need = (range.min - consumed) / share;
        parts.push(need <= 0 ? 1 : Math.min(1, value / need));
      } else {
        const room = ((range.max as number) - consumed) / share;
        parts.push(room <= 0 ? 0 : value <= room ? 1 : Math.max(0, 1 - (value - room) / room));
      }
    }
    return parts.length === 0 ? undefined : parts.reduce((a, b) => a + b, 0) / parts.length;
  }

  /** Da 0 a 1: quanto la ricetta colma delle lacune ancora aperte (al massimo tre gruppi bastano per il pieno). */
  dietGain(r: ProposalRecipe, state: State): number {
    if (!this.dietActive) return 0;
    let fill = 0;
    for (const g of new Set(r.dietGroups ?? [])) fill += Math.min(1, Math.max(0, state.dietOpen(g)));
    if (fill === 0) return 0;
    return Math.min(1, fill / Math.max(1, Math.min(3, state.openDietGroups())));
  }

  /** I gruppi della ricetta che hanno una lacuna aperta. */
  dietFills(r: ProposalRecipe, state: State): DietGroup[] {
    if (!this.dietActive) return [];
    return [...new Set(r.dietGroups ?? [])].filter((g) => state.dietOpen(g) > 0);
  }

  costGain(r: ProposalRecipe): number {
    if (!this.cost || !r.cost?.complete) return 0;
    const span = this.cost.max - this.cost.min;
    return span <= 0 ? 1 : 1 - (r.cost.cents - this.cost.min) / span;
  }

  gain(i: number, r: ProposalRecipe, state: State): number {
    const w = this.dietActive ? PROPOSAL_WEIGHTS : BASE_WEIGHTS;
    return (
      (this.options.spendLeast ? w.cost * this.costGain(r) : 0) +
      w.expiry * this.expiryGain(i, r, state) +
      w.pantry * this.pantryGain(i, r, state) +
      w.diet * this.dietGain(r, state) +
      w.variety * this.varietyGain(i, r, state) +
      w.goals * (this.goalsGain(i, r, state) ?? 0)
    );
  }

  /** Le ricette ammesse nel posto `i`, dalla migliore. Parità: id più basso. */
  ranked(i: number, state: State): { recipe: ProposalRecipe; gain: number }[] {
    const out: { recipe: ProposalRecipe; gain: number }[] = [];
    for (const recipe of this.eligible) if (this.allowed(i, recipe, state)) out.push({ recipe, gain: this.gain(i, recipe, state) });
    return out.sort((a, b) => (Math.abs(b.gain - a.gain) > EPS ? b.gain - a.gain : a.recipe.recipeId < b.recipe.recipeId ? -1 : 1));
  }

  best(i: number, state: State): { recipe: ProposalRecipe; gain: number } | undefined {
    let best: { recipe: ProposalRecipe; gain: number } | undefined;
    for (const recipe of this.eligible) {
      if (!this.allowed(i, recipe, state)) continue;
      const g = this.gain(i, recipe, state);
      if (!best || g > best.gain + EPS) best = { recipe, gain: g };
    }
    return best;
  }

  generate(): ProposalPick[] {
    // lo stato di partenza contiene già le voci dell'utente
    const state = this.stateWith([]);
    for (let i = 0; i < this.slots.length; i++) {
      const best = this.best(i, state);
      if (best) state.assign(i, best.recipe);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      let changed = false;
      for (let i = 0; i < this.slots.length; i++) {
        const current = state.assigned[i];
        state.unassign(i);
        const best = this.best(i, state);
        const currentGain = current ? this.gain(i, current, state) : -Infinity;
        const next = best && best.gain > currentGain + EPS ? best.recipe : current;
        if (next) state.assign(i, next);
        if (next !== current) changed = true;
      }
      if (!changed) break;
    }
    return this.slots.flatMap((slot, i) => {
      const r = state.assigned[i];
      return r ? [{ slot, recipeId: r.recipeId }] : [];
    });
  }
}

function reasonsFor(engine: Engine, i: number, r: ProposalRecipe, state: State): ProposalReason[] {
  const out: ProposalReason[] = [];
  if (engine.options.spendLeast && r.cost?.complete) out.push({ code: "cost", cents: r.cost.cents });
  const slot = engine.slots[i] as ProposalSlot;
  const uses = (r.expiring ?? [])
    .filter((u) => slot.date <= u.expiresOn && !state.isCovered(u))
    .sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : a.name < b.name ? -1 : 1));
  if (uses.length > 0) out.push({ code: "expiring", uses: uses.map((u) => ({ name: u.name, expiresOn: u.expiresOn })) });
  const here = r.ingredients.filter((x) => inHomeOn(x, slot.date));
  const inHome = here.length;
  if (inHome > 0 && inHome * 2 >= r.ingredients.length) {
    out.push({ code: "pantry", inHome, total: r.ingredients.length, stale: here.filter((x) => staleOn(x, slot.date)).length });
  }
  const filled = engine.dietFills(r, state);
  if (filled.length > 0) out.push({ code: "diet", groups: filled });
  const goals = engine.goalsGain(i, r, state);
  if (goals !== undefined && goals >= 0.7 && r.nutrients) out.push({ code: "goals" });
  const top = out.slice(0, 2);
  return top.length > 0 ? top : [{ code: "variety" }];
}

function summarize(engine: Engine, state: State, meals: readonly ProposedMeal[]): ProposalSummary {
  const all = engine.recipes;
  const usable = new Set<string>();
  for (const r of engine.eligible) {
    for (const u of r.expiring ?? []) if (engine.slots.some((s) => s.date <= u.expiresOn)) usable.add(coverKey(u));
  }
  const summary: ProposalSummary = {
    requested: engine.slots.length,
    filled: meals.length,
    candidates: engine.eligible.length,
    excluded: {
      contains: all.filter((r) => r.safety === "contains").length,
      uncertain: engine.options.allowUncertain ? 0 : all.filter((r) => r.safety === "uncertain").length,
    },
    fewRecipes: engine.eligible.length < FEW_RECIPES,
    expiring: { usable: usable.size, used: state.coveredCount() },
  };
  if (engine.options.spendLeast) {
    let cents = 0;
    let known = 0;
    for (const m of meals) {
      const cost = engine.byId.get(m.recipeId)?.cost;
      if (cost?.complete) {
        cents += cost.cents;
        known++;
      }
    }
    summary.cost = {
      cents,
      knownMeals: known,
      unknownMeals: meals.length - known,
      recipesWithoutCost: engine.eligible.filter((r) => !r.cost?.complete).length,
      recipes: engine.eligible.length,
    };
  }
  return summary;
}

function describePicks(engine: Engine, picks: readonly ProposalPick[]): WeekProposal {
  // le scelte valide, in ordine di calendario; i motivi si calcolano costruendo la settimana posto per posto
  const valid: { i: number; recipe: ProposalRecipe }[] = [];
  const used = new Set<number>();
  for (const p of picks) {
    const i = engine.slots.findIndex((s) => sameSlot(s, p.slot));
    const recipe = engine.byId.get(p.recipeId);
    if (i >= 0 && recipe && !used.has(i)) {
      used.add(i);
      valid.push({ i, recipe });
    }
  }
  valid.sort((a, b) => a.i - b.i);
  const state = engine.stateWith([]);
  const meals: ProposedMeal[] = [];
  for (const { i, recipe } of valid) {
    const reasons = reasonsFor(engine, i, recipe, state);
    state.assign(i, recipe);
    meals.push({
      slot: engine.slots[i] as ProposalSlot,
      recipeId: recipe.recipeId,
      title: recipe.title,
      servings: recipe.servings,
      reasons,
      ...(recipe.safety === "uncertain" ? { warning: "uncertain" as const } : {}),
    });
  }
  return {
    picks: meals.map((m) => ({ slot: m.slot, recipeId: m.recipeId })),
    meals,
    unfilled: engine.slots.filter((_, i) => !used.has(i)),
    summary: summarize(engine, state, meals),
  };
}

/** La proposta: scelte, motivi, posti rimasti vuoti e riepilogo. Nulla viene scritto. */
export function proposeWeek(input: ProposalInput): WeekProposal {
  const engine = new Engine(input);
  return describePicks(engine, engine.generate());
}

/** Le stesse scelte (dopo uno scambio o una rimozione) con motivi e riepilogo aggiornati. */
export function explainProposal(input: ProposalInput, picks: readonly ProposalPick[]): WeekProposal {
  return describePicks(new Engine(input), picks);
}

/**
 * Le ricette ammesse in un posto, dalla migliore, dato il resto della proposta (il posto stesso non conta). Comprende
 * quella scelta adesso.
 */
export function alternativesFor(input: ProposalInput, picks: readonly ProposalPick[], slot: ProposalSlot): ProposalPick[] {
  const engine = new Engine(input);
  const i = engine.slots.findIndex((s) => sameSlot(s, slot));
  if (i < 0) return [];
  const state = engine.stateWith(picks, slot);
  return engine.ranked(i, state).map((x) => ({ slot: engine.slots[i] as ProposalSlot, recipeId: x.recipe.recipeId }));
}

/**
 * «Un'altra»: la successiva migliore per quel posto, che torna alla prima dopo l'ultima. `undefined` se non ce n'è
 * un'altra ammessa. Le altre scelte non cambiano.
 */
export function swapPick(input: ProposalInput, picks: readonly ProposalPick[], slot: ProposalSlot): ProposalPick[] | undefined {
  const ranking = alternativesFor(input, picks, slot);
  const current = picks.find((p) => sameSlot(p.slot, slot));
  const at = current ? ranking.findIndex((r) => r.recipeId === current.recipeId) : -1;
  const next = ranking.length === 0 ? undefined : ranking[(at + 1) % ranking.length];
  if (!next || next.recipeId === current?.recipeId) return undefined;
  return [...picks.filter((p) => !sameSlot(p.slot, slot)), next];
}

/** Le voci del piano che la proposta scriverebbe. */
export function proposalEntries(meals: readonly ProposedMeal[]): PlannedEntry[] {
  return meals.map((m) => ({ date: m.slot.date, meal: m.slot.meal, item: { kind: "recipe", recipeId: m.recipeId, servings: m.servings } }));
}
