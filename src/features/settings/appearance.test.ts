import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { exportSettings, importSettings, setSetting, getSetting, wipeAll } from "@/data";
import { MODE_SETTING_KEY, THEME_SETTING_KEY } from "@/design";

beforeEach(async () => {
  await wipeAll();
});

describe("preferenze di aspetto", () => {
  it("rientrano nell'esportazione delle impostazioni e tornano con l'importazione", async () => {
    await setSetting(THEME_SETTING_KEY, "ardesia");
    await setSetting(MODE_SETTING_KEY, "dark");
    await setSetting("ai.key", "segreto");
    const file = await exportSettings();
    expect(file.settings[THEME_SETTING_KEY]).toBe("ardesia");
    expect(file.settings[MODE_SETTING_KEY]).toBe("dark");
    expect(file.settings["ai.key"]).toBeUndefined();

    await wipeAll();
    expect(await getSetting(THEME_SETTING_KEY)).toBeUndefined();
    const res = await importSettings(file);
    expect(res).toMatchObject({ ok: true });
    expect(await getSetting(THEME_SETTING_KEY)).toBe("ardesia");
    expect(await getSetting(MODE_SETTING_KEY)).toBe("dark");
  });
});
