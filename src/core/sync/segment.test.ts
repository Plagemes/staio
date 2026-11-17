import { describe, expect, it } from "vitest";
import { eventKey, fromBase64, fromUtf8, toBase64, utf8, sha256Hex } from "./bytes";
import {
  KDF_ITERATIONS,
  SyncCryptoError,
  checkPassphrase,
  createKey,
  parseKeyInfo,
  unlockKey,
} from "./crypto";
import { SEGMENT_VERSION, parseRemoteName, segmentName } from "./format";
import { decodeSegment, encodeSegment } from "./segment";
import { PASSPHRASE, TEST_ITERATIONS, TEST_UNLOCK, buy, testKey } from "./test-helpers";
import { seededRandom } from "../ledger/test-helpers";

const noKey = async () => undefined;

describe("base64 ed esadecimale", () => {
  it("andata e ritorno per lunghezze qualsiasi", () => {
    const rnd = seededRandom(3);
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
      const b64 = toBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString("base64"));
      expect(fromBase64(b64)).toEqual(bytes);
    }
  });

  it("rifiuta il base64 non valido", () => {
    expect(fromBase64("abc")).toBeUndefined();
    expect(fromBase64("ab$=")).toBeUndefined();
    expect(fromBase64("a=bc")).toBeUndefined();
  });

  it("la chiave di un evento distingue versioni con lo stesso id", async () => {
    const a = buy("a", 1);
    const b = { ...a, note: "altro" };
    expect(await eventKey(a)).toBe(await eventKey({ ...a }));
    expect(await eventKey(a)).not.toBe(await eventKey(b));
    expect((await eventKey(a)).startsWith(`${a.id}|`)).toBe(true);
  });
});

describe("nomi remoti", () => {
  it("riconosce segmenti, manifesti e chiavi", () => {
    const name = segmentName("dev-1", 42, "ab".repeat(32));
    expect(parseRemoteName(name)).toEqual({ kind: "segment", deviceId: "dev-1", seq: 42, hashPrefix: "ab".repeat(8) });
    expect(parseRemoteName("man.dev-1.json")).toEqual({ kind: "manifest", deviceId: "dev-1" });
    expect(parseRemoteName(`key.${"0".repeat(32)}.json`)).toEqual({ kind: "key", keyId: "0".repeat(32) });
    expect(parseRemoteName("seg.dev.1.x.json").kind).toBe("unknown");
    expect(parseRemoteName("altro.txt").kind).toBe("unknown");
  });
});

describe("chiave da frase segreta", () => {
  it("dichiara i parametri e rifiuta frasi corte", async () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(checkPassphrase("corta")).toBe("too_short");
    expect(checkPassphrase(PASSPHRASE)).toBeNull();
    await expect(createKey("corta", { iterations: TEST_ITERATIONS })).rejects.toMatchObject({ code: "passphrase_too_short" });
  });

  it("la frase giusta sblocca, quella sbagliata dà un errore chiaro", async () => {
    const { keyInfo } = await createKey(PASSPHRASE, { iterations: TEST_ITERATIONS });
    expect(parseKeyInfo(JSON.parse(JSON.stringify(keyInfo)))).toEqual(keyInfo);
    expect(JSON.stringify(keyInfo)).not.toContain(PASSPHRASE);
    expect(keyInfo.kdf).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS });
    await expect(unlockKey(PASSPHRASE, keyInfo, TEST_UNLOCK)).resolves.toBeDefined();
    await expect(unlockKey(`  ${PASSPHRASE} `, keyInfo, TEST_UNLOCK)).resolves.toBeDefined();
    const err = await unlockKey("un'altra frase lunga", keyInfo, TEST_UNLOCK).catch((e) => e);
    expect(err).toBeInstanceOf(SyncCryptoError);
    expect(err.code).toBe("wrong_passphrase");
  });

  it("rifiuta parametri remoti troppo deboli", async () => {
    const { keyInfo } = await createKey(PASSPHRASE, { iterations: TEST_ITERATIONS });
    await expect(unlockKey(PASSPHRASE, keyInfo)).rejects.toMatchObject({ code: "weak_key_info" });
  });

  it("la chiave principale non è estraibile", async () => {
    const { key } = await createKey(PASSPHRASE, { iterations: TEST_ITERATIONS });
    expect(key.extractable).toBe(false);
  });
});

