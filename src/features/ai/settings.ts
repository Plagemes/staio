// Chiave e impostazioni dell'intelligenza artificiale. Tutto resta nell'archivio locale del dispositivo
// (tabella `settings`): non passa da indirizzi, non entra nelle copie di sicurezza (che contengono solo gli eventi),
// non viene scritto in nessun registro, e «Cancella tutti i dati» lo toglie con il resto.
import {
  addCall,
  emptyUsage,
  estimateCost,
  monthOf,
  normalizeBaseUrl,
  normalizePriceList,
  normalizeUsage,
  originOf,
  parseDecimal,
  priceOf,
  type AiUsage,
  type PriceList,
  type UsageCounter,
} from "@/core/ai";
import { getDb } from "@/data/db";
import { ANTHROPIC_BASE_URL, createAnthropicProvider } from "./providers/anthropic";
import { createOpenAiProvider, type TokenParam } from "./providers/openai";
import { PROVIDER_IDS, type AiProvider, type ProviderId } from "./providers/types";

export const AI_SETTINGS_KEY = "ai.settings";

/** Modello per la lettura e alternativa economica: valori iniziali, modificabili dall'utente. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_ANTHROPIC_CHEAP_MODEL = "claude-haiku-5-5";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface AnthropicSettings {
  apiKey: string;
  /** Modello per la lettura. */
  model: string;
  /** Alternativa più economica. */
  cheapModel: string;
  useCheapModel: boolean;
  workspaceId: string;
}

export interface OpenAiSettings {
  apiKey: string;
  /**
   * Origine (schema, dominio, porta) per cui la chiave è stata inserita. La chiave viene mandata solo lì:
   * se l'indirizzo del servizio cambia verso un'altra origine, la chiave salvata si scarta e va inserita di nuovo.
   */
  keyOrigin: string;
  baseUrl: string;
  model: string;
  tokenParam: TokenParam;
}

export interface AiSettings {
  provider: ProviderId;
  anthropic: AnthropicSettings;
  openai: OpenAiSettings;
  /** Tetto di spesa mensile, nella valuta del listino; null = nessun tetto. */
  monthlyCap: number | null;
  /** Etichetta della valuta del conto presso il fornitore (per esempio USD). */
  currency: string;
  /** Prezzi per milione di token, compilati dall'utente: all'inizio vuoto. */
  priceList: PriceList;
  usage: UsageCounter;
}

