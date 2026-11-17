#!/usr/bin/env node
// Genera i file di dati src/core/nutrition/data/foods/*.ts a partire dai file JSON di
// USDA FoodData Central (Foundation Foods e SR Legacy) e dalle corrispondenze in
// scripts/nutrition/matches/*.json. Solo Node, nessuna dipendenza.
//
// Uso: node scripts/nutrition/build-foods.mjs --data <cartella> [--data <altra>] [--report]
// La cartella --data contiene i JSON estratti (vedi download-fdc.mjs). Viene scandita
// fino a due livelli di profondita'.
//
// Regola: ogni numero viene dalla fonte. Un nutriente che la fonte non riporta resta
// assente. Le uniche trasformazioni sono quelle dichiarate in DERIVATIONS qui sotto.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const matchesDir = path.join(here, "matches");
const outDir = path.join(repoRoot, "src", "core", "nutrition", "data", "foods");

const args = process.argv.slice(2);
const dataDirs = [];
let report = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data") dataDirs.push(args[++i]);
  else if (args[i] === "--report") report = true;
  else throw new Error(`Argomento sconosciuto: ${args[i]}`);
}
if (dataDirs.length === 0) {
  throw new Error("Indica la cartella dei dati con --data <cartella>");
}

// Mappa NutrientKey -> candidati in ordine di preferenza: [id nutriente FDC, unita' della fonte].
// Se il primo non c'e', si prova il successivo. L'unita' viene verificata, mai assunta.
const DIRECT = {
  energyKcal: [[1008, "kcal"], [2047, "kcal"], [2048, "kcal"]],
  proteinG: [[1003, "g"]],
  carbsG: [[1005, "g"], [1050, "g"]],
  sugarsG: [[2000, "g"], [1063, "g"]],
  fatG: [[1004, "g"]],
  saturatedFatG: [[1258, "g"]],
  monounsaturatedFatG: [[1292, "g"]],
  polyunsaturatedFatG: [[1293, "g"]],
  fiberG: [[1079, "g"], [2033, "g"]],
  waterG: [[1051, "g"]],
  cholesterolMg: [[1253, "mg"]],
  calciumMg: [[1087, "mg"]],
  ironMg: [[1089, "mg"]],
  magnesiumMg: [[1090, "mg"]],
  phosphorusMg: [[1091, "mg"]],
  potassiumMg: [[1092, "mg"]],
  zincMg: [[1095, "mg"]],
  seleniumUg: [[1103, "ug"]],
  iodineUg: [[1100, "ug"]],
  // Retinolo equivalenti attivita' (RAE) come riportato dalla fonte: non e' RE.
  vitaminAUg: [[1106, "ug"]],
  vitaminCMg: [[1162, "mg"]],
  vitaminDUg: [[1114, "ug"]],
  vitaminEMg: [[1109, "mg"]],
  // Solo fillochinone (K1).
  vitaminKUg: [[1185, "ug"]],
  thiaminMg: [[1165, "mg"]],
  riboflavinMg: [[1166, "mg"]],
  niacinMg: [[1167, "mg"]],
  vitaminB6Mg: [[1175, "mg"]],
  // Folati totali, non DFE.
  folateUg: [[1177, "ug"]],
  vitaminB12Ug: [[1178, "ug"]],
  alcoholG: [[1018, "g"]],
  caffeineMg: [[1057, "mg"]],
};

const SODIUM = [1093, "mg"];

// Minerali essenziali: nessun alimento ne e' privo, quindi uno zero nella fonte e' un "non rilevato"
// (sotto il limite dello strumento) e non un dato: il nutriente resta assente. Per gli altri nutrienti
// (vitamine, alcol, caffeina, colesterolo) uno zero della fonte e' un dato e viene scritto.
const NONDETECT_MINERALS = new Set([
  "calciumMg", "ironMg", "magnesiumMg", "phosphorusMg", "potassiumMg", "zincMg", "seleniumUg",
]);

