// Ingressi ostili da ~500 KB: l'estrazione e la lettura da testo sono sincrone, quindi un tempo
// quadratico bloccherebbe tutto il processo. Ogni caso deve finire entro un limite stretto.
import { describe, expect, it } from "vitest";
import { stepDurationFromText } from "./duration";
import { extractRecipeFromHtml } from "./html";
import { parseIngredientLine } from "./ingredient";
import { parseRecipeText } from "./text";

const SIZE = 500_000;
const LIMIT_MS = 1500;

function timed<T>(fn: () => T): { ms: number; value: T } {
  const t = performance.now();
  const value = fn();
  return { ms: performance.now() - t, value };
}

const rep = (unit: string, bytes = SIZE): string => unit.repeat(Math.ceil(bytes / unit.length));
const ld = (json: unknown): string =>
  `<script type="application/ld+json">${(typeof json === "string" ? json : JSON.stringify(json)).replace(/<\//g, "<\\/")}</script>`;
const page = (body: string, head = ""): string => `<html><head>${head}</head><body>${body}</body></html>`;

const GOOD = { "@type": "Recipe", name: "Torta", recipeIngredient: ["2 uova"], recipeInstructions: ["Cuocere."] };

const HTML_CASES: [string, string][] = [
  ["tag aperti '<a ' ripetuti", page(rep("<a "))],
  ["'<a ' ripetuti nel titolo", page("", `<title>${rep("<a ")}</title>`)],
  ["div mai chiusi", page(rep("<div>x"))],
  ["div annidati", page(rep("<div>") + rep("</div>", 100_000))],
  ["nav mai chiusi", page(rep("<nav>x"))],
  ["footer, form, aside mai chiusi alternati", page(rep("<footer><form><aside>x"))],
  ["script aperti senza chiusura", `<html>${rep("<script ")}`],
  ["script chiusi senza fine del tag", `<html>${rep("<script x ")}>`],
  ["commenti non chiusi", page(rep("<!--"))],
  ["CDATA e dichiarazioni ripetute", page(rep("<![CDATA[<!x<?y"))],
  ["meta senza chiusura", `<html><head>${rep("<meta ")}`],
  ["meta con attributo lunghissimo", `<html><head><meta property="og:title" content="${rep("a")}`],
  ["meta con nome di attributo lunghissimo", `<html><head><meta ${rep("a")}=1>`],
  ["script con tipo lunghissimo", `<script type="${rep("a")}">x</script>`],
  ["attributi ripetuti", page(`<a ${rep('b="1" ')}>x</a>`)],
  ["spazi dentro un tag", page(`<p${rep(" ")}>x</p>`)],
  ["spazi dopo '<br'", page(`<br${rep(" ")}x`)],
  ["spazi dopo chiusure", page(rep("</nav ") + rep("</script ", 50_000))],
  ["solo spazi e a capo", page(rep(" \n\t"))],
  ["main e article senza chiusura", page(rep("<main><article>x"))],
  ["head mai chiusi", `<html>${rep("<head>x")}`],
  ["entità ripetute", page(rep("&amp;&#x41;&bogus;&#99999999999;&"))],
  ["ampersand soli", page(rep("&"))],
  ["minori soli", page(rep("<"))],
  ["maggiori soli", page(rep(">"))],
  ["'<' seguito da lettere senza chiusura", page(rep("<x"))],
  ["JSON-LD: '<a ' ripetuti nel nome e negli ingredienti", page("", ld({ ...GOOD, name: rep("<a ", 200_000), recipeIngredient: [rep("<a ", 100_000), "2 uova"] }))],
  ["JSON-LD: '<a ' nei passi e nella descrizione", page("", ld({ ...GOOD, recipeInstructions: rep("<a ", 150_000), description: rep("<a ", 100_000) }))],
  ["JSON-LD: '<a ' in passi HowToStep e tag", page("", ld({ ...GOOD, recipeInstructions: [{ "@type": "HowToStep", text: rep("<a ", 150_000) }], keywords: rep("<a ,", 100_000), author: rep("<a ", 100_000) }))],
  ["JSON-LD: spazi ovunque", page("", ld(`{ "@type": "Recipe",${rep(" ")}"name": "T", "recipeIngredient": ["2 uova"${rep(" ")}], "recipeInstructions": "x"${rep(" ")} }`))],
  ["JSON-LD: virgole e spazi ripetuti", page("", ld(`{"@type":"Recipe","name":"T","recipeIngredient":["2 uova"${rep(", ", 200_000)}]}`))],
  ["JSON-LD: troncato con CDATA e commento", page("", `<script type="application/ld+json"><!--//<![CDATA[${rep(" ,")}`)],
  ["JSON-LD: cifre lunghissime nei campi", page("", ld({ ...GOOD, recipeYield: rep("1"), prepTime: rep("1"), recipeInstructions: [rep("1")], recipeIngredient: [rep("1")] }))],
  ["JSON-LD: cifre e unità ripetute nei passi", page("", ld({ ...GOOD, recipeInstructions: [rep("per 1 minuto "), rep("1-"), rep("9 "), `${rep("9", 100_000)} minuti`] }))],
  ["JSON-LD: tantissimi ingredienti e passi", page("", ld({ ...GOOD, recipeIngredient: Array.from({ length: 60_000 }, () => "1 uovo"), recipeInstructions: Array.from({ length: 60_000 }, () => "Mescolare.") }))],
  ["JSON-LD: tipi e @id enormi", page("", ld({ "@graph": Array.from({ length: 30_000 }, (_, i) => ({ "@id": `#n${i}`, "@type": rep("x", 5), n: { "@id": `#n${i + 1}` } })) }))],
  ["molti blocchi JSON-LD", page(rep(ld(GOOD).slice(0, 60) + "{}</script>", SIZE))],
];

