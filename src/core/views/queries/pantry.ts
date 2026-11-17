// Interrogazioni sulla dispensa e sui consumi: cosa scade, quanto si è consumato di un alimento.
import { localDate } from "../../diary";
import { SHELF_LIFE, effectiveExpiry, toCalendarDate, urgency, type EffectiveExpiry, type ExpiryItem, type FoodCategory } from "../../expiry";
import { activeLots, type Certainty, type Lot } from "../../ledger";
import { LOCATION_NAMES, UNIT_NAMES, formatQty, plural } from "../labels";
import { inRange } from "../period";
import type { QueryDef, ViewContext } from "../types";
import { insufficient, limitOf, limitParam, normText, periodOf, periodParam, stemWords, worst } from "./kit";

function expiryItemOf(lot: Lot, tz: string): ExpiryItem | undefined {
  if (lot.category === undefined || !Object.hasOwn(SHELF_LIFE, lot.category)) return undefined;
  try {
    const day = (instant: string | undefined) => (instant ? toCalendarDate(instant, tz) : null);
    return {
      id: lot.lotId,
      labelDateType: lot.expiry ? lot.expiry.kind : "none",
      labelDate: lot.expiry?.date ?? null,
      purchaseDate: toCalendarDate(lot.createdAt, tz),
      openedDate: day(lot.openedAt),
      location: lot.location,
      frozenDate: day(lot.frozenAt),
      thawedDate: day(lot.thawedAt),
      category: lot.category as FoodCategory,
    };
  } catch {
    return undefined;
  }
}

/** La scadenza che conta: stimata dal motore se la categoria è nota, altrimenti la sola data in etichetta. */
function expiryOf(lot: Lot, ctx: ViewContext): EffectiveExpiry | undefined {
  const item = expiryItemOf(lot, ctx.diary.timeZone);
  if (item) {
    try {
      return effectiveExpiry(item, ctx.today);
    } catch {
      // si ripiega sulla data in etichetta
    }
  }
  if (!lot.expiry) return undefined;
  return {
    date: lot.expiry.date,
    basis: "label",
    nature: lot.expiry.kind === "best_before" ? "quality" : "safety",
    certainty: lot.expiry.kind === "estimated" ? "estimated" : "label",
  };
}

function whenText(daysLeft: number, nature: "safety" | "quality"): string {
  if (daysLeft < 0) {
    const ago = daysLeft === -1 ? "ieri" : `da ${-daysLeft} giorni`;
    return nature === "quality" ? `data passata ${ago}` : `scaduto ${ago}`;
  }
  if (daysLeft === 0) return "scade oggi";
  if (daysLeft === 1) return "scade domani";
  return `scade tra ${daysLeft} giorni`;
}