// Arricchimento e fortificazione: in Italia pane, pasta, farine, cereali da colazione e bevande vegetali
// non sono arricchiti, mentre molte voci statunitensi si'. Una voce e' considerata arricchita se la
// descrizione FDC lo dice, oppure se la fonte riporta acido folico (1186), vitamina E aggiunta (1242)
// o vitamina B12 aggiunta (1246). Ordine di preferenza: (a) voce FDC non arricchita; (b) tenere la
// voce e togliere con "strip" i nutrienti toccati dall'arricchimento (restano assenti, cioe' dato mancante);
// (c) ometterla. Una voce arricchita senza "strip" fa fallire lo script.
const FORTIFIED_DESCRIPTION = /(enriched|fortified|with added (vitamin|calcium|iron|minerals)|added (vitamin|calcium))/i;
const NOT_FORTIFIED_DESCRIPTION = /(unenriched|not fortified|unfortified|without added|no added)/i;
const FORTIFICATION_NUTRIENT_IDS = [1186, 1242, 1246];
const SALT_FROM_SODIUM = 2.5; // sale = sodio x 2,5
const OMEGA3_PARTS = { ala: 1404, epa: 1278, dpa: 1280, dha: 1272 };
const KJ_PER_KCAL = 4.184;

// Volumi che definiscono le misure statunitensi (ml). Servono solo per ricavare la densita'
// dal peso di una misura di volume riportata dalla fonte.
const VOLUME_ML = {
  cup: 236.5882365,
  "cup (8 fl oz)": 236.5882365,
  "fl oz": 29.5735295625,
  tablespoon: 14.78676478125,
  tbsp: 14.78676478125,
  tsp: 4.92892159375,
};

const FILE_ORDER = [
  "fruit", "vegetables", "legumes", "cereals", "dairy", "eggs", "meat",
  "cured-meats", "fish", "nuts-seeds", "oils-fats", "sweets", "beverages", "condiments",
];

const NUTRIENT_ORDER = [
  "energyKcal", "proteinG", "carbsG", "sugarsG", "fatG", "saturatedFatG",
  "monounsaturatedFatG", "polyunsaturatedFatG", "omega3G", "fiberG", "saltG", "waterG",
  "cholesterolMg", "calciumMg", "ironMg", "magnesiumMg", "phosphorusMg", "potassiumMg",
  "zincMg", "seleniumUg", "iodineUg", "vitaminAUg", "vitaminCMg", "vitaminDUg",
  "vitaminEMg", "vitaminKUg", "thiaminMg", "riboflavinMg", "niacinMg", "vitaminB6Mg",
  "folateUg", "vitaminB12Ug", "alcoholG", "caffeineMg",
];

function normUnit(u) {
  const s = String(u ?? "").trim().toLowerCase();
  if (s === "µg" || s === "μg" || s === "mcg") return "ug";
  return s;
}

function round(n, decimals) {
  return Number(n.toFixed(decimals));
}

function findJsonFiles(dir, depth = 2) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) found.push(full);
    else if (entry.isDirectory() && depth > 0) found.push(...findJsonFiles(full, depth - 1));
  }
  return found;
}

function loadDatasets() {
  const datasets = { foundation: null, sr: null };
  for (const dir of dataDirs) {
    for (const file of findJsonFiles(dir)) {
      const name = path.basename(file);
      let kind = null;
      if (/^FoodData_Central_foundation_food_json_/.test(name)) kind = "foundation";
      else if (/^FoodData_Central_sr_legacy_food_json_/.test(name)) kind = "sr";
      if (!kind) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const foods = kind === "foundation" ? json.FoundationFoods : json.SRLegacyFoods;
      if (!Array.isArray(foods)) throw new Error(`Formato inatteso in ${name}`);
      const version = name.replace(/^.*_json_/, "").replace(/\.json$/, "");
      datasets[kind] = { file: name, version, foods };
    }
  }
  if (!datasets.foundation || !datasets.sr) {
    throw new Error("Servono sia il JSON Foundation Foods sia quello SR Legacy nelle cartelle --data");
  }
  return datasets;
}

