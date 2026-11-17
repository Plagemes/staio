// Controlli che l'app fa dopo la risposta del modello, senza fidarsi di lui:
// 1) allergeni ed esclusioni dichiarati dall'utente, con il motore unico (`../allergens`) sul testo degli ingredienti,
//    sugli alimenti di dispensa collegati (con prodotto ed etichetta, se noti), sui passi e sul titolo;
// 2) gli ingredienti «di casa» verificati contro la dispensa reale.
// Una ricetta che contiene un allergene o un alimento escluso viene scartata, con il motivo. Una ricetta con un
// ingrediente generico che può contenere un allergene dichiarato resta tra le proposte ma porta `uncertain`: le
// schermate non la lasciano salvare senza una conferma esplicita. L'utente può confermare un ingrediente alla volta
// («ho letto l'etichetta, per me va bene»): vale solo per il dubbio, mai per un allergene trovato, e l'ingrediente
// confermato esce dai dubbi ma resta nell'elenco `confirmed`, con la data.
import { assessRecipe, type ConfirmationMap, type IngredientHit, type ItemSubject, type RecipeAssessment } from "../allergens";
import {
  compareWithPantry,
  exclusionReasons,
  expiryWeight,
  totalMinutes,
  type Availability,
  type PantryStock,
  type RecipeIngredient,
} from "@/core/recipes";
import type { Quantity } from "@/core/units";
import { daysLeftText, findRef, type PantryRef } from "./mealPhraseShared";
import type { IdeaIngredient, RecipeIdea } from "./recipeIdeasParse";

export interface IdeaCriteria {
  allergens: readonly string[];
  excludedFoods: readonly string[];
  /** Tempo disponibile: oltre, la ricetta non si scarta ma porta un avviso. */
  maxMinutes?: number;
  /** Attrezzatura posseduta: se indicata, un attrezzo mancante porta un avviso. */
  ownedEquipment?: readonly string[];
  /** Conferme dell'utente sugli ingredienti non verificabili (da `deriveConfirmations`). */
  confirmations?: ConfirmationMap;
}

/** Un ingrediente ancora da verificare che l'utente può confermare: porta ciò che serve a dare la conferma. */
export interface UncertainIngredient {
  name: string;
  /** Il testo del dubbio, come in `uncertain`. */
  text: string;
  /** Ciò che il motore ha letto dell'ingrediente: la conferma si lega a questo. */
  subject: ItemSubject;
}

/** Un ingrediente il cui dubbio l'utente ha confermato. */
export interface ConfirmedIngredient {
  name: string;
  /** Gli allergeni dichiarati su cui aveva dei dubbi. */
  allergens: string[];
  /** Quando l'ha confermato (istante ISO). */
  confirmedAt: string;
}

export interface Rejection {
  idea: RecipeIdea;
  /** Perché è stata scartata, in italiano. */
  reasons: string[];
}

export type IngredientStatus = "in_pantry" | "partial" | "to_confirm" | "unquantified" | "missing";

export interface CheckedIngredient {
  ingredient: IdeaIngredient;
  status: IngredientStatus;
  /** Alimenti reali di dispensa che corrispondono, trovati dall'app. */
  matched: PantryRef[];
  /** Ciò che manca (per `partial` e `missing`). */
  shortfall?: Quantity;
  /** Il modello lo dava come presente in dispensa. */
  claimed: boolean;
  /** Il modello lo dava come presente ma la dispensa non lo conferma. */
  claimNotConfirmed: boolean;
}

