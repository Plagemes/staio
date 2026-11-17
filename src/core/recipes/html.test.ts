import { describe, expect, it } from "vitest";
import { decodeEntities, extractRecipeFromHtml } from "./html";
import { recipeFieldsFromDraft } from "./draft";
import { recipeEvent } from "./test-helpers";
import { validateRecipeEvent } from "./validate";

const page = (head: string, body = "<h1>Titolo</h1>"): string =>
  `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Pagina</title>${head}</head><body>${body}</body></html>`;
const ld = (json: unknown): string =>
  `<script type="application/ld+json">${typeof json === "string" ? json : JSON.stringify(json)}</script>`;

const CARBONARA = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Spaghetti alla carbonara",
  description: "Il primo piatto romano per eccellenza.",
  author: { "@type": "Person", name: "Maria Rossi" },
  prepTime: "PT15M",
  cookTime: "PT1H",
  totalTime: "PT1H15M",
  recipeYield: "4 porzioni",
  recipeCategory: "Primi piatti",
  recipeCuisine: "Italiana",
  keywords: "pasta, uova, guanciale, pasta",
  recipeIngredient: [
    "320 g di spaghetti",
    "150 g di guanciale",
    "4 tuorli",
    "1 uovo intero",
    "50 g di pecorino romano grattugiato",
    "Pepe nero q.b.",
    "Sale",
  ],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Tagliare il guanciale a listarelle e rosolarlo in padella." },
    { "@type": "HowToStep", text: "Cuocere la pasta per 10 minuti in acqua salata." },
    { "@type": "HowToStep", text: "Mantecare fuori dal fuoco con le uova e il pecorino." },
  ],
};

describe("extractRecipeFromHtml: ricetta singola", () => {
  const res = extractRecipeFromHtml(page(ld(CARBONARA)), { url: "https://ricette.example/carbonara" });

  it("trova la ricetta e i campi principali", () => {
    expect(res.found).toBe(true);
    if (!res.found) return;
    const r = res.recipe;
    expect(r.title).toBe("Spaghetti alla carbonara");
    expect(r.description).toBe("Il primo piatto romano per eccellenza.");
    expect(r.servings).toBe(4);
    expect(r.times).toEqual({ prepMinutes: 15, cookMinutes: 60, totalMinutes: 75 });
    expect(r.origin).toEqual({ url: "https://ricette.example/carbonara", author: "Maria Rossi" });
    expect(r.tags).toEqual(["Primi piatti", "Italiana", "pasta", "uova", "guanciale"]);
    expect(res.alternatives).toEqual([]);
  });

  it("interpreta gli ingredienti scritti in italiano", () => {
    if (!res.found) throw new Error("non trovata");
    const q = res.recipe.ingredients.map((i) => [i.name, i.quantity?.value, i.quantity?.unit, i.note]);
    expect(q).toEqual([
      ["spaghetti", 320, "g", undefined],
      ["guanciale", 150, "g", undefined],
      ["tuorli", 4, "pz", undefined],
      ["uovo intero", 1, "pz", undefined],
      ["pecorino romano grattugiato", 50, "g", undefined],
      ["Pepe nero", undefined, undefined, "q.b."],
      ["Sale", undefined, undefined, undefined],
    ]);
    expect(res.recipe.ingredients[0]?.raw).toBe("320 g di spaghetti");
  });

  it("legge i passi con la durata solo se sicura", () => {
    if (!res.found) throw new Error("non trovata");
    expect(res.recipe.steps).toHaveLength(3);
    expect(res.recipe.steps[1]?.durationMinutes).toBe(10);
    expect(res.recipe.steps[0]?.durationMinutes).toBeUndefined();
  });

  it("la bozza diventa un evento valido", () => {
    if (!res.found) throw new Error("non trovata");
    const fields = recipeFieldsFromDraft(res.recipe);
    expect(validateRecipeEvent(recipeEvent("e1", "2026-03-01T10:00:00.000Z", fields))).toEqual([]);
  });

  it("senza indirizzo passato usa l'url della ricetta, se http o https", () => {
    const a = extractRecipeFromHtml(page(ld({ ...CARBONARA, url: "https://altro.example/c" })));
    const b = extractRecipeFromHtml(page(ld({ ...CARBONARA, url: "javascript:alert(1)" })));
    expect(a.found && a.recipe.origin.url).toBe("https://altro.example/c");
    expect(b.found && b.recipe.origin.url).toBeUndefined();
  });
});

