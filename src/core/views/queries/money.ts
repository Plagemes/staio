// Interrogazioni sul denaro e sullo spreco: spesa per periodo, negozio e categoria; cosa si butta e perché.
// Denaro in centesimi interi; gli acquisti senza prezzo non si contano e si dichiarano.
import { localDate } from "../../diary";
import { estimatedPantryValue, type Lot } from "../../ledger";
import { CATEGORY_GROUPS, CATEGORY_GROUP_IDS, DISCARD_REASON_LABELS, formatCents, formatQty, groupOfCategory, plural, shortDate } from "../labels";
import { inRange, type Period } from "../period";
import type { QueryDef, ViewContext } from "../types";
import { bucketOf, insufficient, limitOf, limitParam, periodOf, periodParam, worst } from "./kit";

const groupParam = {
  kind: "enum",
  values: ["all", ...CATEGORY_GROUP_IDS],
  default: "all",
  description: "gruppo di alimenti: all = tutti; dairy = latte e latticini; eggs = uova; meat_fish = carne, pesce e salumi; vegetables = verdura; fruit = frutta; grains = pane, pasta, cereali e legumi; sweets_snacks = dolci e snack; canned_condiments = conserve e condimenti; beverages = bevande; ready_frozen = piatti pronti e surgelati",
} as const;

const groupName = (id: string): string => (id === "all" ? "tutti gli alimenti" : CATEGORY_GROUPS[id as keyof typeof CATEGORY_GROUPS].label.toLowerCase());

function purchasesIn(ctx: ViewContext, period: Period): Lot[] {
  const tz = ctx.diary.timeZone;
  return ctx.pantry.lots.filter((l) => l.origin === "purchase" && inRange(localDate(l.createdAt, tz), period));
}

const priceCertainty = (lots: readonly Lot[]) => worst(lots.map((l) => l.priceCertainty ?? "estimated"));
const sumCents = (lots: readonly Lot[]): number => lots.reduce((s, l) => s + (l.priceCents ?? 0), 0);

const spendTotal: QueryDef = {
  name: "spend_total",
  description:
    "Quanto è stato speso nel periodo (somma dei prezzi degli acquisti registrati), per tutti gli alimenti o per un gruppo, per esempio i latticini.",
  params: { period: periodParam(), group: groupParam },
  result: "number",
  needsNutrition: false,
  caption: (p) => `Spesa · ${p.group === "all" ? "tutti gli alimenti" : groupName(String(p.group))}`,
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const group = String(p.group);
    const all = purchasesIn(ctx, period);
    const selected = all.filter((l) => group === "all" || groupOfCategory(l.category) === group);
    const basis = `${plural(selected.length, "acquisto", "acquisti")} (${period.label})`;
    if (selected.length === 0) {
      return insufficient(group === "all" ? "Nessun acquisto registrato nel periodo." : `Nessun acquisto registrato nel periodo per ${groupName(group)}.`, basis);
    }
    const priced = selected.filter((l) => l.priceCents !== undefined);
    if (priced.length === 0) return insufficient("Gli acquisti del periodo non hanno il prezzo.", basis);
    const notes: string[] = [];
    if (priced.length < selected.length) notes.push(`${plural(selected.length - priced.length, "acquisto senza prezzo non è contato", "acquisti senza prezzo non sono contati")}.`);
    const uncategorized = all.filter((l) => groupOfCategory(l.category) === undefined).length;
    if (group !== "all" && uncategorized > 0) {
      notes.push(`${plural(uncategorized, "acquisto senza categoria non rientra", "acquisti senza categoria non rientrano")} in nessun gruppo.`);
    }
    return {
      kind: "number",
      value: sumCents(priced) / 100,
      unit: "€",
      digits: 2,
      certainty: priceCertainty(priced),
      basis: `${plural(priced.length, "acquisto con prezzo", "acquisti con prezzo")} (${period.label})`,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  },
};

function spendRows(key: (l: Lot) => string): QueryDef["run"] {
  return (p, ctx) => {
    const period = periodOf(p, ctx);
    const priced = purchasesIn(ctx, period).filter((l) => l.priceCents !== undefined);
    const basis = `${plural(priced.length, "acquisto con prezzo", "acquisti con prezzo")} (${period.label})`;
    if (priced.length === 0) return insufficient("Nessun acquisto con prezzo nel periodo.", basis);
    const sums = new Map<string, { cents: number; lots: Lot[] }>();
    for (const l of priced) {
      const k = key(l);
      const cur = sums.get(k) ?? { cents: 0, lots: [] };
      cur.cents += l.priceCents ?? 0;
      cur.lots.push(l);
      sums.set(k, cur);
    }
    const total = [...sums.values()].reduce((s, v) => s + v.cents, 0);
    const rows = [...sums.entries()]
      .sort((a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0]))
      .slice(0, limitOf(p))
      .map(([k, v]) => ({
        label: k,
        valueText: formatCents(v.cents),
        share: total > 0 ? v.cents / total : 0,
        detail: plural(v.lots.length, "acquisto", "acquisti"),
        certainty: priceCertainty(v.lots),
      }));
    return { kind: "rows", rows, basis };
  };
}

