// «Ultime azioni»: il testo di una riga. Verbo al passato, che cosa, quanto; e dove si va a vederla. Logica pura.
import type { DrinkEvent, MealEvent, MealKind, WaterEvent } from "@/core/diary";
import { familyOf, isKnownEvent, type AnyEvent, type EventFamily } from "@/core/events";
import type {
  AdjustEvent,
  ConsumeEvent,
  DeclareEvent,
  DiscardEvent,
  GiftEvent,
  MoveEvent,
  OpenEvent,
  PantryState,
  PurchaseEvent,
  Quantity,
  UpdateLotEvent,
  VoidEvent,
} from "@/core/ledger";
import { PREP_REPAIR_ID_PREFIX, type PrepEvent } from "@/core/prep";
import { formatQuantity } from "@/core/units";
import { DIET_HREF } from "../allergens";
import { formatTime } from "../format";
import { SYMPTOM_LABELS, formatKg, formatMl } from "../health";
import { DISCARD_REASON_LABELS, LOCATION_LABELS } from "../labels";
import { MEAL_KIND_LABELS } from "../meals";
import type { Operation } from "./operations";

export interface OperationText {
  /** «Mangiato: 75 g di spinaci, a cena» */
  text: string;
  /** Dove si vede: la riga del diario o la scheda dell'alimento. Assente se non c'è un posto. */
  href?: string;
  /** L'azione è arrivata da un altro telefono. */
  fromOtherDevice: boolean;
}

/** Ciò che del registro serve a un testo e che la dispensa di adesso non dice più. */
export interface LogIndex {
  /** Il nome con cui un alimento è entrato, anche se è stato eliminato. */
  lotName(lotId: string): string | undefined;
  /** Un evento qualsiasi, anche annullato: per sapere che cosa un annullamento ha sostituito. */
  event(id: string): AnyEvent | undefined;
  /** Il momento del pasto con questo `mealId` (l'ultimo scritto). */
  mealKind(mealId: string): MealKind | undefined;
}

export interface DescribeContext {
  pantry: PantryState;
  ownDeviceId: string;
  timeZone: string;
  /** Senza, i testi restano giusti ma più poveri: un alimento eliminato è «alimento», uno spostamento è una correzione. */
  log?: LogIndex;
}

const later = (a: AnyEvent, b: AnyEvent): boolean => {
  const d = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  return d > 0 || (d === 0 && a.id > b.id);
};

/** Si costruisce una volta per registro e si passa a ogni riga. */
export function indexLog(log: readonly AnyEvent[]): LogIndex {
  const events = new Map<string, AnyEvent>();
  const creations = new Map<string, PurchaseEvent | DeclareEvent>();
  const meals = new Map<string, MealEvent>();
  for (const e of log) {
    if (typeof e?.id !== "string") continue;
    events.set(e.id, e);
    if (e.type === "purchase" || e.type === "declare") {
      const cur = creations.get(e.lotId);
      if (!cur || later(e, cur)) creations.set(e.lotId, e);
    } else if (e.type === "meal") {
      const cur = meals.get(e.mealId);
      if (!cur || later(e, cur)) meals.set(e.mealId, e);
    }
  }
  return {
    lotName: (lotId) => creations.get(lotId)?.productRef,
    event: (id) => events.get(id),
    mealKind: (mealId) => meals.get(mealId)?.kind,
  };
}

interface Phrase {
  text: string;
  href?: string;
}

const GENERIC = "Modifica fatta con una versione più nuova dell'app";

const FAMILY_NAMES: Record<EventFamily, string> = {
  pantry: "dispensa",
  diary: "diario",
  plan: "piano",
  prep: "preparazioni",
  recipes: "ricette",
  experiments: "esperimenti",
  allergenConfirmations: "allergeni",
};

const FAMILY_PAGES: Record<EventFamily, string> = {
  pantry: "/app/dispensa",
  diary: "/app",
  plan: "/app/piano",
  prep: "/app/preparazioni",
  recipes: "/app/ricette",
  experiments: "/app/salute/esperimenti",
  allergenConfirmations: "/app/piano",
};

