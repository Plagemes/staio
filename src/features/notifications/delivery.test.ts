import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDiary } from "@/core/diary";
import { derivePantry } from "@/core/ledger";
import { purchase, q } from "@/core/ledger/test-helpers";
import { DEFAULT_PREFS, type NoticeMessage, type NotifyPrefs } from "@/core/notify";
import { runOnOpen, sanitizeMessage, type DeliveryEnv, type PermissionState, type RunData } from "./delivery";
import { createNotifyStore, type NotifyStore } from "./store";

const NOW = "2026-11-17T09:00:00Z"; // 10:00 a Roma

const data: RunData = {
  pantry: derivePantry([
    purchase("p1", "2026-11-10T08:00:00Z", {
      lotId: "a",
      productRef: "Yogurt",
      quantity: q(500),
      location: "frigo",
      expiry: { date: "2026-11-18", kind: "use_by" },
    }),
  ]),
  diary: deriveDiary([]),
};

const on: NotifyPrefs = { ...DEFAULT_PREFS, enabled: true };

function fakeEnv(permission: PermissionState, extra: Partial<DeliveryEnv> = {}) {
  const shown: NoticeMessage[] = [];
  const env: DeliveryEnv = {
    permission: () => permission,
    show: vi.fn(async (m: NoticeMessage) => {
      shown.push(m);
    }),
    ...extra,
  };
  return { env, shown };
}

let store: NotifyStore;
beforeEach(() => {
  store = createNotifyStore(new IDBFactory());
});

describe("runOnOpen", () => {
  it("mostra un avviso e non lo ripete alla seconda apertura", async () => {
    await store.savePrefs(on);
    const { env, shown } = fakeEnv("granted");
    const first = await runOnOpen({ env, store, data, now: NOW });
    expect(first.status).toBe("shown");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: "Scade domani", body: "Yogurt: scade domani.", url: "/app/dispensa" });
    const second = await runOnOpen({ env, store, data, now: "2026-11-17T18:00:00Z" });
    expect(second.status).toBe("nothing");
    expect(shown).toHaveLength(1);
    expect((await store.loadLedger()).messages).toHaveLength(1);
  });

  it("permesso negato: niente avvisi, nessuna richiesta, riepilogo cancellato", async () => {
    await store.savePrefs(on);
    await store.saveSummary({
      forDay: "2026-11-17",
      timeZone: "Europe/Rome",
      message: { tag: "t", title: "x", body: "y", url: "/app", keys: [], count: 1, digest: false },
      expiresAt: "2026-11-19T00:00:00Z",
      savedAt: NOW,
    });
    const { env, shown } = fakeEnv("denied");
    const r = await runOnOpen({ env, store, data, now: NOW });
    expect(r.status).toBe("denied");
    expect(shown).toEqual([]);
    expect(await store.loadSummary()).toBeNull();
  });

  it("permesso mai dato: resta in attesa, senza mostrare nulla", async () => {
    await store.savePrefs(on);
    const { env, shown } = fakeEnv("default");
    expect((await runOnOpen({ env, store, data, now: NOW })).status).toBe("not_asked");
    expect(shown).toEqual([]);
  });

  it("API assente", async () => {
    await store.savePrefs(on);
    const { env, shown } = fakeEnv("unsupported");
    expect((await runOnOpen({ env, store, data, now: NOW })).status).toBe("unsupported");
    expect(shown).toEqual([]);
  });

  it("avvisi spenti dall'utente: nulla, e la sincronizzazione periodica si toglie", async () => {
    const unregister = vi.fn(async () => {});
    const { env, shown } = fakeEnv("granted", { periodic: { register: vi.fn(), unregister } });
    const r = await runOnOpen({ env, store, data, now: NOW });
    expect(r.status).toBe("disabled");
    expect(r.periodic).toBe("removed");
    expect(unregister).toHaveBeenCalled();
    expect(shown).toEqual([]);
  });

  it("di notte non mostra, e tiene il riepilogo per oggi", async () => {
    await store.savePrefs(on);
    const { env, shown } = fakeEnv("granted");
    const r = await runOnOpen({ env, store, data, now: "2026-11-17T22:30:00Z" });
    expect(r.status).toBe("held");
    expect(r.hold).toBe("quiet");
    expect(shown).toEqual([]);
    const summary = await store.loadSummary();
    expect(summary?.forDay).toBe("2026-11-17");
    expect(summary?.message.body).toBe("Yogurt: scade domani.");
  });

  it("dopo aver mostrato, il riepilogo salvato è per il giorno dopo", async () => {
    await store.savePrefs(on);
    const { env } = fakeEnv("granted");
    await runOnOpen({ env, store, data, now: NOW });
    const summary = await store.loadSummary();
    expect(summary?.forDay).toBe("2026-11-18");
    expect(summary?.message.body).toBe("Yogurt: scade oggi.");
  });

  it("se mostrare fallisce non si registra nulla e si riprova dopo", async () => {
    await store.savePrefs(on);
    const failing = fakeEnv("granted", { show: vi.fn(async () => Promise.reject(new Error("no"))) });
    expect((await runOnOpen({ env: failing.env, store, data, now: NOW })).status).toBe("error");
    expect((await store.loadLedger()).messages).toEqual([]);
    const ok = fakeEnv("granted");
    expect((await runOnOpen({ env: ok.env, store, data, now: "2026-11-17T10:00:00Z" })).status).toBe("shown");
  });

  it("sincronizzazione periodica: registrata dove esiste, assente altrove, errore tollerato", async () => {
    await store.savePrefs(on);
    const register = vi.fn(async () => {});
    const withSync = fakeEnv("granted", { periodic: { register, unregister: vi.fn() } });
    expect((await runOnOpen({ env: withSync.env, store, data, now: NOW })).periodic).toBe("registered");
    expect(register).toHaveBeenCalled();
    const without = fakeEnv("granted");
    expect((await runOnOpen({ env: without.env, store, data, now: NOW })).periodic).toBe("unsupported");
    const broken = fakeEnv("granted", { periodic: { register: vi.fn(async () => Promise.reject(new Error("x"))), unregister: vi.fn() } });
    expect((await runOnOpen({ env: broken.env, store, data, now: NOW })).periodic).toBe("error");
  });

  it("archivio non disponibile: errore pulito, nessuna eccezione", async () => {
    const broken = createNotifyStore({ open: () => { throw new Error("no idb"); } } as unknown as IDBFactory);
    const { env, shown } = fakeEnv("granted");
    const r = await runOnOpen({ env, store: broken, data, now: NOW });
    expect(r.status).toBe("error");
    expect(shown).toEqual([]);
  });
});

describe("sanitizeMessage", () => {
  it("un indirizzo fuori da /app diventa /app", () => {
    const m: NoticeMessage = { tag: "t", title: "a", body: "b", url: "https://evil.example/", keys: [], count: 1, digest: false };
    expect(sanitizeMessage(m).url).toBe("/app");
    expect(sanitizeMessage({ ...m, url: "/app/spesa" }).url).toBe("/app/spesa");
  });
});

describe("archivio", () => {
  it("preferenze non valide tornano ai valori predefiniti", async () => {
    expect(await store.loadPrefs()).toEqual(DEFAULT_PREFS);
    await store.savePrefs({ ...on, expiryDaysAhead: 5 });
    expect((await store.loadPrefs()).expiryDaysAhead).toBe(5);
  });
});