const spendByStore: QueryDef = {
  name: "spend_by_store",
  description: "Spesa del periodo divisa per negozio, dal più caro al meno caro.",
  params: { period: periodParam(), limit: limitParam() },
  result: "rows",
  needsNutrition: false,
  caption: () => "Spesa per negozio",
  run: spendRows((l) => l.store?.trim() || "Negozio non indicato"),
};

const UNCATEGORIZED = "Senza categoria";

const spendByCategory: QueryDef = {
  name: "spend_by_category",
  description: "Spesa del periodo divisa per gruppo di alimenti (latticini, frutta, carne...), dal più caro al meno caro.",
  params: { period: periodParam(), limit: limitParam() },
  result: "rows",
  needsNutrition: false,
  caption: () => "Spesa per categoria",
  run: spendRows((l) => {
    const g = groupOfCategory(l.category);
    return g ? CATEGORY_GROUPS[g].label : UNCATEGORIZED;
  }),
};

const spendOverTime: QueryDef = {
  name: "spend_over_time",
  description: "Spesa nel tempo: giorno per giorno (fino a 31 giorni) o settimana per settimana. Per un grafico.",
  params: { period: periodParam() },
  result: "series",
  needsNutrition: false,
  caption: () => "Spesa nel tempo",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    const tz = ctx.diary.timeZone;
    const priced = purchasesIn(ctx, period).filter((l) => l.priceCents !== undefined);
    const basis = `${plural(priced.length, "acquisto con prezzo", "acquisti con prezzo")} (${period.label})`;
    if (priced.length === 0 || period.days < 2) return insufficient("Dati insufficienti: servono acquisti con prezzo su un periodo di almeno 2 giorni.", basis);
    const bucket = bucketOf(period);
    // un giorno (o una settimana) senza acquisti con prezzo è una lacuna, non una spesa di zero euro
    const totals = new Array<number | null>(bucket.count).fill(null);
    for (const l of priced) {
      const date = localDate(l.createdAt, tz);
      if (!date) continue;
      const i = bucket.index(date);
      totals[i] = (totals[i] ?? 0) + (l.priceCents ?? 0);
    }
    return {
      kind: "series",
      points: totals.map((cents, i) => ({ label: shortDate(bucket.start(i)), value: cents === null ? null : cents / 100 })),
      unit: "€",
      digits: 2,
      certainty: priceCertainty(priced),
      basis,
      note: `${bucket.count < period.days ? "Ogni punto è una settimana, dal giorno indicato. " : ""}Dove la linea si interrompe non ci sono acquisti con prezzo.`,
    };
  },
};

const pantryValue: QueryDef = {
  name: "pantry_value",
  description: "Valore stimato di ciò che c'è ora in dispensa (prezzo in proporzione a quanto resta), solo per i prodotti con prezzo.",
  params: {},
  result: "number",
  needsNutrition: false,
  caption: () => "Valore della dispensa",
  run(_p, ctx) {
    const v = estimatedPantryValue(ctx.pantry);
    if (v.lotsWithPrice === 0) return insufficient("Nessun prodotto in dispensa ha un prezzo.");
    return {
      kind: "number",
      value: v.cents / 100,
      unit: "€",
      digits: 2,
      certainty: v.certainty,
      basis: `${plural(v.lotsWithPrice, "prodotto con prezzo", "prodotti con prezzo")} in dispensa`,
      ...(v.lotsWithoutPrice > 0 ? { note: `${plural(v.lotsWithoutPrice, "prodotto senza prezzo non è contato", "prodotti senza prezzo non sono contati")}.` } : {}),
    };
  },
};

/** Senza scarti registrati non si può dire che non si sia buttato nulla: potrebbe solo non essere stato scritto. */
const NO_DISCARDS = "Nessuno scarto registrato nel periodo: non so se non hai buttato nulla o se non l'hai segnato.";

interface Discard {
  reason: string;
  unit: string;
  amount: number;
  cents: number | undefined;
  certainty: "measured" | "label" | "estimated";
}