function nutrientValue(food, [id, unit], context) {
  const entry = food.foodNutrients.find((n) => n.nutrient && n.nutrient.id === id);
  if (!entry || typeof entry.amount !== "number") return undefined;
  const actual = normUnit(entry.nutrient.unitName);
  if (actual !== unit) {
    throw new Error(`${context}: nutriente ${id} in unita' ${actual}, attesa ${unit}`);
  }
  if (entry.amount < 0) {
    throw new Error(`${context}: nutriente ${id} negativo (${entry.amount}) nella fonte`);
  }
  return entry.amount;
}

function isFortified(food) {
  const d = food.description;
  if (FORTIFIED_DESCRIPTION.test(d) && !NOT_FORTIFIED_DESCRIPTION.test(d)) return true;
  return FORTIFICATION_NUTRIENT_IDS.some((id) => {
    const n = food.foodNutrients.find((x) => x.nutrient && x.nutrient.id === id);
    return n !== undefined && typeof n.amount === "number" && n.amount > 0;
  });
}

function extractPer100(food, context, stats) {
  const per100 = {};
  for (const [key, candidates] of Object.entries(DIRECT)) {
    for (const [index, candidate] of candidates.entries()) {
      const value = nutrientValue(food, candidate, context);
      if (value !== undefined) {
        if (value === 0 && NONDETECT_MINERALS.has(key)) {
          stats.nondetect[key] = (stats.nondetect[key] ?? 0) + 1;
          break;
        }
        per100[key] = value;
        if (index > 0) stats.fallback[key] = (stats.fallback[key] ?? 0) + 1;
        break;
      }
    }
  }
  // Energia: se la fonte da' solo kJ, conversione esatta in kcal.
  if (per100.energyKcal === undefined) {
    const kj = nutrientValue(food, [1062, "kj"], context);
    if (kj !== undefined) {
      per100.energyKcal = round(kj / KJ_PER_KCAL, 1);
      stats.fallback.energyKcalFromKj = (stats.fallback.energyKcalFromKj ?? 0) + 1;
    }
  }
  // Sale ricavato dal sodio.
  const sodiumMg = nutrientValue(food, SODIUM, context);
  if (sodiumMg !== undefined) per100.saltG = round((sodiumMg * SALT_FROM_SODIUM) / 1000, 4);
  // Omega 3: somma di ALA, EPA, DPA, DHA presenti, solo se c'e' ALA oppure sia EPA sia DHA.
  const parts = {};
  for (const [name, id] of Object.entries(OMEGA3_PARTS)) {
    const v = nutrientValue(food, [id, "g"], context);
    if (v !== undefined) parts[name] = v;
  }
  if (parts.ala !== undefined || (parts.epa !== undefined && parts.dha !== undefined)) {
    per100.omega3G = round(Object.values(parts).reduce((a, b) => a + b, 0), 4);
  }
  const ordered = {};
  for (const key of NUTRIENT_ORDER) if (per100[key] !== undefined) ordered[key] = per100[key];
  return ordered;
}

function inferState(description) {
  const d = description.toLowerCase();
  if (/\b(cooked|boiled|baked|roasted|fried|grilled|steamed|broiled|braised|simmered|stewed|toasted|poached|scrambled|pan-broiled|microwaved|stir-fried|sauteed|prepared with water)\b/.test(d)) return "cooked";
  if (/\b(raw|fresh|unprepared|uncooked)\b/.test(d)) return "raw";
  if (/\b(dried|dry|dehydrated|dry roasted|powder)\b/.test(d)) return "dried";
  return "as_sold";
}

function portionWeight(food, modifier, context) {
  const p = (food.foodPortions ?? []).find((x) => x.modifier === modifier && typeof x.gramWeight === "number");
  if (!p) throw new Error(`${context}: porzione "${modifier}" non trovata nella fonte`);
  const amount = typeof p.amount === "number" && p.amount > 0 ? p.amount : 1;
  return round(p.gramWeight / amount, 2);
}