export interface CheckedIdea {
  idea: RecipeIdea;
  ingredients: CheckedIngredient[];
  /** Alimenti di casa che la ricetta usa davvero (distinti). */
  usedFromPantry: PantryRef[];
  /** Ingredienti che mancano o non bastano: da comprare. */
  missing: RecipeIngredient[];
  /** Alimenti che scadono presto e che la ricetta usa. */
  expiringUsed: PantryRef[];
  /** Più alto = usa più cose in scadenza. */
  expiringScore: number;
  warnings: string[];
  /**
   * Ingredienti generici o composti che possono contenere un allergene dichiarato, in italiano. Non vuoto = la ricetta
   * non si salva senza che l'utente confermi di aver controllato le etichette.
   */
  uncertain: string[];
  /** Gli stessi ingredienti incerti, uno per riga, con ciò che serve a confermarli uno alla volta. */
  uncertainIngredients: UncertainIngredient[];
  /** Ingredienti che l'utente ha confermato: l'app non ha verificato nulla, lo ha dichiarato lui. */
  confirmed: ConfirmedIngredient[];
}

/** Ciò che si sa del prodotto di un alimento di dispensa, se noto: nome e allergeni dichiarati in etichetta. */
export interface PantryLabel {
  /** Codice a barre del lotto, se c'è: la conferma dell'utente è legata a quel prodotto, come nelle ricette. */
  barcode?: string;
  productName?: string;
  allergens?: readonly string[];
}

export type CheckedPantryRef = PantryRef & PantryLabel;

/** «Scade presto»: entro questi giorni. */
export const EXPIRING_DAYS = 3;

/**
 * Prodotti pronti o composti che contengono di norma qualcosa che il nome non dice. Ora vivono nelle tabelle del motore
 * unico (`../allergens`), insieme ai prodotti composti per allergene; restano esportati da qui per chi li importava.
 */
export { HIDDEN_CONTENTS } from "../allergens";

/** Ciò che si sa di ogni ingrediente: nome, nota, alimenti di dispensa collegati (dal modello o trovati dall'app), prodotto ed etichetta. */
function subjectsOf(idea: RecipeIdea, pantry: readonly CheckedPantryRef[], matched?: readonly (readonly PantryRef[])[]): ItemSubject[] {
  const byId = new Map(pantry.map((p) => [p.id, p]));
  return idea.ingredients.map((ing, index) => {
    const refs = new Map<string, CheckedPantryRef>();
    const claimed = ing.pantryId !== undefined ? findRef(pantry, ing.pantryId) : undefined;
    if (claimed) refs.set(claimed.id, claimed);
    for (const m of matched?.[index] ?? []) refs.set(m.id, byId.get(m.id) ?? m);
    const linked = [...refs.values()];
    const names = linked.flatMap((r) => (r.productName ? [r.name, r.productName] : [r.name]));
    const labels = linked.flatMap((r) => r.allergens ?? []);
    const barcodes = [...new Set(linked.flatMap((r) => (r.barcode ? [r.barcode] : [])))];
    return {
      name: ing.name,
      ...(ing.note ? { note: ing.note } : {}),
      ...(names.length > 0 ? { linkedNames: names } : {}),
      ...(barcodes.length > 0 ? { productRefs: barcodes } : {}),
      ...(labels.length > 0 ? { labelAllergens: labels } : {}),
    };
  });
}

function assessIdea(
  idea: RecipeIdea,
  criteria: Pick<IdeaCriteria, "allergens" | "excludedFoods"> & { confirmations?: ConfirmationMap },
  pantry: readonly CheckedPantryRef[],
  matched?: readonly (readonly PantryRef[])[],
): RecipeAssessment | undefined {
  const allergens = criteria.allergens.filter((a) => a.trim() !== "");
  const excludedFoods = criteria.excludedFoods.filter((a) => a.trim() !== "");
  if (allergens.length === 0 && excludedFoods.length === 0) return undefined;
  return assessRecipe(
    {
      title: idea.title,
      ingredients: subjectsOf(idea, pantry, matched),
      // le note del modello finiscono tra i passi della ricetta salvata: si controllano come passi
      steps: [...idea.steps.map((s) => s.text), ...(idea.notes ? [idea.notes] : [])],
    },
    { allergens, excludedFoods, ...(criteria.confirmations ? { confirmations: criteria.confirmations } : {}) },
  );
}

