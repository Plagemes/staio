import { describe, expect, it } from "vitest";
import { NUTRIENT_KEYS, type NutrientKey } from "../../types";
import { DERIVED_NUTRIENTS, FOODS, FOODS_SOURCE_VERSION } from "./index";

const GROUPS = new Set([
  "frutta",
  "verdura",
  "legumi",
  "cereali",
  "latticini",
  "uova",
  "carne",
  "salumi",
  "pesce",
  "frutta-secca",
  "oli-e-grassi",
  "dolci",
  "bevande",
  "condimenti",
]);

const STATES = new Set(["raw", "cooked", "dried", "as_sold"]);

/** Limite superiore per nutriente: nessun valore per 100 g puo' superarlo. */
function upperLimit(key: NutrientKey): number {
  if (key === "energyKcal") return 910;
  if (key.endsWith("G")) return 100;
  if (key.endsWith("Mg")) return 100_000;
  return 1_000_000;
}

/** Voci fatte quasi solo di sali minerali, che non rientrano nei cinque componenti sommati. */
const MINERAL_RESIDUE = new Set(["lievito-in-polvere", "bicarbonato"]);

/** Voci con energia molto sotto i fattori generali perche' la fonte usa fattori specifici (fibra e teobromina poco digeribili). */
const ENERGY_SPECIFIC_FACTORS = new Set(["cacao-amaro", "lievito-in-polvere"]);

function amount(food: (typeof FOODS)[number], key: NutrientKey): number | undefined {
  return food.per100[key];
}

