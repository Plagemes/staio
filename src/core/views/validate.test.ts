import { describe, expect, it } from "vitest";
import { VIEW_LIMITS } from "./spec";
import { validateView } from "./validate";

const figure = (over: Record<string, unknown> = {}) => ({
  type: "figure",
  label: "Ferro, media al giorno",
  query: { name: "nutrient_average", params: { nutrient: "ironMg", period: "last_30_days" } },
  ...over,
});
const view = (blocks: unknown[], over: Record<string, unknown> = {}) => ({ title: "Il ferro", blocks, ...over });

function codes(input: unknown): string[] {
  return validateView(input).problems.map((p) => p.code);
}

describe("vista valida", () => {
  it("accetta tutti i tipi di blocco e scrive i parametri predefiniti", () => {
    const r = validateView(
      view([
        { type: "figure", label: "Media", query: { name: "nutrient_average", params: { nutrient: "ironMg" } } },
        { type: "list", query: { name: "top_foods_for_nutrient", params: { nutrient: "ironMg" } } },
        { type: "chart", label: "Andamento", query: { name: "weight_trend" } },
        { type: "text", text: "Contano solo i giorni tracciati." },
        { type: "action", action: "open_pantry" },
        { type: "action", action: "add_to_shopping", item: "Latte intero" },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.problems).toEqual([]);
    expect(r.view.blocks).toHaveLength(6);
    expect(r.view.blocks[0]).toMatchObject({ query: { params: { nutrient: "ironMg", period: "last_30_days" } } });
    expect(r.view.blocks[1]).toMatchObject({ query: { params: { limit: 5, period: "last_30_days" } } });
    expect(r.view.blocks[2]).toMatchObject({ query: { name: "weight_trend", params: { period: "last_30_days" } } });
  });
});

describe("risposte ostili", () => {
  it("non è una vista", () => {
    for (const input of [null, undefined, 3, "ciao", [], [figure()], true]) {
      const r = validateView(input);
      expect(r.ok).toBe(false);
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });

  it("componenti inventati: il blocco è scartato e si dice quale", () => {
    const r = validateView(view([figure(), { type: "iframe", src: "https://example.invalid" }, { type: "script", text: "alert(1)" }, { text: "senza tipo" }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.blocks).toHaveLength(1);
    expect(r.problems.filter((p) => p.code === "unknown_block").map((p) => p.path)).toEqual(["blocks[1].type", "blocks[2].type", "blocks[3].type"]);
  });

  it("interrogazioni inesistenti, anche con nomi di proprietà degli oggetti", () => {
    for (const name of ["drop_table", "__proto__", "constructor", "toString", "hasOwnProperty", "", "NUTRIENT_AVERAGE", 42, null]) {
      const r = validateView(view([{ type: "figure", label: "x", query: { name } }]));
      expect(r.ok).toBe(false);
      expect(r.problems.some((p) => p.code === "unknown_query" || p.code === "missing_field")).toBe(true);
    }
  });

  it("parametri fuori limite o del tipo sbagliato", () => {
    const bad: Record<string, unknown>[] = [
      { nutrient: "ironMg", period: "last_1000_days" },
      { nutrient: "ferro", period: "last_7_days" },
      { nutrient: ["ironMg"] },
      { nutrient: "ironMg", period: 30 },
      { period: "last_7_days" },
    ];
    for (const params of bad) {
      const r = validateView(view([{ type: "figure", label: "x", query: { name: "nutrient_average", params } }]));
      expect(r.ok, JSON.stringify(params)).toBe(false);
    }
    for (const limit of [0, 11, 999, 2.5, "5", -1, null, NaN, Infinity, 1e21]) {
      const r = validateView(view([{ type: "list", query: { name: "top_foods_for_nutrient", params: { nutrient: "ironMg", limit } } }]));
      expect(r.ok, String(limit)).toBe(false);
    }
    for (const within_days of [0, 31, 1.5]) {
      expect(validateView(view([{ type: "list", query: { name: "expiring_soon", params: { within_days } } }])).ok).toBe(false);
    }
    expect(validateView(view([{ type: "figure", label: "x", query: { name: "spend_total", params: { group: "armi" } } }])).ok).toBe(false);
    expect(validateView(view([{ type: "list", query: { name: "expiring_soon", params: { location: "garage" } } }])).ok).toBe(false);
  });

  it("parametri sconosciuti o nomi come __proto__", () => {
    const r = validateView(view([figure(), { type: "figure", label: "x", query: { name: "pantry_value", params: { limit: 3 } } }]));
    expect(r.ok && r.view.blocks.length).toBe(1);
    expect(codes(view([{ type: "figure", label: "x", query: { name: "pantry_value", params: JSON.parse('{"__proto__": 1}') } }]))).toContain("unknown_param");
  });

  it("l'alimento da cercare ammette solo un nome", () => {
    const ok = (food: unknown) => validateView(view([{ type: "list", query: { name: "food_consumption", params: { food } } }])).ok;
    expect(ok("latte")).toBe(true);
    expect(ok("pasta d'oro")).toBe(true);
    for (const food of ["<script>alert(1)</script>", "latte; drop table", "a", "", "x".repeat(41), 5, "../../etc/passwd", "latte\u0000"]) {
      expect(ok(food), String(food)).toBe(false);
    }
  });

  it("campi extra a ogni livello", () => {
    expect(validateView(view([figure()], { version: 2 })).ok).toBe(false);
    expect(validateView(view([figure()], { onload: "x()" })).problems[0].code).toBe("unknown_field");
    const block = validateView(view([figure(), figure({ html: "<b>x</b>" })]));
    expect(block.ok && block.view.blocks.length).toBe(1);
    const query = validateView(view([figure(), figure({ query: { name: "nutrient_average", params: { nutrient: "ironMg" }, sql: "select *" } })]));
    expect(query.ok && query.view.blocks.length).toBe(1);
    expect(codes(view([{ type: "text", text: "ok", color: "red" }]))).toContain("unknown_field");
    expect(codes(view([{ type: "action", action: "open_pantry", item: "pane" }]))).toContain("unknown_field");
  });

  it("testi lunghissimi", () => {
    const long = "a".repeat(100_000);
    expect(validateView(view([figure()], { title: long })).ok).toBe(false);
    expect(validateView(view([figure()], { title: "a".repeat(VIEW_LIMITS.titleChars + 1) })).ok).toBe(false);
    expect(validateView(view([figure()], { title: "a".repeat(VIEW_LIMITS.titleChars) })).ok).toBe(true);
    const r = validateView(view([figure(), figure({ label: long }), { type: "text", text: "b".repeat(VIEW_LIMITS.textChars + 1) }, { type: "action", action: "add_to_shopping", item: long }]));
    expect(r.ok && r.view.blocks.length).toBe(1);
    expect(r.problems.filter((p) => p.code === "too_long")).toHaveLength(3);
    // il messaggio non riporta il testo lunghissimo
    expect(JSON.stringify(r.problems).length).toBeLessThan(2000);
  });

  it("niente numeri nei testi liberi: i numeri li calcola l'app", () => {
    expect(codes(view([figure({ label: "Ferro: 12 mg" })]))).toContain("digits_in_text");
    expect(codes(view([{ type: "text", text: "Hai raggiunto il 120% del riferimento" }]))).toContain("digits_in_text");
    expect(codes(view([figure()], { title: "Ultimi 30 giorni" }))).toContain("digits_in_text");
    expect(codes(view([figure()], { title: "Ferro ٣٤" }))).toContain("digits_in_text");
  });

  it("niente numeri o quantità scritti a lettere, né percentuali", () => {
    const bad = [
      "Dodici grammi di ferro",
      "Quasi cento",
      "Mezzo chilo di troppo",
      "Il doppio del solito",
      "Venticinque giorni",
      "Trentatré giorni",
      "Duecento calorie",
      "Tremila passi",
      "Dieci per cento",
      "Molto più del %",
      "Un percento",
      "Zero zuccheri",
      "Centinaia di voci",
      "Una decina di giorni",
      "METÀ della dose",
      "Dimezzato",
      "Una ventina di giorni",
      "Una trentina di voci",
      "Un paio di uova",
      "Un quarto della dose",
      "Un terzo in meno",
      "Un quinto del totale",
      "Raddoppiato",
      "Triplicato",
      "Quadruplo del solito",
      "Un etto di formaggio",
      "Due chili",
      "Un litro d'acqua",
      "Mezzo grammo",
      "Twelve grams",
      "Half of it",
      "A dozen eggs",
      "Twice a day",
      "Hundred percent",
      "XII",
      "Capitolo XIV",
      "Ferro IV",
    ];
    for (const text of bad) {
      expect(codes(view([figure(), { type: "text", text }])), text).toContain("number_words");
      expect(codes(view([figure({ label: text })])), text).toContain("number_words");
      expect(validateView(view([figure()], { title: text })).ok, text).toBe(false);
    }
    // parole comuni che somigliano a numeri o sono articoli restano ammesse
    for (const text of ["Una settimana di ferro", "Un accento sul ferro", "Il centro della dispensa", "Ventilazione e frigo", "Mese scorso", "Uno sguardo ai latticini", "I latticini", "L'andamento del ferro", "Settimana in corso", "Quantità e qualità"]) {
      expect(validateView(view([figure({ label: text })])).ok, text).toBe(true);
    }
  });

  it("affermazioni mediche scritte a parole non passano come numeri, ma i testi restano brevi", () => {
    const r = validateView(view([figure(), { type: "text", text: "a".repeat(VIEW_LIMITS.textChars + 1) }]));
    expect(r.problems.some((p) => p.code === "too_long")).toBe(true);
    expect(VIEW_LIMITS.textChars).toBeLessThanOrEqual(160);
    expect(VIEW_LIMITS.labelChars).toBeLessThanOrEqual(40);
    expect(VIEW_LIMITS.titleChars).toBeLessThanOrEqual(50);
  });

  it("testo vuoto o fatto di soli caratteri invisibili", () => {
    expect(codes(view([figure({ label: "   " })]))).toContain("empty_text");
    expect(codes(view([figure({ label: "​‮" })]))).toContain("empty_text");
    expect(codes(view([figure({ label: 5 })]))).toContain("bad_type");
  });

  it("i testi diventano testo semplice: senza caratteri di controllo né di direzione", () => {
    const r = validateView(view([figure({ label: "Fer‮ro\u0000  \n  dose" })], { title: "<b>Ferro</b> &amp; co" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.blocks[0]).toMatchObject({ label: "Ferro dose" });
    // il markup non si interpreta né si toglie: resta testo letterale (React lo mostra com'è)
    expect(r.view.title).toBe("<b>Ferro</b> &amp; co");
  });

  it("azioni non ammesse o incomplete", () => {
    for (const action of ["delete_all", "open_url", "__proto__", 3, undefined]) {
      expect(codes(view([figure(), { type: "action", action }])), String(action)).toContain("unknown_action");
    }
    expect(codes(view([figure(), { type: "action", action: "add_to_shopping" }]))).toContain("missing_field");
    expect(codes(view([figure(), { type: "action", action: "add_to_shopping", item: "<img src=x>" }]))).toContain("bad_param");
  });

  it("un'interrogazione che dà un tipo di risultato non adatto al blocco", () => {
    const r = validateView(view([figure(), { type: "figure", label: "x", query: { name: "top_foods_for_nutrient", params: { nutrient: "ironMg" } } }, { type: "chart", query: { name: "pantry_value" } }]));
    expect(r.ok && r.view.blocks.length).toBe(1);
    expect(r.problems.filter((p) => p.code === "result_mismatch")).toHaveLength(2);
  });

  it("troppi blocchi: se ne tengono al massimo il limite", () => {
    const r = validateView(view(Array.from({ length: 5000 }, () => figure())));
    expect(r.ok && r.view.blocks.length).toBe(VIEW_LIMITS.maxBlocks);
    expect(r.problems.some((p) => p.code === "too_many_blocks")).toBe(true);
  });

  it("senza nessun blocco valido la vista è rifiutata", () => {
    for (const blocks of [[], [{ type: "iframe" }], undefined, "figure", { 0: figure() }]) {
      const r = validateView({ title: "x", blocks });
      expect(r.ok).toBe(false);
    }
    expect(validateView({ blocks: [figure()] }).ok).toBe(false);
    expect(validateView({ title: "x" }).ok).toBe(false);
  });

  it("non lancia mai, nemmeno con oggetti che esplodono o riferimenti circolari", () => {
    const bomb = new Proxy({}, { get: () => { throw new Error("boom"); }, ownKeys: () => { throw new Error("boom"); }, getPrototypeOf: () => { throw new Error("boom"); } });
    const circular: Record<string, unknown> = { title: "x" };
    circular.blocks = [circular];
    expect(() => validateView(bomb)).not.toThrow();
    expect(() => validateView(view([bomb]))).not.toThrow();
    expect(() => validateView(circular)).not.toThrow();
    expect(validateView(bomb).ok).toBe(false);
    expect(validateView(circular).ok).toBe(false);
  });

  it("__proto__ nel JSON non inquina nulla e conta come campo sconosciuto", () => {
    const parsed = JSON.parse('{"title":"x","blocks":[],"__proto__":{"polluted":true}}');
    const r = validateView(parsed);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.code === "unknown_field")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("la vista ripulita non contiene nulla che non fosse nel catalogo", () => {
    const r = validateView(view([figure(), figure({ label: "ok" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.view);
    expect(JSON.parse(json)).toEqual(r.view);
    expect(Object.keys(r.view).sort()).toEqual(["blocks", "title"]);
  });
});
