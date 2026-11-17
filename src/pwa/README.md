# PWA e uso senza rete

`public/sw.js` e' un service worker classico, senza build. `ServiceWorkerRegister` lo registra solo in produzione.

## Strategie
- Navigazioni: rete prima (con timeout di 4 s se esiste una copia), poi la stessa pagina in cache, poi `/app`. Si salvano solo `/` e `/app/*`.
- Richieste RSC (`_rsc` o intestazione `RSC`): rete prima; le risposte `text/x-component` si salvano con chiave URL piu' tipo di prefetch/segmento, e si leggono ignorando `Vary`. Senza copia la richiesta fallisce e il router di Next ripiega su una navigazione completa, servita dalla cache delle pagine.
- `/_next/static/` e caratteri: cache prima. Icone e manifest: copia in cache, aggiornata in sottofondo.
- All'installazione si salvano `/app` e le sottopagine note, piu' i chunk citati nel loro HTML. Le pagine che rispondono errore sono ignorate.
- Solo GET, solo stessa origine.

## Aggiornamenti
Il nuovo worker resta in attesa. L'interfaccia usa `useUpdateAvailable()` e `applyServiceWorkerUpdate()` (invia `SKIP_WAITING`, poi la pagina si ricarica).

## Alzare la versione
Cambia `CACHE_VERSION` in `public/sw.js`: all'attivazione le cache `staio-*` vecchie vengono cancellate. Aggiorna anche `PRECACHE_PAGES` se nascono nuove pagine.

## Non coperto
Prima visita senza rete; pagine `/app/...` dinamiche mai visitate; sezioni mai aperte oltre l'elenco noto (funzionano solo dopo una visita); risorse di altri domini; notifiche push dal server (non esiste).

## Avvisi senza server
Il worker non calcola avvisi: li calcola l'app (`src/core/notify`) e mostra quelli dovuti all'apertura. Il worker aggiunge solo due gestori, senza toccare le strategie di cache:
- `periodicsync` (etichetta `staio-daily-summary`, solo Chrome su Android con app installata): mostra il riepilogo che l'app ha salvato all'ultima apertura. Lo scarta se è scaduto, se è per un altro giorno, se il permesso manca, nelle ore di silenzio o oltre i limiti giornalieri.
- `notificationclick`: porta in primo piano una finestra dell'app e apre il percorso indicato, solo se è sotto `/app` (altrimenti `/app`).
Lo stato (preferenze, avvisi già mostrati, riepilogo) sta in un database IndexedDB a parte, `staio-notify`, letto sia dall'app (`src/features/notifications/store.ts`) sia dal worker. Se cambi nome, schema o chiavi, aggiorna entrambi: un test (`sw-notify.test.ts`) controlla il nome. Alzare `CACHE_VERSION` non serve per questi gestori.
