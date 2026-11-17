// Strumenti esterni (yt-dlp, ffmpeg): sempre eseguibili chiamati direttamente con gli argomenti in un array, mai
// tramite una shell. L'ambiente passato è minimo: il token e il resto della configurazione non arrivano ai processi figli.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { errorFor } from "./limits.mjs";

const COMMON_YTDLP = ["--ignore-config", "--no-playlist", "--no-cache-dir", "--no-warnings", "--socket-timeout", "15", "--retries", "2"];

/** Argomenti per leggere i metadati di un solo video, senza scaricarlo. `--` chiude le opzioni: l'indirizzo non può diventarne una. */
export function ytdlpInfoArgs(url) {
  return [...COMMON_YTDLP, "--skip-download", "--dump-single-json", "--", url];
}

/** Argomenti per scaricare un solo file (niente fusioni), entro la dimensione massima, nella cartella della richiesta. */
export function ytdlpDownloadArgs(url, dir, maxFileBytes) {
  return [
    ...COMMON_YTDLP,
    "--quiet",
    "--no-mtime",
    "--max-filesize",
    String(Math.trunc(maxFileBytes)),
    "-f",
    "b[height<=720]/b/w",
    "-o",
    join(dir, "video.%(ext)s"),
    "--",
    url,
  ];
}

/** Argomenti per un fotogramma JPEG a un istante, ridotto in larghezza. */
export function ffmpegFrameArgs(input, output, seconds, width) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    seconds.toFixed(2),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${Math.trunc(width)},iw)':-2`,
    "-q:v",
    "5",
    "-y",
    output,
  ];
}

/** Ambiente dei processi figli: solo ciò che serve, con la cartella della richiesta come casa. */
export function childEnv(dir) {
  return { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: dir, TMPDIR: dir, LANG: "C.UTF-8" };
}

/**
 * Esegue un file con argomenti. Si ferma allo scadere del tempo o all'annullamento (SIGKILL).
 * @param {string} file
 * @param {string[]} args
 * @param {{ dir: string, timeoutMs: number, signal?: AbortSignal, maxBuffer?: number }} options
 * @returns {Promise<string>} l'uscita standard
 */
export function runTool(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.dir,
        env: childEnv(options.dir),
        timeout: Math.max(1000, options.timeoutMs),
        killSignal: "SIGKILL",
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        signal: options.signal,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          // né i messaggi né gli argomenti (che contengono il link) escono da qui: solo il motivo
          if (options.signal?.aborted || error.killed || error.code === "ABORT_ERR") reject(errorFor("timeout"));
          else reject(errorFor("unavailable"));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
