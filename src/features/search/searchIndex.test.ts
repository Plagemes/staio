import { describe, expect, it } from "vitest";
import { activeLots, derivePantry } from "@/core/ledger";
import { buildCaptureEvents } from "../capture";
import { evaluateLots } from "../lots";
import { SEARCH_PAGES } from "./pages";
import { MAX_PER_GROUP, isSearching, pantrySources, queryText, search, type SearchGroup, type SearchSources } from "./searchIndex";

const MILK = { lotId: "lot-milk", name: "Latte intero", detail: "1 l · Frigo · ~3 giorni" };

const sources = (over: Partial<SearchSources> = {}): SearchSources => ({
  pantry: [MILK, { lotId: "lot-chicken", name: "Petto di pollo", detail: "400 g · Frigo · domani" }],
  recipes: [],
  habits: [],
  pages: SEARCH_PAGES,
  ...over,
});

const group = (groups: SearchGroup[], title: SearchGroup["title"]) => groups.find((g) => g.title === title);
const titles = (groups: SearchGroup[]) => groups.map((g) => g.title);
const labels = (g: SearchGroup | undefined) => (g?.results ?? []).map((r) => r.label);

describe("search: che cosa c'è in casa", () => {
  it("«lat» con il latte in frigo: la riga dice quanto, dove e quando scade, e apre la sua scheda", () => {
    const groups = search("lat", sources());
    const home = group(groups, "In casa");
    expect(home?.results).toEqual([{ id: "lot:lot-milk", label: "Latte intero", detail: "1 l · Frigo · ~3 giorni", href: "/app/dispensa?lotto=lot-milk" }]);
    expect(home?.note).toBeUndefined();
  });

  it("«lat» offre anche le due azioni, con ciò che è scritto tra virgolette", () => {
    const actions = group(search("lat", sources()), "Azioni");
    expect(labels(actions)).toEqual(["Aggiungi “lat” alla spesa", "Aggiungi “lat” alla dispensa"]);
    expect(actions?.results[0]).toMatchObject({ action: "addToShopping" });
    expect(actions?.results[0].href).toBeUndefined();
    expect(actions?.results[1]).toMatchObject({ action: "addToPantry", href: "/app/cattura?nome=lat" });
  });

  it("«pane» senza pane in casa: il gruppo c'è lo stesso e lo dice, poi le azioni", () => {
    const groups = search("pane", sources());
    expect(titles(groups)).toEqual(["In casa", "Azioni"]);
    expect(group(groups, "In casa")).toEqual({ title: "In casa", results: [], note: "Non ne hai in casa." });
    expect(labels(group(groups, "Azioni"))).toEqual(["Aggiungi “pane” alla spesa", "Aggiungi “pane” alla dispensa"]);
  });

  it("dispensa vuota: «Non ne hai in casa.»", () => {
    expect(group(search("latte", sources({ pantry: [] })), "In casa")?.note).toBe("Non ne hai in casa.");
  });

  it("accenti e maiuscole non contano: «LATTÉ» è «latte»", () => {
    expect(labels(group(search("LATTÉ", sources()), "In casa"))).toEqual(["Latte intero"]);
    expect(group(search("  LATTÉ ", sources()), "In casa")).toEqual(group(search("latte", sources()), "In casa"));
  });

  it("le parole si cercano in qualunque ordine", () => {
    expect(labels(group(search("pollo petto", sources()), "In casa"))).toEqual(["Petto di pollo"]);
    expect(labels(group(search("petto manzo", sources()), "In casa"))).toEqual([]);
  });

  it("prima ciò che comincia con ciò che è scritto, poi ciò che lo contiene in mezzo", () => {
    const pantry = [
      { lotId: "a", name: "Cioccolato fondente", detail: "" },
      { lotId: "b", name: "Yogurt al latte di capra", detail: "" },
      { lotId: "c", name: "Latte intero", detail: "" },
    ];
    expect(labels(group(search("lat", sources({ pantry })), "In casa"))).toEqual(["Latte intero", "Yogurt al latte di capra", "Cioccolato fondente"]);
  });

  it("al massimo cinque righe, e dice che ce ne sono altre", () => {
    const pantry = Array.from({ length: 7 }, (_, i) => ({ lotId: `y${i}`, name: `Yogurt ${i}`, detail: "" }));
    const home = group(search("yogurt", sources({ pantry })), "In casa");
    expect(home?.results).toHaveLength(MAX_PER_GROUP);
    expect(labels(home)).toEqual(["Yogurt 0", "Yogurt 1", "Yogurt 2", "Yogurt 3", "Yogurt 4"]);
    expect(home?.footnote).toBe("Ce ne sono altri 2: cercali in Dispensa.");
    expect(home?.note).toBeUndefined();
    const six = group(search("yogurt", sources({ pantry: pantry.slice(0, 6) })), "In casa");
    expect(six?.footnote).toBe("Ce n'è un altro: cercalo in Dispensa.");
  });
});