// Densita' attesa dalla composizione (g/ml): somma dei volumi dei componenti, il residuo e' cenere.
const COMPONENT_DENSITY = { water: 1, protein: 1.35, carbs: 1.55, fat: 0.92, alcohol: 0.79, ash: 2.2 };
const DENSITY_TOLERANCE = 0.05;

function expectedDensity(per100) {
  if (per100.waterG === undefined) return undefined;
  const parts = {
    water: per100.waterG,
    protein: per100.proteinG ?? 0,
    carbs: per100.carbsG ?? 0,
    fat: per100.fatG ?? 0,
    alcohol: per100.alcoholG ?? 0,
  };
  const ash = Math.max(0, 100 - Object.values(parts).reduce((a, b) => a + b, 0));
  const volume = Object.entries({ ...parts, ash }).reduce((v, [k, g]) => v + g / COMPONENT_DENSITY[k], 0);
  return 100 / volume;
}

// Densita' dal peso di una misura di volume della fonte, accettata solo se coerente con la composizione
// (le misure di volume della fonte sono arrotondate e a volte inaffidabili).
function density(food, per100) {
  for (const p of food.foodPortions ?? []) {
    const ml = VOLUME_ML[p.modifier];
    if (!ml || typeof p.gramWeight !== "number") continue;
    const amount = typeof p.amount === "number" && p.amount > 0 ? p.amount : 1;
    const value = round(p.gramWeight / amount / ml, 3);
    const expected = expectedDensity(per100);
    if (expected === undefined || Math.abs(value - expected) / expected > DENSITY_TOLERANCE) return undefined;
    return value;
  }
  return undefined;
}

function tsString(s) {
  return JSON.stringify(s);
}

function tsNumber(n) {
  return String(n);
}

function renderFood(food) {
  const lines = [];
  lines.push("  {");
  lines.push(`    id: ${tsString(food.id)},`);
  lines.push(`    name: ${tsString(food.name)},`);
  if (food.aliases.length > 0) lines.push(`    aliases: [${food.aliases.map(tsString).join(", ")}],`);
  lines.push(`    group: ${tsString(food.group)},`);
  lines.push(`    basis: ${tsString(food.basis)},`);
  lines.push("    per100: {");
  for (const [k, v] of Object.entries(food.per100)) lines.push(`      ${k}: ${tsNumber(v)},`);
  lines.push("    },");
  if (food.unitWeightG !== undefined) lines.push(`    unitWeightG: ${tsNumber(food.unitWeightG)},`);
  if (food.densityGPerMl !== undefined) lines.push(`    densityGPerMl: ${tsNumber(food.densityGPerMl)},`);
  lines.push(`    state: ${tsString(food.state)},`);
  if (food.variantOf) lines.push(`    variantOf: ${tsString(food.variantOf)},`);
  lines.push("    source: {");
  lines.push(`      db: ${tsString(food.source.db)},`);
  lines.push(`      id: ${tsString(food.source.id)},`);
  lines.push(`      description: ${tsString(food.source.description)},`);
  lines.push("    },");
  lines.push("  },");
  return lines.join("\n");
}

function constName(file) {
  return file.replace(/-/g, "_").toUpperCase();
}

// Un alias non deve contraddire lo stato della voce ("tagliatelle secche" non sta su una pasta cotta,
// "patate lesse" non sta su una patata cruda). Fa eccezione la parola che e' gia' nel nome mostrato
// (per esempio l'alias "prosciutto cotto" sulla voce "Prosciutto cotto").
const DRY_OR_RAW_WORD = /\b(secc[a-z]*|crud[oaie])\b/i;
const COOKED_WORD = /\b(cott[oaie]|less[aeio]|lessat[oaie]|bollit[oaie]|arrost[oaie]|grigliat[oaie])\b|\bal forno\b|\balla griglia\b/i;

