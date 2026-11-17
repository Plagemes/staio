# Fonti degli abbinamenti di gusto

Verifica delle licenze fatta il 2026-11-17 leggendo i file e le pagine ufficiali. Non è una consulenza legale.

## Che cosa c'è nel repository

- `data/flavorgraph.json`: **dato derivato da FlavorGraph**. Per 257 nodi ingrediente (che coprono 341 dei 388 alimenti della tabella nutrizionale di Staio) contiene i 20 vicini scelti per similarità coseno tra i vettori pubblicati e ordinati con correzione dell'effetto hub (CSLS), con punteggio (coseno) arrotondato a due decimali. Circa 58 KB, caricato con import dinamico solo dalla schermata degli abbinamenti.
- `data/LICENZA-DATI.md`: la licenza di quel file. **Vale per il file di dati e non per il codice.**
- `../../../scripts/taste/`: lo script che lo genera (`build_taste.py`), la tabella nome inglese → alimento Staio (`mapping.txt`, a mano, rivedibile) e l'elenco degli alimenti lasciati fuori (`non-mappati.txt`).
- Il resto di `src/core/taste` è codice scritto da zero e funziona con qualunque dato nel formato `TasteData`.
- `test-sample.ts`: piccolo insieme scritto a mano, usato solo nei test. Non è importato dall'app.

## Fonti e licenze

| Fonte | Licenza trovata | Cosa permette |
|---|---|---|
| Codice del repository `lamypark/FlavorGraph` | Apache License 2.0 (file `LICENSE`, README, metadati GitHub). L'appendice con anno e titolare è lasciata in bianco. | Uso, modifica e ridistribuzione del codice con avviso di licenza. Staio non ne usa il codice. |
| Vettori (`output/kitchenette_embeddings.pkl`) e tabella dei nodi (`input/nodes_191120.csv`) | Nessuna licenza propria oltre alla generale del repository. | Non chiaro, vedi sotto. |
| Articolo di FlavorGraph | CC BY 4.0 (Europe PMC). | Citare con attribuzione. Non riguarda i dati. |
| FlavorDB (composti aromatici degli ingredienti: 35.440 relazioni ingrediente-composto nel grafo) | CC BY-NC-SA 3.0 (pagina ufficiale del database). | Uso non commerciale, attribuzione, stessa licenza per chi ridistribuisce o modifica. |
| Recipe1M (co-occorrenza degli ingredienti in oltre un milione di ricette) | La pagina del progetto non dichiara condizioni per i dati; il codice associato è MIT. | Non dichiarato. |
| HyperFoods (386 relazioni ingrediente-farmaco nel grafo) | Non verificata a fondo; parte minima del grafo. | Non verificato. |

## Come è distribuito il file degli abbinamenti

Decisione del proprietario del progetto (2026-11-17): Staio è gratuito, non commerciale e a codice aperto. Il file `data/flavorgraph.json` è un dato derivato da FlavorGraph, che a sua volta deriva da FlavorDB e Recipe1M, ed è distribuito sotto **CC BY-NC-SA 3.0**:

- solo per uso non commerciale;
- con attribuzione (sotto);
- chi lo ridistribuisce o lo modifica lo fa con la stessa licenza.

La licenza vale per quel file, non per il codice. Per questo l'app resta non commerciale finché usa questi dati. La schermata mostra una riga di attribuzione con il collegamento alla fonte.

## Incertezza residua (dichiarata)

1. I vettori di FlavorGraph non hanno una licenza esplicita propria. L'Apache 2.0 del repository copre il codice; che copra anche dati addestrati su relazioni di FlavorDB (CC BY-NC-SA) non è garantito. Si è scelta la licenza più restrittiva tra quelle in gioco, la CC BY-NC-SA 3.0 di FlavorDB.
2. Recipe1M non dichiara condizioni per i dati derivati. Non si può escludere che le abbia in un accordo non pubblico.
3. Non c'è stata nessuna conferma scritta degli autori. **Se un titolare dei diritti lo chiede, il file va tolto** (basta rimuovere `data/flavorgraph.json` e il caricamento in `src/features/taste/useTasteData.ts`) e la voce tornare a "da rifare con dati con licenza chiara".
4. Il file non contiene i vettori ma solo vicini e punteggi: è comunque un derivato e lo si tratta come tale.

## Come sono stati letti i dati

I due file sono stati scaricati dal repository ufficiale in una cartella a sé, fuori dal repository di Staio, e trattati come non fidati: il pickle si legge con un `Unpickler` ristretto che ammette solo `numpy.ndarray`, `numpy.dtype` e la ricostruzione degli array (prima si sono elencati i tipi richiesti dal file con `pickletools`, senza eseguirlo: sono solo quei tre), Python con `-I`, nessun codice del repository scaricato è stato eseguito. Sono stati usati solo i nodi che la tabella dei nodi dichiara di tipo ingrediente (2.549 con vettore a 300 numeri; esclusi i nomi che compaiono anche come composto, e le 1.017 voci del pickle che non sono nella tabella dei nodi e di cui non si conosce il tipo).

## Cosa dice l'app sulla base degli abbinamenti

«Somiglianza statistica di gusto appresa da ricette e composti aromatici: non è una regola né un giudizio di salute.» (`basis.ts`). Sotto il titolo la schermata dice: «Alimenti che nelle ricette e negli aromi stanno vicini a questo. A volte sono compagni, a volte sostituti.»

Il punteggio mostrato è la similarità coseno tra i vettori, da 0 a 1. **Vicini ordinati con correzione dell'effetto hub, metodo CSLS** (Conneau et al., 2018): l'ordine usa 2·cos(x,y) − r(x) − r(y), dove r(x) è la media del coseno di x con i suoi 10 vicini più prossimi tra i nodi mappati. L'ordine dei vicini è quello corretto, il numero mostrato resta il coseno. Per i gruppi di alimenti (una ricetta) si ordina per la media dei valori CSLS e si mostra la media dei coseni. Il vicinato è per i 20 primi: non sempre reciproco; l'indice usa il valore più alto nei due sensi.

Scelta del metodo, con i numeri (stampati da `build_taste.py`, 257 nodi, primi 20 vicini, 5.140 posti): presenze dei 10 nodi più frequenti, coseno 545, CSLS 391 (−28%), prossimità reciproca per rango 422 (−23%); coppie classiche di controllo nei primi 20 (25 coppie scritte nello script solo per misurare, mai per forzare l'ordine): 6 su 25 con tutti e tre i metodi. Varianti provate e scartate: r calcolato su tutti i 2.549 nodi ingrediente, k = 30 o 100, coseno centrato sulla media: nessuna fa meglio.

Limiti noti: la correzione riduce la concentrazione (il nodo più frequente scende da 66 a 52 presenze su 257), ma non la elimina, e non porta nei primi venti i classici italiani che la fonte non vi mette (per esempio mozzarella con pomodoro). Il file riflette la fonte; non è stato corretto a mano.

## Citazione

Park D, Kim K, Kim S, Spranger M, Kang J. *FlavorGraph: a large-scale food-chemical graph for generating food representations and recommending food pairings.* Scientific Reports 11, 2021. DOI 10.1038/s41598-020-79422-8. Codice e dati: https://github.com/lamypark/FlavorGraph.

Fonti citate dall'articolo: Recipe1M (Marín J. et al., 2019, IEEE TPAMI); FlavorDB (Garg N. et al., Nucleic Acids Research, 2018); HyperFoods (Veselkov K. et al., Scientific Reports, 2019).
