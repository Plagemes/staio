// Trasporto https reale e risoluzione dei nomi. Codice solo server (ambiente Node).
//
// Si usa `node:https` e non `fetch` perché serve fissare l'indirizzo di connessione a quello già
// controllato (`lookup`), mantenendo nome e certificato del sito (`servername`, verifica attiva).

import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { PassThrough, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import {
  UnsupportedEncodingError,
  type ResolvedAddress,
  type Resolver,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "./fetch-page";

/** Risolve un nome in tutti i suoi indirizzi (IPv4 e IPv6), nell'ordine del sistema. */
export const systemResolver: Resolver = async (hostname) => {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.flatMap((a): ResolvedAddress[] =>
    a.family === 4 || a.family === 6 ? [{ address: a.address, family: a.family }] : [],
  );
};

type RequestFn = (options: RequestOptions, callback: (res: IncomingMessage) => void) => ReturnType<typeof httpsRequest>;

function flattenHeaders(raw: IncomingMessage["headers"]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function decompressor(encoding: string | undefined): PassThrough | null {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return createGunzip() as unknown as PassThrough;
    case "deflate":
      return createInflate() as unknown as PassThrough;
    case "br":
      return createBrotliDecompress() as unknown as PassThrough;
    default:
      throw new UnsupportedEncodingError(encoding);
  }
}

/**
 * Trasporto su `node:https`. La connessione va all'indirizzo già controllato; la verifica del
 * certificato resta quella predefinita (nome del sito). Nessun agente condiviso, nessun riuso di
 * connessioni, nessun reindirizzamento automatico (`node:https` non ne segue).
 * `request` si può sostituire nei test.
 */
export function createHttpsTransport(request: RequestFn = httpsRequest): Transport {
  return ({ url, address, headers, signal }: TransportRequest): Promise<TransportResponse> =>
    new Promise<TransportResponse>((resolve, reject) => {
      const hostname = url.hostname.replace(/\.$/, "");
      const options: RequestOptions = {
        host: hostname,
        port: 443,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host, connection: "close" },
        servername: hostname,
        agent: false,
        rejectUnauthorized: true,
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts && opts.all) cb(null, [{ address: address.address, family: address.family }]);
          else cb(null, address.address, address.family);
        }) as unknown as RequestOptions["lookup"],
      };

      let settled = false;
      const req = request(options, (res) => {
        let stream: Readable = res;
        try {
          const unzip = decompressor(res.headers["content-encoding"] as string | undefined);
          if (unzip) {
            res.on("error", (e) => unzip.destroy(e));
            stream = res.pipe(unzip);
          }
        } catch (e) {
          res.destroy();
          settled = true;
          reject(e);
          return;
        }
        // Gli errori di flusso arrivano a chi legge il corpo; senza lettore non devono far cadere il processo.
        res.on("error", () => undefined);
        stream.on("error", () => undefined);
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          headers: flattenHeaders(res.headers),
          body: stream as AsyncIterable<Uint8Array>,
          close: () => {
            stream.destroy();
            res.destroy();
            req.destroy();
          },
        });
      });
      const abort = (): void => {
        req.destroy();
        if (!settled) reject(new Error("aborted"));
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      req.on("error", (e) => {
        if (!settled) reject(e);
      });
      req.end();
    });
}

export const httpsTransport: Transport = createHttpsTransport();
