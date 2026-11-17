// Classificazione degli indirizzi IP: solo gli indirizzi pubblici instradabili sono ammessi.
// Codice solo server. Lettura rigorosa di tutte le forme di scrittura (decimale intera, ottale,
// esadecimale, forme abbreviate, IPv4 incorporato in IPv6): ciò che non si capisce non è pubblico.

type Bytes = readonly number[];

const PART = /^(?:0x[0-9a-f]*|0[0-7]*|[1-9][0-9]*)$/i;

/**
 * IPv4 nella sintassi tollerata dai resolver (`inet_aton`): da 1 a 4 parti decimali, ottali (`0177`)
 * o esadecimali (`0x7f`); l'ultima parte riempie i byte rimanenti ("127.1", "2130706433").
 */
export function parseIPv4(input: string): Bytes | null {
  if (input.length === 0 || input.length > 45) return null;
  const parts = input.split(".");
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!PART.test(p)) return null;
    // "0x" senza cifre non è un numero.
    if (/^0x$/i.test(p)) return null;
    const n = /^0x/i.test(p) ? parseInt(p.slice(2), 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : Number(p);
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1] as number;
  const lastLimit = 256 ** (5 - nums.length);
  if (last >= lastLimit) return null;
  for (let i = 0; i < nums.length - 1; i++) if ((nums[i] as number) > 255) return null;
  const out: number[] = nums.slice(0, -1);
  let rest = last;
  const tail: number[] = [];
  for (let i = 0; i < 5 - nums.length; i++) {
    tail.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  return [...out, ...tail];
}

/** IPv6 in forma testuale (anche `::`, IPv4 puntato in coda). Gli identificatori di zona (`%eth0`) non sono ammessi. */
export function parseIPv6(input: string): Bytes | null {
  let s = input;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.length < 2 || s.length > 45 || !/^[0-9a-f:.]+$/i.test(s)) return null;
  const dbl = s.split("::");
  if (dbl.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const raw = part.split(":");
    const groups: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i] as string;
      if (g.includes(".")) {
        if (i !== raw.length - 1) return null;
        const v4 = parseStrictDotted(g);
        if (!v4) return null;
        groups.push(((v4[0] as number) << 8) | (v4[1] as number), ((v4[2] as number) << 8) | (v4[3] as number));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
        groups.push(parseInt(g, 16));
      }
    }
    return groups;
  };

  const head = toGroups(dbl[0] as string);
  if (!head) return null;
  let groups: number[];
  if (dbl.length === 2) {
    const tail = toGroups(dbl[1] as string);
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) bytes.push(g >> 8, g & 255);
  return bytes;
}

/** Quattro numeri decimali 0-255 senza zeri iniziali (l'IPv4 incorporato in IPv6). */
function parseStrictDotted(s: string): Bytes | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const n = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
  if (n.some((x) => x > 255)) return null;
  if ([m[1], m[2], m[3], m[4]].some((x) => (x as string).length > 1 && (x as string).startsWith("0"))) return null;
  return n;
}

// [rete, lunghezza del prefisso]
const BLOCKED_V4: ReadonlyArray<readonly [readonly [number, number, number, number], number]> = [
  [[0, 0, 0, 0], 8], // "questa rete"
  [[10, 0, 0, 0], 8], // privata
  [[100, 64, 0, 0], 10], // condivisa degli operatori (CGNAT)
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, compreso il servizio di metadati dei cloud
  [[172, 16, 0, 0], 12], // privata
  [[192, 0, 0, 0], 24], // assegnazioni IETF
  [[192, 0, 2, 0], 24], // documentazione
  [[192, 88, 99, 0], 24], // relay 6to4
  [[192, 168, 0, 0], 16], // privata
  [[198, 18, 0, 0], 15], // prove di rete
  [[198, 51, 100, 0], 24], // documentazione
  [[203, 0, 113, 0], 24], // documentazione
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // riservata e broadcast
];

function inCidr4(b: Bytes, net: readonly number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; i < 4 && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((b[i] as number) & mask) !== ((net[i] as number) & mask)) return false;
    bits -= take;
  }
  return true;
}

export function isPublicIPv4Bytes(b: Bytes): boolean {
  return !BLOCKED_V4.some(([net, prefix]) => inCidr4(b, net, prefix));
}

export function isPublicIPv6Bytes(b: Bytes): boolean {
  const at = (i: number): number => b[i] as number;
  // IPv4 mappato (::ffff:a.b.c.d): vale l'indirizzo IPv4 incorporato.
  if (b.slice(0, 10).every((x) => x === 0) && at(10) === 0xff && at(11) === 0xff) {
    return isPublicIPv4Bytes(b.slice(12));
  }
  // Solo 2000::/3 è unicast globale: ::, ::1, IPv4-compatibili, 64:ff9b::/96 (NAT64), fc00::/7,
  // fe80::/10, ff00::/8 e il resto sono fuori.
  if ((at(0) & 0xe0) !== 0x20) return false;
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) < 0x02) return false; // 2001::/23: Teredo, benchmarking, ORCHID, IETF
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return false; // 2001:db8::/32 documentazione
  if (at(0) === 0x20 && at(1) === 0x02) return false; // 2002::/16 6to4
  if (at(0) === 0x3f && at(1) === 0xff && (at(2) & 0xf0) === 0) return false; // 3fff::/20 documentazione
  return true;
}

/**
 * Vero solo se `address` è un indirizzo IP valido, pubblico e instradabile. Un testo che non si
 * riesce a leggere come IPv4 o IPv6 non è pubblico.
 */
export function isPublicAddress(address: string): boolean {
  try {
    const s = address;
    if (s.includes(":")) {
      const b = parseIPv6(s);
      return b !== null && isPublicIPv6Bytes(b);
    }
    const b4 = parseIPv4(s);
    return b4 !== null && isPublicIPv4Bytes(b4);
  } catch {
    return false;
  }
}

/** Il testo ha la forma di un indirizzo numerico (anche in forme alternative o non valide). */
export function looksLikeIpLiteral(host: string): boolean {
  const h = host.startsWith("[") ? host.slice(1, -1) : host;
  if (h.includes(":")) return true;
  if (parseIPv4(h) !== null) return true;
  // L'ultima etichetta numerica o esadecimale (0x…) rende il nome un indirizzo per i resolver.
  const last = h.split(".").pop() ?? "";
  return /^(?:\d+|0x[0-9a-f]*)$/i.test(last);
}