describe("segmenti", () => {
  it("in chiaro: andata e ritorno con verifica dell'impronta", async () => {
    const events = [buy("a", 1), buy("a", 2)];
    const enc = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events });
    const dec = await decodeSegment(enc.name, enc.bytes, noKey);
    expect(dec).toMatchObject({ status: "ok", events });
  });

  it("cifrato: il remoto vede solo dati cifrati, sale e nonce cambiano a ogni segmento", async () => {
    const key = await testKey();
    const events = [buy("a", 1, "farina-segreta")];
    const one = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events, key });
    const two = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events, key });
    const raw = fromUtf8(one.bytes);
    expect(raw).not.toContain("farina-segreta");
    expect(raw).not.toContain(events[0].id);
    expect(one.header.encryption!.salt).not.toBe(two.header.encryption!.salt);
    expect(one.header.encryption!.nonce).not.toBe(two.header.encryption!.nonce);
    expect(one.name).not.toBe(two.name);
    const dec = await decodeSegment(one.name, one.bytes, async (id) => (id === key.keyId ? key.key : undefined));
    expect(dec).toMatchObject({ status: "ok", events });
  });

  it("senza la chiave resta da sbloccare, con la chiave sbagliata è rifiutato", async () => {
    const key = await testKey();
    const other = await testKey();
    const enc = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("a")], key });
    expect(await decodeSegment(enc.name, enc.bytes, noKey)).toMatchObject({ status: "locked", keyId: key.keyId });
    expect(await decodeSegment(enc.name, enc.bytes, async () => other.key)).toMatchObject({ status: "rejected", reason: "auth_failed" });
  });

  it("l'intestazione è autenticata: cambiarla (anche ricalcolando impronta e nome) rompe la decifratura", async () => {
    const key = await testKey();
    const enc = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("a")], key });
    const doc = JSON.parse(fromUtf8(enc.bytes));
    doc.header.seq = 2;
    const name = segmentName("a", 2, doc.header.hash);
    const dec = await decodeSegment(name, utf8(JSON.stringify(doc)), async () => key.key);
    expect(dec).toMatchObject({ status: "rejected", reason: "auth_failed" });
  });

  it("contenuto cifrato alterato con impronta ricalcolata: rifiutato", async () => {
    const key = await testKey();
    const enc = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("a")], key });
    const doc = JSON.parse(fromUtf8(enc.bytes));
    const payload = fromBase64(doc.payload)!;
    payload[0] ^= 1;
    doc.payload = toBase64(payload);
    doc.header.hash = await sha256Hex(payload);
    const name = segmentName("a", 1, doc.header.hash);
    expect(await decodeSegment(name, utf8(JSON.stringify(doc)), async () => key.key)).toMatchObject({
      status: "rejected",
      reason: "auth_failed",
    });
  });

  it("riconosce i guasti: JSON rotto, impronta sbagliata, nome incoerente, conteggio, versione futura", async () => {
    const enc = await encodeSegment({ deviceId: "a", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("a")] });
    expect(await decodeSegment(enc.name, enc.bytes.slice(0, 20), noKey)).toMatchObject({ reason: "corrupt" });

    const doc = JSON.parse(fromUtf8(enc.bytes));
    const tampered = { ...doc, payload: toBase64(utf8(JSON.stringify({ events: [buy("x")] }))) };
    expect(await decodeSegment(enc.name, utf8(JSON.stringify(tampered)), noKey)).toMatchObject({ reason: "hash_mismatch" });

    expect(await decodeSegment(segmentName("b", 1, doc.header.hash), enc.bytes, noKey)).toMatchObject({ reason: "name_mismatch" });

    const counted = { ...doc, header: { ...doc.header, count: 5 } };
    expect(await decodeSegment(enc.name, utf8(JSON.stringify(counted)), noKey)).toMatchObject({ reason: "count_mismatch" });

    const future = { ...doc, header: { ...doc.header, version: SEGMENT_VERSION + 1, nuovo: true } };
    expect(await decodeSegment(enc.name, utf8(JSON.stringify(future)), noKey)).toMatchObject({
      status: "future",
      version: SEGMENT_VERSION + 1,
    });

    const wrong = { ...doc, header: { ...doc.header, format: "altro" } };
    expect(await decodeSegment(enc.name, utf8(JSON.stringify(wrong)), noKey)).toMatchObject({ reason: "wrong_format" });
  });
});
