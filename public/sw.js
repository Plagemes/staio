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
  "/app/piano/settimana",
  "/app/piano/obiettivi",
  "/app/piano/verifica",
  "/app/spesa",
  "/app/spesa/negozio",
  "/app/spesa/scorte",
  "/app/ricette",
  "/app/ricette/vedi",
  "/app/ricette/nuova",
  "/app/ricette/importa",
  "/app/ricette/cucina",
  "/app/ricette/cucinata",
  "/app/preparazioni",
  "/app/preparazioni/nuova",
  "/app/dispensa/foto",
  "/app/salute",
  "/app/assistente",
  "/app/pasto/frase",
  "/app/pasto/foto",
  "/app/ricette/idee",
  "/app/dispensa/frigo",
  "/app/salute/analisi",
  "/app/salute/esperimenti",
  "/app/salute/rapporto",
  "/app/qualita",
  "/app/qualita/prodotto",
  "/app/qualita/scaffale",
  "/app/qualita/prodotti",
  "/app/impostazioni/aspetto",
  "/app/impostazioni/avvisi",
  "/app/ricette/abbinamenti",
  "/app/ricette/condivisa",
  "/app/impostazioni/video",
  "/app/impostazioni/sincronizzazione",
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


/*
 * Avvisi senza server. Il service worker non calcola nulla: mostra il riepilogo che l'app ha
 * preparato all'ultima apertura e lasciato nel suo archivio (stesso database di
 * src/features/notifications/store.ts) e apre la pagina giusta al tocco.
 * Le regole (ore di silenzio, limiti al giorno) ripetono quelle di src/core/notify.
 */
const NOTIFY_DB = "staio-notify";
const NOTIFY_DB_VERSION = 1;
const NOTIFY_STORE = "kv";
const PERIODIC_TAG = "staio-daily-summary";
const NOTIFY_ICON = "/icons/icon-192.png";
const NOTIFY_MAX_PER_DAY = 2;
const NOTIFY_MIN_GAP_MINUTES = 240;
const NOTIFY_KEEP_DAYS = 14;

function notifyOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIFY_DB, NOTIFY_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(NOTIFY_STORE)) {
        request.result.createObjectStore(NOTIFY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

async function notifyRun(mode, run) {
  const db = await notifyOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTIFY_STORE, mode);
      const request = run(tx.objectStore(NOTIFY_STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const notifyGet = (key) => notifyRun("readonly", (s) => s.get(key));
const notifyPut = (key, value) => notifyRun("readwrite", (s) => s.put(value, key));
const notifyDelete = (key) => notifyRun("readwrite", (s) => s.delete(key));

// Percorsi interni sotto /app e nient'altro (come safeAppPath in src/core/notify/paths.ts).
function safeAppPath(input) {
  const fallback = "/app";
  if (typeof input !== "string" || input.length === 0 || input.length > 500) return fallback;
  if (input.charAt(0) !== "/" || input.indexOf("//") === 0) return fallback;
  if (input.indexOf("\\") !== -1 || /[\u0000-\u001f\u007f]/.test(input)) return fallback;
  let url;
  try {
    url = new URL(input, "https://app.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://app.invalid") return fallback;
  const p = url.pathname;
  if (p !== "/app" && p.indexOf("/app/") !== 0) return fallback;
  if (/%2e|%2f|%5c/i.test(p)) return fallback;
  return p + url.search + url.hash;
}

// Data e minuti locali di un istante in un fuso; null se il fuso non esiste.
function notifyLocal(ms, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type) => {
      const part = parts.find((p) => p.type === type);
      return part ? part.value : "";
    };
    return {
      date: get("year").padStart(4, "0") + "-" + get("month") + "-" + get("day"),
      minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
    };
  } catch {
    return null;
  }
}

function notifyClock(value) {
  const m = typeof value === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function notifyIsQuiet(minutes, quiet) {
  if (!quiet || quiet.enabled !== true) return false;
  const from = notifyClock(quiet.from);
  const to = notifyClock(quiet.to);
  if (from === undefined || to === undefined || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

function notifyValidSummary(s) {
  const m = s && s.message;
  return !!(
    s &&
    typeof s.forDay === "string" &&
    typeof s.timeZone === "string" &&
    typeof s.expiresAt === "string" &&
    m &&
    typeof m.title === "string" &&
    typeof m.body === "string" &&
    typeof m.tag === "string" &&
    Array.isArray(m.keys)
  );
}

function notifyDayBefore(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/*
 * Mostra il riepilogo salvato, se vale ancora: permesso concesso, avvisi accesi, giorno giusto,
 * non scaduto, fuori dal silenzio, entro i limiti del giorno. Restituisce il motivo se non lo mostra.
 */
async function showSavedSummary() {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return "no_permission";
  const prefs = await notifyGet("prefs");
  if (!prefs || prefs.enabled !== true) return "disabled";
  const summary = await notifyGet("summary");
  if (!notifyValidSummary(summary)) return "no_summary";
  const now = Date.now();
  if (!(now < Date.parse(summary.expiresAt))) {
    await notifyDelete("summary");
    return "expired";
  }
  const local = notifyLocal(now, summary.timeZone);
  if (!local || local.date !== summary.forDay) return "other_day";
  if (notifyIsQuiet(local.minutes, prefs.quietHours)) return "quiet";

  const ledger = (await notifyGet("ledger")) || {};
  const shown = Array.isArray(ledger.shown) ? ledger.shown : [];
  const messages = Array.isArray(ledger.messages) ? ledger.messages : [];
  const today = messages.filter((m) => m && m.day === local.date);
  if (today.length >= NOTIFY_MAX_PER_DAY) return "daily_limit";
  const last = today[today.length - 1];
  if (last && (now - Date.parse(last.at)) / 60000 < NOTIFY_MIN_GAP_MINUTES) return "too_soon";
  const known = new Set(shown.map((s) => s && s.key));
  if (summary.message.keys.length > 0 && summary.message.keys.every((k) => known.has(k))) return "already_shown";

  await self.registration.showNotification(summary.message.title, {
    body: summary.message.body,
    tag: summary.message.tag,
    icon: NOTIFY_ICON,
    badge: NOTIFY_ICON,
    data: { url: safeAppPath(summary.message.url), keys: summary.message.keys },
  });

  const oldest = notifyDayBefore(local.date, NOTIFY_KEEP_DAYS);
  const added = summary.message.keys.filter((k) => !known.has(k)).map((key) => ({ key, day: local.date }));
  await notifyPut("ledger", {
    shown: shown.concat(added).filter((s) => s && s.day >= oldest),
    messages: messages.concat([{ day: local.date, at: new Date(now).toISOString() }]).filter((m) => m && m.day >= oldest),
  });
  await notifyDelete("summary");
  return "shown";
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== PERIODIC_TAG) return;
  event.waitUntil(showSavedSummary().catch(() => "error"));
});

// Tocco sull'avviso: porta in primo piano una finestra dell'app e apre la pagina giusta.
async function openAppPage(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const mine = windows.filter((c) => {
    try {
      return new URL(c.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  const preferred = mine.filter((c) => new URL(c.url).pathname.indexOf("/app") === 0).concat(mine);
  for (const client of preferred) {
    try {
      const focused = (await client.focus()) || client;
      if (focused.url !== url && typeof focused.navigate === "function") {
        try {
          await focused.navigate(url);
        } catch {
          /* finestra non controllata: resta dov'è, già in primo piano */
        }
      }
      return;
    } catch {
      /* si prova con la finestra successiva */
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openAppPage(safeAppPath(data && data.url)).catch(() => undefined));
});