describe("extractRecipeFromHtml: grafo", () => {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://x.example/#org", name: "Cucina X" },
      { "@type": "WebSite", "@id": "https://x.example/#site", name: "Cucina X" },
      { "@type": ["WebPage", "ItemPage"], "@id": "https://x.example/torta/#page", mainEntity: { "@id": "https://x.example/torta/#recipe" } },
      { "@type": "Person", "@id": "https://x.example/#me", name: "Giulia Bianchi" },
      {
        "@type": ["Recipe"],
        "@id": "https://x.example/torta/#recipe",
        name: "Torta di mele",
        author: { "@id": "https://x.example/#me" },
        recipeYield: ["8", "8 fette"],
        totalTime: "PT1H",
        recipeIngredient: ["3 mele", "200 g di farina", "2 uova", "100 ml di latte"],
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Impasto",
            itemListElement: [
              { "@type": "HowToStep", text: "Sbattere le uova con lo zucchero." },
              { "@id": "https://x.example/torta/#step2" },
            ],
          },
          { "@type": "HowToSection", name: "Cottura", itemListElement: [{ "@type": "HowToStep", name: "Infornare", text: "Infornare a 180 gradi per 40 minuti." }] },
        ],
      },
      { "@type": "HowToStep", "@id": "https://x.example/torta/#step2", text: "Unire la farina setacciata." },
    ],
  };

  it("trova la ricetta dentro @graph e risolve i riferimenti @id", () => {
    const res = extractRecipeFromHtml(page(ld(graph)));
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.recipe.title).toBe("Torta di mele");
    expect(res.recipe.servings).toBe(8);
    expect(res.recipe.origin.author).toBe("Giulia Bianchi");
    expect(res.recipe.steps.map((s) => s.text)).toEqual([
      "Sbattere le uova con lo zucchero.",
      "Unire la farina setacciata.",
      "Infornare a 180 gradi per 40 minuti.",
    ]);
    expect(res.recipe.steps[2]?.durationMinutes).toBe(40);
  });

  it("trova la ricetta anche dentro un array di nodi e un ItemList", () => {
    const a = extractRecipeFromHtml(page(ld([{ "@type": "WebSite", name: "x" }, CARBONARA])));
    expect(a.found && a.recipe.title).toBe("Spaghetti alla carbonara");
    const b = extractRecipeFromHtml(
      page(ld({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, item: CARBONARA }] })),
    );
    expect(b.found && b.recipe.title).toBe("Spaghetti alla carbonara");
  });

  it("accetta i tipi scritti con prefisso", () => {
    const res = extractRecipeFromHtml(page(ld({ ...CARBONARA, "@type": "https://schema.org/Recipe" })));
    expect(res.found).toBe(true);
    const res2 = extractRecipeFromHtml(page(ld({ ...CARBONARA, "@type": "schema:Recipe" })));
    expect(res2.found).toBe(true);
  });
});

describe("extractRecipeFromHtml: più ricette", () => {
  const poor = { "@type": "Recipe", name: "Ricetta scarna", recipeIngredient: ["acqua"] };
  const html = page(ld(poor) + ld(CARBONARA) + ld({ ...CARBONARA }) + ld({ "@type": "Recipe", name: "Solo titolo" }));

  it("restituisce la più completa e le altre come alternative, senza duplicati", () => {
    const res = extractRecipeFromHtml(html);
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.recipe.title).toBe("Spaghetti alla carbonara");
    expect(res.alternatives.map((r) => r.title)).toEqual(["Ricetta scarna"]);
  });
});

