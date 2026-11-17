// PUNTO DI ESTENSIONE: trascrizione del parlato.
//
// Per ora non trascrive: restituisce `undefined` e la risposta non ha il campo `transcript` (il contratto lo prevede
// facoltativo). Chi vuole aggiungere la trascrizione sostituisce il corpo di `transcribe`, senza toccare il resto.
//
// Impegni da rispettare:
//  - `videoPath` è un file dentro `dir`, la cartella della richiesta: legge solo da lì e scrive solo lì. La cartella
//    viene cancellata comunque a fine richiesta.
//  - Gli eseguibili si chiamano con `runTool` (argomenti in array, mai una shell) e rispettano `signal` e il tempo.
//  - Nessuna rete verso servizi esterni con il contenuto del video, a meno che chi installa non lo decida e lo scriva
//    nel README. Con whisper.cpp (eseguibile locale) il parlato non esce dalla macchina.
//  - Restituisce testo semplice. Il servizio lo taglia a `HARD_LIMITS.maxTranscriptChars`.
//  - Un errore qui non deve far fallire la richiesta: chi chiama lo ignora e risponde senza trascrizione.
//
// Esempio di schema (non attivo):
//   const wav = join(dir, "audio.wav");
//   await runTool(cfg.ffmpeg, ["-nostdin", "-loglevel", "error", "-i", videoPath, "-ar", "16000", "-ac", "1", "-y", wav], { dir, timeoutMs, signal });
//   return await runTool(cfg.whisper, ["-m", cfg.whisperModel, "-l", "auto", "-nt", "-f", wav], { dir, timeoutMs, signal });

/**
 * @param {{ videoPath: string, dir: string, durationSec: number, signal?: AbortSignal }} _input
 * @returns {Promise<string | undefined>}
 */
// eslint-disable-next-line no-unused-vars
export async function transcribe(_input) {
  return undefined;
}
