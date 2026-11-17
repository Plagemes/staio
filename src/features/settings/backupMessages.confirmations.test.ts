import { describe, expect, it } from "vitest";
import { describeImport } from "./backupMessages";

describe("esito del ripristino con conferme di allergeni", () => {
  it("lo dice, anche quando non c'è nient'altro di nuovo", () => {
    const base = { ok: true as const, added: 0, conflicts: [], rejected: [] };
    expect(describeImport({ ...base, allergenConfirmations: 2 }).text).toContain(
      "Questa copia contiene 2 conferme di allergeni date in precedenza: controllale in Obiettivi.",
    );
    expect(describeImport({ ...base, added: 5, allergenConfirmations: 1 }).text).toMatch(/5 eventi nuovi importati.*1 conferma di allergeni data in precedenza: controllala in Obiettivi/);
  });

  it("senza conferme il testo è quello di prima", () => {
    expect(describeImport({ ok: true, added: 0, conflicts: [], rejected: [] }).text).toBe("Questa copia era già sul telefono: non c'è niente di nuovo.");
  });
});