/** Gli scarti del periodo; il costo è la parte di prezzo del lotto che corrisponde alla quantità buttata. */
function discardsIn(ctx: ViewContext, period: Period): Discard[] {
  const tz = ctx.diary.timeZone;
  const out: Discard[] = [];
  for (const lot of ctx.pantry.lots) {
    let wasted = 0;
    for (const h of lot.history) {
      if (h.type !== "discard" || h.reason === undefined) continue;
      const amount = -(h.quantityDelta ?? 0);
      if (amount <= 0) continue;
      const fraction = Math.min(amount / lot.initial, 1 - wasted);
      wasted += fraction;
      if (!inRange(localDate(h.at, tz), period)) continue;
      out.push({
        reason: h.reason,
        unit: lot.unit,
        amount,
        cents: lot.priceCents !== undefined ? lot.priceCents * fraction : undefined,
        certainty: worst([h.certainty, lot.priceCents !== undefined ? (lot.priceCertainty ?? "estimated") : undefined]) ?? h.certainty,
      });
    }
  }
  return out;
}

const wasteByReason: QueryDef = {
  name: "waste_by_reason",
  description: "Cosa è stato buttato nel periodo, diviso per motivo (scaduto, avanzato, non piaciuto, altro), con quantità e costo stimato.",
  params: { period: periodParam() },
  result: "rows",
  needsNutrition: false,
  caption: () => "Spreco per motivo",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    if (ctx.pantry.lots.length === 0) return insufficient("La dispensa non ha ancora registrazioni.");
    const items = discardsIn(ctx, period);
    const basis = `${plural(items.length, "scarto registrato", "scarti registrati")} (${period.label})`;
    if (items.length === 0) return insufficient(NO_DISCARDS, basis);
    const byReason = new Map<string, Discard[]>();
    for (const d of items) byReason.set(d.reason, [...(byReason.get(d.reason) ?? []), d]);
    const totalCents = items.reduce((s, d) => s + (d.cents ?? 0), 0);
    const rows = [...byReason.entries()]
      .map(([reason, list]) => {
        const cents = list.reduce((s, d) => s + (d.cents ?? 0), 0);
        const perUnit = new Map<string, number>();
        for (const d of list) perUnit.set(d.unit, (perUnit.get(d.unit) ?? 0) + d.amount);
        const priced = list.filter((d) => d.cents !== undefined).length;
        return {
          cents,
          row: {
            label: DISCARD_REASON_LABELS[reason] ?? reason,
            valueText: [...perUnit.entries()].map(([u, v]) => formatQty(v, u)).join(" · "),
            ...(totalCents > 0 ? { share: cents / totalCents } : {}),
            detail: priced > 0 ? `circa ${formatCents(cents)}${priced < list.length ? " (alcuni senza prezzo)" : ""}` : "senza prezzo",
            certainty: worst(list.map((d) => d.certainty)),
          },
        };
      })
      .sort((a, b) => b.cents - a.cents)
      .map((r) => r.row);
    return { kind: "rows", rows, basis };
  },
};

const wasteCost: QueryDef = {
  name: "waste_cost",
  description: "Costo stimato di ciò che è stato buttato nel periodo (parte del prezzo corrispondente alla quantità scartata).",
  params: { period: periodParam() },
  result: "number",
  needsNutrition: false,
  caption: () => "Costo dello spreco",
  run(p, ctx) {
    const period = periodOf(p, ctx);
    if (ctx.pantry.lots.length === 0) return insufficient("La dispensa non ha ancora registrazioni.");
    const items = discardsIn(ctx, period);
    const basis = `${plural(items.length, "scarto registrato", "scarti registrati")} (${period.label})`;
    if (items.length === 0) return insufficient(NO_DISCARDS, basis);
    const priced = items.filter((d) => d.cents !== undefined);
    if (priced.length === 0) return insufficient("Gli scarti del periodo non hanno un prezzo: non posso stimare il costo.", basis);
    return {
      kind: "number",
      value: Math.round(priced.reduce((s, d) => s + (d.cents ?? 0), 0)) / 100,
      unit: "€",
      digits: 2,
      certainty: worst(priced.map((d) => d.certainty)),
      basis,
      ...(priced.length < items.length ? { note: `${plural(items.length - priced.length, "scarto senza prezzo non è contato", "scarti senza prezzo non sono contati")}.` } : {}),
    };
  },
};

export const MONEY_QUERIES: readonly QueryDef[] = [spendTotal, spendByStore, spendByCategory, spendOverTime, pantryValue, wasteByReason, wasteCost];
