// Rete e risoluzione dei nomi simulate per i test: nessuna richiesta reale.
import { vi } from "vitest";
import type {
  FetchDeps,
  ResolvedAddress,
  Resolver,
  Transport,
  TransportRequest,
  TransportResponse,
} from "./fetch-page";

export const PUBLIC_V4: ResolvedAddress = { address: "93.184.216.34", family: 4 };

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

export async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield typeof p === "string" ? enc(p) : p;
}

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: AsyncIterable<Uint8Array>;
}

export function response(r: FakeResponse = {}): TransportResponse & { closed: () => boolean } {
  let closed = false;
  return {
    status: r.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(r.headers ?? {}) },
    body: r.body ?? chunks("<html><body>ok</body></html>"),
    close: () => {
      closed = true;
    },
    closed: () => closed,
  };
}

export interface FakeNet extends FetchDeps {
  resolve: ReturnType<typeof vi.fn<Resolver>>;
  transport: ReturnType<typeof vi.fn<Transport>>;
}

/**
 * `hosts` associa un nome agli indirizzi risolti; `pages` associa un indirizzo (`https://nome/percorso`)
 * alla risposta. Un nome sconosciuto non si risolve.
 */
export function fakeNet(
  hosts: Record<string, ResolvedAddress[] | Error>,
  pages: Record<string, FakeResponse | ((req: TransportRequest) => Promise<TransportResponse>)>,
): FakeNet {
  const resolve = vi.fn<Resolver>(async (hostname) => {
    const found = hosts[hostname];
    if (found instanceof Error) throw found;
    if (!found) throw new Error(`ENOTFOUND ${hostname} (dettaglio interno)`);
    return found;
  });
  const transport = vi.fn<Transport>(async (req) => {
    const key = req.url.toString();
    const page = pages[key];
    if (!page) throw new Error(`nessuna pagina simulata per ${key}`);
    return typeof page === "function" ? page(req) : response(page);
  });
  return { resolve, transport };
}