export function defaultAiSettings(month: string): AiSettings {
  return {
    provider: "anthropic",
    anthropic: {
      apiKey: "",
      model: DEFAULT_ANTHROPIC_MODEL,
      cheapModel: DEFAULT_ANTHROPIC_CHEAP_MODEL,
      useCheapModel: false,
      workspaceId: "",
    },
    openai: { apiKey: "", keyOrigin: "", baseUrl: DEFAULT_OPENAI_BASE_URL, model: "", tokenParam: "max_completion_tokens" },
    monthlyCap: null,
    currency: "USD",
    priceList: {},
    usage: emptyUsage(month),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** Ripulisce quello che c'è sul disco: un valore rovinato torna al valore iniziale, non lancia. */
export function normalizeSettings(raw: unknown, nowIso: string): AiSettings {
  const month = monthOf(nowIso);
  const d = defaultAiSettings(month);
  if (!isObj(raw)) return d;
  const a = isObj(raw.anthropic) ? raw.anthropic : {};
  const o = isObj(raw.openai) ? raw.openai : {};
  const cap = parseDecimal(raw.monthlyCap);
  const openaiBaseUrl = str(o.baseUrl, d.openai.baseUrl).trim();
  const openaiOrigin = originOf(openaiBaseUrl);
  const savedOrigin = str(o.keyOrigin, "");
  // la chiave vale solo per l'origine per cui è stata inserita: un altro dominio non la riceve mai
  const openaiKeyValid = openaiOrigin !== undefined && savedOrigin === openaiOrigin;
  return {
    provider: PROVIDER_IDS.includes(raw.provider as ProviderId) ? (raw.provider as ProviderId) : d.provider,
    anthropic: {
      apiKey: str(a.apiKey, "").trim(),
      model: str(a.model, d.anthropic.model).trim() || d.anthropic.model,
      cheapModel: str(a.cheapModel, d.anthropic.cheapModel).trim() || d.anthropic.cheapModel,
      useCheapModel: a.useCheapModel === true,
      workspaceId: str(a.workspaceId, "").trim(),
    },
    openai: {
      apiKey: openaiKeyValid ? str(o.apiKey, "").trim() : "",
      keyOrigin: openaiKeyValid ? savedOrigin : "",
      baseUrl: openaiBaseUrl,
      model: str(o.model, "").trim(),
      tokenParam: o.tokenParam === "max_tokens" ? "max_tokens" : "max_completion_tokens",
    },
    monthlyCap: cap !== undefined && cap > 0 ? cap : null,
    currency: str(raw.currency, d.currency).trim().slice(0, 8),
    priceList: normalizePriceList(raw.priceList),
    usage: normalizeUsage(raw.usage, month),
  };
}

// ---------------------------------------------------------------- chiave

/** Una chiave va nell'intestazione di una richiesta: niente spazi né caratteri fuori dall'ASCII stampabile. */
export function cleanApiKey(text: string): string {
  return text.trim().replace(/^["']|["']$/g, "");
}

export type KeyCheck = { ok: true; key: string } | { ok: false; error: "empty" | "invalid" };

export function checkApiKey(text: string): KeyCheck {
  const key = cleanApiKey(text);
  if (key === "") return { ok: false, error: "empty" };
  if (!/^[\x21-\x7e]{8,}$/.test(key)) return { ok: false, error: "invalid" };
  return { ok: true, key };
}

/** Per mostrare che una chiave c'è senza mostrarla: solo gli ultimi quattro caratteri. */
export function maskKey(key: string): string {
  if (key === "") return "";
  return key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;
}

// ---------------------------------------------------------------- scelte derivate

export function activeModel(settings: AiSettings): string {
  if (settings.provider === "anthropic") {
    const a = settings.anthropic;
    return a.useCheapModel ? a.cheapModel : a.model;
  }
  return settings.openai.model;
}

export function activeKey(settings: AiSettings): string {
  return settings.provider === "anthropic" ? settings.anthropic.apiKey : settings.openai.apiKey;
}

export type ConfigIssue = "missing_key" | "missing_model" | "invalid_base_url";

/** Perché il fornitore scelto non si può ancora usare, o null se è pronto. */
export function configIssue(settings: AiSettings): ConfigIssue | null {
  if (activeKey(settings) === "") return "missing_key";
  if (activeModel(settings) === "") return "missing_model";
  if (settings.provider === "openai_compatible" && !normalizeBaseUrl(settings.openai.baseUrl).ok) return "invalid_base_url";
  return null;
}

/** Dominio a cui verranno inviati la chiave e la foto, per mostrarlo sempre in chiaro all'utente. */
export function destinationHost(settings: AiSettings): string {
  return hostOf(settings.provider, settings.provider === "anthropic" ? ANTHROPIC_BASE_URL : settings.openai.baseUrl);
}

/** Come `destinationHost`, per un indirizzo ancora in modifica: stringa vuota se non è valido. */
export function hostOf(provider: ProviderId, baseUrl: string): string {
  if (provider === "anthropic") return new URL(ANTHROPIC_BASE_URL).host;
  const origin = originOf(baseUrl);
  return origin === undefined ? "" : new URL(origin).host;
}

export function hasUsableKey(settings: AiSettings): boolean {
  return configIssue(settings) === null;
}

/** Il fornitore scelto, pronto a chiamare. Null se manca qualcosa (si veda `configIssue`). */
export function providerFor(settings: AiSettings): AiProvider | null {
  if (configIssue(settings) !== null) return null;
  if (settings.provider === "anthropic") {
    return createAnthropicProvider({
      apiKey: settings.anthropic.apiKey,
      model: activeModel(settings),
      workspaceId: settings.anthropic.workspaceId,
    });
  }
  return createOpenAiProvider({
    apiKey: settings.openai.apiKey,
    baseUrl: settings.openai.baseUrl,
    model: settings.openai.model,
    tokenParam: settings.openai.tokenParam,
  });
}

/** Il prezzo del modello scelto è nel listino? */
export function isPriceKnown(settings: AiSettings): boolean {
  return priceOf(activeModel(settings), settings.priceList) !== undefined;
}

export function costOf(settings: AiSettings, model: string, usage: AiUsage): number | null {
  return estimateCost(usage, model, settings.priceList);
}

// ---------------------------------------------------------------- archivio

/** Dove stanno le impostazioni. L'aggiornamento è atomico: nessuno legge nel mezzo di una scrittura altrui. */
export interface SettingsStore {
  read(): Promise<unknown>;
  update(fn: (current: unknown) => unknown): Promise<unknown>;
}

export function dexieSettingsStore(key: string = AI_SETTINGS_KEY): SettingsStore {
  return {
    async read() {
      return (await getDb().settings.get(key))?.value;
    },
    async update(fn) {
      const db = getDb();
      return db.transaction("rw", db.settings, async () => {
        const next = fn((await db.settings.get(key))?.value);
        await db.settings.put({ key, value: next });
        return next;
      });
    },
  };
}

export function memorySettingsStore(initial?: unknown): SettingsStore {
  let value = initial;
  return {
    async read() {
      return value;
    },
    async update(fn) {
      value = fn(value);
      return value;
    },
  };
}

export async function loadAiSettings(store: SettingsStore, nowIso: string = new Date().toISOString()): Promise<AiSettings> {
  return normalizeSettings(await store.read(), nowIso);
}

/** Cambia le impostazioni con una funzione e le salva. */
export async function updateAiSettings(
  store: SettingsStore,
  change: (current: AiSettings) => AiSettings,
  nowIso: string = new Date().toISOString(),
): Promise<AiSettings> {
  const saved = await store.update((raw) => normalizeSettings(change(normalizeSettings(raw, nowIso)), nowIso));
  return normalizeSettings(saved, nowIso);
}

export function setApiKey(store: SettingsStore, provider: ProviderId, key: string, nowIso?: string): Promise<AiSettings> {
  return updateAiSettings(
    store,
    (s) =>
      provider === "anthropic"
        ? { ...s, anthropic: { ...s.anthropic, apiKey: cleanApiKey(key) } }
        : { ...s, openai: { ...s.openai, apiKey: cleanApiKey(key), keyOrigin: originOf(s.openai.baseUrl) ?? "" } },
    nowIso,
  );
}

/** Cancella la chiave di un fornitore (o di tutti, se non se ne indica uno). Il resto delle impostazioni resta. */
export function clearApiKey(store: SettingsStore, provider?: ProviderId, nowIso?: string): Promise<AiSettings> {
  return updateAiSettings(
    store,
    (s) => ({
      ...s,
      anthropic: provider === undefined || provider === "anthropic" ? { ...s.anthropic, apiKey: "" } : s.anthropic,
      openai: provider === undefined || provider === "openai_compatible" ? { ...s.openai, apiKey: "", keyOrigin: "" } : s.openai,
    }),
    nowIso,
  );
}

/** Conta una chiamata riuscita (o comunque pagata): una per volta, nel mese in corso. */
export function recordCall(
  store: SettingsStore,
  usage: AiUsage,
  cost: number | null,
  nowIso: string = new Date().toISOString(),
  estimated = false,
): Promise<AiSettings> {
  return updateAiSettings(store, (s) => ({ ...s, usage: addCall(s.usage, usage, cost, nowIso, estimated) }), nowIso);
}