describe("search: gruppi", () => {
  const full = sources({
    pantry: [{ lotId: "p1", name: "Pasta di semola", detail: "500 g · Credenza · 8 mesi" }],
    recipes: [{ id: "r1", title: "Pasta al pomodoro", href: "/app/ricette/vedi?id=r1" }],
    habits: [{ habitId: "h1", title: "Pasta del martedì" }],
    pages: [{ label: "Pasti abituali", href: "/app/pasti-abituali", keywords: ["pasta"] }],
  });

  it("l'ordine è sempre: In casa, Azioni, Ricette, Pasti abituali, Pagine", () => {
    expect(titles(search("pasta", full))).toEqual(["In casa", "Azioni", "Ricette", "Pasti abituali", "Pagine"]);
  });

  it("un gruppo senza risultati non compare (tranne «In casa»)", () => {
    expect(titles(search("pomodoro", full))).toEqual(["In casa", "Azioni", "Ricette"]);
    expect(titles(search("martedi", full))).toEqual(["In casa", "Azioni", "Pasti abituali"]);
  });

  it("con meno di due lettere non c'è nessun risultato", () => {
    expect(search("", full)).toEqual([]);
    expect(search("p", full)).toEqual([]);
    expect(search("  p  ", full)).toEqual([]);
    expect(isSearching("p")).toBe(false);
    expect(isSearching("pa")).toBe(true);
  });

  it("ogni gruppo ha al massimo cinque righe", () => {
    const many = sources({
      pantry: [],
      recipes: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, title: `Torta ${i}`, href: `/app/ricette/vedi?id=r${i}` })),
      habits: Array.from({ length: 8 }, (_, i) => ({ habitId: `h${i}`, title: `Torta della domenica ${i}` })),
      pages: Array.from({ length: 8 }, (_, i) => ({ label: `Torta ${i}`, href: `/app/torta-${i}`, keywords: [] })),
    });
    for (const g of search("torta", many)) expect(g.results.length).toBeLessThanOrEqual(MAX_PER_GROUP);
    expect(group(search("torta", many), "Ricette")?.results).toHaveLength(MAX_PER_GROUP);
    expect(group(search("torta", many), "Pasti abituali")?.results).toHaveLength(MAX_PER_GROUP);
    expect(group(search("torta", many), "Pagine")?.results).toHaveLength(MAX_PER_GROUP);
  });

  it("ogni riga ha un indirizzo oppure un'azione, e gli id non si ripetono", () => {
    const results = search("pasta", full).flatMap((g) => g.results);
    for (const r of results) expect(r.href !== undefined || r.action !== undefined).toBe(true);
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
  });

  it("ciò che è scritto va nell'indirizzo senza rompersi", () => {
    const actions = group(search("  olio  d'oliva & sale ", sources()), "Azioni");
    expect(queryText("  olio  d'oliva & sale ")).toBe("olio d'oliva & sale");
    expect(actions?.results[0].label).toBe("Aggiungi “olio d'oliva & sale” alla spesa");
    expect(new URL(actions?.results[1].href ?? "", "https://x.test").searchParams.get("nome")).toBe("olio d'oliva & sale");
  });
});

