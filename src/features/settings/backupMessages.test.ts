import { describe, expect, it } from "vitest";
import { describeImport, describeSettingsExport, describeSettingsImport } from "./backupMessages";

describe("describeImport", () => {
  it("errori di formato", () => {
    expect(describeImport({ ok: false, error: "invalid_json" })).toMatchObject({ ok: false });
    expect(describeImport({ ok: false, error: "wrong_format" }).text).toMatch(/non è una copia/);
    expect(describeImport({ ok: false, error: "unsupported_version" }).text).toMatch(/più recente/);
  });

  it("esito con eventi nuovi, conflitti e scarti", () => {
    const r = describeImport({ ok: true, added: 3, conflicts: [{ id: "a" } as never], rejected: [{ index: 0, errors: [] }] });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("3 eventi nuovi importati");
    expect(r.text).toContain("1 evento era diverso");
    expect(r.text).toContain("1 evento scartato");
  });

  it("copia già presente", () => {
    expect(describeImport({ ok: true, added: 0, conflicts: [], rejected: [] }).text).toMatch(/già sul telefono/);
  });

  it("impostazioni: esiti e chiavi dell'AI ignorate", () => {
    expect(describeSettingsImport({ ok: false, error: "wrong_format" }).text).toMatch(/non è una copia delle impostazioni/);
    expect(describeSettingsImport({ ok: false, error: "unsupported_version" }).text).toMatch(/più recente/);
    const done = describeSettingsImport({ ok: true, imported: 3, skipped: 1 });
    expect(done.ok).toBe(true);
    expect(done.text).toContain("3 impostazioni importate");
    expect(done.text).toContain("le chiavi e i token non si importano mai.");
    expect(done.text).not.toMatch(/intelligenza artificiale/);
    expect(describeSettingsImport({ ok: true, imported: 1, skipped: 0 }).text).toBe("1 impostazione importata.");
  });

  it("esportazione: il numero e la frase sulle chiavi", () => {
    expect(describeSettingsExport(12)).toBe("Copia pronta: 12 impostazioni, senza chiavi né token.");
    expect(describeSettingsExport(1)).toBe("Copia pronta: 1 impostazione, senza chiavi né token.");
    expect(describeSettingsExport(0)).toBe("Copia pronta: 0 impostazioni, senza chiavi né token.");
  });
});
