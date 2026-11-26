// I testi dei «valori attuali» di Impostazioni e dei riassunti di Alimentazione. Funzioni pure: ogni testo dice solo ciò
// che si sa; dove non si sa, la funzione restituisce `undefined` e la riga resta senza valore.
import { daysBetween, MEAL_KINDS, type MealKind } from "@/core/diary";
import { DEFAULT_TIME_ZONE, toCalendarDate } from "@/core/expiry";
import { MODES, THEMES, type ThemeChoice } from "@/design/themes";
import type { ConfigIssue } from "../ai/settings";

const MEAL_NAMES: Record<MealKind, string> = { breakfast: "colazione", lunch: "pranzo", dinner: "cena", snack: "spuntino" };

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** «Donna, 42 anni» · «Non compilato». `age` è già quella di oggi. */
export function profileValue(profile: { sex: "female" | "male"; age: number } | null): string {
  if (profile === null) return "Non compilato";
  const who = profile.sex === "female" ? "Donna" : "Uomo";
  return `${who}, ${profile.age} ${plural(profile.age, "anno", "anni")}`;
}

/** Quante voci si elencano per nome prima di dire «e altri N». */
const NAMED = 3;

interface Voice {
  text: string;
}

/**
 * «Allergeni: latte, uova · 2 alimenti esclusi» · «Niente dichiarato». Con il controllo incompleto, «Da controllare»:
 * mai «Niente dichiarato» quando non si riesce a leggere tutto. `undefined` finché le dichiarazioni non sono lette.
 */
export function dietValue(state: { allergens: readonly Voice[]; excludedFoods: readonly Voice[]; complete: boolean } | undefined): string | undefined {
  if (state === undefined) return undefined;
  if (!state.complete) return "Da controllare";
  const parts: string[] = [];
  if (state.allergens.length > 0) {
    const names = state.allergens.map((v) => v.text);
    const shown = names.slice(0, NAMED).join(", ");
    const more = names.length - NAMED;
    parts.push(`Allergeni: ${more > 0 ? `${shown} e altri ${more}` : shown}`);
  }
  if (state.excludedFoods.length > 0) {
    const n = state.excludedFoods.length;
    parts.push(`${n} ${plural(n, "alimento escluso", "alimenti esclusi")}`);
  }
  return parts.length === 0 ? "Niente dichiarato" : parts.join(" · ");
}

const MODE_WORDS: Record<ThemeChoice["mode"], string> = { light: "chiaro", dark: "scuro", device: "automatico" };

/** «Vivo · scuro»: il nome del tema e la scelta tra chiaro e scuro. */
export function appearanceValue(choice: ThemeChoice): string {
  const theme = THEMES.find((t) => t.id === choice.theme)?.name ?? choice.theme;
  const mode = MODES.some((m) => m.id === choice.mode) ? MODE_WORDS[choice.mode] : MODE_WORDS.device;
  return `${theme} · ${mode}`;
}

/** «Chiave attiva» · «Da completare» (la chiave c'è, manca altro) · «Spenta» (nessuna chiave). */
export function aiValue(issue: ConfigIssue | null): string {
  if (issue === null) return "Chiave attiva";
  return issue === "missing_key" ? "Spenta" : "Da completare";
}

export const videoValue = (configured: boolean): string => (configured ? "Servizio impostato" : "Spento");

export const noticesValue = (enabled: boolean): string => (enabled ? "Accesi" : "Spenti");

export const habitsValue = (count: number): string => (count === 0 ? "Nessuno" : `${count} ${plural(count, "pasto", "pasti")}`);

/** Giorni dopo i quali si scrive la data («il 2 nov») invece di «N giorni fa». */
const RELATIVE_DAYS = 14;

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/**
 * «oggi», «ieri», «3 giorni fa», «il 2 nov» (con l'anno se non è quello di oggi) per un istante passato.
 * `undefined` se l'istante non si legge; un istante che sta nel futuro (orologio spostato) vale «oggi».
 */