describe("search: ricette e pasti abituali", () => {
  const withRecipes = sources({
    recipes: [
      { id: "r1", title: "Torta di mele", href: "/app/ricette/vedi?id=r1" },
      { id: "r2", title: "Torta salata", href: "/app/ricette/vedi?id=r2", note: "Ingrediente confermato da te: Prosciutto cotto (confermato da te il 3 novembre 2026). Non verificato dall'app." },
    ],
    recipesNote: "Quelle mostrate non hanno dato nessuna corrispondenza nei nomi: non vuol dire che siano sicure.",
    habits: [{ habitId: "h1", title: "Solita colazione" }],
  });

  it("le ricette si cercano per titolo e aprono la loro scheda", () => {
    const recipes = group(search("mele", withRecipes), "Ricette");
    expect(recipes?.results).toEqual([{ id: "recipe:r1", label: "Torta di mele", href: "/app/ricette/vedi?id=r1" }]);
  });

  it("l'avviso che una ricetta porta nel ricettario resta sulla sua riga, e la riga del ricettario sotto il gruppo", () => {
    const recipes = group(search("torta", withRecipes), "Ricette");
    expect(recipes?.results[1].detail).toBe("Ingrediente confermato da te: Prosciutto cotto (confermato da te il 3 novembre 2026). Non verificato dall'app.");
    expect(recipes?.results[0].detail).toBeUndefined();
    expect(recipes?.note).toBe("Quelle mostrate non hanno dato nessuna corrispondenza nei nomi: non vuol dire che siano sicure.");
  });

  it("compaiono solo le ricette che le vengono passate: quelle che il ricettario nasconde non arrivano fin qui", () => {
    expect(group(search("torta", sources()), "Ricette")).toBeUndefined();
  });

  it("nessun testo dà la ricetta per «compatibile»", () => {
    expect(JSON.stringify(search("torta", withRecipes))).not.toMatch(/compatibil/i);
  });

  it("un pasto abituale si cerca per nome e apre la pagina dei pasti abituali", () => {
    expect(group(search("colazione", withRecipes), "Pasti abituali")?.results).toEqual([{ id: "habit:h1", label: "Solita colazione", href: "/app/pasti-abituali" }]);
  });
});

describe("search: pagine", () => {
  const pagesOf = (query: string) => labels(group(search(query, sources()), "Pagine"));

  it("«tema» porta ad Aspetto", () => {
    expect(pagesOf("tema")).toEqual(["Aspetto"]);
  });

  it("le parole che una persona scriverebbe", () => {
    expect(pagesOf("lista")).toEqual(["Spesa"]);
    expect(pagesOf("menu")).toEqual(["Settimana"]);
    expect(pagesOf("peso")).toEqual(["Salute"]);
    expect(pagesOf("calorie")).toEqual(["Nutrizione"]);
    expect(pagesOf("stampa")).toEqual(["Rapporto"]);
    expect(pagesOf("annulla")).toEqual(["Ultime azioni"]);
    expect(pagesOf("notifiche")).toEqual(["Avvisi"]);
    expect(pagesOf("telefono nuovo")).toEqual(["Sincronizzazione"]);
    expect(pagesOf("SCURO")).toEqual(["Aspetto"]);
    expect(pagesOf("qualità")).toEqual(["Qualità dei prodotti"]);
  });

  it("se si trovano soltanto pagine, le pagine vengono per prime e sotto restano le azioni, con «Non ne hai in casa.» in una riga", () => {
    const groups = search("tema", sources());
    expect(titles(groups)).toEqual(["Pagine", "Azioni"]);
    expect(labels(groups[0])).toEqual(["Aspetto"]);
    expect(groups[1].note).toBe("Non ne hai in casa.");
    expect(labels(groups[1])).toEqual(["Aggiungi “tema” alla spesa", "Aggiungi “tema” alla dispensa"]);
  });

  it("se c'è anche qualcosa in casa, una ricetta o un pasto abituale, l'ordine resta quello di sempre", () => {
    const inHome = sources({ pantry: [{ lotId: "t", name: "Tema di prova", detail: "" }] });
    expect(titles(search("tema", inHome))).toEqual(["In casa", "Azioni", "Pagine"]);
    const recipe = sources({ recipes: [{ id: "r", title: "Zuppa a tema", href: "/app/ricette/vedi?id=r" }] });
    expect(titles(search("tema", recipe))).toEqual(["In casa", "Azioni", "Ricette", "Pagine"]);
    const habit = sources({ habits: [{ habitId: "h", title: "Cena a tema" }] });
    expect(titles(search("tema", habit))).toEqual(["In casa", "Azioni", "Pasti abituali", "Pagine"]);
    expect(group(search("tema", habit), "In casa")?.note).toBe("Non ne hai in casa.");
  });

  it("una pagina risponde all'inizio di una parola, non a lettere in mezzo", () => {
    expect(pagesOf("ana")).toEqual(["Analisi"]);
    expect(pagesOf("impost")).toEqual(["Impostazioni"]);
    // «le» e «dei» stanno nei nomi di due pagine, ma non sono ciò che si cerca
    expect(pagesOf("le")).toEqual([]);
    expect(pagesOf("dei")).toEqual([]);
  });
});

