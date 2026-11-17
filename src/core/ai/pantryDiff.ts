// Dalle risposte del modello alle differenze da confermare una per una. Nessuna scrive niente: sono proposte e domande.
// Regola fissa: «non visto» non diventa mai «assente». Solo uno stato «assente» dichiarato con buona certezza porta a «probabilmente finito».
import { LOCATION_NAMES, type ExpectedLot, type PantryScan, type ScanUnit } from "./pantryScan";
import { foodKey, usualZone, zoneRank, zoneLabel, ZONES, type ScanLocation, type ZoneMap } from "./zones";

export type DiffKind = "quantity_changed" | "probably_finished" | "unexpected_item" | "expiry_differs" | "use_soon";

/** Cosa succede se l'utente conferma. */
export type DiffChange =
  | { type: "adjust"; remaining: { value: number; unit: ScanUnit } }
  | { type: "declare"; name: string; quantity: { value: number; unit: ScanUnit }; quantityGuessed: boolean }
  | { type: "expiry"; expiry: { date: string; kind: "use_by" | "best_before" | "estimated" }; registered?: string }
  /** Solo un avviso: il lotto ha una data d'etichetta e una stima visiva non la sostituisce. Non scrive nulla da sola. */
  | { type: "notice"; labelDate: string; labelKind: "use_by" | "best_before" };

export interface Difference {
  /** Stabile nella schermata. */
  key: string;
  kind: DiffKind;
  /** `proposal`: la certezza basta per proporlo. `question`: sotto la soglia, si chiede all'utente. */
  mode: "proposal" | "question";
  /** Identificativo corto del lotto atteso; assente per gli elementi inattesi. */
  lotId?: string;
  name: string;
  /** Da 0 a 1. */
  confidence: number;
  /** Perché, in una frase. */
  reason: string;
  /** Solo per le domande. */
  question?: string;
  confirmLabel: string;
  declineLabel: string;
  zone?: string;
  /** Chiave dell'alimento per la mappa delle zone. */
  food: string;
  change: DiffChange;
}

export interface Thresholds {
  /** Da questa certezza in su la differenza è una proposta; sotto, una domanda. */
  propose: number;
  /** Sotto questa certezza la differenza si scarta: sarebbe solo rumore. */
  floor: number;
  /** Variazione minima della quantità, in parte della quantità iniziale, perché valga la pena proporla. */
  quantityChange: number;
  /** Frazione piena sotto cui il contenitore si considera vuoto. */
  empty: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { propose: 0.75, floor: 0.3, quantityChange: 0.2, empty: 0.05 };

/** Giorni da oggi per una scadenza «da consumare presto» stimata dalla foto. */
export const USE_SOON_DAYS = 2;

export interface DiffContext {
  location: ScanLocation;
  /** `YYYY-MM-DD` */
  today: string;
  thresholds?: Partial<Thresholds>;
}

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** "20 nov 2026" da `YYYY-MM-DD`. */
export function formatDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : date;
}

export function formatAmount(value: number, unit: ScanUnit): string {
  const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
  if (unit === "pz") return `${num(value)} pz`;
  if (value >= 1000) return `${num(value / 1000)} ${unit === "g" ? "kg" : "l"}`;
  return `${num(value)} ${unit}`;
}

/** `YYYY-MM-DD` più `days` giorni (anche negativi). */
export function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function matchesExpected(name: string, expected: readonly ExpectedLot[]): boolean {
  const n = fold(name);
  if (n.length < 4) return false;
  return expected.some((e) => {
    const m = fold(e.name);
    return m.length >= 4 && (m === n || m.includes(n) || n.includes(m));
  });
}

function mode(confidence: number, t: Thresholds): "proposal" | "question" {
  return confidence >= t.propose ? "proposal" : "question";
}