describe("extractRecipeFromHtml: durate e porzioni", () => {
  const rec = (extra: Record<string, unknown>) =>
    extractRecipeFromHtml(
      page(ld({ "@type": "Recipe", name: "T", recipeIngredient: ["1 uovo"], recipeInstructions: "Cuocere.", ...extra })),
    );

  it("legge durate ISO 8601 di vario tipo", () => {
    const r = rec({ prepTime: "PT0H20M", cookTime: "P0Y0M0DT1H30M0S", totalTime: "PT2H" });
    expect(r.found && r.recipe.times).toEqual({ prepMinutes: 20, totalMinutes: 120 });
    const r2 = rec({ prepTime: "PT45M", cookTime: "PT1H15M" });
    expect(r2.found && r2.recipe.times).toEqual({ prepMinutes: 45, cookMinutes: 75 });
    const r3 = rec({ prepTime: "boh", cookTime: "PT0M", totalTime: 90 });
    expect(r3.found && r3.recipe.times).toEqual({ totalMinutes: 90 });
    const r4 = rec({});
    expect(r4.found && r4.recipe.times).toBeUndefined();
  });

  it("legge le porzioni da formati diversi e rifiuta le masse", () => {
    const y = (v: unknown) => {
      const r = rec({ recipeYield: v });
      return r.found ? r.recipe.servings : "non trovata";
    };
    expect(y(6)).toBe(6);
    expect(y("6")).toBe(6);
    expect(y("Serves 4-6")).toBe(4);
    expect(y("12 biscotti")).toBe(12);
    expect(y(["2", "2 persone"])).toBe(2);
    expect(y("250 g")).toBeUndefined();
    expect(y(0)).toBeUndefined();
    expect(y("tante")).toBeUndefined();
  });
});

describe("extractRecipeFromHtml: istruzioni in forme diverse", () => {
  const steps = (v: unknown) => {
    const r = extractRecipeFromHtml(page(ld({ "@type": "Recipe", name: "T", recipeIngredient: ["1 uovo"], recipeInstructions: v })));
    return r.found ? r.recipe.steps.map((s) => s.text) : [];
  };

  it("testo con a capo, numerazione e liste HTML", () => {
    expect(steps("Sbattere.\nCuocere.\n\nServire.")).toEqual(["Sbattere.", "Cuocere.", "Servire."]);
    expect(steps("1. Sbattere le uova. 2. Cuocere in padella. 3. Servire caldo.")).toEqual([
      "Sbattere le uova.",
      "Cuocere in padella.",
      "Servire caldo.",
    ]);
    expect(steps("<ol><li>Sbattere</li><li>Cuocere</li></ol>")).toEqual(["Sbattere", "Cuocere"]);
    expect(steps("<p>Primo passo.</p><p>Secondo passo.</p>")).toEqual(["Primo passo.", "Secondo passo."]);
  });

  it("array di stringhe e passi con solo il nome", () => {
    expect(steps(["Uno", "Due"])).toEqual(["Uno", "Due"]);
    expect(steps([{ "@type": "HowToStep", name: "Mescolare tutto" }])).toEqual(["Mescolare tutto"]);
  });

  it("usa performTime dei passi", () => {
    const r = extractRecipeFromHtml(
      page(ld({ "@type": "Recipe", name: "T", recipeIngredient: ["1 uovo"], recipeInstructions: [{ "@type": "HowToStep", text: "Lievitare", performTime: "PT2H" }] })),
    );
    expect(r.found && r.recipe.steps[0]?.durationMinutes).toBe(120);
  });
});

describe("extractRecipeFromHtml: testo italiano e entità", () => {
  it("decodifica le entità negli ingredienti e toglie i tag", () => {
    const res = extractRecipeFromHtml(
      page(
        ld({
          "@type": "Recipe",
          name: "Pasta &amp; fagioli &#8211; la vera",
          recipeIngredient: ["200&nbsp;g di fagioli", "&frac12; cucchiaino di sale", "<b>1</b> cipolla", "Olio extravergine d&#39;oliva q.b."],
          recipeInstructions: "Cuocere i fagioli.",
        }),
      ),
    );
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.recipe.title).toBe("Pasta & fagioli – la vera");
    expect(res.recipe.ingredients.map((i) => [i.name, i.quantity?.value, i.quantity?.unit])).toEqual([
      ["fagioli", 200, "g"],
      ["sale", 0.5, "cucchiaino"],
      ["cipolla", 1, "pz"],
      ["Olio extravergine d'oliva", undefined, undefined],
    ]);
  });

  it("decodeEntities lavora in un solo passaggio e rifiuta i codici non validi", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("&#x41;&#66;&agrave;&egrave;")).toBe("ABàè");
    expect(decodeEntities("&#0;&#xD800;&#9999999;")).toBe("   ");
    expect(decodeEntities("&inesistente;")).toBe("&inesistente;");
  });
});

