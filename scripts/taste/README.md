# Abbinamenti di gusto: generazione dei dati

Scarica `output/kitchenette_embeddings.pkl` e `input/nodes_191120.csv` da https://github.com/lamypark/FlavorGraph in una cartella fuori dal repository, poi lancia `python -I scripts/taste/build_taste.py <embeddings.pkl> <nodes.csv>` (serve numpy): legge il pickle con un lettore ristretto e riscrive `src/core/taste/data/flavorgraph.json` e `non-mappati.txt`.
La corrispondenza nome inglese → alimento Staio è in `mapping.txt`, da correggere a mano; licenza e limiti in `src/core/taste/FONTI.md`.
Vicini ordinati con correzione dell'effetto hub, metodo CSLS (2·cos(x,y) − r(x) − r(y), con r(x) media del coseno con i 10 vicini più prossimi tra i nodi mappati). Il punteggio mostrato resta il coseno; il valore CSLS decide solo l'ordine.
Misura (lo script la stampa): presenze dei 10 nodi più frequenti tra i primi 20 vicini: coseno 545, CSLS 391, prossimità reciproca per rango 422 (su 5.140); 25 coppie classiche di controllo, solo per misurare e mai per forzare: 6 su 25 con tutti e tre i metodi. Scelto CSLS perché riduce di più la concentrazione; non migliora le coppie classiche, che la fonte non mette tra i primi venti.