/** Una quantità proposta: a passi del 5% dell'iniziale, e interi per i pezzi. */
function proposedRemaining(fraction: number, lot: ExpectedLot): { value: number; unit: ScanUnit } {
  const stepped = (Math.round(fraction * 20) / 20) * lot.initial;
  const value = lot.remaining.unit === "pz" ? Math.round(stepped) : Math.round(stepped * 100) / 100;
  return { value: Math.min(Math.max(value, 0), lot.initial), unit: lot.remaining.unit };
}

/** Differenze proposte dalla lettura. Non scrive nulla. */
export function diffScan(scan: PantryScan, expected: readonly ExpectedLot[], context: DiffContext): Difference[] {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...context.thresholds };
  const byId = new Map(expected.map((e) => [e.id, e]));
  const out: Difference[] = [];
  const where = LOCATION_NAMES[context.location];

  for (const r of scan.lots) {
    const lot = byId.get(r.id);
    if (!lot) continue;
    const food = foodKey(lot.name, lot.category);
    const base = { lotId: lot.id, name: lot.name, food, ...(r.zone ? { zone: r.zone } : {}) };

    // «non visto» non produce mai nulla: non si sa se c'è
    if (r.status === "not_seen") continue;

    if (r.status === "absent") {
      if (r.confidence < t.floor) continue;
      out.push({
        ...base,
        key: `${lot.id}:finished`,
        kind: "probably_finished",
        mode: mode(r.confidence, t),
        confidence: r.confidence,
        reason: `Guardando dove dovrebbe stare, non lo vedo. Il registro dice che ne restano ${formatAmount(lot.remaining.value, lot.remaining.unit)}.`,
        question: `C'è ancora ${lot.name}?`,
        confirmLabel: "No, è finito",
        declineLabel: "Sì, c'è ancora",
        change: { type: "adjust", remaining: { value: 0, unit: lot.remaining.unit } },
      });
      continue;
    }

    // visto
    if (r.level && r.level.confidence >= t.floor) {
      if (r.level.fraction <= t.empty) {
        out.push({
          ...base,
          key: `${lot.id}:finished`,
          kind: "probably_finished",
          mode: mode(r.level.confidence, t),
          confidence: r.level.confidence,
          reason: "Il contenitore sembra vuoto.",
          question: `${lot.name} è finito?`,
          confirmLabel: "Sì, è finito",
          declineLabel: "No",
          change: { type: "adjust", remaining: { value: 0, unit: lot.remaining.unit } },
        });
      } else if (lot.initial > 0) {
        const proposed = proposedRemaining(r.level.fraction, lot);
        if (Math.abs(proposed.value - lot.remaining.value) / lot.initial >= t.quantityChange) {
          out.push({
            ...base,
            key: `${lot.id}:quantity`,
            kind: "quantity_changed",
            mode: mode(r.level.confidence, t),
            confidence: r.level.confidence,
            reason: `Nel registro restano ${formatAmount(lot.remaining.value, lot.remaining.unit)}; dalla foto ne vedo circa ${formatAmount(proposed.value, proposed.unit)}.`,
            question: `Di ${lot.name} ne resta circa ${formatAmount(proposed.value, proposed.unit)}?`,
            confirmLabel: `Sì, circa ${formatAmount(proposed.value, proposed.unit)}`,
            declineLabel: "No, lascia com'è",
            change: { type: "adjust", remaining: proposed },
          });
        }
      }
    }

    // scadenza: al più una proposta per lotto, la più prudente (la data più vicina)
    const expiryDiffs: Difference[] = [];
    if (r.expiry && r.expiry.confidence >= t.floor && r.expiry.date !== lot.expiry?.date) {
      const kind = r.expiry.kind ?? (lot.expiry && lot.expiry.kind !== "estimated" ? lot.expiry.kind : "best_before");
      expiryDiffs.push({
        ...base,
        key: `${lot.id}:expiry`,
        kind: "expiry_differs",
        mode: mode(r.expiry.confidence, t),
        confidence: r.expiry.confidence,
        reason: lot.expiry
          ? `Sull'etichetta leggo ${formatDay(r.expiry.date)}; nel registro c'è ${formatDay(lot.expiry.date)}.`
          : `Sull'etichetta leggo ${formatDay(r.expiry.date)}; nel registro non c'è una scadenza.`,
        question: `La scadenza di ${lot.name} è ${formatDay(r.expiry.date)}?`,
        confirmLabel: `Sì, ${formatDay(r.expiry.date)}`,
        declineLabel: "No, lascia com'è",
        change: { type: "expiry", expiry: { date: r.expiry.date, kind }, ...(lot.expiry ? { registered: lot.expiry.date } : {}) },
      });
    }
    if (r.freshness && r.freshness.state !== "good" && r.freshness.confidence >= t.floor) {
      const discard = r.freshness.state === "discard";
      const date = discard ? context.today : addDaysTo(context.today, USE_SOON_DAYS);
      const label = lot.expiry && lot.expiry.kind !== "estimated" ? { date: lot.expiry.date, kind: lot.expiry.kind } : undefined;
      if (label) {
        // una data d'etichetta non si tocca con una stima visiva: solo un avviso, con le azioni di sempre (mangiato, buttato)
        out.push({
          ...base,
          key: `${lot.id}:soon`,
          kind: "use_soon",
          mode: "proposal",
          confidence: r.freshness.confidence,
          reason: `${discard ? "Dalla foto sembra rovinato" : "Dalla foto sembra da consumare presto"}: la data in etichetta è ${formatDay(label.date)}. È solo un'impressione, non un parere sulla sicurezza: giudica tu. Non cambio la data.`,
          question: discard ? `${lot.name} ti sembra da buttare?` : `${lot.name} ti sembra da consumare presto?`,
          confirmLabel: "Ho capito",
          declineLabel: "Ho capito",
          change: { type: "notice", labelDate: label.date, labelKind: label.kind },
        });
      } else if (!lot.expiry || lot.expiry.date > date) {
        // senza data d'etichetta (o con una già stimata) si scrive solo una stima più vicina: mai più in là di quella che c'è
        expiryDiffs.push({
          ...base,
          key: `${lot.id}:soon`,
          kind: "use_soon",
          mode: mode(r.freshness.confidence, t),
          confidence: r.freshness.confidence,
          reason: discard
            ? "Dalla foto sembra rovinato. È solo un'impressione, non un parere sulla sicurezza: giudica tu."
            : "Dalla foto sembra da consumare presto. È solo un'impressione: giudica tu.",
          question: discard ? `${lot.name} ti sembra da buttare?` : `${lot.name} ti sembra da consumare presto?`,
          confirmLabel: discard ? "Sì, segna scadenza oggi" : `Sì, entro ${formatDay(date)}`,
          declineLabel: "No",
          change: { type: "expiry", expiry: { date, kind: "estimated" }, ...(lot.expiry ? { registered: lot.expiry.date } : {}) },
        });
      }
    }
    if (expiryDiffs.length > 0) {
      expiryDiffs.sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.kind === "expiry_differs" ? -1 : 1));
      out.push(expiryDiffs[0]);
    }
  }

  scan.unexpected.forEach((u, i) => {
    if (u.confidence < t.floor) return;
    // se somiglia a un lotto atteso potrebbe essere lo stesso: si chiede, non si propone
    const confidence = matchesExpected(u.name, expected) ? Math.min(u.confidence, t.propose - 0.01) : u.confidence;
    const quantity = u.quantity ?? { value: 1, unit: "pz" as const };
    out.push({
      key: `new:${i}`,
      kind: "unexpected_item",
      mode: mode(confidence, t),
      name: u.name,
      confidence,
      reason: `Lo vedo in ${where} ma non è nel registro${u.quantity ? "" : "; la quantità non si capisce, parto da 1 pezzo"}.`,
      question: `Vedo ${u.name}: ce l'hai in ${where}?`,
      confirmLabel: "Sì, aggiungilo",
      declineLabel: "No",
      ...(u.zone ? { zone: u.zone } : {}),
      food: foodKey(u.name),
      change: { type: "declare", name: u.name, quantity, quantityGuessed: u.quantity === undefined },
    });
  });

  return out;
}

