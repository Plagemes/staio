import { describe, expect, it, vi } from "vitest";
import type { ExtractedRecipe } from "@/core/recipes";
import { formFromDraft, buildRecipeFields } from "./form";
import {
  IMPORT_MESSAGES,
  draftFromExtracted,
  draftFromText,
  draftIsEmpty,
  draftSummary,
  importFromUrl,
  normalizeUrl,
  readImportResponse,
} from "./importDraft";

const extracted: ExtractedRecipe = {
  title: "Carbonara",
  servings: 4,
  ingredients: [{ raw: "400 g spaghetti", name: "spaghetti", quantity: { value: 400, unit: "g" }, recognized: true }],
  steps: [{ text: "Cuoci la pasta." }],
  equipment: [],
  tags: ["primo"],
  origin: { url: "https://cucina.example/carbonara", author: "Luca" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("normalizeUrl", () => {
  it("accetta https, aggiunge lo schema se manca, rifiuta il resto con un codice", () => {
    expect(normalizeUrl(" https://a.it/x ")).toEqual({ ok: true, url: "https://a.it/x" });
    expect(normalizeUrl("www.a.it/x")).toEqual({ ok: true, url: "https://www.a.it/x" });
    expect(normalizeUrl("")).toEqual({ ok: false, code: "empty" });
    expect(normalizeUrl("http://a.it")).toEqual({ ok: false, code: "not_https" });
    expect(normalizeUrl("ftp://a.it")).toEqual({ ok: false, code: "not_https" });
    expect(normalizeUrl("due parole")).toEqual({ ok: false, code: "invalid_url" });
    expect(normalizeUrl("localhost")).toEqual({ ok: false, code: "invalid_url" });
  });
});

describe("readImportResponse", () => {
  it("ricetta trovata", () => {
    const o = readImportResponse({ ok: true, found: true, recipe: extracted, alternatives: [extracted] }, "https://x.it/");
    expect(o).toMatchObject({ kind: "recipe", alternatives: 1, url: "https://x.it/" });
  });

  it("nessun dato strutturato: testo ripulito", () => {
    expect(readImportResponse({ ok: true, found: false, title: "Pagina", text: "Ingredienti…" }, "https://x.it/")).toEqual({
      kind: "text",
      title: "Pagina",
      text: "Ingredienti…",
      url: "https://x.it/",
    });
  });

  it("ogni codice d'errore del server ha un messaggio chiaro", () => {
    for (const code of ["rate_limited", "forbidden_origin", "address_not_allowed", "unreachable", "timeout", "not_https", "busy"] as const) {
      const o = readImportResponse({ ok: false, error: { code, message: "x" } }, "u");
      expect(o).toEqual({ kind: "error", code, message: IMPORT_MESSAGES[code] });
    }
    expect(readImportResponse({ ok: false, error: { code: "boh" } }, "u")).toMatchObject({ kind: "error", code: "internal" });
  });

  it("forme inattese diventano un errore, non un'eccezione", () => {
    for (const bad of [null, 5, "x", [], {}, { ok: true }, { ok: true, found: true, recipe: { title: 3 } }]) {
      expect(readImportResponse(bad, "u")).toMatchObject({ kind: "error", code: "bad_response" });
    }
  });
});

describe("importFromUrl", () => {
  const online = { online: true };

  it("chiama la rotta della stessa origine con l'indirizzo in JSON", async () => {
    const fetch = vi.fn(async () => json({ ok: true, found: true, recipe: extracted, alternatives: [] }));
    const o = await importFromUrl("cucina.example/carbonara", { fetch, ...online });
    expect(o.kind).toBe("recipe");
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/ricetta");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://cucina.example/carbonara" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("senza rete non chiama nemmeno la rotta", async () => {
    const fetch = vi.fn();
    const o = await importFromUrl("https://a.it/x", { fetch, online: false });
    expect(o).toMatchObject({ kind: "error", code: "offline" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("indirizzo rifiutato prima di chiamare", async () => {
    const fetch = vi.fn();
    expect(await importFromUrl("http://a.it", { fetch, ...online })).toMatchObject({ code: "not_https" });
    expect(await importFromUrl("  ", { fetch, ...online })).toMatchObject({ code: "empty" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sito non raggiungibile, troppe richieste, origine non ammessa", async () => {
    const send = (status: number, code: string) => async () => json({ ok: false, error: { code, message: "x" } }, status);
    expect(await importFromUrl("https://a.it/x", { fetch: send(502, "unreachable"), ...online })).toMatchObject({ code: "unreachable" });
    expect(await importFromUrl("https://a.it/x", { fetch: send(429, "rate_limited"), ...online })).toMatchObject({ code: "rate_limited" });
    expect(await importFromUrl("https://a.it/x", { fetch: send(403, "forbidden_origin"), ...online })).toMatchObject({ code: "forbidden_origin" });
  });

  it("un 429 senza corpo leggibile resta «troppe richieste»", async () => {
    const fetch = async () => new Response("<html>", { status: 429 });
    expect(await importFromUrl("https://a.it/x", { fetch, ...online })).toMatchObject({ code: "rate_limited" });
  });

  it("rete che cade a metà", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await importFromUrl("https://a.it/x", { fetch, ...online })).toMatchObject({ code: "network" });
  });

  it("risposta non JSON", async () => {
    const fetch = async () => new Response("oops", { status: 500 });
    expect(await importFromUrl("https://a.it/x", { fetch, ...online })).toMatchObject({ code: "bad_response" });
  });
});

describe("bozze", () => {
  it("dai dati della pagina: la fonte è sempre salvata, con l'indirizzo richiesto se la pagina non ne dà uno", () => {
    const d = draftFromExtracted({ ...extracted, origin: { author: "Luca" } }, "https://cucina.example/carbonara");
    expect(d.origin).toEqual({ author: "Luca", url: "https://cucina.example/carbonara" });
    expect(d.via).toBe("page");
    expect(draftSummary(d)).toBe("1 ingrediente, 1 passo. Porzioni: 4.");
  });

  it("dal testo incollato: titolo, porzioni, ingredienti, passi e fonte scritta dall'utente", () => {
    const d = draftFromText(
      "Pasta al pomodoro\nPorzioni: 4\nIngredienti\n320 g spaghetti\n400 ml passata\nsale q.b.\nPreparazione\nCuoci la pasta per 10 minuti.\nCondisci.",
      { url: " https://blog.example/pasta ", author: "Giulia" },
    );
    expect(d.title).toBe("Pasta al pomodoro");
    expect(d.servings).toBe(4);
    expect(d.ingredients.map((i) => i.name)).toEqual(["spaghetti", "passata", "sale"]);
    expect(d.steps).toHaveLength(2);
    expect(d.steps[0]?.durationMinutes).toBe(10);
    expect(d.origin).toEqual({ url: "https://blog.example/pasta", author: "Giulia" });
    expect(d.via).toBe("text");
    expect(draftIsEmpty(d)).toBe(false);
  });

  it("il testo di una pagina usa il titolo della pagina come riserva", () => {
    const d = draftFromText("320 g spaghetti\n400 ml passata", { url: "https://x.it/p", title: "Dal sito" });
    expect(d.title).toBe("Dal sito");
    expect(draftSummary(d)).toContain("Porzioni: non indicate");
  });

  it("un testo senza ricetta dà una bozza vuota, e le righe non capite si conservano", () => {
    expect(draftIsEmpty(draftFromText("ciao a tutti, oggi niente di speciale."))).toBe(true);
    const d = draftFromText("");
    expect(draftIsEmpty(d)).toBe(true);
    const odd = draftFromText("Zuppa\nIngredienti\n200 g ceci\nPer la guarnizione:\nPreparazione\nCuoci.");
    expect(odd.leftovers).toContain("Per la guarnizione:");
  });

  it("il contenuto che sembra HTML resta testo, e la bozza è modificabile prima di salvare", () => {
    const d = draftFromText("<script>alert(1)</script>\nIngredienti\n100 g <b>farina</b>\nPreparazione\nImpasta <img src=x onerror=alert(1)>.");
    const form = formFromDraft(d);
    expect(form.ingredients.some((i) => i.name.includes("<b>"))).toBe(true);
    const built = buildRecipeFields({ ...form, title: form.title || "Prova", servingsText: "2" });
    // i tag non vengono interpretati né rimossi: arrivano come testo, da mostrare come testo
    expect(built.ok).toBe(true);
  });
});