describe("extractRecipeFromHtml: HTML e JSON malformati", () => {
  it("ripara JSON con a capo nelle stringhe, virgole finali e commento HTML intorno", () => {
    const json = `<!--
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Zuppa
di ceci",
  "recipeIngredient": ["200 g di ceci", "1 carota",],
  "recipeInstructions": ["Lessare i ceci.",],
}
-->`;
    const res = extractRecipeFromHtml(page(ld(json)));
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.recipe.title).toBe("Zuppa di ceci");
    expect(res.recipe.ingredients).toHaveLength(2);
  });

  it("legge il JSON-LD con CDATA, tipo in maiuscolo e apici singoli", () => {
    const html = `<SCRIPT TYPE='application/LD+JSON'>//<![CDATA[
${JSON.stringify(CARBONARA)}
//]]></SCRIPT>`;
    expect(extractRecipeFromHtml(html).found).toBe(true);
  });

  it("legge il JSON-LD con virgolette scritte come entità", () => {
    const encoded = JSON.stringify(CARBONARA).replace(/"/g, "&quot;");
    expect(extractRecipeFromHtml(page(`<script type="application/ld+json">${encoded}</script>`)).found).toBe(true);
  });

  it("trova la ricetta in una pagina con tag non chiusi e script finale senza chiusura", () => {
    const html = `<html><head><title>Ricetta<body><div><p>Testo <b>grassetto<div class="x"
<script type="application/ld+json">${JSON.stringify(CARBONARA)}</script>
<ul><li>uno<li>due</ul><script type="application/ld+json">{"@type":"Recipe","name":"Tronca`;
    const res = extractRecipeFromHtml(html);
    expect(res.found).toBe(true);
    expect(res.found && res.recipe.title).toBe("Spaghetti alla carbonara");
  });

  it("ignora JSON-LD non valido e passa al testo", () => {
    const res = extractRecipeFromHtml(page(ld("{ non è json"), "<p>Ciao</p>"));
    expect(res.found).toBe(false);
  });

  it("ignora script di altro tipo che parlano di Recipe", () => {
    const html = page(`<script>var x = ${JSON.stringify(CARBONARA)};</script><script type="application/json">${JSON.stringify(CARBONARA)}</script>`);
    expect(extractRecipeFromHtml(html).found).toBe(false);
  });

  it("scarta un nodo Recipe senza ingredienti né passi", () => {
    expect(extractRecipeFromHtml(page(ld({ "@type": "Recipe", name: "Vuota" }))).found).toBe(false);
  });
});