const dateOf = (d: Difference) => (d.change.type === "expiry" ? d.change.expiry.date : "9999-12-31");

const KIND_ORDER: Record<DiffKind, number> = { probably_finished: 0, quantity_changed: 1, expiry_differs: 2, use_soon: 3, unexpected_item: 4 };

/**
 * Prima le proposte (per genere), poi le domande raggruppate per zona nell'ordine in cui si guarda l'elettrodomestico:
 * la zona è quella in cui l'alimento sta di solito, o altrimenti quella vista nella foto.
 */
export function orderDifferences(diffs: readonly Difference[], location: ScanLocation, zoneMap: ZoneMap): Difference[] {
  const zoneOf = (d: Difference) => usualZone(zoneMap, location, d.food)?.zone ?? d.zone;
  return [...diffs].sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "proposal" ? -1 : 1;
    if (a.mode === "proposal") {
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.confidence - a.confidence || a.name.localeCompare(b.name, "it");
    }
    return zoneRank(location, zoneOf(a)) - zoneRank(location, zoneOf(b)) || b.confidence - a.confidence || a.name.localeCompare(b.name, "it");
  });
}

// ---------------------------------------------------------------- seconda foto

export interface SecondPhotoHint {
  /** Voci non viste su quelle attese. */
  unseen: number;
  total: number;
  zone?: string;
  text: string;
}

