# Fonti degli abbinamenti di gusto

Verifica delle licenze fatta il 2026-11-17, leggendo i file e le pagine ufficiali. Non è una consulenza legale.

## Esito

**Dati derivati da FlavorGraph: NON inclusi nel repository.** La ridistribuzione in un repository pubblico, senza una licenza che la regoli, non è chiaramente consentita (motivi sotto). Il codice di `src/core/taste` è scritto da zero e funziona con qualunque insieme di dati nel formato `TasteData`. Oggi l'app usa un **insieme di prova scritto a mano** (`sample.ts`), dichiarato tale nell'interfaccia e nel codice (`source: "sample"`). I punteggi di quell'insieme sono tre fasce assegnate a mano, non numeri statistici.

## Cosa si è trovato

| Fonte | Licenza trovata | Cosa permette |
|---|---|---|
| Codice del repository `lamypark/FlavorGraph` | Apache License 2.0 (file `LICENSE`, riga «License» del README, metadati GitHub). Nel file `LICENSE` l'appendice con anno e titolare del copyright è lasciata in bianco. | Uso, modifica e ridistribuzione del codice, con avviso di copyright e di licenza. |
| Vettori pubblicati (`output/kitchenette_embeddings.pkl` nel repository; il README rimanda anche a un file su Google Drive) | Nessuna licenza propria: valgono la licenza generale del repository e quelle dei dati da cui sono addestrati. | Non chiaro, vedi sotto. |
| Grafo (`input/nodes_191120.csv`, `edges_191120.csv`) | Come sopra. | Non chiaro. |
| Articolo scientifico | CC BY 4.0 (Europe PMC). | Citare e riusare il testo con attribuzione. Non riguarda i dati. |
| Recipe1M (relazioni cibo-cibo: co-occorrenza negli ingredienti di oltre un milione di ricette) | La pagina del progetto non dichiara una licenza o condizioni d'uso per i dati; il codice associato è MIT. | Non verificabile: senza condizioni scritte non si può presumere il diritto di ridistribuire dati derivati dalle ricette. |
| FlavorDB (composti aromatici degli ingredienti, 35.440 relazioni ingrediente-composto nel grafo) | Creative Commons Attribution-NonCommercial-ShareAlike 3.0 (pagina ufficiale del database). | Solo uso non commerciale; i derivati vanno condivisi con la stessa licenza. Incompatibile con un repository senza licenza e con un'app che potrebbe diventare commerciale. |
| HyperFoods (relazioni ingrediente-farmaco, 386 relazioni) | Non verificata a fondo; piccola parte del grafo. | Non verificato. |

## Perché non basta l'Apache 2.0

1. Il titolare del repository non può concedere con l'Apache 2.0 diritti su dati che non sono suoi: i vettori sono addestrati anche su relazioni di FlavorDB (CC BY-NC-SA) e su Recipe1M (condizioni non dichiarate).
2. I vettori e i punteggi di vicinanza che ne ricaveremmo sono un'opera derivata di quelle relazioni. La clausola ShareAlike imporrebbe di ridistribuirli con la stessa licenza non commerciale, mentre il repository di Staio oggi non ha licenza ed è pubblico.
3. Il file `LICENSE` ha l'appendice non compilata e il README ha segnaposto («[a publication or conference]»): la dichiarazione è poco curata.
4. L'articolo dice che «dati e rappresentazioni addestrate sono disponibili» nel repository: è una dichiarazione di disponibilità, non una licenza sui dati.

Quindi: niente vettori, niente tabelle di vicini derivate, niente script che li scarichino ed eseguano nel repository finché non c'è una conferma scritta.

## Come si può sbloccare

- Scrivere agli autori (indirizzo nel README del repository) chiedendo una licenza esplicita per i vettori e se FlavorDB e Recipe1M ne consentono la ridistribuzione in forma derivata, anche commerciale.
- Oppure tenere i dati fuori dal repository e fuori dalla distribuzione: l'app non li può caricare dall'esterno senza ridistribuirli, quindi questa strada non è praticabile per un'app installabile.
- Oppure ricavare abbinamenti da una fonte con licenza chiara (per esempio ricette con licenza aperta) o scriverli a mano e rivederli.

Quando si sbloccherà, il formato è già pronto: un file `TasteData` con `source: "flavorgraph"`, caricato con import dinamico al posto di `sample.ts` in `src/features/taste/useTasteData.ts`. La mappatura dai nomi inglesi di FlavorGraph agli alimenti di Staio dovrà essere una tabella esplicita e rivedibile; ciò che non si mappa con sicurezza resta fuori ed è contato.

## Insieme di prova (`sample.ts`)

Scritto a mano, per la cucina italiana e mediterranea comune, senza copiare nessuna fonte. 70 alimenti con 623 coppie (circa 26 KB), legati a 114 dei 388 alimenti della tabella nutrizionale di Staio. Gli abbinamenti sono in tre fasce (classico, buono, possibile) e vanno rivisti da una persona prima di essere usati per consigliare. Non esprimono nessuna statistica.

## Citazione

Park D, Kim K, Kim S, Spranger M, Kang J. *FlavorGraph: a large-scale food-chemical graph for generating food representations and recommending food pairings.* Scientific Reports 11, 2021. DOI 10.1038/s41598-020-79422-8. Codice: https://github.com/lamypark/FlavorGraph (Apache-2.0).

Altre fonti citate dall'articolo: Recipe1M (Marín J. et al., 2019, IEEE TPAMI); FlavorDB (Garg N. et al., Nucleic Acids Research, 2018); HyperFoods (Veselkov K. et al., Scientific Reports, 2019).

## Cosa dice l'app sulla base degli abbinamenti

Con l'insieme di prova: «elenco di prova scritto a mano, non statistico». Con dati statistici veri: somiglianza appresa da ricette e composti aromatici, non una regola di cucina e non un giudizio di salute. Il testo è in `basis.ts`.
