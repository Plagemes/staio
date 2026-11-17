import { describe, expect, it } from "vitest";
import { MAX_PINNED, PINNED_NAME_CHARS, PINNED_TITLE, cleanName, normalizePinned, pinView, removePinned, renamePinned, toStore, withoutNotes } from "./pinned";
import type { ViewSpec } from "./spec";

const spec = (limit = 5): ViewSpec => ({
  title: "Il ferro",
  blocks: [{ type: "list", query: { name: "top_foods_for_nutrient", params: { nutrient: "ironMg", period: "last_30_days", limit } } }],
});
const NOW = "2026-11-16T10:00:00Z";

describe("viste fissate", () => {
  it("fissa, non duplica, rispetta il limite", () => {
    const first = pinView([], { id: "a", spec: spec(), now: NOW });
    expect(first.ok && first.views[0].name).toBe(PINNED_TITLE);
    if (!first.ok) return;
    expect(pinView(first.views, { id: "b", spec: spec(), now: NOW })).toEqual({ ok: false, reason: "already_pinned" });
    let views = first.views;
    for (let i = 1; i < MAX_PINNED; i++) {
      const r = pinView(views, { id: `v${i}`, spec: spec(1 + (i % 9) + (i > 9 ? 0 : 0)), now: NOW, name: `n${i}` });
      if (r.ok) views = r.views;
    }
    expect(views.length).toBeLessThanOrEqual(MAX_PINNED);
    const full = Array.from({ length: MAX_PINNED }, (_, i) => ({ id: `x${i}`, name: "n", pinnedAt: NOW, spec: spec(1 + (i % 10)) }));
    expect(pinView(full, { id: "z", spec: { ...spec(), title: "Altro" }, now: NOW })).toEqual({ ok: false, reason: "full" });
  });

  it("il titolo scritto dall'AI non si conserva: il nome è la domanda dell'utente, troncata, o la sua scelta", () => {
    const aiTitle: ViewSpec = { ...spec(), title: "Il ferro ti manca" };
    const asked = pinView([], { id: "a", spec: aiTitle, question: "Com'è andato il ferro questo mese?", now: NOW });
    expect(asked.ok && asked.views[0].name).toBe("Com'è andato il ferro questo mese?");
    expect(asked.ok && asked.views[0].spec.title).toBe(PINNED_TITLE);
    expect(JSON.stringify(asked)).not.toContain("ti manca");
    const long = pinView([], { id: "b", spec: aiTitle, question: "x".repeat(300), now: NOW });
    expect(long.ok && long.views[0].name).toHaveLength(PINNED_NAME_CHARS);
    const chosen = pinView([], { id: "c", spec: aiTitle, question: "domanda", name: "Il mio ferro", now: NOW });
    expect(chosen.ok && chosen.views[0].name).toBe("Il mio ferro");
    const bare = pinView([], { id: "d", spec: aiTitle, now: NOW });
    expect(bare.ok && bare.views[0].name).toBe(PINNED_TITLE);
    // due titoli diversi con gli stessi blocchi sono la stessa vista
    if (asked.ok) expect(pinView(asked.views, { id: "e", spec: { ...aiTitle, title: "Altro titolo" }, now: NOW })).toEqual({ ok: false, reason: "already_pinned" });
  });

  it("rileggendo, un nome salvato uguale al titolo dell'AI non conta come scelta dell'utente", () => {
    const stored = {
      version: 1,
      views: [
        { id: "a", name: "Il ferro", question: "come va il ferro?", pinnedAt: NOW, spec: spec() },
        { id: "b", name: "Il mio nome", pinnedAt: NOW, spec: spec(3) },
        { id: "c", name: "Il ferro", pinnedAt: NOW, spec: spec(4) },
      ],
    };
    const out = normalizePinned(stored);
    expect(out.map((v) => v.name)).toEqual(["come va il ferro?", "Il mio nome", PINNED_TITLE]);
    expect(out.every((v) => v.spec.title === PINNED_TITLE)).toBe(true);
  });

  it("le note dell'assistente non si fissano né si rileggono dall'archivio", () => {
    const withNote: ViewSpec = { ...spec(), blocks: [...spec().blocks, { type: "text", text: "Una nota qualunque" }] };
    const r = pinView([], { id: "a", spec: withNote, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.views[0].spec.blocks.some((b) => b.type === "text")).toBe(false);
    expect(JSON.stringify(toStore(r.views))).not.toContain("nota qualunque");
    // una vista che è solo una nota non ha nulla da fissare
    expect(pinView([], { id: "b", spec: { title: "Solo nota", blocks: [{ type: "text", text: "Ciao" }] }, now: NOW })).toEqual({ ok: false, reason: "invalid" });
    // una vista già salvata con una nota, da una versione precedente, la perde alla lettura
    const stored = { version: 1, views: [{ id: "a", name: "Ok", pinnedAt: NOW, spec: withNote }, { id: "b", name: "Solo nota", pinnedAt: NOW, spec: { title: "x", blocks: [{ type: "text", text: "Ciao" }] } }] };
    const out = normalizePinned(stored);
    expect(out.map((v) => v.id)).toEqual(["a"]);
    expect(out[0].spec.blocks).toHaveLength(1);
    // la stessa vista con e senza nota è la stessa vista
    expect(pinView(r.views, { id: "c", spec: spec(), now: NOW })).toEqual({ ok: false, reason: "already_pinned" });
    expect(withoutNotes(withNote)?.blocks).toHaveLength(1);
  });

  it("rifiuta una descrizione non valida", () => {
    expect(pinView([], { id: "a", spec: { title: "x", blocks: [{ type: "iframe" }] } as unknown as ViewSpec, now: NOW })).toEqual({ ok: false, reason: "invalid" });
  });

  it("rinomina e rimuove", () => {
    const r = pinView([], { id: "a", spec: spec(), now: NOW });
    if (!r.ok) throw new Error("non fissata");
    const renamed = renamePinned(r.views, "a", "  Il mio ferro \u0000 ");
    expect(renamed[0].name).toBe("Il mio ferro");
    expect(renamePinned(renamed, "a", "   ")[0].name).toBe("Il mio ferro");
    expect(renamePinned(renamed, "a", "x".repeat(500))[0].name).toHaveLength(PINNED_NAME_CHARS);
    expect(removePinned(renamed, "a")).toEqual([]);
    expect(removePinned(renamed, "altro")).toHaveLength(1);
  });

  it("rilegge dall'archivio e scarta ciò che non è valido, senza lanciare", () => {
    const good = { id: "a", name: "Ok", pinnedAt: NOW, spec: spec() };
    const store = {
      version: 1,
      views: [
        good,
        { ...good, id: "b", spec: { title: "x", blocks: [{ type: "script" }] } },
        { ...good, id: "a" },
        { id: "", name: "senza id", spec: spec() },
        { ...good, id: "c", spec: spec(7), name: 42 },
        null,
        "testo",
        { ...good, id: "d", spec: { ...spec(), extra: true } },
      ],
    };
    const out = normalizePinned(JSON.parse(JSON.stringify(store)));
    expect(out.map((v) => v.id)).toEqual(["a", "c"]);
    expect(out[1].name).toBe(PINNED_TITLE);
    for (const raw of [undefined, null, 5, "x", [], {}, { views: "no" }, { views: [[]] }]) expect(normalizePinned(raw)).toEqual([]);
  });

  it("il limite vale anche in lettura", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, name: "n", pinnedAt: NOW, spec: spec() }));
    expect(normalizePinned({ version: 1, views: many })).toHaveLength(MAX_PINNED);
  });

  it("il nome è testo semplice", () => {
    expect(cleanName("<b>x</b>\n‮")).toBe("<b>x</b>");
    expect(cleanName("")).toBeUndefined();
    expect(toStore([])).toEqual({ version: 1, views: [] });
  });
});