/** Quanti lotti non visti, in quota, fanno suggerire una seconda foto. */
export const SECOND_PHOTO_MIN_SHARE = 0.4;
export const SECOND_PHOTO_MIN_UNSEEN = 3;

/**
 * Se molte voci risultano non viste, suggerisce una foto mirata: alla zona dove, secondo la mappa, stanno di solito
 * i lotti non visti; se la mappa non dice nulla, a una parte che il modello ha dichiarato illeggibile; altrimenti una foto più completa.
 */
export function suggestSecondPhoto(
  scan: PantryScan,
  expected: readonly ExpectedLot[],
  options: { location: ScanLocation; zoneMap: ZoneMap },
): SecondPhotoHint | null {
  const unseen = scan.lots.filter((l) => l.status === "not_seen");
  if (unseen.length < SECOND_PHOTO_MIN_UNSEEN || expected.length === 0 || unseen.length / expected.length < SECOND_PHOTO_MIN_SHARE) return null;

  const byId = new Map(expected.map((e) => [e.id, e]));
  const perZone = new Map<string, number>();
  for (const r of unseen) {
    const lot = byId.get(r.id);
    if (!lot) continue;
    const usual = usualZone(options.zoneMap, options.location, foodKey(lot.name, lot.category));
    if (usual) perZone.set(usual.zone, (perZone.get(usual.zone) ?? 0) + 1);
  }
  const best = [...perZone.entries()].sort((a, b) => b[1] - a[1] || zoneRank(options.location, a[0]) - zoneRank(options.location, b[0]))[0];
  const counts = { unseen: unseen.length, total: expected.length };
  if (best && best[1] >= 2) {
    const def = ZONES[options.location].find((z) => z.key === best[0]);
    return {
      ...counts,
      zone: best[0],
      text: `Non ho visto ${unseen.length} voci su ${expected.length}. Mostra ${def?.show ?? zoneLabel(options.location, best[0]).toLowerCase()}: di solito lì ce ne sono ${best[1]}.`,
    };
  }
  if (scan.unreadable.length > 0) {
    return { ...counts, text: `Non ho visto ${unseen.length} voci su ${expected.length}. Prova con una foto più chiara di: ${scan.unreadable[0]}.` };
  }
  return {
    ...counts,
    text: `Non ho visto ${unseen.length} voci su ${expected.length}. Fai un'altra foto più da vicino, a porte aperte, mostrando i ripiani che prima restavano nascosti.`,
  };
}
