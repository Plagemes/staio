import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_NAME, closeDb } from "./db";
import { SECRET_KEYS, SECRET_PREFIX, exportSettings, getSetting, importSettings, setSetting } from "./settings";

beforeEach(async () => {
  closeDb();
  await Dexie.delete(DB_NAME);
});

const SERVICE = { url: "https://video.example.test", token: "token-segreto-del-servizio-video" };

describe("copia delle impostazioni: le chiavi segrete non escono mai", () => {
  it("il servizio dei video (indirizzo e token) non è nel file", async () => {
    await setSetting("video.service", SERVICE);
    await setSetting("theme", "dark");
    const file = await exportSettings();
    expect(file.settings).toEqual({ theme: "dark" });
    expect(JSON.stringify(file)).not.toContain(SERVICE.token);
    expect(JSON.stringify(file)).not.toContain("video.service");
  });

  it("ai.* resta fuori come prima", async () => {
    await setSetting(`${SECRET_PREFIX}settings`, { apiKey: "chiave-segreta" });
    await setSetting("ai.zones", { a: 1 });
    await setSetting("theme", "dark");
    const file = await exportSettings();
    expect(Object.keys(file.settings)).toEqual(["theme"]);
    expect(JSON.stringify(file)).not.toContain("chiave-segreta");
  });

  it("un file vecchio che contiene video.service lo ignora, e non tocca quello di questo telefono", async () => {
    await setSetting("video.service", SERVICE);
    const res = await importSettings({
      format: "ledger-settings",
      version: 1,
      settings: { "video.service": { url: "https://altro.example.test", token: "altro-token-altro-token" }, theme: "light", "ai.settings": { apiKey: "k" } },
    });
    expect(res).toEqual({ ok: true, imported: 1, skipped: 2 });
    expect(await getSetting("video.service")).toEqual(SERVICE);
    expect(await getSetting("ai.settings")).toBeUndefined();
    expect(await getSetting("theme")).toBe("light");
  });

  it("l'elenco delle chiavi segrete con il nome intero", () => {
    expect([...SECRET_KEYS]).toEqual(["video.service"]);
  });

  it("la data dell'ultima copia è di questo telefono: non esce e non si importa", async () => {
    await setSetting("backup.lastExportAt", "2026-11-20T10:00:00.000Z");
    expect((await exportSettings()).settings).toEqual({});
    const res = await importSettings({ format: "ledger-settings", version: 1, settings: { "backup.lastExportAt": "2020-01-01T00:00:00.000Z" } });
    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
    expect(await getSetting("backup.lastExportAt")).toBe("2026-11-20T10:00:00.000Z");
  });

  it("la bozza dello scontrino e la cucina a metà sono di un solo telefono: non escono e non si importano", async () => {
    await setSetting("receipt.draft", { lines: [1] });
    await setSetting("recipes.cookSession", { step: 3 });
    await setSetting("theme", "dark");
    expect((await exportSettings()).settings).toEqual({ theme: "dark" });
    const res = await importSettings({
      format: "ledger-settings",
      version: 1,
      settings: { "receipt.draft": { lines: [9] }, "recipes.cookSession": { step: 9 }, theme: "light" },
    });
    expect(res).toEqual({ ok: true, imported: 1, skipped: 2 });
    expect(await getSetting("receipt.draft")).toEqual({ lines: [1] });
    expect(await getSetting("recipes.cookSession")).toEqual({ step: 3 });
  });

  it("su un telefono che non le ha, l'importazione non le crea", async () => {
    await importSettings({ format: "ledger-settings", version: 1, settings: { "receipt.draft": { lines: [9] }, "recipes.cookSession": { step: 9 } } });
    expect(await getSetting("receipt.draft")).toBeUndefined();
    expect(await getSetting("recipes.cookSession")).toBeUndefined();
  });
});
