// Un indirizzo incollato (nel «+» o in Importa): lo si riconosce anche dentro un testo condiviso. Solo funzioni pure.

import { findLinks, readHttpLink, removeLinks, videoPlatform } from "../recipes-video/links";

/** Parole di contorno (un titolo di pagina) che ancora lasciano il testo «un indirizzo». */
const MAX_EXTRA_WORDS = 3;

/** Il primo indirizzo http o https nel testo, ripulito. */
export function addressIn(text: string): string | undefined {
  const first = findLinks(text)[0];
  return first ? readHttpLink(first) : undefined;
}

/** Il testo è un indirizzo, al massimo con un titolo davanti o dietro: non un paragrafo con un link dentro. */
export function isOnlyAddress(text: string): boolean {
  const links = findLinks(text);
  if (links.length === 0 || !addressIn(text)) return false;
  const rest = removeLinks(text, links);
  const words = rest.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length <= MAX_EXTRA_WORDS;
}

/** Il dominio da mostrare sotto la proposta, senza «www.». */
export function addressHost(text: string): string | undefined {
  const address = addressIn(text);
  if (!address) return undefined;
  return new URL(address).hostname.replace(/^www\./i, "");
}

/** Dove porta un indirizzo incollato: la pagina del video condiviso per Instagram, TikTok e YouTube, altrimenti Importa. */
export function pastedLinkTarget(text: string): { href: string; label: string } | undefined {
  if (!isOnlyAddress(text)) return undefined;
  const address = addressIn(text);
  if (!address) return undefined;
  const encoded = encodeURIComponent(address);
  if (videoPlatform(address)) return { href: `/app/ricette/condivisa?url=${encoded}`, label: "Apri il video condiviso" };
  return { href: `/app/ricette/importa?url=${encoded}`, label: "Importa la ricetta da questo indirizzo" };
}
