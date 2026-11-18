import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { operationIdOf, withOperationId, type AnyEvent } from "@/core/events";
import { water } from "@/core/diary/test-helpers";
import { purchase, q, voidOf } from "@/core/ledger/test-helpers";
import { MemoryLocal, MemoryTransport, runSync, unlockKey } from "@/core/sync";
import { PASSPHRASE, TEST_ITERATIONS, TEST_UNLOCK } from "@/core/sync/test-helpers";
import { appendEvents, exportBackup, getAllEvents, importBackup, importEvents, wipeAll } from "./index";
import { createDexieSyncPort, createPassphrase, syncWith } from "./sync";

const buy = (id: string, at: string) => purchase(id, at, { lotId: `lot-${id}`, productRef: "farina", quantity: q(500), location: "dispensa" });
const byId = async (): Promise<Map<string, AnyEvent>> => new Map((await getAllEvents()).map((e) => [e.id, e]));

beforeEach(async () => {
  await wipeAll();
});

describe("opId: ogni scrittura è un'operazione", () => {
  it("gli eventi di una chiamata ricevono lo stesso identificativo; due chiamate, due identificativi", async () => {
    const first = [buy("a", "2026-01-01T10:00:00.000Z"), water("w", "2026-01-01T10:00:05.000Z", { ml: 200 }), voidOf("v", "2026-01-01T10:00:09.000Z", "zzz")];
    expect(await appendEvents(first as AnyEvent[])).toMatchObject({ added: 3, rejected: [] });
    await appendEvents([buy("b", "2026-01-01T10:00:00.000Z")]);
    const stored = await byId();
    const ids = ["a", "w", "v", "b"].map((id) => operationIdOf(stored.get(id)));
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids.slice(0, 3)).size).toBe(1);
    expect(ids[3]).not.toBe(ids[0]);
    // gli eventi passati da chi chiama non vengono toccati
    expect(operationIdOf(first[0])).toBeUndefined();
  });

  it("un evento che ne porta già uno lo tiene, e riscriverlo non cambia niente", async () => {
    const [mine] = withOperationId([buy("a", "2026-01-01T10:00:00.000Z")], "op-di-prima");
    await appendEvents([mine]);
    expect(await appendEvents([buy("a", "2026-01-01T10:00:00.000Z")])).toMatchObject({ added: 0, duplicates: 1 });
    expect(operationIdOf((await byId()).get("a"))).toBe("op-di-prima");
  });

  it("andata e ritorno con la copia di sicurezza: il campo resta dov'è", async () => {
    await appendEvents([buy("a", "2026-01-01T10:00:00.000Z"), buy("b", "2026-01-01T10:00:00.000Z")]);
    const before = await getAllEvents();
    const text = JSON.stringify(await exportBackup());
    await wipeAll();
    expect(await importBackup(text)).toMatchObject({ ok: true, added: 2 });
    expect(await getAllEvents()).toEqual(before);
    expect(new Set(before.map(operationIdOf)).size).toBe(1);
  });

  it("lo stesso evento arrivato senza il campo (una copia di prima) non è un conflitto, e il campo non si perde", async () => {
    const a = buy("a", "2026-01-01T10:00:00.000Z");
    await appendEvents([a]);
    const stamped = (await byId()).get("a");
    const res = await importEvents([a]);
    expect(res).toMatchObject({ added: 0, conflicts: [], rejected: [] });
    expect((await byId()).get("a")).toEqual(stamped);
  });

  it("un evento di prima che arriva con il campo lo prende, senza conflitto; due identificativi diversi restano un conflitto", async () => {
    const a = buy("a", "2026-01-01T10:00:00.000Z");
    expect(await importEvents([a])).toMatchObject({ added: 1 });
    expect(operationIdOf((await byId()).get("a"))).toBeUndefined();
    expect(await importEvents(withOperationId([a], "op-1"))).toMatchObject({ added: 0, conflicts: [] });
    expect(operationIdOf((await byId()).get("a"))).toBe("op-1");
    expect((await importEvents(withOperationId([a], "op-2"))).conflicts).toHaveLength(1);
  });

  it("andata e ritorno con la sincronizzazione: il campo arriva all'altro telefono e torna da lui", async () => {
    await createPassphrase(PASSPHRASE, PASSPHRASE, [], { create: { iterations: TEST_ITERATIONS }, unlock: TEST_UNLOCK });
    const transport = new MemoryTransport();
    const peer = new MemoryLocal("peer");
    const key = (await createDexieSyncPort().writeKey())!;
    peer.useKey({ ...key, key: await unlockKey(PASSPHRASE, key.keyInfo, TEST_UNLOCK) });
    peer.author(withOperationId([buy("theirs", "2026-01-02T10:00:00.000Z")], "op-peer"));
    await runSync({ transport, local: peer });
    await appendEvents([buy("mine", "2026-01-03T10:00:00.000Z")]);

    expect(await syncWith(transport, "drive", { requireEncryption: true })).toMatchObject({ status: "ok", received: { added: 1 }, sent: { events: 1 } });
    await runSync({ transport, local: peer });
    const stored = await byId();
    expect(operationIdOf(stored.get("theirs"))).toBe("op-peer");
    const sent = (peer.events as AnyEvent[]).find((e) => e.id === "mine");
    expect(operationIdOf(sent)).toBe(operationIdOf(stored.get("mine")));
    expect(operationIdOf(sent)).toBeTypeOf("string");
  });
});
