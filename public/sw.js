/* Service worker scritto a mano. Per alzare la versione vedi src/pwa/README.md. */
"use strict";

const CACHE_VERSION = "v1";
const PREFIX = "staio-";
const CACHES = {
  pages: PREFIX + "pages-" + CACHE_VERSION, // HTML delle navigazioni
  rsc: PREFIX + "rsc-" + CACHE_VERSION, // payload dei componenti server
  static: PREFIX + "static-" + CACHE_VERSION, // /_next/static e caratteri
  assets: PREFIX + "assets-" + CACHE_VERSION, // icone e manifest
};
const CURRENT = new Set(Object.values(CACHES));

const APP_SHELL = "/app";
const PRECACHE_PAGES = [
  "/app",
  "/app/dispensa",
  "/app/cattura",
  "/app/cattura/veloce",
  "/app/cattura/codice",
  "/app/dispensa/riallinea",
  "/app/impostazioni",
  "/app/impostazioni/profilo",
  "/app/impostazioni/ai",
  "/app/cattura/scontrino",
  "/app/salute/nutrizione",
  "/app/pasto",
  "/app/pasti-abituali",
  "/app/piano",
  "/app/salute",
];
const NAVIGATION_TIMEOUT_MS = 4000;
const RSC_MAX_ENTRIES = 80;
const PAGES_MAX_ENTRIES = 40;

self.addEventListener("install", (event) => {
  // Niente skipWaiting automatico: l'attivazione avviene su richiesta (messaggio SKIP_WAITING).
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith(PREFIX) && !CURRENT.has(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;

  if (isRsc(request, url)) {
    event.respondWith(rscStrategy(request, url));
  } else if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(event, request, url));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, CACHES.static));
  } else if (isIconOrManifest(url)) {
    event.respondWith(staleWhileRevalidate(event, request, CACHES.assets));
  }
});

// Richieste dei componenti server: parametro _rsc o intestazione RSC.
function isRsc(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("rsc") === "1";
}

function isIconOrManifest(url) {
  const p = url.pathname;
  return (
    p.startsWith("/icons/") ||
    p === "/manifest.webmanifest" ||
    p === "/manifest.json" ||
    p === "/icon.svg" ||
    p === "/apple-icon.png" ||
    p === "/favicon.ico"
  );
}

function isCacheablePagePath(pathname) {
  return pathname === "/" || pathname === "/app" || pathname.startsWith("/app/");
}

async function precache() {
  const pages = await caches.open(CACHES.pages);
  const statics = await caches.open(CACHES.static);
  await Promise.all(
    PRECACHE_PAGES.map(async (path) => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (!isCacheableHtml(response)) return;
        const copy = response.clone();
        await pages.put(path, response);
        // I file dei chunk citati nell'HTML servono per aprire la pagina senza rete.
        const html = await copy.text();
        const found = html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || [];
        await Promise.all(
          Array.from(new Set(found)).map(async (asset) => {
            try {
              if (await statics.match(asset)) return;
              const res = await fetch(asset);
              if (res.ok) await statics.put(asset, res);
            } catch {
              /* tollerato */
            }
          }),
        );
      } catch {
        /* pagina non raggiungibile: tollerata */
      }
    }),
  );
}

function isCacheableHtml(response) {
  if (!response || !response.ok || response.redirected) return false;
  if (response.status !== 200) return false;
  const type = response.headers.get("content-type") || "";
  return type.includes("text/html");
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function navigationStrategy(event, request, url) {
  const pages = await caches.open(CACHES.pages);
  const key = url.origin + url.pathname; // la query non cambia l'HTML statico
  const cached = await pages.match(key);
  try {
    // Con una copia disponibile non si aspetta una rete che non risponde.
    const fetching = fetch(request);
    const response = cached ? await withTimeout(fetching, NAVIGATION_TIMEOUT_MS) : await fetching;
    if (isCacheableHtml(response) && isCacheablePagePath(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(
        pages.put(key, copy).then(() => trim(pages, PAGES_MAX_ENTRIES)),
      );
    }
    return response;
  } catch (error) {
    if (cached) return cached;
    const shell = await pages.match(APP_SHELL);
    if (shell) return shell;
    throw error;
  }
}

/*
 * Richieste RSC (navigazione morbida e prefetch). Rete prima, copia in cache come ripiego.
 * La chiave e' l'URL completo (l'hash _rsc codifica gia' le intestazioni della richiesta) piu'
 * il valore dell'intestazione del segmento, e la corrispondenza ignora Vary: altrimenti la
 * cache non trova mai nulla perche' la risposta varia per intestazioni che offline cambiano.
 * Senza copia la richiesta fallisce di proposito: il router di Next ripiega su una
 * navigazione completa, che la strategia delle pagine serve dalla cache. Non si serve mai
 * una variante diversa da quella richiesta, perche' un payload di tipo sbagliato rompe il router.
 */
function rscKey(request, url) {
  const key = new URL(url.href);
  key.hash = "";
  const segment = request.headers.get("next-router-segment-prefetch");
  const prefetch = request.headers.get("next-router-prefetch");
  key.searchParams.set("__sw", (prefetch ? "p" : "n") + (segment || ""));
  return key.href;
}

async function rscStrategy(request, url) {
  const cache = await caches.open(CACHES.rsc);
  const key = rscKey(request, url);
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    if (response.status === 200 && type.includes("text/x-component")) {
      await cache.put(key, response.clone());
      await trim(cache, RSC_MAX_ENTRIES);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response || Response.error();
}

async function trim(cache, max) {
  const keys = await cache.keys();
  const extra = keys.length - max;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
