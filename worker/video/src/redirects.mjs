// Verifica dei reindirizzamenti: ogni passaggio deve restare su https e su un dominio ammesso. Si seguono a mano
// (mai in automatico) e si ferma tutto al primo passaggio che esce dall'elenco. L'indirizzo che poi va allo strumento
// di scaricamento resta quello originale, già validato: qui si controlla soltanto la strada.
import { errorFor } from "./limits.mjs";
import { ALLOWED_DOMAINS, validateVideoUrl } from "./url.mjs";

export const MAX_HOPS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * @param {string} startUrl indirizzo già validato
 * @param {{ fetch: typeof fetch, signal?: AbortSignal, domains?: readonly string[], maxHops?: number }} deps
 * @returns {Promise<string[]>} gli indirizzi attraversati, compreso il primo
 */
export async function verifyRedirectChain(startUrl, deps) {
  const domains = deps.domains ?? ALLOWED_DOMAINS;
  const maxHops = deps.maxHops ?? MAX_HOPS;
  const chain = [startUrl];
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    let response;
    try {
      response = await deps.fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: deps.signal,
        headers: { accept: "text/html,*/*;q=0.5" },
      });
    } catch {
      throw errorFor(deps.signal?.aborted ? "timeout" : "unavailable");
    }
    // il contenuto della pagina non serve: si chiude senza leggerlo
    try {
      await response.body?.cancel();
    } catch {
      /* già chiuso */
    }
    if (!REDIRECT_STATUS.has(response.status)) return chain;
    const location = response.headers.get("location");
    if (!location) return chain;
    let next;
    try {
      next = new URL(location, current).href;
    } catch {
      throw errorFor("unavailable");
    }
    const checked = validateVideoUrl(next, domains);
    if (!checked.ok) throw errorFor("domain_not_allowed");
    current = checked.url;
    chain.push(current);
  }
  throw errorFor("unavailable");
}