const AT_MOMENT: Record<MealKind, string> = { breakfast: "a colazione", lunch: "a pranzo", dinner: "a cena", snack: "come spuntino" };
const SKIPPED: Record<MealKind, string> = { breakfast: "Colazione saltata", lunch: "Pranzo saltato", dinner: "Cena saltata", snack: "Spuntino saltato" };
const NO_DETAILS: Record<MealKind, string> = {
  breakfast: "Colazione mangiata, senza dettagli",
  lunch: "Pranzo mangiato, senza dettagli",
  dinner: "Cena mangiata, senza dettagli",
  snack: "Spuntino mangiato, senza dettagli",
};
const RATINGS = { poor: "non buono", good: "buono", great: "ottimo" } as const;

/** In mezzo a una frase il nome comincia con la minuscola; una sigla resta com'è. */
const lower = (name: string): string => name.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());
const kindWord = (kind: MealKind): string => MEAL_KIND_LABELS[kind].toLowerCase();
const voce = (id: string): string => `/app?voce=${encodeURIComponent(id)}`;
const lotto = (lotId: string): string => `/app/dispensa?lotto=${encodeURIComponent(lotId)}`;
const hasReplaces = (e: AnyEvent): boolean => typeof e.replaces === "string" && e.replaces !== "";
const sum = (values: readonly number[]): number => Math.round(values.reduce((s, v) => s + v, 0) * 1e6) / 1e6;

/** La voce «Fuori casa · normale» di un pasto che ha solo quella (una stima, con la sua energia): «fuori casa, normale». */
function outOfHomeOf(m: MealEvent): string | undefined {
  const items = m.items ?? [];
  if (items.length !== 1 || items[0].energyKcal === undefined) return undefined;
  return lower(items[0].name.trim()).replace(/\s*·\s*/g, ", ");
}

/** «il tè», «la birra», «l'acqua tonica», «lo spritz»: l'articolo si sceglie dalla prima parola, come si può. */
function withArticle(name: string): string {
  const word = name.split(/\s+/)[0].toLowerCase();
  if (/^[aeiouàèéìòù]/.test(word)) return `l'${name}`;
  if (/^(s[^aeiou]|z|gn|ps|x|y)/.test(word)) return `lo ${name}`;
  return `${word.endsWith("a") ? "la" : "il"} ${name}`;
}

/** «latte, uova, pane e altri 2»: al massimo tre nomi, senza ripetizioni. */
function listed(names: readonly string[]): string {
  const unique = [...new Set(names)];
  return unique.slice(0, 3).join(", ") + (unique.length > 3 ? ` e altri ${unique.length - 3}` : "");
}

