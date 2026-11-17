// Aggiunta rapida: un alimento per riga ("latte 1 l", "6 uova", "pasta 500 g, credenza"). Logica pura.
import { SHELF_LIFE, type FoodCategory } from "@/core/expiry";
import type { Location, Quantity } from "@/core/ledger";
import { parseQuantity } from "@/core/units";
import { buildCaptureEvents, cleanName, readQuantity, type CaptureContext } from "./capture";
import type { LedgerEvent } from "@/core/ledger";
import { suggestCategory } from "./labels";
import { isFoodCategory } from "./lots";

export type QuickRowStatus = "ok" | "needs_category" | "unreadable";

export interface QuickRow {
  /** Posizione tra le righe non vuote. */
  index: number;
  /** Testo della riga com'è stato scritto. */
  line: string;
  status: QuickRowStatus;
  name?: string;
  quantity?: Quantity;
  /** Categoria proposta dal nome (o scelta dall'utente tramite `overrides`). */
  category?: FoodCategory;
  location?: Location;
  /** Il luogo è stato scritto nella riga, non dedotto dalla categoria. */
  locationFromText?: boolean;
  /** Perché la riga non è stata letta. */
  error?: string;
}

export interface QuickOverrides {
  category?: string;
  location?: Location;
}

const LOCATION_WORDS: ReadonlyArray<readonly [RegExp, Location]> = [
  [/^(frigo|frigorifero)$/, "frigo"],
  [/^(freezer|congelatore|surgelati)$/, "freezer"],
  [/^(credenza|dispensa|armadio|scaffale)$/, "dispensa"],
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function locationOf(text: string): Location | undefined {
  const word = fold(text).replace(/^(?:in|nel|nella|al|alla|sul|sulla|nello)\s+/, "").replace(/^(?:il|la|lo)\s+/, "");
  return LOCATION_WORDS.find(([pattern]) => pattern.test(word))?.[1];
}

/** Luogo più probabile per una categoria: quello dove di solito sta. */
export function defaultLocation(category: FoodCategory): Location {
  if (category === "frozen_foods") return "freezer";
  if (category === "bread_fresh" || category === "bread_packaged" || category === "root_vegetables") return "dispensa";
  return SHELF_LIFE[category].pantryDays >= 30 ? "dispensa" : "frigo";
}

type Split = { name: string; quantity: Quantity } | { error: string };

const NUMBER_WORD = /^(mezzo|mezza|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b/;

/** Separa nome e quantità: "6 uova", "500 g di pasta", "latte 1 l", "uova 6". */
function splitNameAndQuantity(text: string): Split {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean === "") return { error: "Riga vuota." };
  const lower = fold(clean);

  if (/^\d/.test(lower) || NUMBER_WORD.test(lower)) {
    const parsed = parseQuantity(clean);
    if (parsed.ok && parsed.value.rest === "") return { error: "Manca il nome dell'alimento." };
    if (parsed.ok && parsed.value.rest !== "") {
      const quantity = readQuantity(clean);
      if (quantity.ok) return { name: cleanName(parsed.value.rest), quantity: quantity.quantity };
      return { error: quantity.error };
    }
  }

  const tokens = clean.split(" ");
  for (let i = 1; i < tokens.length; i++) {
    const candidate = tokens.slice(i).join(" ");
    if (!/^\d/.test(candidate)) continue;
    const parsed = parseQuantity(candidate);
    if (!parsed.ok || parsed.value.rest !== "") continue;
    const quantity = readQuantity(candidate);
    if (!quantity.ok) return { error: quantity.error };
    return { name: cleanName(tokens.slice(0, i).join(" ")), quantity: quantity.quantity };
  }
  return { error: "Manca la quantità: scrivi per esempio «latte 1 l» o «6 uova»." };
}

/**
 * Legge il testo riga per riga. `modelCategoryOf` (facoltativo) dà la categoria del primo modello del
 * catalogo per un nome: serve solo quando le parole non bastano a proporre una categoria.
 * `overrides` sono le correzioni dell'utente, per posizione e testo della riga.
 */
export function parseQuickLines(
  text: string,
  options: {
    modelCategoryOf?: (name: string) => string | undefined;
    overrides?: ReadonlyMap<string, QuickOverrides>;
  } = {},
): QuickRow[] {
  const rows: QuickRow[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const segments = line.split(",").map((s) => s.trim());
    let main = segments[0];
    let location: Location | undefined;
    for (const extra of segments.slice(1)) {
      location = locationOf(extra) ?? location;
    }
    // "latte 1 l in frigo" senza virgola
    const trailing = /\s(?:in|nel|nella|al|alla)\s+(frigo|frigorifero|freezer|congelatore|credenza|dispensa)$/i.exec(main);
    if (trailing) {
      location = locationOf(trailing[1]) ?? location;
      main = main.slice(0, trailing.index).trim();
    }

    const split = splitNameAndQuantity(main);
    if ("error" in split) {
      rows.push({ index, line, status: "unreadable", error: split.error });
      return;
    }
    const override = options.overrides?.get(overrideKey(index, line));
    const chosen = override?.category;
    const category: FoodCategory | undefined =
      chosen !== undefined && isFoodCategory(chosen)
        ? chosen
        : suggestCategory(split.name, options.modelCategoryOf?.(split.name));
    const finalLocation = override?.location ?? location ?? (category ? defaultLocation(category) : "frigo");
    rows.push({
      index,
      line,
      status: category ? "ok" : "needs_category",
      name: split.name,
      quantity: split.quantity,
      category,
      location: finalLocation,
      locationFromText: override?.location === undefined && location !== undefined,
    });
  });
  return rows;
}

export function overrideKey(index: number, line: string): string {
  return `${index}:${line}`;
}

export interface QuickSave {
  events: LedgerEvent[];
  /** Righe scritte come «già in casa». */
  saved: QuickRow[];
  /** Righe non salvate: non lette, senza categoria o rifiutate dal modulo di cattura. */
  skipped: QuickRow[];
}

/** Ogni riga valida diventa un `declare`: è ciò che c'era già in casa, senza prezzo e con quantità stimata. */
export function buildQuickEvents(rows: readonly QuickRow[], ctx: CaptureContext): QuickSave {
  const events: LedgerEvent[] = [];
  const saved: QuickRow[] = [];
  const skipped: QuickRow[] = [];
  for (const row of rows) {
    if (row.status !== "ok" || !row.name || !row.quantity || !row.category || !row.location) {
      skipped.push(row);
      continue;
    }
    const result = buildCaptureEvents(
      {
        name: row.name,
        quantityText: `${row.quantity.value} ${row.quantity.unit}`,
        location: row.location,
        category: row.category,
        expiryKind: "none",
        expiryDate: "",
        priceText: "",
        alreadyHave: true,
      },
      ctx,
    );
    if (result.ok) {
      events.push(...result.events);
      saved.push(row);
    } else skipped.push(row);
  }
  return { events, saved, skipped };
}
