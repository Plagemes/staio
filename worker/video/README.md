# Servizio di estrazione dei video

Piccolo servizio per l'app: riceve il link di **un** video (Instagram, TikTok, YouTube), lo scarica con `yt-dlp`, ne prende
la didascalia e fino a 8 fotogrammi con `ffmpeg`, e li restituisce. L'analisi (didascalia, parlato e immagini diventano una
bozza di ricetta) la fa il telefono con la chiave AI dell'utente: **questo servizio non riceve mai la chiave AI** e non
chiama nessun servizio di intelligenza artificiale.

Per uso personale, un video alla volta. Il video non si conserva: i file temporanei stanno in una cartella per richiesta e
vengono cancellati a fine richiesta, anche in caso di errore.

Niente dipendenze npm: servono solo Node 20 o più recente, `yt-dlp` e `ffmpeg`.

## Contratto

`POST /estrai` con `Content-Type: application/json` e `Authorization: Bearer <token>`:

```
{ "url": "https://www.instagram.com/reel/..." }
```

Risposta 200:

```
{ "caption": "...", "transcript": "..."?, "frames": ["<jpeg in base64>", ...]?, "durationSec": 42.5 }
```

- `frames`: al massimo 8 JPEG, larghezza ridotta, scelti a intervalli regolari. Il campo `transcript` c'è solo se la
  trascrizione è attiva (vedi sotto).
- Errori: `{ "error": "<codice>" }` con stato HTTP. Codici: `unauthorized` (401), `forbidden_origin` (403),
  `invalid_request` (400), `payload_too_large` (413), `unsupported_media_type` (415), `invalid_url` e
  `domain_not_allowed` (422), `too_long` e `too_large` (422), `rate_limited` (429, con `Retry-After`), `unavailable` (502,
  per esempio video privato o rimosso), `busy` (503), `timeout` (504), `internal` (500). Nessun errore riporta il link o
  il contenuto.
- `GET /salute` risponde `{ "ok": true }` senza token (serve alla prova del collegamento e al controllo del contenitore).

## Limiti (tutti obbligatori)

| Limite | Valore |
|---|---|
| Protocollo | solo `https`, senza credenziali nell'indirizzo, solo porta 443 |
| Domini | `instagram.com`, `tiktok.com`, `youtube.com`, `youtu.be` e loro sottodomini: si confronta l'host ricavato dal parser, mai la stringa |
| Reindirizzamenti | seguiti a mano, al massimo 5; si fermano al primo passaggio fuori elenco. L'host della pagina finale dichiarato da `yt-dlp` è ricontrollato; l'estrattore generico è rifiutato |
| Video per richiesta | uno (le playlist sono rifiutate); un solo video in lavorazione alla volta (`STAIO_VIDEO_CONCURRENCY`, massimo 2) |
| Durata | massimo 300 secondi (dirette e durata ignota rifiutate, prima di scaricare) |
| Dimensione | massimo 80 MB per impostazione predefinita (tetto assoluto 200 MB), imposto anche a `yt-dlp` |
| Tempo | 120 s per richiesta per impostazione predefinita (tetto 300 s); i processi figli vengono terminati |
| Token | condiviso, almeno 24 caratteri, confrontato a tempo costante (hash e `timingSafeEqual`) |
| Richieste | 10 ogni 10 minuti per client (anche con token sbagliato); oltre, 429 |
| CORS | una sola origine configurabile; le richieste con un'altra origine sono rifiutate (403) |
| Registro | solo evento, stato, codice e durata. Mai link, contenuti, token o indirizzi di rete |
| Corpo | JSON di al massimo 4 KB |

I limiti si possono solo **abbassare** con le variabili d'ambiente.

## Configurazione

Variabili d'ambiente:

| Variabile | Obbligatoria | Significato |
|---|---|---|
| `STAIO_VIDEO_TOKEN` | sì | Token condiviso con l'app. Genera: `openssl rand -base64 32` |
| `STAIO_VIDEO_CORS_ORIGIN` | consigliata | Origine dell'app, per esempio `https://app.esempio.it` (senza percorso). Senza, nessun browser può usare il servizio |
| `HOST`, `PORT` | no | Predefiniti `127.0.0.1` e `8787` (nel contenitore `0.0.0.0`) |
| `STAIO_VIDEO_TRUST_PROXY` | no | `1` solo se davanti c'è un proxy di fiducia: il client per il limite è l'ultimo `X-Forwarded-For` |
| `STAIO_VIDEO_MAX_DURATION_SEC`, `STAIO_VIDEO_MAX_FILE_MB`, `STAIO_VIDEO_TIMEOUT_SEC` | no | Limiti più bassi di quelli sopra |
| `STAIO_VIDEO_FRAMES`, `STAIO_VIDEO_FRAME_WIDTH` | no | Fotogrammi (0-8) e larghezza in pixel |
| `STAIO_VIDEO_RATE_MAX`, `STAIO_VIDEO_RATE_WINDOW_SEC` | no | Richieste e finestra del limite |
| `STAIO_VIDEO_TMP` | no | Radice dei temporanei (solo il servizio ci scrive; all'avvio si tolgono le cartelle `req-*` rimaste) |
| `STAIO_VIDEO_YTDLP`, `STAIO_VIDEO_FFMPEG` | no | Percorsi degli eseguibili, se non sono nel `PATH` |

## Installazione con Docker

Dalla cartella `worker/video`:

```
docker build -t staio-video .
docker run -d --name staio-video --restart unless-stopped \
  --read-only --tmpfs /tmp/staio-video:rw,size=512m,mode=700,uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges \
  -e STAIO_VIDEO_TOKEN="<il token>" \
  -e STAIO_VIDEO_CORS_ORIGIN="https://app.esempio.it" \
  -p 127.0.0.1:8787:8787 \
  staio-video
```

`yt-dlp` va tenuto aggiornato (le piattaforme cambiano spesso): ricostruisci l'immagine senza cache, `docker build --no-cache`,
ogni tanto o quando i video smettono di scaricarsi. Il Dockerfile controlla la somma SHA-256 pubblicata con la versione.

## Come renderlo raggiungibile dall'app

L'app è servita in `https`, quindi il browser accetta solo un servizio in `https` (fa eccezione `localhost`). Il servizio non
parla `https` da solo: mettigli davanti un proxy inverso con certificato, oppure un tunnel in uscita, che inoltri a
`127.0.0.1:8787`. Non pubblicare la porta 8787 direttamente su internet. In Staio, in Impostazioni > Lettura dei video,
scrivi l'indirizzo `https` del servizio e il token.

## Rischi che restano

- Un link ammesso è sempre contenuto di altri: `yt-dlp` e `ffmpeg` elaborano file non fidati. Per questo il contenitore gira
  senza privilegi, con filesystem di sola lettura e senza capacità. Aggiorna spesso le immagini.
- Il controllo dei reindirizzamenti avviene prima, con richieste dirette alla pagina; `yt-dlp` ne fa poi di sue. Se puoi,
  limita l'uscita di rete del contenitore ai soli domini ammessi (regole del firewall o rete dedicata).
- Le piattaforme possono bloccare le richieste da certe reti o richiedere l'accesso: in quel caso il servizio risponde
  `unavailable` e l'app propone di incollare la didascalia. Controlla le condizioni d'uso delle piattaforme: il servizio è
  pensato per uso personale.
- Se il token trapela, chiunque lo abbia può usare il servizio (nei limiti di richieste e di durata). Cambialo con un nuovo
  avvio e aggiornalo nell'app.

## Trascrizione del parlato (punto di estensione)

Non è attiva: la risposta non ha `transcript`, e l'app usa didascalia e fotogrammi. Per aggiungerla si implementa
`transcribe()` in `src/transcribe.mjs` (il file spiega impegni e un esempio con `ffmpeg` e un eseguibile locale come
whisper.cpp). Il resto del servizio e l'app non cambiano. Se la trascrizione usasse un servizio esterno, il parlato uscirebbe
dalla macchina: scrivilo qui.

## Prove

Le parti pure (validazione dell'indirizzo, limiti, token, limite di richieste, CORS, gestione delle richieste con
strumenti finti) hanno test con il lanciatore di Node, senza rete e senza avviare il servizio:

```
cd worker/video
node --test "test/*.test.mjs"
```