function describer(ctx: DescribeContext) {
  const current = new Map(ctx.pantry.lots.map((l) => [l.lotId, l.productRef]));
  const lotName = (lotId: string): string => lower(current.get(lotId) ?? ctx.log?.lotName(lotId) ?? "alimento");
  const lotsHref = (lotIds: readonly string[]): string => {
    const unique = [...new Set(lotIds)];
    return unique.length === 1 ? lotto(unique[0]) : "/app/dispensa";
  };

  /** «275 g di petto di pollo», «100 g di pane, 50 g di burro»: le confezioni dello stesso alimento si sommano. */
  function amounts(parts: readonly { lotId: string; quantity: Quantity }[]): string {
    const totals = new Map<string, { name: string; quantity: Quantity }>();
    for (const p of parts) {
      const name = lotName(p.lotId);
      const key = `${name}\u0000${p.quantity.unit}`;
      const cur = totals.get(key);
      if (cur) cur.quantity = { value: sum([cur.quantity.value, p.quantity.value]), unit: p.quantity.unit };
      else totals.set(key, { name, quantity: { ...p.quantity } });
    }
    return listed([...totals.values()].map((t) => `${formatQuantity(t.quantity)} di ${t.name}`));
  }

  /** «petto di pollo», «mousse (3 confezioni)», «latte, uova, pane e altri 2». */
  function lotNames(lotIds: readonly string[]): string {
    const names = lotIds.map(lotName);
    const unique = [...new Set(names)];
    return unique.length === 1 && lotIds.length > 1 ? `${unique[0]} (${lotIds.length} confezioni)` : listed(names);
  }

  /** Il consumo che un sostituto ha preso il posto di: quello annullato dallo stesso gruppo, per lo stesso alimento. */
  function replacedBy(c: ConsumeEvent, op: Operation): ConsumeEvent | undefined {
    for (const v of op.events) {
      if (v.type !== "void") continue;
      const target = ctx.log?.event((v as VoidEvent).targetEventId);
      if (target?.type === "consume" && target.lotId === c.lotId) return target;
    }
    return undefined;
  }

  function mealPhrase(written: readonly MealEvent[], consumes: readonly ConsumeEvent[]): Phrase {
    // Due versioni dello stesso pasto in una sola operazione non sono uno spostamento: è un registro in cui la seconda
    // ha ereditato l'`opId` della prima e non si sono potute separare. Vale l'ultima scritta.
    const latest = new Map<string, MealEvent>();
    for (const m of written) {
      const cur = latest.get(m.mealId);
      if (!cur || later(m, cur)) latest.set(m.mealId, m);
    }
    const meals = written.filter((m) => latest.get(m.mealId) === m);
    const fresh = meals.filter((m) => !hasReplaces(m));
    const rewritten = meals.filter(hasReplaces);

    if (fresh.length === 0) {
      const m = rewritten[0];
      const added = consumes.filter((c) => c.mealId === m.mealId && !hasReplaces(c));
      const before = ctx.log?.event(m.replaces as string);
      const kept = before?.type === "meal" ? (before.items?.length ?? 0) : undefined;
      const items = m.items ?? [];
      const away = outOfHomeOf(m);
      // è cambiata solo la taglia della stima «fuori casa»: momento e ora sono quelli di prima
      if (away !== undefined && rewritten.length === 1 && added.length === 0 && before?.type === "meal" && outOfHomeOf(before) !== undefined && before.kind === m.kind && before.at === m.at) {
        return { text: `Corretto: ${kindWord(m.kind)} ${away}`, href: voce(m.id) };
      }
      const more = kept !== undefined && items.length > kept ? items.slice(kept).map((i) => lower(i.name)) : [];
      if (added.length > 0 || (more.length > 0 && rewritten.length === 1)) {
        return { text: `Aggiunto a ${kindWord(m.kind)}: ${listed([...added.map((c) => lotName(c.lotId)), ...more])}`, href: voce(m.id) };
      }
      return { text: `Pasto corretto: ${kindWord(m.kind)}`, href: voce(m.id) };
    }

    const m = fresh[0];
    const items = m.items ?? [];
    const mine = consumes.filter((c) => c.mealId === m.mealId);
    const away = outOfHomeOf(m);
    if (away !== undefined && meals.length === 1 && mine.length === 0) return { text: `Registrato: ${kindWord(m.kind)} ${away}`, href: voce(m.id) };
    if (rewritten.length > 0 && items.length > 0 && mine.length === 0) {
      return { text: `Spostato ${AT_MOMENT[m.kind]}: ${listed(items.map((i) => lower(i.name)))}`, href: voce(m.id) };
    }
    if (items.length === 0 && mine.length > 0 && mine.every(hasReplaces)) {
      return { text: `Spostato ${AT_MOMENT[m.kind]}: ${amounts(mine)}`, href: voce(mine[0].id) };
    }
    if (items.length === 0 && mine.length > 0 && mine.every((c) => c.note === "quick")) {
      return { text: `Mangiato: ${amounts(mine)}, ${AT_MOMENT[m.kind]}`, href: voce(mine[0].id) };
    }
    const parts = listed([...mine.map((c) => lotName(c.lotId)), ...items.map((i) => lower(i.name))]);
    return { text: `Registrato: ${kindWord(m.kind)}${parts === "" ? "" : ` (${parts})`}`, href: voce(m.id) };
  }

  function consumePhrase(consumes: readonly ConsumeEvent[], op: Operation): Phrase {
    const first = consumes[0];
    const kinds = new Set(consumes.map((c) => (c.mealId ? ctx.log?.mealKind(c.mealId) : undefined)));
    const where = kinds.size === 1 ? [...kinds][0] : undefined;

    if (consumes.every(hasReplaces)) {
      const before = replacedBy(first, op);
      const moved = before !== undefined && before.mealId !== first.mealId && before.quantity.value === first.quantity.value;
      if (moved) return { text: `Spostato${where ? ` ${AT_MOMENT[where]}` : ""}: ${amounts(consumes)}`, href: voce(first.id) };
      const text = consumes.length === 1 ? `${lotName(first.lotId)}, ${formatQuantity(first.quantity)}` : amounts(consumes);
      return { text: `Corretto: ${text}`, href: voce(first.id) };
    }
    // gli ingredienti scalati per le porzioni usate dopo che la loro preparazione era stata tolta: non è un «mangiato»
    if (consumes.every((c) => c.id.startsWith(PREP_REPAIR_ID_PREFIX))) {
      return { text: `Preparazione riparata: ${amounts(consumes)}`, href: "/app/preparazioni" };
    }
    if (consumes.every((c) => c.note?.startsWith("drink:"))) {
      const drinkIds = new Set(consumes.map((c) => (c.note as string).slice("drink:".length)));
      const drink = drinkIds.size === 1 ? ctx.log?.event([...drinkIds][0]) : undefined;
      const why = drink?.type === "drink" ? ` (per ${withArticle(lower(drink.name.trim()))} delle ${formatTime(drink.at, ctx.timeZone)})` : "";
      return { text: `Scalato dalla dispensa: ${amounts(consumes)}${why}`, href: lotsHref(consumes.map((c) => c.lotId)) };
    }
    return { text: `Mangiato: ${amounts(consumes)}${where ? `, ${AT_MOMENT[where]}` : ""}`, href: voce(first.id) };
  }

  function creationPhrase(creations: readonly (PurchaseEvent | DeclareEvent)[], adjusts: readonly AdjustEvent[]): Phrase {
    const fresh = creations.filter((c) => !hasReplaces(c));
    if (fresh.length === 1) {
      const c = fresh[0];
      return { text: `Aggiunto alla dispensa: ${lower(c.productRef)}, ${formatQuantity(c.quantity)}`, href: lotto(c.lotId) };
    }
    if (fresh.length > 1) {
      const names = new Set(fresh.map((c) => lower(c.productRef.trim())));
      if (names.size === 1) return { text: `Aggiunte alla dispensa: ${fresh.length} confezioni di ${[...names][0]}`, href: "/app/dispensa" };
      return { text: `Aggiunti alla dispensa: ${fresh.length} alimenti (${listed(fresh.map((c) => lower(c.productRef)))})`, href: "/app/dispensa" };
    }
    // l'ingresso riscritto con lo stesso alimento: una correzione
    if (adjusts.length > 0) return adjustPhrase(adjusts);
    return { text: `Corretto: ${lotNames(creations.map((c) => c.lotId))}`, href: lotsHref(creations.map((c) => c.lotId)) };
  }

  function adjustPhrase(adjusts: readonly AdjustEvent[]): Phrase {
    const href = lotsHref(adjusts.map((a) => a.lotId));
    const names = lotNames(adjusts.map((a) => a.lotId));
    if (adjusts.every((a) => a.remaining.value === 0)) return { text: `${adjusts.length === 1 ? "Finito" : "Finiti"}: ${names}`, href };
    if (adjusts.length > 1) return { text: `Corretti: ${names}`, href };
    const { remaining } = adjusts[0];
    const left = remaining.unit === "pz" && remaining.value === 1 ? "ne resta" : "ne restano";
    return { text: `Corretto: ${names}, ${left} ${formatQuantity(remaining)}`, href };
  }

  /** Peso, umore, sintomi, integratori: quello che si segna di sé. */
  function bodyPart(e: AnyEvent, corrected: boolean): string | undefined {
    switch (e.type) {
      case "weight":
        return `${corrected ? "Peso corretto" : "Peso"}: ${formatKg(e.kg)}`;
      case "mood":
        return `Umore: ${e.score} su 5`;
      case "symptom":
        return `${e.kind === "other" ? (e.label?.trim() ? e.label.trim() : "Sintomo") : SYMPTOM_LABELS[e.kind]}: ${e.score} su 5`;
      case "supplement":
        return `Integratore: ${lower(e.name)}`;
      default:
        return undefined;
    }
  }

  function single(e: AnyEvent): Phrase {
    switch (e.type) {
      case "mealDeclaration":
        return { text: e.status === "skipped" ? SKIPPED[e.kind] : NO_DETAILS[e.kind], href: voce(e.id) };
      case "untrackedMeal":
        return { text: NO_DETAILS[e.kind], href: voce(e.id) };
      case "habit":
        return { text: `${e.archived ? "Pasto abituale ritirato" : "Pasto abituale salvato"}: ${e.title}`, href: "/app/pasti-abituali" };
      case "planWeek":
        return { text: "Piano: settimana cambiata", href: "/app/piano/settimana" };
      case "planTargets":
        return { text: "Piano: obiettivi cambiati", href: `${DIET_HREF}?sezione=obiettivi` };
      case "planStructure":
        return { text: "Piano: pasti, allergeni o esclusioni cambiati", href: "/app/piano" };
      case "dayType":
        return { text: "Piano: tipo di giornata cambiato", href: "/app/piano" };
      case "prep":
        return { text: `Preparazione: ${lower(e.title)}, ${e.portions} ${e.portions === 1 ? "porzione" : "porzioni"}`, href: "/app/preparazioni" };
      case "recipe":
        return { text: `${e.archived ? "Ricetta ritirata" : "Ricetta salvata"}: ${lower(e.title)}`, href: e.archived ? "/app/ricette" : `/app/ricette/vedi?id=${encodeURIComponent(e.recipeId)}` };
      case "dishRating":
        return { text: e.rating ? `Piatto cucinato: ${RATINGS[e.rating]}` : "Piatto cucinato", href: `/app/ricette/vedi?id=${encodeURIComponent(e.recipeId)}` };
      case "experiment":
        return { text: "startDate" in e ? `Esperimento salvato: ${lower(e.title)}` : "Modifica: esperimenti", href: "/app/salute/esperimenti" };
      case "allergenConfirmation":
        return { text: `${e.action === "confirm" ? "Conferma sugli allergeni" : "Conferma sugli allergeni ritirata"}: ${lower(e.ingredient)}` };
      case "allergenDeclaration": {
        const what = e.list === "allergens" ? (e.action === "add" ? "Allergene aggiunto" : "Allergene tolto") : e.action === "add" ? "Alimento escluso aggiunto" : "Alimento escluso tolto";
        return { text: `${what}: ${lower(e.text)}`, href: "/app/impostazioni/alimentazione" };
      }
      default: {
        const family = familyOf(e);
        return family ? { text: `Modifica: ${FAMILY_NAMES[family]}`, href: FAMILY_PAGES[family] } : { text: GENERIC };
      }
    }
  }

  return function phrase(op: Operation): Phrase {
    const own = op.events.filter((e) => e.type !== "void");
    if (own.length === 0 || own.some((e) => !isKnownEvent(e))) return { text: GENERIC };
    const corrected = own.length < op.events.length;
    const of = <E extends AnyEvent>(type: E["type"]): E[] => own.filter((e) => e.type === type) as E[];

    const meals = of<MealEvent>("meal");
    const consumes = of<ConsumeEvent>("consume");
    if (meals.length > 0) return mealPhrase(meals, consumes);

    const preps = of<PrepEvent>("prep");
    if (preps.length > 0) return single(preps[0]);

    const drinks = of<DrinkEvent>("drink");
    if (drinks.length > 0) {
      const names = [...new Set(drinks.map((d) => lower(d.name)))];
      const href = voce(drinks[0].id);
      if (corrected && drinks.length === 1) return { text: `Bevanda spostata: ${names[0]}, alle ${formatTime(drinks[0].at, ctx.timeZone)}`, href };
      if (names.length === 1) return { text: `Bevanda: ${names[0]}, ${formatMl(sum(drinks.map((d) => d.ml)))}`, href };
      return { text: `Bevande: ${listed(names)}`, href };
    }

    if (consumes.length > 0) return consumePhrase(consumes, op);

    const creations = [...of<PurchaseEvent>("purchase"), ...of<DeclareEvent>("declare")];
    const adjusts = of<AdjustEvent>("adjust");
    if (creations.length > 0) return creationPhrase(creations, adjusts);

    const discards = of<DiscardEvent>("discard");
    if (discards.length > 0) {
      return { text: `Buttato: ${amounts(discards)} (${DISCARD_REASON_LABELS[discards[0].reason].toLowerCase()})`, href: lotsHref(discards.map((d) => d.lotId)) };
    }
    const gifts = of<GiftEvent>("gift");
    if (gifts.length > 0) return { text: `Regalato: ${amounts(gifts)}`, href: lotsHref(gifts.map((g) => g.lotId)) };
    if (adjusts.length > 0) return adjustPhrase(adjusts);
    const moves = of<MoveEvent>("move");
    if (moves.length > 0) {
      const lots = moves.map((m) => m.lotId);
      return { text: `Spostato in ${LOCATION_LABELS[moves[0].to].toLowerCase()}: ${lotNames(lots)}`, href: lotsHref(lots) };
    }
    const opens = of<OpenEvent>("open");
    if (opens.length > 0) return { text: `Aperto: ${lotNames(opens.map((o) => o.lotId))}`, href: lotsHref(opens.map((o) => o.lotId)) };
    const updates = of<UpdateLotEvent>("updateLot");
    if (updates.length > 0) return { text: `Corretto: ${lotNames(updates.map((u) => u.lotId))}`, href: lotsHref(updates.map((u) => u.lotId)) };

    const waters = of<WaterEvent>("water");
    if (waters.length > 0) return { text: `Acqua: ${formatMl(sum(waters.map((w) => w.ml)))}`, href: voce(waters[0].id) };

    const body: { id: string; text: string }[] = [];
    for (const e of own) {
      const text = bodyPart(e, corrected && own.length === 1);
      if (text !== undefined) body.push({ id: e.id, text });
    }
    if (body.length > 0) {
      return { text: body.slice(0, 3).map((x) => x.text).join(" · ") + (body.length > 3 ? ` e altri ${body.length - 3}` : ""), href: voce(body[0].id) };
    }

    return single(own[0]);
  };
}

/** Il testo di una riga di «Ultime azioni» e dove porta. Non lancia: un tipo che non conosce ha la frase generica. */
export function describeOperation(op: Operation, ctx: DescribeContext): OperationText {
  const fromOtherDevice = op.deviceId !== ctx.ownDeviceId;
  try {
    const { text, href } = describer(ctx)(op);
    return { text, ...(href !== undefined ? { href } : {}), fromOtherDevice };
  } catch {
    return { text: GENERIC, fromOtherDevice };
  }
}

/** L'avviso dopo «Annulla» o «Rifai»: «Annullato: mangiato 75 g di spinaci, a cena.» */
export function doneText(kind: "undo" | "redo", text: string): string {
  const said = text.replace(/^\p{Lu}(?=\p{Ll}|\s|:)/u, (c) => c.toLowerCase()).replace(": ", " ");
  return `${kind === "undo" ? "Annullato" : "Rifatto"}: ${said}.`;
}
