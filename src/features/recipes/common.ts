// Pezzi comuni del ricettario: testo, tempi, indirizzi della fonte. Logica pura.
import type { IdGenerator } from "@/core/ledger";
import type { Quantity, RecipeIngredient } from "@/core/recipes";
import { formatQuantity } from "@/core/units";

/** Contesto di scrittura: istante, dispositivo e (nei test) il generatore di id. */
export interface EventCtx {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

/** Minuscolo, senza accenti né spazi doppi: per le ricerche. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** "45 min", "1 h", "1 h 20 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** "1 porzione", "4 porzioni". Le mezze porzioni si scrivono con la virgola. */
export function formatServings(n: number): string {
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ",");
  return n === 1 ? "1 porzione" : `${text} porzioni`;
}

/** "200 g" oppure "q.b." quando la quantità non è scritta. */
export function quantityText(q: Quantity | undefined): string {
  return q ? formatQuantity(q) : "q.b.";
}

/** Riga di un ingrediente per l'elenco: "200 g farina 00 (setacciata)". */
export function ingredientLine(ing: Pick<RecipeIngredient, "name" | "quantity" | "note">): string {
  const head = ing.quantity ? `${formatQuantity(ing.quantity)} ${ing.name}` : ing.name;
  return ing.note ? `${head} (${ing.note})` : head;
}

/**
 * Indirizzo `http` o `https` da mostrare come collegamento, altrimenti `undefined`.
 * Qualunque altro schema (`javascript:`, `data:`) non diventa mai un link.
 */
export function safeSourceUrl(url: string | undefined): { href: string; host: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username !== "" || u.password !== "") return undefined;
    return { href: u.href, host: u.hostname.replace(/^www\./, "") };
  } catch {
    return undefined;
  }
}

/** Divide un testo scritto a mano in voci: virgola, punto e virgola o a capo. Senza doppioni né voci vuote. */
export function splitList(text: string, max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;\n]/)) {
    const v = part.replace(/\s+/g, " ").trim().slice(0, 80);
    if (v === "") continue;
    const key = fold(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export const NO_NUMBER = "Scrivi un numero.";
