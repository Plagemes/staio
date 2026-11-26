import { describe, expect, it } from "vitest";
import { EVENT_FAMILIES } from "@/core/events";
import { SYNC_SCOPE, type SyncReport } from "@/core/sync";
import {
  clockWarningText,
  describeReport,
  familiesText,
  clearQuarantineQuestion,
  familyLabel,
  packageReadText,
  formatSkew,
  lastOutcome,
  packageErrorText,
  passphraseErrorText,
  quarantineReasonText,
  scopeText,
  syncErrorText,
} from "./messages";

const base: SyncReport = {
  status: "ok",
  startedAt: "2026-11-17T09:00:00.000Z",
  finishedAt: "2026-11-17T09:00:02.000Z",
  received: { segments: 0, events: 0, added: 0, conflicts: 0 },
  sent: { segments: 0, events: 0 },
  quarantined: 0,
  released: 0,
  locked: 0,
  unknownKeys: [],
  skipped: [],
  overflow: 0,
  recovered: false,
  missing: [],
  clock: [],
  manifestUpdated: false,
};

describe("frasi della sincronizzazione", () => {
  it("niente di nuovo", () => {
    expect(describeReport(base)).toEqual({ ok: true, text: "Tutto allineato: niente di nuovo da scambiare." });
  });

  it("riassume ricevuti, inviati, quarantena e blocchi da sbloccare", () => {
    const text = describeReport({
      ...base,
      received: { segments: 2, events: 5, added: 3, conflicts: 0 },
      sent: { segments: 1, events: 1 },
      quarantined: 2,
      locked: 1,
    }).text;
    expect(text).toContain("3 eventi nuovi ricevuti");
    expect(text).toContain("1 evento inviato");
    expect(text).toContain("2 dati messi da parte");
    expect(text).toContain("inserisci la frase segreta");
  });

  it("errori: frasi chiare, niente gergo", () => {
    expect(describeReport({ ...base, status: "failed", error: "offline" })).toEqual({ ok: false, text: syncErrorText("offline") });
    for (const code of ["offline", "unauthorized", "forbidden", "rate_limited", "server", "no_key", "unexpected"] as const) {
      const t = syncErrorText(code);
      expect(t).toMatch(/\.$/);
      expect(t).not.toMatch(/token|HTTP|40\d|50\d/i);
    }
  });

  it("ultimo esito con data", () => {
    expect(lastOutcome(undefined)).toBe("Mai eseguita su questo dispositivo.");
    expect(lastOutcome(base)).toBe("Riuscita Mar 17 nov alle 10:00.");
    expect(lastOutcome({ ...base, status: "failed" })).toMatch(/^Non riuscita/);
  });

  it("orologi", () => {
    expect(formatSkew(2 * 3600_000)).toBe("circa 2 ore");
    expect(formatSkew(-15 * 60_000)).toBe("circa 15 minuti");
    expect(formatSkew(3 * 86_400_000)).toBe("circa 3 giorni");
    expect(clockWarningText({ deviceId: "abcdef123456", kind: "device_clock", skewMs: 7200_000 }, "me")).toContain(
      "del dispositivo abcdef12 sembra avanti di circa 2 ore",
    );
    expect(clockWarningText({ deviceId: "me", kind: "device_clock", skewMs: -7200_000 }, "me")).toContain("di questo dispositivo sembra indietro");
  });

  it("ogni voce dell'elenco di ciò che si sincronizza ha un testo", () => {
    for (const item of SYNC_SCOPE) expect(scopeText(item.id).label.length).toBeGreaterThan(0);
    expect(familiesText()).toContain("dispensa");
  });

  it("quarantena, frase e pacchetti", () => {
    expect(quarantineReasonText("future_event")).toContain("versione più recente");
    expect(passphraseErrorText("wrong_passphrase")).toContain("Nessun dato è stato toccato");
    expect(packageErrorText("wrong_format")).toContain("non è un pacchetto");
  });

  it("ogni famiglia di eventi ha un nome suo, anche quelle aggiunte dopo", () => {
    for (const { family } of EVENT_FAMILIES) {
      expect(familyLabel(family), family).toBeTruthy();
      expect(familyLabel(family)).not.toBe("altri dati del registro");
    }
    expect(familiesText()).toContain("allergeni e conferme");
  });

  it("file saltati, quarantena piena e sequenza riparata compaiono nell'esito", () => {
    const text = describeReport({
      ...base,
      skipped: [
        { name: "seg.b.0000000001.0123456789abcdef.json", code: "forbidden" },
        { name: "seg.b.0000000002.0123456789abcdef.json", code: "not_found" },
      ],
      overflow: 3,
      recovered: true,
    }).text;
    expect(text).toContain("2 file non si sono potuti scaricare");
    expect(text).toContain("3 dati messi da parte non sono stati conservati");
    expect(text).toMatch(/numerazione/);
  });

  it("nuovi motivi ed errori hanno frasi proprie", () => {
    expect(quarantineReasonText("unencrypted")).toContain("non è cifrato");
    expect(quarantineReasonText("too_large")).toContain("troppo grande");
    expect(syncErrorText("too_many_files")).toMatch(/troppi file/);
    expect(passphraseErrorText("passphrase_mismatch")).toContain("non coincidono");
    expect(passphraseErrorText("key_exists")).toContain("esiste già");
    expect(passphraseErrorText("no_existing_key")).toContain("Nessuna frase");
  });

  it("i file del pacchetto non riconosciuti si contano", () => {
    expect(packageReadText(0)).toBeNull();
    expect(packageReadText(2)).toContain("2 file del pacchetto non sono stati riconosciuti");
  });

  it("chiave diversa su Drive e svuotamento della quarantena", () => {
    const t = describeReport({ ...base, status: "locked", error: "key_mismatch" });
    expect(t.ok).toBe(false);
    expect(t.text).toContain("frase diversa");
    expect(t.text).toContain("Non ho caricato niente");
    expect(clearQuarantineQuestion(1)).toContain("1 dato messo da parte");
    expect(clearQuarantineQuestion(7)).toContain("7 dati messi da parte");
  });

  it("file di chiave illeggibile: caricamento sospeso", () => {
    const t = describeReport({ ...base, status: "locked", error: "key_unreadable" });
    expect(t).toMatchObject({ ok: false });
    expect(t.text).toMatch(/^Caricamento sospeso: un file di chiave non si legge/);
  });
});