describe("extractRecipeFromHtml: nessun dato strutturato", () => {
  const html = `<!doctype html><html><head>
<title>Lasagne | Sito di cucina</title>
<meta property="og:title" content="Lasagne alla bolognese &amp; besciamella">
<style>.x{color:red}</style>
<script>window.evil = function(){ document.title = "eseguito" }; var secret = "SEGRETO-NEL-SCRIPT";</script>
</head><body>
<nav><a href="/">Home</a><a href="/ricette">Ricette</a></nav>
<header><h1>Lasagne</h1></header>
<main>
<article>
<h2>Ingredienti</h2>
<ul><li>250 g di sfoglia</li><li>500 g di ragù</li><li>Besciamella q.b.</li></ul>
<h2>Preparazione</h2>
<p>Alternare gli strati.<br>Cuocere a 180 gradi per 40 minuti.</p>
<p>Questo contenuto serve a superare la soglia minima di lunghezza del testo principale: ${"parola ".repeat(40)}</p>
<img src="http://tracker.example/pixel.gif" onerror="alert(1)">
</article>
</main>
<!-- commento SEGRETO-NEL-COMMENTO -->
<form><input name="email"><button>Iscriviti alla newsletter</button></form>
<footer>Copyright Sito di cucina - Privacy</footer>
<script>document.write("<b>script finale</b>")</script>
</body></html>`;

  it("restituisce 'non trovata' con titolo e testo principale ripuliti", () => {
    const res = extractRecipeFromHtml(html);
    expect(res.found).toBe(false);
    if (res.found) return;
    expect(res.title).toBe("Lasagne alla bolognese & besciamella");
    expect(res.text).toContain("Ingredienti");
    expect(res.text).toContain("250 g di sfoglia");
    expect(res.text).toContain("Alternare gli strati.\nCuocere a 180 gradi per 40 minuti.");
    expect(res.text).not.toMatch(/SEGRETO|evil|eseguito|color:red|Home|Iscriviti|Copyright|tracker|onerror|<|>/);
  });

  it("senza main né article usa il corpo della pagina senza menu e piè di pagina", () => {
    const res = extractRecipeFromHtml(`<html><head><title>Solo titolo</title></head><body><nav>Menu</nav><h1>Ricetta</h1><p>Mescolare &amp; servire</p><footer>Fine</footer></body></html>`);
    expect(res.found).toBe(false);
    if (res.found) return;
    expect(res.title).toBe("Solo titolo");
    expect(res.text).toBe("Ricetta\nMescolare & servire");
  });

  it("usa h1 se manca il titolo e tronca i testi lunghi", () => {
    const res = extractRecipeFromHtml(`<body><h1>Solo h1</h1>${"<p>riga di testo abbastanza lunga</p>".repeat(2000)}</body>`, { maxTextChars: 500 });
    expect(res.found).toBe(false);
    if (res.found) return;
    expect(res.title).toBe("Solo h1");
    expect(res.text.length).toBeLessThanOrEqual(500);
  });
});

describe("extractRecipeFromHtml: robustezza", () => {
  it("non lancia mai e restituisce 'non trovata' per input non HTML", () => {
    for (const v of ["", " ", "{}", "null", "<", "<<<>>>", "<script", "<script type=application/ld+json>", "\u0000\u0001", undefined, null, 42, {}, []]) {
      let res: ReturnType<typeof extractRecipeFromHtml> | undefined;
      expect(() => {
        res = extractRecipeFromHtml(v as unknown as string);
      }).not.toThrow();
      expect(res?.found).toBe(false);
    }
  });

  it("regge JSON molto annidato e cicli di riferimenti @id", () => {
    const deep = "[".repeat(5000) + "]".repeat(5000);
    expect(() => extractRecipeFromHtml(page(ld(deep)))).not.toThrow();
    const cyc = { "@graph": [{ "@id": "#a", "@type": "Thing", x: { "@id": "#a" }, y: { "@id": "#b" } }, { "@id": "#b", "@type": "Thing", z: { "@id": "#a" } }] };
    expect(extractRecipeFromHtml(page(ld(cyc))).found).toBe(false);
    const selfRef = { "@type": "Recipe", "@id": "#r", name: "Auto", recipeIngredient: ["1 uovo"], recipeInstructions: { "@id": "#r" } };
    expect(() => extractRecipeFromHtml(page(ld(selfRef)))).not.toThrow();
  });

  it("resta veloce su pagine ostili con migliaia di tag mai chiusi", () => {
    const start = Date.now();
    for (const tag of ["nav", "footer", "form", "aside", "button", "head", "script", "style", "svg", "main", "article"]) {
      const html = `<html><body>${`<${tag}>x`.repeat(60_000)}</body></html>`;
      expect(extractRecipeFromHtml(html).found).toBe(false);
    }
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("taglia le pagine troppo grandi", () => {
    const html = page(ld(CARBONARA)) + "x".repeat(1000);
    expect(extractRecipeFromHtml(html, { maxHtmlChars: 50 }).found).toBe(false);
  });

  it("non esegue né richiama nulla: il risultato è solo testo semplice", () => {
    const evil = { ...CARBONARA, name: "<img src=x onerror=alert(1)>Torta", recipeIngredient: ["<script>alert(1)</script>2 uova"] };
    const res = extractRecipeFromHtml(page(ld(JSON.stringify(evil).replace(/<\//g, "<\\/"))));
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(JSON.stringify(res)).not.toMatch(/<img|<script|onerror/);
  });
});
