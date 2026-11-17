// Una richiesta: metadati, controlli, scaricamento, fotogrammi, risposta. I file temporanei stanno in una cartella
// propria della richiesta e vengono sempre cancellati, anche in caso di errore o di tempo scaduto.
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { HARD_LIMITS, checkInfo, cleanText, errorFor, frameTimestamps, keepFrames, ServiceError } from "./limits.mjs";
import { verifyRedirectChain } from "./redirects.mjs";
import { ffmpegFrameArgs, runTool, ytdlpDownloadArgs, ytdlpInfoArgs } from "./tools.mjs";
import { transcribe as defaultTranscribe } from "./transcribe.mjs";

/** Cartella di lavoro di una richiesta, dentro la radice dei temporanei (riservata al servizio). */
export async function makeRequestDir(tmpRoot) {
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  return mkdtemp(join(tmpRoot, "req-"));
}

/** All'avvio: toglie ciò che una richiesta interrotta male avesse lasciato. Tocca solo le cartelle «req-». */
export async function cleanStaleDirs(tmpRoot) {
  let names;
  try {
    names = await readdir(tmpRoot);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith("req-")) continue;
    await rm(join(tmpRoot, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** Il file scaricato: l'unico `video.*` regolare nella cartella, entro la dimensione massima. */
async function findDownloaded(dir, maxFileBytes) {
  const names = (await readdir(dir)).filter((n) => n.startsWith("video.") && !n.endsWith(".part") && !n.endsWith(".ytdl"));
  if (names.length !== 1) throw errorFor("unavailable");
  const path = join(dir, names[0]);
  const info = await stat(path);
  if (!info.isFile()) throw errorFor("unavailable");
  if (info.size > maxFileBytes) throw errorFor("too_large");
  return path;
}

/**
 * @param {string} url indirizzo già validato (https, dominio ammesso)
 * @param {ReturnType<import("./config.mjs").loadConfig>} cfg
 * @param {{ fetch?: typeof fetch, transcribe?: typeof defaultTranscribe, run?: typeof runTool }} deps
 */
export async function extractVideo(url, cfg, deps = {}) {
  const run = deps.run ?? runTool;
  const doFetch = deps.fetch ?? fetch;
  const transcribe = deps.transcribe ?? defaultTranscribe;

  const deadline = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => deadline.abort(), cfg.timeoutMs);
  const remaining = () => Math.max(1000, cfg.timeoutMs - (Date.now() - startedAt));
  const dir = await makeRequestDir(cfg.tmpRoot);
  try {
    // 1. la strada dei reindirizzamenti resta tra i domini ammessi
    await verifyRedirectChain(url, { fetch: doFetch, signal: deadline.signal, domains: cfg.domains });

    // 2. metadati e controlli, prima di scaricare qualunque cosa
    const stdout = await run(cfg.ytdlp, ytdlpInfoArgs(url), { dir, timeoutMs: remaining(), signal: deadline.signal });
    let info;
    try {
      info = JSON.parse(stdout);
    } catch {
      throw errorFor("unavailable");
    }
    const checked = checkInfo(info, { maxDurationSec: cfg.maxDurationSec, maxFileBytes: cfg.maxFileBytes, domains: cfg.domains });
    if (!checked.ok) throw errorFor(checked.code);
    const caption = cleanText(typeof info.description === "string" && info.description.trim() !== "" ? info.description : info.title, HARD_LIMITS.maxCaptionChars);

    // 3. scaricamento di quel solo video
    await run(cfg.ytdlp, ytdlpDownloadArgs(url, dir, cfg.maxFileBytes), { dir, timeoutMs: remaining(), signal: deadline.signal });
    const videoPath = await findDownloaded(dir, cfg.maxFileBytes);

    // 4. fotogrammi a intervalli regolari
    const times = frameTimestamps(checked.durationSec, cfg.frames);
    const files = [];
    for (let i = 0; i < times.length; i++) {
      const out = join(dir, `frame-${i}.jpg`);
      try {
        await run(cfg.ffmpeg, ffmpegFrameArgs(videoPath, out, times[i], cfg.frameWidth), { dir, timeoutMs: remaining(), signal: deadline.signal });
        files.push(out);
      } catch (error) {
        if (error instanceof ServiceError && error.code === "timeout") throw error;
        // un fotogramma che non si estrae non fa fallire la richiesta
      }
    }
    const buffers = [];
    for (const file of files) buffers.push(await readFile(file));
    const kept = keepFrames(buffers.map((b) => b.length));
    const frames = kept.map((i) => buffers[i].toString("base64"));

    // 5. trascrizione (punto di estensione): un errore non blocca la risposta
    let transcript;
    try {
      const raw = await transcribe({ videoPath, dir, durationSec: checked.durationSec, signal: deadline.signal });
      const text = cleanText(raw, HARD_LIMITS.maxTranscriptChars);
      if (text !== "") transcript = text;
    } catch {
      transcript = undefined;
    }

    return { caption, ...(transcript ? { transcript } : {}), frames, durationSec: checked.durationSec };
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