describe("tabella di composizione degli alimenti", () => {
  it("contiene un numero adeguato di alimenti in tutti i gruppi", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(250);
    const present = new Set(FOODS.map((f) => f.group));
    expect([...present].sort()).toEqual([...GROUPS].sort());
  });

  it("ha id unici, stabili e in minuscolo con trattini", () => {
    const seen = new Set<string>();
    for (const f of FOODS) {
      expect(f.id, f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(f.id), `id duplicato ${f.id}`).toBe(false);
      seen.add(f.id);
    }
  });

  it("ha nomi e gruppi validi", () => {
    for (const f of FOODS) {
      expect(f.name.trim().length, f.id).toBeGreaterThan(0);
      expect(GROUPS.has(f.group), `${f.id}: gruppo ${f.group}`).toBe(true);
      expect(f.basis, f.id).toBe("g");
      expect(f.state !== undefined && STATES.has(f.state), `${f.id}: stato`).toBe(true);
      for (const alias of f.aliases ?? []) expect(alias.trim().length, f.id).toBeGreaterThan(0);
    }
  });

  it("ha la fonte compilata per ogni voce", () => {
    for (const f of FOODS) {
      expect(f.source.db, f.id).toMatch(/^USDA FoodData Central/);
      expect(f.source.id, f.id).toMatch(/^\d+$/);
      expect(f.source.description.trim().length, f.id).toBeGreaterThan(0);
    }
  });

  it("riporta energia e i tre macronutrienti in ogni voce", () => {
    for (const f of FOODS) {
      for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) {
        expect(amount(f, key), `${f.id}: ${key}`).toBeTypeOf("number");
      }
    }
  });

  it("non ha valori negativi, non finiti o oltre il massimo possibile", () => {
    const known = new Set<string>(NUTRIENT_KEYS);
    for (const f of FOODS) {
      for (const [key, value] of Object.entries(f.per100)) {
        expect(known.has(key), `${f.id}: chiave ${key}`).toBe(true);
        expect(Number.isFinite(value), `${f.id}: ${key}`).toBe(true);
        expect(value, `${f.id}: ${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${f.id}: ${key}`).toBeLessThanOrEqual(upperLimit(key as NutrientKey));
      }
    }
  });

  it("ha una scomposizione dei grassi e degli zuccheri coerente", () => {
    for (const f of FOODS) {
      const fat = amount(f, "fatG") ?? 0;
      const parts =
        (amount(f, "saturatedFatG") ?? 0) +
        (amount(f, "monounsaturatedFatG") ?? 0) +
        (amount(f, "polyunsaturatedFatG") ?? 0);
      expect(parts, `${f.id}: acidi grassi oltre il grasso totale`).toBeLessThanOrEqual(fat + 1);
      const omega3 = amount(f, "omega3G");
      const poly = amount(f, "polyunsaturatedFatG");
      if (omega3 !== undefined && poly !== undefined) {
        expect(omega3, `${f.id}: omega 3 oltre i polinsaturi`).toBeLessThanOrEqual(poly + 0.05);
      }
      const sugars = amount(f, "sugarsG");
      if (sugars !== undefined) {
        expect(sugars, `${f.id}: zuccheri oltre i carboidrati`).toBeLessThanOrEqual(
          (amount(f, "carbsG") ?? 0) + 0.5,
        );
      }
    }
  });

  it("ha proteine, carboidrati, grassi, acqua e alcol che non superano 100 g e lasciano un residuo plausibile", () => {
    for (const f of FOODS) {
      const water = amount(f, "waterG");
      if (water === undefined) continue;
      const sum =
        (amount(f, "proteinG") ?? 0) +
        (amount(f, "carbsG") ?? 0) +
        (amount(f, "fatG") ?? 0) +
        water +
        (amount(f, "alcoholG") ?? 0);
      // Il residuo e' soprattutto cenere (minerali): ammesso fino a 15 g, piu' il sale se presente.
      const gap = 100 - sum;
      if (MINERAL_RESIDUE.has(f.id)) continue;
      const allowed = 15 + (amount(f, "saltG") ?? 0);
      expect(gap, `${f.id}: somma ${sum.toFixed(1)} g oltre 100`).toBeGreaterThanOrEqual(-1.5);
      expect(gap, `${f.id}: somma ${sum.toFixed(1)} g troppo bassa`).toBeLessThanOrEqual(allowed);
    }
  });

  it("ha un'energia vicina a quella calcolata dai macronutrienti", () => {
    for (const f of FOODS) {
      const carbs = amount(f, "carbsG") ?? 0;
      const fiber = Math.min(amount(f, "fiberG") ?? 0, carbs);
      const estimate =
        4 * (amount(f, "proteinG") ?? 0) +
        4 * (carbs - fiber) +
        2 * fiber +
        9 * (amount(f, "fatG") ?? 0) +
        7 * (amount(f, "alcoholG") ?? 0);
      if (ENERGY_SPECIFIC_FACTORS.has(f.id)) continue;
      const energy = amount(f, "energyKcal") ?? 0;
      // Fibre, polioli e acidi organici fanno scostare i fattori di Atwater dai valori generali.
      const tolerance = Math.max(35, 0.25 * energy);
      expect(Math.abs(energy - estimate), `${f.id}: energia ${energy} contro ${estimate.toFixed(0)}`).toBeLessThanOrEqual(
        tolerance,
      );
    }
  });

  it("ha pesi per pezzo e densita' plausibili quando presenti", () => {
    for (const f of FOODS) {
      if (f.unitWeightG !== undefined) {
        expect(f.unitWeightG, f.id).toBeGreaterThan(0);
        expect(f.unitWeightG, f.id).toBeLessThan(5000);
      }
      if (f.densityGPerMl !== undefined) {
        expect(f.densityGPerMl, f.id).toBeGreaterThan(0.5);
        expect(f.densityGPerMl, f.id).toBeLessThan(2);
      }
    }
  });

  it("dichiara come ricavati il sale e gli omega 3", () => {
    expect(DERIVED_NUTRIENTS.saltG).toContain("sodio");
    expect(DERIVED_NUTRIENTS.omega3G).toContain("somma");
  });

  it("dichiara la versione dei dati di origine", () => {
    expect(FOODS_SOURCE_VERSION.foundationFoods).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FOODS_SOURCE_VERSION.srLegacy).toMatch(/^\d{4}-\d{2}$/);
  });

  it("non ha minerali essenziali a zero (uno zero della fonte e' un non rilevato, resta assente)", () => {
    const minerals: NutrientKey[] = [
      "calciumMg",
      "ironMg",
      "magnesiumMg",
      "phosphorusMg",
      "potassiumMg",
      "zincMg",
      "seleniumUg",
    ];
    for (const f of FOODS) {
      for (const key of minerals) {
        expect(amount(f, key), `${f.id}: ${key}`).not.toBe(0);
      }
    }
  });

  it("scrive lo zero dove la fonte lo riporta davvero (alcol, caffeina, colesterolo)", () => {
    const apple = FOODS.find((f) => f.id === "mela-cruda");
    expect(apple?.per100.alcoholG).toBe(0);
    expect(apple?.per100.caffeineMg).toBe(0);
    expect(apple?.per100.cholesterolMg).toBe(0);
  });

  describe("arricchimento e fortificazione", () => {
    /** Cereali, derivati e prodotti da forno: in Italia non sono arricchiti. */
    const BAKERY_SWEETS = new Set([
      "biscotti-frollini-al-burro",
      "biscotti-avena",
      "savoiardi",
      "brownie",
      "cornetto-al-burro",
      "plumcake",
      "pan-di-spagna",
      "cheesecake",
    ]);
    // Le patatine sono a base di patate (vitamina C naturale), non di farina arricchita.
    const unenrichedScope = FOODS.filter(
      (f) => (f.group === "cereali" && !f.id.startsWith("patatine")) || BAKERY_SWEETS.has(f.id),
    );
    // Soglie sopra i massimi naturali dei cereali integrali e dei pseudocereali nella fonte
    // (ferro 4,6; folati 184; tiamina 0,54; niacina 8,7) e sotto i valori delle voci arricchite
    // (ferro 5-19, folati 100-700, tiamina 0,7-4,5, calcio 180-680).
    const LIMITS: Partial<Record<NutrientKey, number>> = {
      calciumMg: 120,
      ironMg: 6,
      thiaminMg: 0.7,
      riboflavinMg: 0.5,
      niacinMg: 10,
      folateUg: 190,
      vitaminDUg: 1,
      vitaminAUg: 250,
      vitaminCMg: 5,
      vitaminB6Mg: 0.7,
    };

    it("non supera soglie plausibili per un prodotto non arricchito (cereali, pane, pasta, riso, prodotti da forno)", () => {
      expect(unenrichedScope.length).toBeGreaterThan(30);
      for (const f of unenrichedScope) {
        // I cereali non contengono vitamina B12; nei dolci e nei piatti con uova, formaggio o carne puo' venire da questi.
        const animalBased = /^(pasta-all-uovo|lasagne|spaghetti-al-sugo)/.test(f.id);
        if (f.group === "cereali" && !animalBased) expect(amount(f, "vitaminB12Ug") ?? 0, `${f.id}: B12`).toBeLessThanOrEqual(0.1);
        for (const [key, limit] of Object.entries(LIMITS) as [NutrientKey, number][]) {
          const v = amount(f, key);
          if (v !== undefined) expect(v, `${f.id}: ${key} da arricchimento?`).toBeLessThanOrEqual(limit);
        }
      }
    });

    it("lascia assenti i nutrienti aggiunti nelle voci fortificate senza alternativa non fortificata", () => {
      const byId = new Map(FOODS.map((f) => [f.id, f]));
      const absent = (id: string, keys: NutrientKey[]) => {
        for (const key of keys) expect(byId.get(id)?.per100[key], `${id}: ${key}`).toBeUndefined();
      };
      absent("pane-bianco-a-fette", ["calciumMg", "ironMg", "folateUg"]);
      absent("corn-flakes", ["ironMg", "folateUg", "vitaminDUg", "vitaminB12Ug", "vitaminAUg"]);
      absent("pasta-fresca", ["ironMg", "folateUg"]);
      absent("latte-di-riso", ["calciumMg", "vitaminDUg", "vitaminB12Ug"]);
      absent("latte-di-mandorla", ["calciumMg", "vitaminDUg"]);
      absent("latte-di-avena", ["calciumMg", "vitaminDUg"]);
      absent("latte-al-cioccolato", ["vitaminAUg", "vitaminDUg"]);
      absent("margarina", ["vitaminDUg", "vitaminAUg"]);
    });

    it("non ha voci la cui descrizione di origine dica arricchito o fortificato, salvo quelle con i nutrienti aggiunti tolti", () => {
      const stripped = new Set(["latte-al-cioccolato", "latte-di-capra", "latte-in-polvere-intero", "margarina"]);
      for (const f of FOODS) {
        if (stripped.has(f.id)) continue;
        const d = f.source.description;
        const fortified =
          /\b(enriched|fortified|with added (vitamin|calcium|iron|minerals))/i.test(d) &&
          !/\b(unenriched|not fortified|unfortified|without added)\b/i.test(d);
        expect(fortified, `${f.id}: ${d}`).toBe(false);
      }
    });

    it("per le bevande vegetali non supera i valori di una bevanda non fortificata", () => {
      for (const f of FOODS.filter((x) => x.id.startsWith("latte-di-") && x.group === "bevande")) {
        expect(amount(f, "calciumMg") ?? 0, f.id).toBeLessThanOrEqual(40);
        expect(amount(f, "vitaminDUg") ?? 0, f.id).toBeLessThanOrEqual(0.5);
        expect(amount(f, "vitaminB12Ug") ?? 0, f.id).toBeLessThanOrEqual(0.1);
      }
    });
  });

  describe("stato e coppie crudo/secco e cotto", () => {
    // [secco o crudo, cotto, alias generico che deve stare solo sulla voce cotta]
    const PAIRS: [string, string, string][] = [
      ["pasta-secca", "pasta-cotta", "pasta"],
      ["pasta-integrale-secca", "pasta-integrale-cotta", "pasta integrale"],
      ["pasta-fresca", "pasta-fresca-cotta", "pasta fresca"],
      ["riso-bianco-crudo", "riso-bianco-lessato", "riso"],
      ["riso-tondo-crudo", "riso-tondo-lessato", "risotto"],
      ["riso-integrale-crudo", "riso-integrale-lessato", "riso integrale"],
      ["farro-crudo", "farro-lessato", "farro"],
      ["orzo-perlato-crudo", "orzo-perlato-lessato", "orzo"],
      ["bulgur-secco", "bulgur-lessato", "bulgur"],
      ["couscous-secco", "couscous-lessato", "couscous"],
      ["quinoa-cruda", "quinoa-lessata", "quinoa"],
      ["miglio-crudo", "miglio-lessato", "miglio"],
      ["fiocchi-di-avena", "fiocchi-di-avena-cotti", "avena"],
      ["lenticchie-secche", "lenticchie-lessate", "lenticchie"],
      ["ceci-secchi", "ceci-lessati", "ceci"],
      ["fagioli-cannellini-secchi", "fagioli-cannellini-lessati", "cannellini"],
      ["fagioli-rossi-secchi", "fagioli-rossi-lessati", "fagioli rossi"],
      ["piselli-secchi-spaccati", "piselli-secchi-lessati", "piselli secchi"],
      ["fave-secche", "fave-lessate", "fave"],
      ["soia-secca", "soia-lessata", "soia"],
      ["lupini-secchi", "lupini-lessati", "lupini"],
    ];

    it("ha per ogni coppia la voce secca o cruda e quella cotta, con stato e nome distinti", () => {
      const byId = new Map(FOODS.map((f) => [f.id, f]));
      for (const [dryId, cookedId] of PAIRS) {
        const dry = byId.get(dryId);
        const cooked = byId.get(cookedId);
        expect(dry, dryId).toBeDefined();
        expect(cooked, cookedId).toBeDefined();
        expect(cooked?.state, cookedId).toBe("cooked");
        expect(dry?.state, dryId).not.toBe("cooked");
        expect(dry?.name, dryId).not.toBe(cooked?.name);
        expect(cooked?.name, cookedId).toMatch(/cott|lessat/i);
        expect(dry?.name, dryId).not.toMatch(/cott|lessat/i);
      }
    });

    it("fa condividere variantOf a ogni coppia, con la stessa chiave per secco o crudo e cotto", () => {
      const byId = new Map(FOODS.map((f) => [f.id, f]));
      for (const [dryId, cookedId] of PAIRS) {
        const key = byId.get(dryId)?.variantOf;
        expect(key, dryId).toBeTypeOf("string");
        expect(byId.get(cookedId)?.variantOf, cookedId).toBe(key);
      }
    });

    it("mette gli alias generici su tutte le voci dello stesso gruppo variantOf", () => {
      // [chiave variantOf, alias generici che devono comparire su ogni voce del gruppo]
      const GENERIC: [string, string[]][] = [
        ["pasta-semola", ["pasta", "spaghetti"]],
        ["pasta-integrale", ["pasta integrale"]],
        ["pasta-fresca", ["pasta fresca"]],
        ["riso-bianco-lungo", ["riso"]],
        ["riso-bianco-tondo", ["risotto"]],
        ["riso-integrale", ["riso integrale"]],
        ["avena-fiocchi", ["avena", "fiocchi d'avena", "fiocchi di avena"]],
        ["lenticchie", ["lenticchie"]],
        ["ceci", ["ceci"]],
        ["farro", ["farro"]],
        ["orzo-perlato", ["orzo"]],
        ["quinoa", ["quinoa"]],
        ["fave", ["fave"]],
        ["soia", ["soia"]],
        ["lupini", ["lupini"]],
        ["carota", ["carota", "carote"]],
        ["patata", ["patata", "patate"]],
        ["uovo-intero", ["uovo", "uova"]],
      ];
      for (const [key, aliases] of GENERIC) {
        const members = FOODS.filter((f) => f.variantOf === key);
        expect(members.length, key).toBeGreaterThanOrEqual(2);
        for (const m of members) {
          for (const alias of aliases) expect(m.aliases ?? [], `${m.id}: alias ${alias}`).toContain(alias);
        }
      }
    });

    it("usa per il riso e per la pasta cotti la voce senza sale aggiunto", () => {
      const rice = FOODS.find((f) => f.id === "riso-bianco-lessato");
      expect(rice?.source.description).not.toMatch(/with salt/i);
      expect(rice?.per100.saltG ?? 0).toBeLessThan(0.1);
      const pasta = FOODS.find((f) => f.id === "pasta-cotta");
      expect(pasta?.source.description).toMatch(/without added salt/i);
    });
  });

  it("ha densita' coerenti con la composizione per i liquidi acquosi", () => {
    for (const f of FOODS) {
      if (f.densityGPerMl === undefined) continue;
      if ((amount(f, "waterG") ?? 0) >= 90) {
        expect(f.densityGPerMl, f.id).toBeGreaterThanOrEqual(0.98);
        expect(f.densityGPerMl, f.id).toBeLessThanOrEqual(1.06);
      }
    }
    for (const id of ["latte-di-mandorla", "brodo-vegetale-pronto"]) {
      expect(FOODS.find((f) => f.id === id)?.densityGPerMl, id).toBeUndefined();
    }
  });

  describe("gruppi variantOf", () => {
    const groups = new Map<string, (typeof FOODS)[number][]>();
    for (const f of FOODS) {
      if (f.variantOf === undefined) continue;
      groups.set(f.variantOf, [...(groups.get(f.variantOf) ?? []), f]);
    }

    it("ha almeno due voci per gruppo e tutti gli stati diversi", () => {
      expect(groups.size).toBeGreaterThanOrEqual(30);
      for (const [key, members] of groups) {
        expect(members.length, key).toBeGreaterThanOrEqual(2);
        const states = members.map((m) => m.state);
        expect(new Set(states).size, `${key}: stati ${states.join(", ")}`).toBe(states.length);
      }
    });

    it("non ha due voci con lo stesso nome mostrato", () => {
      const seen = new Map<string, string>();
      for (const f of FOODS) {
        const key = f.name.toLowerCase();
        expect(seen.has(key), `nome duplicato "${f.name}" (${seen.get(key)}, ${f.id})`).toBe(false);
        seen.set(key, f.id);
      }
    });

    it("permette di condividere gli alias generici e li mette su tutte le voci pertinenti", () => {
      const withAlias = (alias: string) => FOODS.filter((f) => (f.aliases ?? []).includes(alias)).map((f) => f.id);
      expect(withAlias("tonno")).toEqual(
        expect.arrayContaining(["tonno-fresco-crudo", "tonno-al-naturale", "tonno-sott-olio"]),
      );
      expect(withAlias("pomodori")).toEqual(
        expect.arrayContaining(["pomodoro-crudo", "pomodori-pelati", "pomodori-a-pezzi"]),
      );
      expect(withAlias("pane")).toEqual(
        expect.arrayContaining(["pane-bianco-a-fette", "pane-francese", "pane-integrale"]),
      );
      expect(withAlias("pollo")).toEqual(
        expect.arrayContaining(FOODS.filter((f) => f.id.startsWith("pollo-")).map((f) => f.id)),
      );
      for (const generic of ["formaggio", "prosciutto", "biscotti", "cereali", "succo", "insalata"]) {
        expect(withAlias(generic).length, generic).toBeGreaterThanOrEqual(2);
      }
    });

    it("non mette in uno stesso gruppo variantOf alimenti diversi con lo stesso nome generico", () => {
      const keyOf = (id: string) => FOODS.find((f) => f.id === id)?.variantOf;
      expect(keyOf("tonno-fresco-crudo")).toBeUndefined();
      expect(keyOf("tonno-al-naturale")).toBeUndefined();
      expect(keyOf("pomodoro-crudo")).toBeUndefined();
      expect(keyOf("pomodori-pelati")).toBeUndefined();
      expect(keyOf("latte-intero")).toBeUndefined();
      expect(keyOf("latte-di-soia")).toBeUndefined();
    });

    it("non ha alias in contrasto con lo stato della voce (secco, crudo, cotto, lesso, bollito, al forno, alla griglia)", () => {
      const dryOrRaw = /\b(secc[a-z]*|crud[oaie])\b/i;
      const cooked = /\b(cott[oaie]|less[aeio]|lessat[oaie]|bollit[oaie]|arrost[oaie]|grigliat[oaie])\b|\bal forno\b|\balla griglia\b/i;
      for (const f of FOODS) {
        for (const alias of f.aliases ?? []) {
          const d = dryOrRaw.exec(alias);
          const c = cooked.exec(alias);
          if (f.state === "cooked" && d && !f.name.toLowerCase().includes(d[0].toLowerCase())) {
            expect.fail(`${f.id} (cotto): alias "${alias}" dice secco o crudo`);
          }
          if (f.state !== "cooked" && c && !f.name.toLowerCase().includes(c[0].toLowerCase())) {
            expect.fail(`${f.id} (${f.state}): alias "${alias}" dice cotto`);
          }
        }
      }
      // I due casi segnalati dalla revisione
      const tagliatelle = FOODS.filter((f) => (f.aliases ?? []).includes("tagliatelle secche"));
      for (const f of tagliatelle) expect(f.state, f.id).not.toBe("cooked");
      const patateLesse = FOODS.filter((f) => (f.aliases ?? []).includes("patate lesse"));
      for (const f of patateLesse) expect(f.state, f.id).toBe("cooked");
    });
  });

  it("segna come secchi la frutta secca, i semi e la frutta disidratata", () => {
    const dried = [
      "datteri-secchi", "fichi-secchi", "albicocche-secche", "prugne-secche", "uvetta-sultanina",
      "mandorle", "noci", "nocciole", "pinoli", "pistacchi", "anacardi", "arachidi",
      "semi-di-sesamo", "semi-di-girasole", "semi-di-zucca", "semi-di-lino", "semi-di-chia", "pomodori-secchi",
    ];
    for (const id of dried) expect(FOODS.find((f) => f.id === id)?.state, id).toBe("dried");
  });

  it("non attribuisce alla farina di mais l'alias polenta (manca una voce cotta non arricchita)", () => {
    const flour = FOODS.find((f) => f.id === "farina-di-mais");
    expect(flour?.aliases ?? []).not.toContain("polenta");
    for (const f of FOODS) expect(f.aliases ?? [], f.id).not.toContain("polenta");
  });

  it("lascia assente la fibra aggiunta del pane bianco e distingue le mozzarelle", () => {
    const bread = FOODS.find((f) => f.id === "pane-bianco-a-fette");
    expect(bread?.per100.fiberG).toBeUndefined();
    const fresh = FOODS.find((f) => f.id === "mozzarella-fiordilatte");
    const pizza = FOODS.find((f) => f.id === "mozzarella-per-pizza");
    expect(fresh?.aliases ?? []).toContain("mozzarella");
    expect(pizza?.aliases ?? []).not.toContain("mozzarella");
    expect(pizza?.name).toMatch(/bassa umidit/i);
    expect(fresh?.source.description).not.toMatch(/low moisture/i);
    expect(pizza?.source.description).toMatch(/low moisture/i);
  });
});
