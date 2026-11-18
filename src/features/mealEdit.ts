// Aggiungere alimenti a un pasto che c'è già e registrare di nuovo un pasto già fatto. Le quantità si leggono e gli
// alimenti si prendono dalla dispensa con le regole di `meals.ts`: qui si compone soltanto. Logica pura.
import {
  appendItems,
  createMeal,
  currentMeal,
  lowerMealCertainty,
  type MealEvent,
  type MealItem,
  type MealKind,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { worseCertainty, type Certainty, type ConsumeEvent, type Lot } from "@/core/ledger";
import { evaluateLots } from "./lots";
import {
  MEAL_KIND_LABELS,
  buildMealEvents,
  buildMealFromHabit,
  type FreeItemInput,
  type HabitMealResult,
  type MealContext,
  type MealPick,
  type MealResult,
} from "./meals";

const isMeal = (e: AnyEvent): e is MealEvent => e.type === "meal";
const isConsume = (e: AnyEvent): e is ConsumeEvent => e.type === "consume";

/** I primi tre nomi, senza ripetizioni: «pane, insalata, mela e altri 2». */
function listed(names: readonly string[]): string {
  const unique = [...new Set(names)];
  return unique.slice(0, 3).join(", ") + (unique.length > 3 ? ` e altri ${unique.length - 3}` : "");
}

/** Il contesto senza `mealAt`: un pasto che c'è già tiene la sua ora, e i consumi sono sempre di adesso. */
const nowOnly = (ctx: MealContext): MealContext => ({
  now: ctx.now,
  deviceId: ctx.deviceId,
  ...(ctx.idGenerator ? { idGenerator: ctx.idGenerator } : {}),
});

/** Aggiunge alimenti a un pasto che c'è già: i consumi nuovi portano il suo `mealId`, le voci libere passano da `appendItems`. */
export function buildAppendToMeal(
  args: { mealId: string; picks: readonly MealPick[]; freeItems: readonly FreeItemInput[]; log: readonly AnyEvent[] },
  ctx: MealContext,
): MealResult {
  const general = (text: string): MealResult => ({ ok: false, errors: { picks: {}, free: {}, general: text } });
  const cur = currentMeal(args.mealId, args.log);
  if (!cur) return general("Questo pasto non c'è più.");
  const typed = args.freeItems.some((i) => i.name.trim() !== "" || i.quantityText.trim() !== "");
  if (args.picks.length === 0 && !typed) return general("Scegli almeno un alimento.");

  // Si compone un pasto come se fosse nuovo, per leggere quantità ed errori con le stesse regole, e se ne tengono
  // le voci e i consumi: l'evento `meal` di questa bozza non si scrive.
  const draft = buildMealEvents({ kind: cur.meal.kind, picks: args.picks, freeItems: args.freeItems }, nowOnly(ctx));
  if (!draft.ok) return draft;
  const items = draft.events.find(isMeal)?.items ?? [];
  const consumes = draft.events.filter(isConsume).map((c) => ({ ...c, mealId: args.mealId }));

  // Come in un pasto nuovo, un alimento stimato rende stimato il pasto: la sua certezza è la peggiore tra le voci.
  const worst = consumes.reduce<Certainty>((w, c) => worseCertainty(w, c.certainty), "measured");
  const edit =
    items.length > 0
      ? appendItems(args.mealId, items, args.log, nowOnly(ctx))
      : lowerMealCertainty(args.mealId, worst, args.log, nowOnly(ctx));
  if (!edit.ok) return general(edit.error);
  const written = edit.events.map((e) => (e.type === "meal" ? { ...e, certainty: worseCertainty(e.certainty, worst) } : e));

  const names = [...args.picks.map((p) => p.lot.productRef), ...items.map((i) => i.name)];
  return {
    ok: true,
    events: [...written, ...consumes],
    mealId: args.mealId,
    message: `Aggiunto a ${MEAL_KIND_LABELS[cur.meal.kind].toLowerCase()}: ${listed(names)}.`,
  };
}

const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Come si chiama, nel pasto ripetuto, un alimento di cui non si trova più il nome. */
const UNNAMED = "Alimento senza nome";

/**
 * Registra di nuovo, adesso, un pasto già fatto («Come ieri», «Ripeti adesso»). Ogni voce che veniva dalla dispensa si
 * riprende dagli alimenti con lo stesso nome che ci sono ora, prima da quelli da mangiare per primi (l'ordine lo
 * stabilisce questa funzione, non chi chiama); ciò che manca diventa una voce libera stimata, e `missing` dice quali.
 * Le voci libere si copiano. Ripetere un pasto è supporre le stesse quantità: tutto ciò che si scrive è una stima.
 * `kind`: il momento in cui metterlo, se diverso.
 */
export function buildRepeatMeal(
  args: { meal: MealWithPantry; names: ReadonlyMap<string, string>; lots: readonly Lot[]; kind?: MealKind },
  ctx: MealContext,
): HabitMealResult {
  const { meal, names } = args;
  const kind = args.kind ?? meal.kind;
  const lots = evaluateLots(args.lots.filter((l) => l.remaining > 0), ctx.now).map((e) => e.lot);

  // Le voci che venivano dalla dispensa: una per alimento e unità, anche se allora era diviso in due confezioni.
  // Un consumo di cui non si trova più il nome non si può cercare tra gli alimenti: resta una voce stimata a parte.
  const fromPantry: MealItem[] = [];
  const unnamed: MealItem[] = [];
  const add = (list: MealItem[], name: string, quantity: MealItem["quantity"]) => {
    const same = list.find((i) => i.quantity.unit === quantity.unit && nameKey(i.name) === nameKey(name));
    if (same) same.quantity.value = Math.round((same.quantity.value + quantity.value) * 1e9) / 1e9;
    else list.push({ name, quantity: { ...quantity }, certainty: "estimated" });
  };
  for (const c of meal.pantryConsumes) {
    const name = (names.get(c.lotId) ?? args.lots.find((l) => l.lotId === c.lotId)?.productRef ?? "").trim();
    if (name === "") add(unnamed, UNNAMED, c.quantity);
    else add(fromPantry, name, c.quantity);
  }
  const copied: MealItem[] = [
    ...unnamed,
    ...meal.items.map((i) => ({ ...i, quantity: { ...i.quantity }, certainty: "estimated" as const })),
  ];
  if (fromPantry.length + copied.length === 0) {
    return { events: [], mealId: "", missing: [], message: "Non c'è niente da ripetere." };
  }

  const title = meal.title?.trim() || undefined;
  const label = MEAL_KIND_LABELS[kind];
  try {
    // La regola con cui un pasto abituale prende dalla dispensa è la stessa: le si passano le sole voci della
    // dispensa (quelle libere non si cercano tra gli alimenti). Il pasto che ne esce è una bozza: quello scritto
    // non porta `habitId` né la fonte «pasto abituale».
    const taken = buildMealFromHabit({ habitId: "repeat", title: title ?? label, kind, items: fromPantry }, lots, nowOnly(ctx));
    const draft = taken.events.find(isMeal) as MealEvent;
    const consumes = taken.events.filter(isConsume).map((c) => ({ ...c, source: "manual" as const }));
    const items = [...(draft.items ?? []), ...copied];
    const event = createMeal(
      { kind, title, items: items.length > 0 ? items : undefined, mealId: draft.mealId },
      { deviceId: ctx.deviceId, now: () => ctx.now, idGenerator: () => draft.id, certainty: "estimated", ...(ctx.mealAt ? { at: ctx.mealAt } : {}) },
    );
    const missing = [...taken.missing, ...(unnamed.length > 0 ? [UNNAMED] : [])];
    const message =
      `Registrato: ${label.toLowerCase()} come l'ultima volta (${listed([...fromPantry, ...copied].map((i) => i.name))}).` +
      (missing.length > 0
        ? ` Non ho trovato in dispensa: ${missing.join(", ")}. ${missing.length === 1 ? "L'ho segnato" : "Li ho segnati"} come stima.`
        : "");
    return { events: [event, ...consumes], mealId: event.mealId, missing, message };
  } catch {
    return { events: [], mealId: "", missing: [], message: "Non riesco a ripetere questo pasto." };
  }
}
