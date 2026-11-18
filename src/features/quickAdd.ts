// «Più alimenti»: un alimento per riga ("latte 1 l", "6 uova", "pasta 500 g, credenza"). Logica pura.
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
  /** Luogo o categoria vengono dalla memoria per nome: «come l'ultima volta». */
  fromMemory?: boolean;
  /** Perché la riga non è stata letta. */
  error?: string;
}

export interface QuickOverrides {
  category?: string;
  location?: Location;
}

/** Ciò che si ricorda di un nome (la memoria per nome, `memory/itemDefaults.ts`): la riga lo usa per ciò che non dice. */
export interface QuickRemembered {
  category?: string;
  location?: Location;
}

/** Da dove vengono gli alimenti: appena comprati (acquisti di oggi) o già in casa (senza prezzo, quantità stimate). */
export type QuickMode = "bought" | "had";

/** Impostazione che ricorda l'ultima scelta. */
export const QUICK_MODE_KEY = "quickAdd.mode";

export const isQuickMode = (value: unknown): value is QuickMode => value === "bought" || value === "had";

/** La scelta di partenza: quella ricordata; la prima volta «Già in casa» se la dispensa è vuota (è il primo riempimento). */
export function initialQuickMode(stored: unknown, pantryEmpty: boolean): QuickMode {
  if (isQuickMode(stored)) return stored;
  return pantryEmpty ? "had" : "bought";
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

/** Le parti di una riga separate da virgole; una virgola tra due cifre è un decimale («latte 1,5 l») e non separa. */
function splitSegments(line: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "," || (/\d/.test(line[i - 1] ?? "") && /\d/.test(line[i + 1] ?? ""))) continue;
    out.push(line.slice(from, i));
    from = i + 1;
  }
  out.push(line.slice(from));
  return out.map((s) => s.trim());
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
 * `remembered` dà, per un nome, luogo e categoria dell'ultima volta: valgono per ciò che la riga non dice
 * (ciò che è scritto e le correzioni vincono), prima della regola per categoria.
 */
export function parseQuickLines(
  text: string,
  options: {
    modelCategoryOf?: (name: string) => string | undefined;
    overrides?: ReadonlyMap<string, QuickOverrides>;
    remembered?: (name: string) => QuickRemembered | undefined;
  } = {},
): QuickRow[] {
  const rows: QuickRow[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const segments = splitSegments(line);
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
    const remembered = options.remembered?.(split.name);
    const chosen = override?.category;
    const recalled = remembered?.category;
    const rememberedCategory = isFoodCategory(recalled) ? recalled : undefined;
    const categoryFromMemory = !(chosen !== undefined && isFoodCategory(chosen)) && rememberedCategory !== undefined;
    const category: FoodCategory | undefined =
      chosen !== undefined && isFoodCategory(chosen)
        ? chosen
        : (rememberedCategory ?? suggestCategory(split.name, options.modelCategoryOf?.(split.name)));
    const locationFromMemory = override?.location === undefined && location === undefined && remembered?.location !== undefined;
    const finalLocation = override?.location ?? location ?? remembered?.location ?? (category ? defaultLocation(category) : "frigo");
    rows.push({
      index,
      line,
      status: category ? "ok" : "needs_category",
      name: split.name,
      quantity: split.quantity,
      category,
      location: finalLocation,
      locationFromText: override?.location === undefined && location !== undefined,
      ...(categoryFromMemory || locationFromMemory ? { fromMemory: true } : {}),
    });
  });
  return rows;
}

export function overrideKey(index: number, line: string): string {
  return `${index}:${line}`;
}

export interface QuickSave {
  events: LedgerEvent[];
  /** Righe scritte. */
  saved: QuickRow[];
  /** Righe non salvate: non lette, senza categoria o rifiutate dal modulo di cattura. */
  skipped: QuickRow[];
}

/**
 * Ogni riga valida diventa un evento, come nel modulo a mano. «Già in casa» (`alreadyHave`, il valore se non si passa
 * niente): un `declare`, senza prezzo e con quantità stimata. «Appena comprati»: un `purchase` di adesso, senza prezzo.
 */
export function buildQuickEvents(rows: readonly QuickRow[], ctx: CaptureContext, options: { alreadyHave?: boolean } = {}): QuickSave {
  const alreadyHave = options.alreadyHave ?? true;
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
        alreadyHave,
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

/** L'avviso dopo «Aggiungi alla dispensa»: quanti alimenti sono entrati e, se ci sono, le righe rimaste nel campo. */
export function quickAddedMessage(saved: number, left: readonly Pick<QuickRow, "status">[] = []): string {
  const head = saved === 1 ? "Aggiunto alla dispensa: 1 alimento." : `Aggiunti alla dispensa: ${saved} alimenti.`;
  if (left.length === 0) return head;
  const count = (status: QuickRowStatus) => left.filter((r) => r.status === status).length;
  const rows = (n: number, single: string, plural: string) => (n === 1 ? `1 riga ${single}` : `${n} righe ${plural}`);
  const parts = [
    count("unreadable") > 0 ? rows(count("unreadable"), "non letta", "non lette") : "",
    count("needs_category") > 0 ? rows(count("needs_category"), "senza categoria", "senza categoria") : "",
    count("ok") > 0 ? rows(count("ok"), "non salvata", "non salvate") : "",
  ].filter((p) => p !== "");
  return `${head} ${parts.join(", ")}: ${left.length === 1 ? "è rimasta" : "sono rimaste"} nel campo.`;
}

/**
 * La memoria per nome com'era prima di una scrittura, per le sole chiavi che quella scrittura ha toccato: le voci
 * ricordate dopo per altri nomi restano. Serve all'«Annulla».
 */
export function restoreRemembered(current: unknown, before: unknown, keys: readonly string[]): Record<string, unknown> {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const out: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const key of keys) {
    if (isRecord(before) && Object.hasOwn(before, key)) out[key] = before[key];
    else delete out[key];
  }
  return out;
}
