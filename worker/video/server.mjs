// Servizio di estrazione dei video: POST /estrai { url } -> { caption, transcript?, frames?, durationSec }.
// Si avvia con `node server.mjs`; la configurazione sta nelle variabili d'ambiente (vedi README.md).
import { createServer } from "node:http";
import { loadConfig } from "./src/config.mjs";
import { cleanStaleDirs } from "./src/extract.mjs";
import { createHandler } from "./src/handler.mjs";
import { logEvent } from "./src/logger.mjs";

let cfg;
try {
  cfg = loadConfig(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Configurazione non valida."}\n`);
  process.exit(1);
}

await cleanStaleDirs(cfg.tmpRoot);

const server = createServer(createHandler(cfg));
// i client lenti non tengono occupate le connessioni
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

server.listen(cfg.port, cfg.host, () => logEvent({ event: "listening" }));

function stop() {
  logEvent({ event: "stopping" });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), cfg.timeoutMs + 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
