import { describe, expect, it } from "vitest";
import { describeImport } from "./backupMessages";

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
});
