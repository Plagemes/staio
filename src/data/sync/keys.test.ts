// Punto 4 della revisione: la frase si verifica contro le chiavi esistenti, e una chiave nuova
// nasce solo se non ne esiste nessuna, con la frase scritta due volte.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createKey, currentKeyId } from "@/core/sync";
import { PASSPHRASE, TEST_ITERATIONS, TEST_UNLOCK } from "@/core/sync/test-helpers";
import { getDb } from "../db";
import { wipeAll } from "../index";
import { changePassphrase, createPassphrase, getKeyStatus, unlockPassphrase } from "./index";

const opts = { create: { iterations: TEST_ITERATIONS }, unlock: TEST_UNLOCK };
const TYPO = "la mia frase molto segreata";

beforeEach(async () => {
  await wipeAll();
});

async function remoteKey(passphrase = PASSPHRASE) {
  return (await createKey(passphrase, { iterations: TEST_ITERATIONS })).keyInfo;
}

async function syncRows(): Promise<number> {
  return getDb().syncMeta.count();
}

describe("frase segreta contro le chiavi esistenti", () => {
  it("un errore di battitura con una chiave remota esistente: errore, nessuna chiave creata", async () => {
    const remote = await remoteKey();
    await expect(unlockPassphrase(TYPO, [remote], opts)).rejects.toMatchObject({ code: "wrong_passphrase" });
    expect(await syncRows()).toBe(0);
    await expect(createPassphrase(TYPO, TYPO, [remote], opts)).rejects.toMatchObject({ code: "key_exists" });
    expect(await syncRows()).toBe(0);
  });

  it("un secondo dispositivo nuovo usa la chiave che c'è già, non ne crea una diversa", async () => {
    const remote = await remoteKey();
    const r = await unlockPassphrase(PASSPHRASE, [remote], opts);
    expect(r).toMatchObject({ keyId: remote.keyId, unmatched: 0 });
    expect(await getKeyStatus()).toMatchObject({ ready: true, keyIds: [remote.keyId] });
  });

  it("senza chiavi da nessuna parte non si sblocca: si crea, scrivendo la frase due volte", async () => {
    await expect(unlockPassphrase(PASSPHRASE, [], opts)).rejects.toMatchObject({ code: "no_existing_key" });
    await expect(createPassphrase(PASSPHRASE, TYPO, [], opts)).rejects.toMatchObject({ code: "passphrase_mismatch" });
    expect(await syncRows()).toBe(0);
    const created = await createPassphrase(PASSPHRASE, ` ${PASSPHRASE} `, [], opts);
    expect((await getKeyStatus()).keyIds).toEqual([created.keyId]);
  });

  it("anche le chiavi locali contano: non se ne crea una seconda, e la frase si verifica su quelle", async () => {
    const { keyId } = await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    await expect(createPassphrase(TYPO, TYPO, [], opts)).rejects.toMatchObject({ code: "key_exists" });
    await expect(unlockPassphrase(TYPO, [], opts)).rejects.toMatchObject({ code: "wrong_passphrase" });
    expect(await unlockPassphrase(PASSPHRASE, [], opts)).toMatchObject({ keyId });
  });

  it("con più chiavi remote si scrive con quella corrente del remoto", async () => {
    const a = await remoteKey();
    const b = await remoteKey();
    const r = await unlockPassphrase(PASSPHRASE, [b, a], opts);
    expect([a.keyId, b.keyId]).toContain(r.keyId);
    expect(r.keyId).toBe(currentKeyId([a, b]));
  });

  it("cambiare frase è un'azione a parte: serve la frase attuale, quella nuova due volte", async () => {
    const { keyId: old } = await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    const next = "una frase nuova e lunga";
    await expect(changePassphrase(TYPO, next, next, [], opts)).rejects.toMatchObject({ code: "wrong_passphrase" });
    await expect(changePassphrase(PASSPHRASE, next, "diversa davvero", [], opts)).rejects.toMatchObject({ code: "passphrase_mismatch" });
    const changed = await changePassphrase(PASSPHRASE, next, next, [], opts);
    expect(changed.keyId).not.toBe(old);
    const status = await getKeyStatus();
    expect(status.ready).toBe(true);
    expect(status.keyIds.sort()).toEqual([old, changed.keyId].sort());
  });
});
