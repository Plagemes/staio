// Prova public/sw.js con un service worker finto e un IndexedDB finto: sincronizzazione
// periodica e tocco sull'avviso, leggendo ciò che scrive src/features/notifications/store.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, type SavedSummary } from "@/core/notify";
import { createNotifyStore, type NotifyStore } from "@/features/notifications/store";

const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

function boot(options: { permission?: string; clients?: FakeClient[] } = {}) {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => null);
  const clientList = options.clients ?? [];
  const idb = new IDBFactory();
  const swSelf = {
    location: { origin: "https://staio.example" },
    addEventListener: (type: string, h: Handler) => handlers.set(type, h),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clientList), openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  const run = new Function("self", "indexedDB", "Notification", "caches", "fetch", source);
  run(swSelf, idb, { permission: options.permission ?? "granted" }, {}, vi.fn());
  const store = createNotifyStore(idb);
  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, event: Record<string, unknown>) => {
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits.splice(0));
  };
  return { fire, showNotification, openWindow, store, handlers };
}

const summaryFor = (forDay: string, over: Partial<SavedSummary> = {}): SavedSummary => ({
  forDay,
  timeZone: "Europe/Rome",
  message: { tag: "avvisi-x", title: "Scade domani", body: "Yogurt: scade domani.", url: "/app/dispensa", keys: ["expiry:a:2026-11-18:tomorrow"], count: 1, digest: false },
  expiresAt: "2026-11-18T20:00:00Z",
  savedAt: "2026-11-17T09:00:00Z",
  ...over,
});

async function prepare(store: NotifyStore, summary: SavedSummary | null, enabled = true) {
  await store.savePrefs({ ...DEFAULT_PREFS, enabled });
  if (summary) await store.saveSummary(summary);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T09:00:00Z")); // 10:00 a Roma
});
afterEach(() => vi.useRealTimers());

describe("periodicsync", () => {
  it("mostra il riepilogo salvato e lo segna come mostrato", async () => {
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-17"));
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Scade domani",
      expect.objectContaining({ body: "Yogurt: scade domani.", tag: "avvisi-x", data: { url: "/app/dispensa", keys: ["expiry:a:2026-11-18:tomorrow"] } }),
    );
    const ledger = await sw.store.loadLedger();
    expect(ledger.shown).toEqual([{ key: "expiry:a:2026-11-18:tomorrow", day: "2026-11-17" }]);
    expect(ledger.messages).toHaveLength(1);
    expect(await sw.store.loadSummary()).toBeNull();
    // un secondo giro non ripete nulla
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
  });

  it("riepilogo scaduto: non lo mostra e lo toglie", async () => {
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-17", { expiresAt: "2026-11-17T08:00:00Z" }));
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(await sw.store.loadSummary()).toBeNull();
  });

  it("riepilogo di un altro giorno: non lo mostra", async () => {
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-18"));
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(await sw.store.loadSummary()).not.toBeNull();
  });

  it("senza permesso o con gli avvisi spenti non mostra nulla", async () => {
    const denied = boot({ permission: "denied" });
    await prepare(denied.store, summaryFor("2026-11-17"));
    await denied.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(denied.showNotification).not.toHaveBeenCalled();

    const off = boot();
    await prepare(off.store, summaryFor("2026-11-17"), false);
    await off.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(off.showNotification).not.toHaveBeenCalled();
  });

  it("senza riepilogo salvato non fa nulla", async () => {
    const sw = boot();
    await prepare(sw.store, null);
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("nelle ore di silenzio non mostra", async () => {
    vi.setSystemTime(new Date("2026-11-17T22:30:00Z")); // 23:30
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-17", { expiresAt: "2026-11-18T20:00:00Z" }));
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("se l'app ha già mostrato quei fatti oggi, non li ripete", async () => {
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-17"));
    await sw.store.saveLedger({ shown: [{ key: "expiry:a:2026-11-18:tomorrow", day: "2026-11-17" }], messages: [{ day: "2026-11-17", at: "2026-11-17T05:00:00Z" }] });
    await sw.fire("periodicsync", { tag: "staio-daily-summary" });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("ignora altre etichette", async () => {
    const sw = boot();
    await prepare(sw.store, summaryFor("2026-11-17"));
    await sw.fire("periodicsync", { tag: "altro" });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });
});

describe("notificationclick", () => {
  const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

  it("porta in primo piano la finestra aperta e va alla pagina giusta", async () => {
    const client: FakeClient = { url: "https://staio.example/app", focus: vi.fn(), navigate: vi.fn() };
    client.focus.mockResolvedValue(client);
    const sw = boot({ clients: [client] });
    const event = click("/app/dispensa");
    await sw.fire("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith("https://staio.example/app/dispensa");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("senza finestre aperte ne apre una", async () => {
    const sw = boot();
    await sw.fire("notificationclick", click("/app/spesa"));
    expect(sw.openWindow).toHaveBeenCalledWith("https://staio.example/app/spesa");
  });

  it("un indirizzo non valido apre solo /app", async () => {
    for (const bad of ["https://evil.example/", "//evil.example", "/api/ricetta", "/app/../x", undefined, 5]) {
      const sw = boot();
      await sw.fire("notificationclick", click(bad));
      expect(sw.openWindow).toHaveBeenCalledWith("https://staio.example/app");
    }
  });

  it("ignora le finestre di altri siti", async () => {
    const foreign: FakeClient = { url: "https://altro.example/app", focus: vi.fn() };
    const sw = boot({ clients: [foreign] });
    await sw.fire("notificationclick", click("/app/dispensa"));
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalled();
  });
});

describe("pagina degli avvisi", () => {
  it("è tra le pagine salvate per l'uso senza rete", () => {
    expect(source).toContain('"/app/impostazioni/avvisi"');
  });
  it("il nome del database coincide con quello dell'app", async () => {
    const { NOTIFY_DB_NAME } = await import("@/features/notifications/store");
    expect(source).toContain(`const NOTIFY_DB = "${NOTIFY_DB_NAME}"`);
  });
});
