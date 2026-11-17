// Ciò che arriva dal menu «Condividi» del telefono: titolo, testo e indirizzo. Su Android il link finisce spesso dentro
// il testo, e il titolo può contenerlo. Qui si ricava il link, si separa la didascalia e si riconosce la piattaforma.
// Tutto ciò che arriva è testo di altri: mai interpretato, solo mostrato.

export const SHARE_LIMITS = { title: 300, text: 20_000, url: 2048 } as const;

export interface SharedContent {
  title: string;
  /** Testo condiviso senza il link: di solito la didascalia. */
  caption: string;
  /** Link http o https, se ce n'è uno. */
  link?: string;
}

export type VideoPlatform = "instagram" | "tiktok" | "youtube";

export const PLATFORM_LABELS: Readonly<Record<VideoPlatform, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Domini dei video che il servizio sa leggere (con i loro sottodomini). Lo stesso elenco vale nel servizio. */
const PLATFORM_DOMAINS: ReadonlyArray<readonly [string, VideoPlatform]> = [
  ["instagram.com", "instagram"],
  ["tiktok.com", "tiktok"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
];

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const LINK = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}»”’]+$/;

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(CONTROL, "").slice(0, max).trim();
}

/** Link http o https ben formato, senza credenziali, o undefined. */
export function readHttpLink(value: string): string | undefined {
  const t = value.trim();
  if (t === "" || t.length > SHARE_LIMITS.url) return undefined;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username !== "" || u.password !== "") return undefined;
    if (!u.hostname.includes(".")) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** Tutti i link http/https in un testo, nell'ordine, ripuliti dalla punteggiatura finale. */
export function findLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(LINK)) {
    const raw = match[0].replace(TRAILING, "");
    if (readHttpLink(raw)) out.push(raw);
  }
  return out;
}

/** Toglie dal testo i link indicati e ripulisce gli spazi rimasti. */
export function removeLinks(text: string, links: readonly string[]): string {
  let out = text;
  for (const link of links) out = out.split(link).join(" ");
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ParamSource = { get(name: string): string | null };

/**
 * Riordina ciò che ha mandato il telefono. Il link è `url`, se è valido; altrimenti il primo nel testo; altrimenti
 * il primo nel titolo. La didascalia è il testo senza quel link.
 */
export function readShared(params: ParamSource): SharedContent {
  const title = clean(params.get("title"), SHARE_LIMITS.title);
  const text = clean(params.get("text"), SHARE_LIMITS.text);
  const urlParam = clean(params.get("url"), SHARE_LIMITS.url);

  const fromParam = urlParam === "" ? undefined : readHttpLink(urlParam);
  const inText = findLinks(text);
  const inTitle = findLinks(title);
  const link = fromParam ?? (inText[0] ? readHttpLink(inText[0]) : undefined) ?? (inTitle[0] ? readHttpLink(inTitle[0]) : undefined);

  const toRemove = [...inText, ...inTitle, ...(urlParam !== "" ? [urlParam] : [])];
  const caption = removeLinks(text, toRemove);
  const cleanTitle = removeLinks(title, toRemove);
  return { title: cleanTitle, caption, ...(link ? { link } : {}) };
}

export const hasSharedContent = (s: SharedContent): boolean => s.title !== "" || s.caption !== "" || s.link !== undefined;

/** Piattaforma del video se il link è https e il dominio è nell'elenco (anche un sottodominio, mai un dominio simile). */
export function videoPlatform(link: string): VideoPlatform | undefined {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return undefined;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const [domain, platform] of PLATFORM_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return undefined;
}
