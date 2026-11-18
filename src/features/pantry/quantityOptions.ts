// Le pastiglie del selettore di quantità nella scheda di un alimento, la scelta con cui si apre e che cosa vuol dire
// ogni scelta per il registro. Logica pura.
import type { Lot, Unit } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import type { AmountChoice } from "../actions";
import type { QuantityOption, QuantityValue } from "../common";
import { pieceChoices } from "../pieces";
import type { RememberedPortion } from "../portions";

export interface LotQuantityOption extends QuantityOption {
  /** Come la scelta si legge sul pulsante, dopo «Mangiato · »: «150 g», «Una piadina», «tutte (3)». */
  summary: string;
}

export interface QuantityChoices {
  options: LotQuantityOption[];
  /** La scelta con cui si apre il selettore; `null` se va fatta a mano. */
  initial: QuantityValue | null;
}

const EPSILON = 1e-9;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Le pastiglie per un alimento, nell'ordine: «Il solito», i pezzi (o «1 pz», «2 pz»), le confezioni di un gruppo,
 * «~Metà», «Tutto». Due pastiglie con la stessa quantità diventano una: resta la prima.
 * `group` sono le confezioni uguali (almeno due) di cui `lot` fa parte; vuoto se è solo.
 * Si parte da «Il solito», altrimenti da un pezzo; mai da «Tutto», «Tutte» o «1 confezione» in quanto tali, e nemmeno
 * da un «solito» che vale quanto tutto il rimasto (in un gruppo: di tutte le confezioni): quello si mostra, ma lo
 * sceglie chi usa l'app. In un gruppo «Il solito» che vale una confezione parte già scelto: è ciò che si è fatto l'ultima volta.
 */
export function quantityOptions({ lot, group = [], usual }: { lot: Lot; group?: readonly Lot[]; usual?: RememberedPortion }): QuantityChoices {
  if (!(lot.remaining > 0)) return { options: [], initial: null };
  const unit = lot.unit;
  const text = (value: number): string => formatQuantity({ value, unit });
  const found: LotQuantityOption[] = [];
  const total = round3((group.length > 1 ? group : [lot]).reduce((sum, member) => sum + member.remaining, 0));

  if (usual && usual.unit === unit && usual.value > 0 && usual.value <= lot.remaining + EPSILON) {
    const shown = `${usual.estimated ? "~" : ""}${text(usual.value)}`;
    found.push({ id: "usual", label: `Il solito (${shown})`, value: usual.value, ...(usual.estimated ? { estimated: true } : {}), summary: shown });
  }

  const pieces = pieceChoices(lot);
  const half = pieces.find((p) => p.id === "pieces-half");
  for (const p of [...pieces.filter((p) => p.id !== "pieces-half").slice(0, 2), ...(half ? [half] : [])]) {
    found.push({ id: p.id, label: p.short, value: p.quantity.value, estimated: p.estimated, summary: p.short });
  }

  if (unit === "pz" && pieces.length === 0) {
    for (const count of [1, 2]) {
      if (lot.remaining >= count) found.push({ id: `count-${count}`, label: text(count), value: count, summary: text(count) });
    }
  }

  if (group.length > 1) {
    found.push({ id: "pack-one", label: "1 confezione", value: lot.remaining, summary: "1 confezione" });
    found.push({ id: "pack-all", label: `Tutte (${group.length})`, value: total, summary: `tutte (${group.length})` });
  } else {
    // la stessa metà che scrive il registro (`resolveAmount`, scelta `half`)
    const halfValue = round2(lot.remaining / 2);
    if (unit !== "pz" && halfValue > 0 && halfValue < lot.remaining) {
      found.push({ id: "half", label: `~Metà (${text(halfValue)})`, value: halfValue, estimated: true, summary: `~${text(halfValue)}` });
    }
    found.push({ id: "all", label: `Tutto (${text(lot.remaining)})`, value: lot.remaining, summary: text(lot.remaining) });
  }

  const options: LotQuantityOption[] = [];
  for (const option of found) {
    if (!options.some((kept) => Math.abs(kept.value - option.value) <= EPSILON)) options.push(option);
  }

  // un pezzo che coincide con «Il solito» è sparito come doppione: non si ripiega sul pezzo dopo
  const firstPiece = found.find((o) => o.id.startsWith("pieces-"));
  const start =
    options.find((o) => o.id === "usual" && o.value < total - EPSILON) ??
    (firstPiece && options.includes(firstPiece) ? firstPiece : undefined) ??
    (unit === "pz" ? options.find((o) => o.id === "count-1") : undefined);
  return {
    options,
    initial: start ? { value: start.value, estimated: start.estimated ?? false, optionId: start.id } : null,
  };
}

/** Su quali confezioni agisce una scelta, e quanto: tutte quelle del gruppo, o solo quella scelta. */
export function amountFor(value: QuantityValue): { target: "lot" | "group"; choice: AmountChoice } {
  switch (value.optionId) {
    case "pack-all":
      return { target: "group", choice: { kind: "all" } };
    case "pack-one":
    case "all":
      return { target: "lot", choice: { kind: "all" } };
    case "half":
      return { target: "lot", choice: { kind: "half" } };
    default:
      return { target: "lot", choice: { kind: "value", value: value.value, estimated: value.estimated } };
  }
}

/**
 * Se ciò che si è appena mangiato è una porzione da riproporre come «Il solito»: le quantità scelte apposta (scritte a
 * mano, pezzi, «1 pz», il solito di prima) e «1 confezione». «Tutto», «Tutte» e «~Metà» dipendono dalla confezione,
 * non da quanto si mangia di solito. «1 confezione» vale solo se la confezione era intatta (una da una porzione, come
 * uno yogurt): chi chiama lo controlla, perché una confezione già cominciata dà una quantità che non è una porzione.
 */
export function remembersPortion(value: QuantityValue): boolean {
  return !["all", "pack-all", "half"].includes(value.optionId ?? "");
}

/** Il testo del pulsante: «Mangiato · 150 g», «Mangiato · Una piadina», «Mangiato · tutte (3)»; senza scelta solo il verbo. */
export function amountLabel(verb: string, value: QuantityValue | null, options: readonly LotQuantityOption[], unit: Unit): string {
  if (value === null) return verb;
  const option = options.find((o) => o.id === value.optionId);
  return `${verb} · ${option ? option.summary : formatQuantity({ value: value.value, unit }, { estimated: value.estimated })}`;
}