/** «Burro», «Cotoletta di pollo («cotoletta»)», «Crema (in dispensa: «Crema di arachidi»)». */
function hitText(hit: IngredientHit): string {
  const term = hit.note !== undefined ? ` (${hit.note})` : fold(hit.name).trim() === hit.term ? "" : ` («${hit.term}»)`;
  switch (hit.origin) {
    case "linked":
    case "product":
      return `${hit.name} (in dispensa: «${hit.text}»)`;
    case "label":
      return `${hit.name} (in etichetta: ${hit.text})`;
    case "note":
      return `${hit.name} (nella nota: «${hit.text}»)`;
    default:
      return `${hit.name}${term}`;
  }
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

function reasonsFrom(a: RecipeAssessment | undefined, title: string): string[] {
  if (!a) return [];
  const reasons: string[] = [];
  for (const o of a.allergens) {
    if (o.verdict !== "contains") continue;
    if (o.ingredients.length > 0) reasons.push(`contiene ${o.allergen} negli ingredienti: ${o.ingredients.map(hitText).join(", ")}`);
    if (o.steps.length > 0) reasons.push(`contiene ${o.allergen} nei passi: ${o.steps.map((s) => `${s.text} («${s.term}»)`).join(" / ")}`);
    if (o.title) reasons.push(`contiene ${o.allergen} nel titolo: ${title} («${o.title.term}»)`);
  }
  for (const e of a.exclusions) {
    const what = `un alimento che hai escluso («${e.excluded}»)`;
    if (e.ingredients.length > 0) reasons.push(`contiene ${what} negli ingredienti: ${e.ingredients.map(hitText).join(", ")}`);
    if (e.steps.length > 0) reasons.push(`contiene ${what} nei passi: ${e.steps.map((s) => `${s.text} («${s.term}»)`).join(" / ")}`);
    if (e.title) reasons.push(`contiene ${what} nel titolo: ${title} («${e.title.term}»)`);
  }
  return [...new Set(reasons)];
}

function uncertainEntries(a: RecipeAssessment | undefined): { index: number; name: string; text: string; mixed: boolean }[] {
  if (!a) return [];
  const byIngredient = new Map<number, { hit: IngredientHit; allergens: string[] }>();
  const mixed = new Set<number>();
  for (const o of a.allergens) {
    if (o.verdict !== "uncertain") continue;
    for (const hit of o.ingredients) {
      if (hit.reason === "mixed_script") mixed.add(hit.index);
      const entry = byIngredient.get(hit.index) ?? { hit, allergens: [] };
      if (!entry.allergens.includes(o.allergen)) entry.allergens.push(o.allergen);
      byIngredient.set(hit.index, entry);
    }
  }
  return [...byIngredient.values()].map(({ hit, allergens }) => {
    const where = hit.origin === "linked" || hit.origin === "product" ? ` (in dispensa: «${hit.text}»)` : "";
    const what =
      hit.reason === "unrecognized"
        ? `ha un nome non riconosciuto («${hit.term}»)`
        : hit.reason === "mixed_script"
          ? `ha lettere di alfabeti diversi («${hit.term}»): riscrivilo`
          : hit.reason === "gluten_free_claim"
          ? `è dichiarato senza glutine («${hit.term}»), da verificare in etichetta`
          : hit.reason === "processed"
            ? `è un prodotto lavorato o confezionato («${hit.term}»), da verificare in etichetta`
            : `è un ingrediente generico o composto («${hit.term}»)`;
    return { index: hit.index, name: hit.name, mixed: mixed.has(hit.index), text: `«${hit.name}»${where} ${what}: non so se contiene ${allergens.join(", ")}` };
  });
}

const uncertainFrom = (a: RecipeAssessment | undefined): string[] => uncertainEntries(a).map((e) => e.text);

function uncertainIngredientsFrom(a: RecipeAssessment | undefined, idea: RecipeIdea, pantry: readonly CheckedPantryRef[], matched?: readonly (readonly PantryRef[])[]): UncertainIngredient[] {
  const subjects = subjectsOf(idea, pantry, matched);
  // un testo con alfabeti mescolati va riscritto: non si conferma
  return uncertainEntries(a).flatMap((e) => {
    const subject = subjects[e.index];
    return subject && !e.mixed ? [{ name: e.name, text: e.text, subject }] : [];
  });
}

function confirmedFrom(a: RecipeAssessment | undefined): ConfirmedIngredient[] {
  const byIndex = new Map<number, ConfirmedIngredient>();
  for (const c of a?.confirmed ?? []) {
    const cur = byIndex.get(c.index) ?? { name: c.name, allergens: [], confirmedAt: c.confirmedAt };
    if (!cur.allergens.includes(c.allergen)) cur.allergens.push(c.allergen);
    byIndex.set(c.index, cur);
  }
  return [...byIndex.values()];
}

/**
 * I motivi per cui la ricetta contiene qualcosa da evitare (lista vuota se non risulta niente). Con la dispensa, guarda
 * anche gli alimenti collegati agli ingredienti (`pantryId`), con il loro prodotto ed etichetta se noti.
 */
export function forbiddenReasons(
  idea: RecipeIdea,
  criteria: Pick<IdeaCriteria, "allergens" | "excludedFoods">,
  pantry: readonly CheckedPantryRef[] = [],
): string[] {
  return reasonsFrom(assessIdea(idea, criteria, pantry), idea.title);
}

/**
 * Gli ingredienti generici o composti che possono contenere un allergene dichiarato (lista vuota se non ce ne sono).
 * Non bastano a scartare la ricetta, ma non la lasciano passare in silenzio.
 */
export function uncertainReasons(
  idea: RecipeIdea,
  criteria: Pick<IdeaCriteria, "allergens" | "excludedFoods" | "confirmations">,
  pantry: readonly CheckedPantryRef[] = [],
): string[] {
  return uncertainFrom(assessIdea(idea, criteria, pantry));
}

const STATUS_OF: Record<Availability, IngredientStatus> = {
  available: "in_pantry",
  partial: "partial",
  to_confirm: "to_confirm",
  unquantified: "unquantified",
  missing: "missing",
};

/** Confronta gli ingredienti con la dispensa vera, per nome e quantità, a prescindere da ciò che dice il modello. */
export function verifyAgainstPantry(idea: RecipeIdea, pantry: readonly PantryRef[]): CheckedIngredient[] {
  const stock: PantryStock[] = pantry.map((p) => ({ ref: p.id, name: p.name, quantity: p.remaining }));
  const byId = new Map(pantry.map((p) => [p.id, p]));
  const compared = compareWithPantry(
    { servings: idea.servings, ingredients: idea.ingredients.map((i) => ({ name: i.name, ...(i.quantity ? { quantity: i.quantity } : {}) })) },
    stock,
  );
  return idea.ingredients.map((ingredient, index): CheckedIngredient => {
    const claimed = ingredient.pantryId !== undefined;
    const item = compared.ok ? compared.value.items[index] : undefined;
    if (!item) return { ingredient, status: "missing", matched: [], claimed, claimNotConfirmed: claimed };
    const matched = item.matched.map((id) => byId.get(id)).filter((p): p is PantryRef => p !== undefined);
    const status = STATUS_OF[item.status];
    const found = status !== "missing";
    const confirmed = claimed && found && matched.some((m) => m.id === ingredient.pantryId);
    return {
      ingredient,
      status,
      matched: found ? matched : [],
      ...(item.shortfall ? { shortfall: item.shortfall } : {}),
      claimed,
      claimNotConfirmed: claimed && !confirmed,
    };
  });
}

/**
 * Controlla le idee: scarta quelle con allergeni o esclusioni (anche negli alimenti di dispensa collegati), verifica la
 * dispensa, segna gli ingredienti incerti, ordina per ciò che scade prima.
 */
export function checkIdeas(
  ideas: readonly RecipeIdea[],
  criteria: IdeaCriteria,
  pantry: readonly CheckedPantryRef[],
): { accepted: CheckedIdea[]; rejected: Rejection[] } {
  const accepted: CheckedIdea[] = [];
  const rejected: Rejection[] = [];

  for (const idea of ideas) {
    const ingredients = verifyAgainstPantry(idea, pantry);
    const assessment = assessIdea(idea, criteria, pantry, ingredients.map((c) => c.matched));
    const reasons = reasonsFrom(assessment, idea.title);
    if (reasons.length > 0) {
      rejected.push({ idea, reasons });
      continue;
    }
    const warnings: string[] = [];

    const used = new Map<string, PantryRef>();
    for (const c of ingredients) {
      if (c.status === "in_pantry" || c.status === "partial" || c.status === "unquantified") for (const m of c.matched) used.set(m.id, m);
    }
    const expiring = new Map<string, { ref: PantryRef; weight: number }>();
    for (const c of ingredients) {
      if (c.status === "missing") continue;
      for (const m of c.matched) {
        if (m.daysLeft === undefined || m.daysLeft > EXPIRING_DAYS) continue;
        const weight = expiryWeight(m.daysLeft) * (c.status === "to_confirm" ? 0.5 : 1);
        const prev = expiring.get(m.id);
        if (!prev || weight > prev.weight) expiring.set(m.id, { ref: m, weight });
      }
    }

    const missing: RecipeIngredient[] = ingredients
      .filter((c) => c.status === "missing" || c.status === "partial")
      .map((c) => ({ name: c.ingredient.name, ...((c.shortfall ?? c.ingredient.quantity) ? { quantity: (c.shortfall ?? c.ingredient.quantity) as Quantity } : {}) }));

    for (const c of ingredients) {
      if (c.claimNotConfirmed) warnings.push(`«${c.ingredient.name}» era dato come presente in dispensa, ma non lo trovo: lo conto tra quelli da comprare.`);
      else if (c.status === "to_confirm") warnings.push(`«${c.ingredient.name}»: in dispensa c'è ${c.matched.map((m) => `«${m.name}»`).join(", ")}, non so se è lo stesso alimento. Controlla.`);
      else if (c.status === "unquantified") warnings.push(`«${c.ingredient.name}»: ce l'hai, ma non so se basta (unità diverse).`);
    }
    const minutes = totalMinutes({ times: idea.times, steps: idea.steps });
    if (criteria.maxMinutes !== undefined && minutes !== undefined && minutes > criteria.maxMinutes) {
      warnings.push(`Richiede circa ${minutes} minuti: più dei ${criteria.maxMinutes} che hai.`);
    }
    if (criteria.ownedEquipment && criteria.ownedEquipment.length > 0) {
      const lacking = exclusionReasons({ ingredients: [], equipment: idea.equipment }, { ownedEquipment: criteria.ownedEquipment }).find((r) => r.code === "missing_equipment");
      if (lacking && lacking.code === "missing_equipment") warnings.push(`Serve ${lacking.equipment.join(", ")}, che non hai segnato tra l'attrezzatura.`);
    }

    accepted.push({
      idea,
      ingredients,
      usedFromPantry: [...used.values()],
      missing,
      expiringUsed: [...expiring.values()].sort((a, b) => b.weight - a.weight).map((e) => e.ref),
      expiringScore: Math.round([...expiring.values()].reduce((s, e) => s + e.weight, 0) * 1e6) / 1e6,
      warnings,
      uncertain: uncertainFrom(assessment),
      uncertainIngredients: uncertainIngredientsFrom(assessment, idea, pantry, ingredients.map((c) => c.matched)),
      confirmed: confirmedFrom(assessment),
    });
  }

  // precedenza a ciò che scade prima; a pari punteggio resta l'ordine della risposta (l'ordinamento è stabile)
  accepted.sort((a, b) => b.expiringScore - a.expiringScore);
  return { accepted, rejected };
}

export function expiringText(ref: PantryRef): string {
  return ref.daysLeft === undefined ? ref.name : `${ref.name} (${daysLeftText(Math.round(ref.daysLeft))})`;
}