describe("tempo su ingressi ostili da 500 KB: estrazione dalla pagina", () => {
  for (const [name, html] of HTML_CASES) {
    it(name, () => {
      const { ms, value } = timed(() => extractRecipeFromHtml(html));
      expect(ms, `${name}: ${Math.round(ms)} ms`).toBeLessThan(LIMIT_MS);
      expect(typeof value.found).toBe("boolean");
      if (!value.found) expect(value.text.length).toBeLessThanOrEqual(20_000);
    });
  }

  it("la pagina oltre 500 KB è scartata: una ricetta in coda non si legge", () => {
    const html = page(rep("x", 600_000), ld(GOOD).replace("<script", "<script"));
    const late = page(rep("x", 600_000) + ld(GOOD));
    expect(extractRecipeFromHtml(late).found).toBe(false);
    expect(extractRecipeFromHtml(html).found).toBe(true);
  });

  it("pagine ostili da 3 MB restano veloci grazie al limite di lettura", () => {
    const { ms } = timed(() => extractRecipeFromHtml(rep("<a ", 3_000_000)));
    expect(ms).toBeLessThan(LIMIT_MS);
  });
});

describe("tempo su ingressi ostili da 500 KB: lettura da testo e ingredienti", () => {
  const TEXT_CASES: [string, string][] = [
    ["spazi dopo 'Ingredienti'", `Ingredienti${rep(" ")}x\nPreparazione`],
    ["spazi dopo 'Preparazione'", `Preparazione${rep(" ")}x`],
    ["riga unica di cifre", rep("1")],
    ["righe di cifre e spazi", rep("1 ")],
    ["frazioni ripetute", rep("1/1 ")],
    ["intervalli ripetuti", rep("1-")],
    ["ripetizioni di 'per N minuti'", `Preparazione\n${rep("per 1 minuto ")}`],
    ["cifre lunghe seguite da minuti", `Preparazione\n${rep("9", 300_000)} minuti`],
    ["'q.b.' e parentesi ripetute", rep("q.b. (")],
    ["parentesi e virgole", rep("(,")],
    ["due punti e trattini", rep(": - ")],
    ["tantissime righe brevi", rep("200 g di farina\n")],
    ["righe con numerazione", rep("1. a\n")],
    ["a capo e spazi", rep("\n \t")],
    ["frazioni unicode ripetute", rep("1½ ")],
    ["intestazioni ripetute", rep("Ingredienti per 4 persone:\n")],
    ["tempo con spazi", `Tempo di preparazione:${rep(" ")}20 minuti`],
    ["porzioni con spazi", `Porzioni:${rep(" ")}4`],
  ];
  for (const [name, text] of TEXT_CASES) {
    it(name, () => {
      const { ms } = timed(() => parseRecipeText(text));
      expect(ms, `${name}: ${Math.round(ms)} ms`).toBeLessThan(LIMIT_MS);
    });
  }

  it("riga di ingrediente lunghissima", () => {
    for (const line of [rep("1"), rep("1 "), rep("1/"), rep(" "), rep("("), rep("q.b. "), `200 g di ${rep("a")}`, `${rep("a")}: 200 g`, rep("-")]) {
      const { ms } = timed(() => parseIngredientLine(line));
      expect(ms).toBeLessThan(LIMIT_MS);
    }
  });

  it("durata di un passo da testo ostile", () => {
    for (const t of [rep("1"), rep("1 "), rep("per 1 min "), rep(" "), `${rep("9", 2900)} minuti`]) {
      const { ms } = timed(() => stepDurationFromText(t));
      expect(ms).toBeLessThan(LIMIT_MS);
    }
  });
});
