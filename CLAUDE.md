@AGENTS.md

# Staio

Web app installabile (PWA), mobile first, per la gestione personale del cibo: un registro a eventi di tutto ciò che entra in casa, viene mangiato o buttato. Le fasi del progetto sono riassunte nel README. Lo staio è l'antica misura del grano, e il recipiente con cui lo si misurava: è anche l'oggetto del marchio.

## Stack

Next.js 16 (App Router, cartella `src/`), React 19, TypeScript strict, pnpm, Vitest, ESLint. Stili con CSS Modules e variabili di tema, niente Tailwind. three.js per il 3D, Dexie per l'archivio locale.

## Struttura

- `src/core/` logica pura di dominio, senza React né accesso a rete o disco. Ogni modulo ha i suoi test accanto (`*.test.ts`).
  - `units/` unità e conversioni
  - `ledger/` libro mastro a eventi e dispensa calcolata
  - `expiry/` scadenze
- `src/design/` tema e componenti di interfaccia
- `src/models3d/` generatore di modelli 3D e catalogo delle ricette
- `src/data/` archivio locale sul dispositivo
- `src/app/` pagine
- `riferimenti/` sorgenti del design approvato e della prova 3D: solo da leggere

## Regole

- Identificatori e nomi di file in inglese. Testi mostrati all'utente in italiano.
- Non scrivere il nome dell'app nel codice: usa la costante `APP_NAME` in `src/config.ts`.
- `src/core/` non importa da nessun'altra cartella del progetto e non ha dipendenze esterne.
- Ogni dato numerico che può essere una stima porta con sé il livello di certezza: `measured`, `label`, `estimated`.
- L'app non dà pareri medici: confronta assunzioni con valori di riferimento.
- Denaro in centesimi interi. Date di calendario come stringhe `YYYY-MM-DD`, istanti come ISO 8601 UTC.
- Commenti solo dove spiegano un perché non ovvio.

## Comandi

- `pnpm test` test
- `pnpm typecheck` controllo dei tipi
- `pnpm lint` lint
- `pnpm build` build