function aliasStateConflicts(food) {
  const problems = [];
  for (const alias of food.aliases) {
    const dry = DRY_OR_RAW_WORD.exec(alias);
    const cooked = COOKED_WORD.exec(alias);
    if (food.state === "cooked" && dry && !food.name.toLowerCase().includes(dry[0].toLowerCase())) {
      problems.push(alias);
    }
    if (food.state !== "cooked" && cooked && !food.name.toLowerCase().includes(cooked[0].toLowerCase())) {
      problems.push(alias);
    }
  }
  return problems;
}

function main() {
  const datasets = loadDatasets();
  const byId = new Map();
  for (const f of datasets.sr.foods) byId.set(f.fdcId, { food: f, dataset: "sr" });
  for (const f of datasets.foundation.foods) byId.set(f.fdcId, { food: f, dataset: "foundation" });
  const dbName = {
    foundation: "USDA FoodData Central, Foundation Foods",
    sr: "USDA FoodData Central, SR Legacy",
  };

  const stats = { fallback: {}, nondetect: {}, stripped: [], missing: {}, count: 0, approx: [], byGroup: {} };
  const seenIds = new Set();
  const groups = [];
  const files = fs.readdirSync(matchesDir).filter((f) => f.endsWith(".json")).sort();

  for (const f of files) {
    const spec = JSON.parse(fs.readFileSync(path.join(matchesDir, f), "utf8"));
    const foods = [];
    for (const item of spec.items) {
      const context = `${spec.group}/${item.id} (FDC ${item.fdc})`;
      if (seenIds.has(item.id)) throw new Error(`${context}: id duplicato`);
      seenIds.add(item.id);
      const hit = byId.get(item.fdc);
      if (!hit) throw new Error(`${context}: identificativo FDC non presente nei dati scaricati`);
      const per100 = extractPer100(hit.food, context, stats);
      for (const need of ["energyKcal", "proteinG", "carbsG", "fatG"]) {
        if (per100[need] === undefined) throw new Error(`${context}: manca ${need} nella fonte`);
      }
      if (isFortified(hit.food) && !item.strip) {
        throw new Error(`${context}: voce arricchita (${hit.food.description}): cercare la voce non arricchita o indicare "strip"`);
      }
      for (const key of item.strip ?? []) {
        if (!NUTRIENT_ORDER.includes(key) || ["energyKcal", "proteinG", "carbsG", "fatG"].includes(key)) {
          throw new Error(`${context}: strip non valido: ${key}`);
        }
        if (per100[key] !== undefined) {
          delete per100[key];
          stats.stripped.push(`${item.id}: ${key}`);
        }
      }
      for (const key of NUTRIENT_ORDER) {
        if (per100[key] === undefined) stats.missing[key] = (stats.missing[key] ?? 0) + 1;
      }
      const food = {
        id: item.id,
        name: item.nameNote ? `${item.name} (${item.nameNote})` : item.name,
        aliases: item.aliases ?? [],
        group: spec.group,
        basis: "g",
        per100,
        state: item.state ?? inferState(hit.food.description),
        source: {
          db: dbName[hit.dataset],
          id: String(hit.food.fdcId),
          description: hit.food.description,
        },
      };
      if (item.variantOf) food.variantOf = item.variantOf;
      const conflicts = aliasStateConflicts(food);
      if (conflicts.length > 0) {
        throw new Error(`${context}: alias in contrasto con lo stato ${food.state}: ${conflicts.join(", ")}`);
      }
      if (item.unit) food.unitWeightG = portionWeight(hit.food, item.unit, context);
      if (item.liquid) {
        const d = density(hit.food, per100);
        if (d !== undefined) food.densityGPerMl = d;
        else stats.noDensity = [...(stats.noDensity ?? []), item.id];
      }
      if (item.approx) stats.approx.push(`${item.id}: ${item.approx}`);
      foods.push(food);
    }
    stats.count += foods.length;
    stats.byGroup[spec.group] = foods.length;
    groups.push({ file: spec.file, group: spec.group, foods });
  }
  // Gemelli: voci che sono lo stesso alimento in stati diversi condividono variantOf, con stati tutti diversi.
  const twins = new Map();
  for (const g of groups) {
    for (const f of g.foods) {
      if (!f.variantOf) continue;
      twins.set(f.variantOf, [...(twins.get(f.variantOf) ?? []), f]);
    }
  }
  for (const [key, members] of twins) {
    if (members.length < 2) throw new Error(`variantOf "${key}": serve almeno una seconda voce`);
    const states = members.map((m) => m.state);
    if (new Set(states).size !== states.length) {
      throw new Error(`variantOf "${key}": stati non tutti diversi (${states.join(", ")})`);
    }
  }
  stats.twinGroups = twins.size;
  groups.sort((a, b) => {
    const ia = FILE_ORDER.indexOf(a.file);
    const ib = FILE_ORDER.indexOf(b.file);
    if (ia < 0 || ib < 0) throw new Error(`File di gruppo non previsto in FILE_ORDER: ${ia < 0 ? a.file : b.file}`);
    return ia - ib;
  });

  fs.mkdirSync(outDir, { recursive: true });
  const header =
    "// File generato da scripts/nutrition/build-foods.mjs a partire da USDA FoodData Central.\n" +
    "// Non modificare a mano: rigenerare con lo script (vedi FONTE.md).\n";

  for (const g of groups) {
    const name = constName(g.file);
    const body =
      `${header}import type { FoodComposition } from "../../types";\n\n` +
      `export const ${name}: readonly FoodComposition[] = [\n${g.foods.map(renderFood).join("\n")}\n];\n`;
    fs.writeFileSync(path.join(outDir, `${g.file}.ts`), body);
  }

  const imports = groups.map((g) => `import { ${constName(g.file)} } from "./${g.file}";`).join("\n");
  const spread = groups.map((g) => `  ...${constName(g.file)},`).join("\n");
  const index =
    `${header}import type { FoodComposition, NutrientKey } from "../../types";\n${imports}\n\n` +
    `export const FOODS: readonly FoodComposition[] = [\n${spread}\n];\n\n` +
    `/** Versioni dei file di dati da cui la tabella e' stata generata. */\n` +
    `export const FOODS_SOURCE_VERSION = {\n` +
    `  foundationFoods: ${tsString(datasets.foundation.version)},\n` +
    `  srLegacy: ${tsString(datasets.sr.version)},\n` +
    `} as const;\n\n` +
    `/** Nutrienti non riportati dalla fonte ma ricavati da altri valori della fonte. */\n` +
    `export const DERIVED_NUTRIENTS: Partial<Record<NutrientKey, string>> = {\n` +
    `  saltG: "sale = sodio (FDC 1093) x 2,5; ricavato, non misurato",\n` +
    `  omega3G: "somma di ALA (1404), EPA (1278), DPA (1280), DHA (1272) quando riportati; presente solo se c'e' l'ALA oppure sia EPA sia DHA",\n` +
    `};\n`;
  fs.writeFileSync(path.join(outDir, "index.ts"), index);

  console.log(`Foundation Foods ${datasets.foundation.version}, SR Legacy ${datasets.sr.version}`);
  console.log(`Alimenti generati: ${stats.count}`);
  console.log(`Gruppi variantOf: ${stats.twinGroups}`);
  console.log("Per gruppo:", JSON.stringify(stats.byGroup));
  console.log("Nutrienti da candidato alternativo:", JSON.stringify(stats.fallback));
  console.log("Minerali a zero nella fonte, lasciati assenti:", JSON.stringify(stats.nondetect));
  console.log(`Nutrienti tolti per arricchimento (${stats.stripped.length}):`, stats.stripped.join(", "));
  console.log("Nutrienti assenti (numero di alimenti):", JSON.stringify(stats.missing));
  if (stats.noDensity) console.log("Liquidi senza densita' (misura di volume assente o incoerente con la composizione):", stats.noDensity.join(", "));
  if (report) {
    console.log("\nCorrispondenze approssimative:");
    for (const line of stats.approx) console.log(`- ${line}`);
  }
}

main();
