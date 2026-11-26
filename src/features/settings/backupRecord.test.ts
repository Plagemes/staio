import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_NAME, closeDb } from "@/data/db";
import { getSetting, setSetting } from "@/data";
import { LAST_EXPORT_KEY, exportSettingsCopy, rememberEventsBackup } from "./backupRecord";
import { backupValue } from "./settingsSummary";

beforeEach(async () => {
  closeDb();
  await Dexie.delete(DB_NAME);
});

describe("data dell'ultima copia", () => {
  it("la copia delle impostazioni non la scrive: senza copia degli eventi resta «Mai fatta»", async () => {
    await setSetting("theme", "dark");
    const file = await exportSettingsCopy();
    expect(file.settings).toEqual({ theme: "dark" });
    expect(await getSetting(LAST_EXPORT_KEY)).toBeUndefined();
    expect(backupValue(await getSetting(LAST_EXPORT_KEY), "2026-11-16T10:00:00.000Z")).toBe("Mai fatta");
  });

  it("la copia degli eventi la scrive", async () => {
    await rememberEventsBackup(() => new Date("2026-11-16T09:00:00.000Z"));
    expect(await getSetting(LAST_EXPORT_KEY)).toBe("2026-11-16T09:00:00.000Z");
    expect(backupValue(await getSetting(LAST_EXPORT_KEY), "2026-11-16T10:00:00.000Z")).toBe("Ultima copia: oggi");
  });

  it("la copia delle impostazioni, dopo, non la cambia", async () => {
    await rememberEventsBackup(() => new Date("2026-11-10T09:00:00.000Z"));
    await exportSettingsCopy();
    expect(await getSetting(LAST_EXPORT_KEY)).toBe("2026-11-10T09:00:00.000Z");
  });
});