export function whenAgo(instant: string, now: string, timeZone: string = DEFAULT_TIME_ZONE): string | undefined {
  if (Number.isNaN(Date.parse(instant)) || Number.isNaN(Date.parse(now))) return undefined;
  const day = toCalendarDate(instant, timeZone);
  const today = toCalendarDate(now, timeZone);
  const ago = daysBetween(day, today);
  if (ago <= 0) return "oggi";
  if (ago === 1) return "ieri";
  if (ago <= RELATIVE_DAYS) return `${ago} giorni fa`;
  const at = new Date(`${day}T12:00:00Z`);
  const text = (day.slice(0, 4) === today.slice(0, 4) ? DAY_MONTH : DAY_MONTH_YEAR).format(at).replace(/\./g, "");
  return `il ${text}`;
}

/** «Ultima copia: 3 giorni fa» · «Mai fatta». `undefined` se la data salvata non si legge. */
export function backupValue(lastExportAt: unknown, now: string): string | undefined {
  if (lastExportAt === undefined || lastExportAt === null) return "Mai fatta";
  if (typeof lastExportAt !== "string") return undefined;
  const when = whenAgo(lastExportAt, now);
  return when === undefined ? undefined : `Ultima copia: ${when}`;
}

/** Un'ultima sincronizzazione, com'è salvata: lo stato e l'istante in cui è finita. */
export interface SyncStamp {
  status: string;
  finishedAt: string;
}

/**
 * «Ultima: ieri» (l'ultima andata a buon fine) · «Spenta» (mai fatta). Se ci sono solo giri non riusciti, nessun valore:
 * non si sa dire niente di vero in una parola.
 */
export function syncValue(stamps: readonly (SyncStamp | undefined)[], now: string): string | undefined {
  const reports = stamps.filter((s): s is SyncStamp => s !== undefined);
  if (reports.length === 0) return "Spenta";
  const ok = reports.filter((s) => s.status === "ok" && !Number.isNaN(Date.parse(s.finishedAt)));
  if (ok.length === 0) return undefined;
  const last = ok.reduce((a, b) => (Date.parse(b.finishedAt) > Date.parse(a.finishedAt) ? b : a));
  const when = whenAgo(last.finishedAt, now);
  return when === undefined ? undefined : `Ultima: ${when}`;
}

/** «Eventi registrati: 12.» */
export const eventsText = (count: number): string => `Eventi registrati: ${count}.`;

/** «9 cose ricordate» · «Niente». */
export const memoriesValue = (count: number): string => (count === 0 ? "Niente" : count === 1 ? "1 cosa ricordata" : `${count} cose ricordate`);

// ---- Alimentazione: i riassunti delle tre righe richiuse ----

/** «2 tipi: allenamento, riposo» · «Nessun obiettivo». */
export function targetsSummary(dayTypes: readonly string[]): string {
  if (dayTypes.length === 0) return "Nessun obiettivo";
  return `${dayTypes.length} ${plural(dayTypes.length, "tipo", "tipi")}: ${dayTypes.join(", ")}`;
}

/** «8» · «8:30»: l'ora come si dice. */
function clockWords(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  const hours = String(Number(m[1]));
  return m[2] === "00" ? hours : `${hours}:${m[2]}`;
}

interface StructureLike {
  meals: readonly { kind: MealKind }[];
  eatingWindow?: { from?: string; to?: string } | undefined;
}

/** «Colazione, pranzo, cena · dalle 8 alle 20» · «Non impostati». */
export function structureSummary(structure: StructureLike | undefined): string {
  if (structure === undefined) return "Non impostati";
  const kinds = MEAL_KINDS.filter((k) => structure.meals.some((m) => m.kind === k));
  const names = kinds.map((k, i) => (i === 0 ? MEAL_NAMES[k][0].toUpperCase() + MEAL_NAMES[k].slice(1) : MEAL_NAMES[k])).join(", ");
  const from = structure.eatingWindow?.from?.trim();
  const to = structure.eatingWindow?.to?.trim();
  const window = from && to ? `dalle ${clockWords(from)} alle ${clockWords(to)}` : from ? `dalle ${clockWords(from)}` : to ? `fino alle ${clockWords(to)}` : "";
  const parts = [names, window].filter((p) => p !== "");
  return parts.length === 0 ? "Non impostati" : parts.join(" · ");
}

/** «3 ingredienti» · «Nessuno». */
export const confirmationsSummary = (count: number): string => (count === 0 ? "Nessuno" : `${count} ${plural(count, "ingrediente", "ingredienti")}`);

