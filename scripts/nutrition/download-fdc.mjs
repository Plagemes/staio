#!/usr/bin/env node
// Scarica da fdc.nal.usda.gov i file di dati JSON di Foundation Foods e SR Legacy e li
// estrae in una cartella FUORI dal progetto (per default nella cartella temporanea del sistema).
// Solo Node, nessuna dipendenza: l'estrazione dello zip usa node:zlib.
//
// Uso: node scripts/nutrition/download-fdc.mjs [--out <cartella>]
// Poi: node scripts/nutrition/build-foods.mjs --data <cartella>
//
// Licenza dei dati: pubblico dominio, CC0 1.0 (https://fdc.nal.usda.gov/api-guide).
// Pagina dei download: https://fdc.nal.usda.gov/download-datasets/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const BASE = "https://fdc.nal.usda.gov/fdc-datasets/";
// Versioni usate per generare la tabella. Aggiornarle qui (e rigenerare) per usare dati piu' recenti.
const FILES = [
  "FoodData_Central_foundation_food_json_2026-10-29.zip",
  "FoodData_Central_sr_legacy_food_json_2018-04.zip",
];

const args = process.argv.slice(2);
let out = path.join(os.tmpdir(), "staio-fdc");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = path.resolve(args[++i]);
  else throw new Error(`Argomento sconosciuto: ${args[i]}`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (out === repoRoot || out.startsWith(repoRoot + path.sep)) {
  throw new Error("La cartella di destinazione deve stare fuori dal progetto");
}

/** Estrae tutti i file di uno zip (compressione deflate o nessuna) leggendo la directory centrale. */
function unzip(buffer, destDir) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Zip non valido: directory centrale non trovata");
  const entries = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const written = [];
  for (let n = 0; n < entries; n++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Zip non valido: voce corrotta");
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const base = path.basename(name);
    if (base !== name.replace(/^.*[\\/]/, "")) throw new Error(`Nome non sicuro nello zip: ${name}`);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Metodo di compressione ${method} non supportato`);
    const target = path.join(destDir, base);
    fs.writeFileSync(target, data);
    written.push(target);
  }
  return written;
}

fs.mkdirSync(out, { recursive: true });
for (const file of FILES) {
  const url = BASE + file;
  console.log(`Scarico ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fallito (${res.status}) per ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  for (const target of unzip(buffer, out)) console.log(`  estratto ${target}`);
}
console.log(`Data dello scaricamento: ${new Date().toISOString().slice(0, 10)}`);
console.log(`Ora: node scripts/nutrition/build-foods.mjs --data "${out}"`);
