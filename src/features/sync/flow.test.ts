import { describe, expect, it } from "vitest";
import { exportNotice, passphraseStep, showReadOlderForm } from "./flow";

describe("passi della frase segreta", () => {
  it("con Drive configurato si collega prima di chiedere la frase", () => {
    expect(passphraseStep({ driveReady: true, driveSkipped: false, remoteMismatch: false, remoteKeys: null, localKeys: 0, keysReady: false })).toBe("connect");
  });

  it("chiavi remote o locali esistenti: si sblocca, non si crea", () => {
    expect(passphraseStep({ driveReady: true, driveSkipped: false, remoteMismatch: false, remoteKeys: 1, localKeys: 0, keysReady: false })).toBe("unlock");
    expect(passphraseStep({ driveReady: true, driveSkipped: false, remoteMismatch: false, remoteKeys: null, localKeys: 1, keysReady: false })).toBe("unlock");
    expect(passphraseStep({ driveReady: false, driveSkipped: false, remoteMismatch: false, remoteKeys: null, localKeys: 2, keysReady: false })).toBe("unlock");
  });

  it("si crea solo quando si sa che non esiste nessuna chiave", () => {
    expect(passphraseStep({ driveReady: true, driveSkipped: false, remoteMismatch: false, remoteKeys: 0, localKeys: 0, keysReady: false })).toBe("create");
    expect(passphraseStep({ driveReady: false, driveSkipped: false, remoteMismatch: false, remoteKeys: null, localKeys: 0, keysReady: false })).toBe("create");
    expect(passphraseStep({ driveReady: true, driveSkipped: true, remoteMismatch: false, remoteKeys: null, localKeys: 0, keysReady: false })).toBe("create");
  });

  it("chiave pronta", () => {
    expect(passphraseStep({ driveReady: true, driveSkipped: false, remoteMismatch: false, remoteKeys: null, localKeys: 1, keysReady: true })).toBe("ready");
  });
});

describe("avviso prima di preparare il file", () => {
  it("il file non cifrato si dichiara prima, non dopo", () => {
    expect(exportNotice(false)).toContain("non sarà cifrato");
    expect(exportNotice(true)).toContain("cifrato con la frase segreta");
  });
});

describe("chiave diversa da quella su Drive", () => {
  it("anche con la chiave pronta si chiede la frase giusta, dopo aver letto le chiavi remote", () => {
    const base = { driveReady: true, driveSkipped: true, localKeys: 1, keysReady: true, remoteMismatch: true };
    expect(passphraseStep({ ...base, remoteKeys: null })).toBe("connect");
    expect(passphraseStep({ ...base, remoteKeys: 1 })).toBe("unlock");
  });
});

describe("frase per dati più vecchi", () => {
  it("compare ogni volta che restano blocchi da leggere, anche con la chiave pronta", () => {
    expect(showReadOlderForm(undefined)).toBe(false);
    expect(showReadOlderForm({ status: "ok", locked: 0 })).toBe(false);
    expect(showReadOlderForm({ status: "ok", locked: 2 })).toBe(true);
    expect(showReadOlderForm({ status: "locked", error: "key_unreadable", locked: 1 })).toBe(true);
    expect(showReadOlderForm({ status: "locked", error: "key_mismatch", locked: 3 })).toBe(false);
  });
});