const expiringSoon: QueryDef = {
  name: "expiring_soon",
  description: "Cosa in dispensa è già scaduto o sta per scadere entro un certo numero di giorni, dal più urgente.",
  params: {
    within_days: { kind: "int", min: 1, max: 30, default: 3, description: "entro quanti giorni da oggi" },
    location: { kind: "enum", values: ["all", "frigo", "freezer", "dispensa"], default: "all", description: "luogo: all = tutti, dispensa = credenza" },
    limit: limitParam(),
  },
  result: "rows",
  needsNutrition: false,
  caption: (p) => `In scadenza entro ${plural(Number(p.within_days), "giorno", "giorni")}`,
  run(p, ctx) {
    const location = p.location === "all" ? undefined : (p.location as Lot["location"]);
    const lots = activeLots(ctx.pantry, location);
    if (lots.length === 0) return insufficient(location ? `Non c'è nulla in ${LOCATION_NAMES[location]}.` : "La dispensa è vuota.");
    const within = Number(p.within_days);
    const found = lots.flatMap((lot) => {
      const expiry = expiryOf(lot, ctx);
      if (!expiry) return [];
      const u = urgency(expiry, ctx.today, ctx.diary.timeZone);
      return u.daysLeft <= within ? [{ lot, expiry, daysLeft: u.daysLeft }] : [];
    });
    found.sort((a, b) => a.daysLeft - b.daysLeft || (a.expiry.nature === b.expiry.nature ? 0 : a.expiry.nature === "safety" ? -1 : 1));
    const limit = limitOf(p);
    const rows = found.slice(0, limit).map(({ lot, expiry, daysLeft }) => ({
      label: lot.productRef.trim(),
      valueText: whenText(daysLeft, expiry.nature),
      detail: `${LOCATION_NAMES[lot.location]} · ${formatQty(lot.remaining, lot.unit)}${expiry.certainty === "estimated" ? " · data stimata" : ""}`,
      certainty: expiry.certainty === "estimated" ? ("estimated" as const) : ("label" as const),
    }));
    const noDate = lots.filter((l) => expiryOf(l, ctx) === undefined).length;
    if (found.length === 0 && noDate === lots.length) {
      return insufficient("Nessun prodotto ha una data di scadenza o una categoria da cui stimarla: non posso dire cosa scade.");
    }
    const notes = [
      found.length === 0 && noDate > 0 ? "Vale solo per i prodotti con una data o una categoria." : "",
      found.length > limit ? `Altre ${found.length - limit} voci non sono mostrate.` : "",
      noDate > 0 ? `${plural(noDate, "prodotto senza data né categoria non è considerato", "prodotti senza data né categoria non sono considerati")}.` : "",
    ].filter(Boolean);
    return {
      kind: "rows",
      rows,
      basis: found.length === 0 ? `Nulla scade entro ${plural(within, "giorno", "giorni")}` : `${plural(found.length, "voce", "voci")} entro ${plural(within, "giorno", "giorni")}`,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  },
};

/** Il nome cercato (già ridotto alle radici) compare come parola intera, o parole di seguito, nel testo: «uva» non trova «uvetta». */
const hasWords = (haystack: string, needle: string): boolean => ` ${haystack} `.includes(` ${needle} `);

const namesText = (names: readonly string[]): string => `${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`;

const foodConsumption: QueryDef = {
  name: "food_consumption",
  description:
    "Quanto è stato consumato di un alimento nel periodo, per unità (grammi, millilitri, pezzi), sommando i consumi dalla dispensa e le voci scritte nei pasti. L'alimento si indica con il suo nome, una parola intera, per esempio «latte» o «uova»: si trovano i prodotti il cui nome contiene quella parola.",
  params: { food: { kind: "text", maxLength: 40, description: "nome dell'alimento, una o due parole" }, period: periodParam() },
  result: "rows",
  needsNutrition: false,
  caption: (p, result) =>
    result?.kind === "rows" && result.matched && result.matched.length > 0 ? `Consumi di: ${namesText(result.matched)}` : `Consumi di «${String(p.food)}»`,
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const needle = stemWords(String(p.food));
    if (normText(String(p.food)).length < 2) return insufficient("Il nome dell'alimento è troppo breve.");
    const tz = ctx.diary.timeZone;
    const found = new Map<string, string>();
    const perUnit = new Map<string, { pantry: number; meals: number; certainty: Certainty[] }>();
    const slot = (unit: string) => {
      let s = perUnit.get(unit);
      if (!s) perUnit.set(unit, (s = { pantry: 0, meals: 0, certainty: [] }));
      return s;
    };
    for (const lot of ctx.pantry.lots) {
      if (!hasWords(stemWords(lot.productRef), needle)) continue;
      for (const h of lot.history) {
        if (h.type !== "consume" || !inRange(localDate(h.at, tz), period)) continue;
        const amount = -(h.quantityDelta ?? 0);
        if (amount <= 0) continue;
        const s = slot(lot.unit);
        s.pantry += amount;
        s.certainty.push(h.certainty);
        found.set(normText(lot.productRef), lot.productRef.trim());
      }
    }
    for (const day of ctx.diary.days) {
      if (!inRange(day.date, period)) continue;
      for (const meal of day.meals) {
        for (const item of meal.items) {
          if (!hasWords(stemWords(item.name), needle)) continue;
          const s = slot(item.quantity.unit);
          s.meals += item.quantity.value;
          s.certainty.push(item.certainty);
          found.set(normText(item.name), item.name.trim());
        }
      }
    }
    if (perUnit.size === 0) return insufficient(`Non trovo consumi di «${String(p.food)}» registrati nel periodo.`, period.label);
    const rows = [...perUnit.entries()].map(([unit, s]) => ({
      label: UNIT_NAMES[unit] ?? unit,
      valueText: formatQty(s.pantry + s.meals, unit),
      detail: [s.pantry > 0 ? `dalla dispensa ${formatQty(s.pantry, unit)}` : "", s.meals > 0 ? `scritto nei pasti ${formatQty(s.meals, unit)}` : ""].filter(Boolean).join(" · "),
      certainty: worst(s.certainty),
    }));
    return { kind: "rows", rows, matched: [...found.values()], basis: period.label, note: "Si cercano i nomi che contengono la parola intera indicata: i nomi trovati sono nella didascalia." };
  },
};

export const PANTRY_QUERIES: readonly QueryDef[] = [expiringSoon, foodConsumption];
