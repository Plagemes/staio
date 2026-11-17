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
Prima visita senza rete; pagine `/app/...` dinamiche mai visitate; sezioni mai aperte oltre l'elenco noto (funzionano solo dopo una visita); risorse di altri domini; sincronizzazione in background; notifiche.