describe("SEARCH_PAGES", () => {
  it("ogni indirizzo comincia per /app/", () => {
    for (const page of SEARCH_PAGES) expect(page.href, page.label).toMatch(/^\/app\/[a-z]/);
  });

  it("non ci sono doppioni, né di indirizzo né di nome", () => {
    expect(new Set(SEARCH_PAGES.map((p) => p.href)).size).toBe(SEARCH_PAGES.length);
    expect(new Set(SEARCH_PAGES.map((p) => p.label)).size).toBe(SEARCH_PAGES.length);
  });

  it("ci sono le pagine che la ricerca promette", () => {
    expect(SEARCH_PAGES.map((p) => p.label)).toEqual([
      "Spesa",
      "Scorte minime",
      "Settimana",
      "Ricettario",
      "Preparazioni",
      "Salute",
      "Nutrizione",
      "Analisi",
      "Rapporto",
      "Ultime azioni",
      "Pasti abituali",
      "Impostazioni",
      "Aspetto",
      "Avvisi",
      "Sincronizzazione",
      "Profilo",
      "Qualità dei prodotti",
      "Controlla le quantità",
    ]);
  });
});

describe("pantrySources", () => {
  const NOW = "2026-11-17T08:00:00.000Z";

  function add(name: string, over: Record<string, unknown> = {}) {
    const r = buildCaptureEvents(
      {
        name,
        quantityText: "1 l",
        location: "frigo",
        category: "yogurt",
        expiryKind: "best_before",
        expiryDate: "2026-11-20",
        priceText: "",
        alreadyHave: false,
        ...over,
      },
      { now: NOW, deviceId: "d" },
    );
    if (!r.ok) throw new Error("setup");
    return r.events;
  }

  const sourcesOf = (...batches: ReturnType<typeof add>[]) => pantrySources(evaluateLots(activeLots(derivePantry(batches.flat())), NOW));

  it("una riga per alimento: quantità, luogo, scadenza", () => {
    const [milk] = sourcesOf(add("Latte intero"));
    expect(milk.name).toBe("Latte intero");
    expect(milk.detail).toBe("1 l · Frigo · 3 giorni");
    expect(milk.lotId).not.toBe("");
  });

  it("le confezioni uguali stanno in una riga sola, che apre quella che scade prima", () => {
    const rows = sourcesOf(add("Mousse", { quantityText: "125 g", expiryDate: "2026-11-25" }), add("Mousse", { quantityText: "125 g", expiryDate: "2026-11-19" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe("2 × 125 g · Frigo · 2 giorni");
  });

  it("una scadenza stimata porta la tilde", () => {
    const [row] = sourcesOf(add("Yogurt bianco", { quantityText: "125 g", expiryKind: "none", expiryDate: "" }));
    expect(row.detail).toMatch(/^125 g · Frigo · ~\d+ giorni$/);
  });

  it("senza nessuna scadenza nota lo dice", () => {
    const [entry] = evaluateLots(activeLots(derivePantry(add("Sale"))), NOW);
    const [row] = pantrySources([{ lot: entry.lot }]);
    expect(row.detail).toBe("1 l · Frigo · senza data");
  });

  it("si trova con la ricerca", () => {
    const pantry = sourcesOf(add("Latte intero"), add("Uova", { quantityText: "6 pz" }));
    const home = search("lat", { pantry, recipes: [], habits: [], pages: [] })[0];
    expect(home.results.map((r) => r.label)).toEqual(["Latte intero"]);
    expect(home.results[0].href).toBe(`/app/dispensa?lotto=${pantry.find((p) => p.name === "Latte intero")?.lotId}`);
  });
});
