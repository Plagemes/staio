# Licenza del file `flavorgraph.json`

Questa licenza vale per il file `flavorgraph.json` (e per i file che ne derivano) e **non per il codice** di Staio.

**Licenza: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported (CC BY-NC-SA 3.0).**
Testo: https://creativecommons.org/licenses/by-nc-sa/3.0/

In breve:

- **Solo uso non commerciale.**
- **Attribuzione**: indica la fonte (sotto) e che il file è stato modificato (qui: vicini più simili per similarità coseno tra alimenti scelti, ordinati con la correzione CSLS, punteggi arrotondati).
- **Stessa licenza**: chi ridistribuisce o modifica il file lo fa con la stessa licenza.

## Origine

Il file è un dato derivato da FlavorGraph:

> Park D, Kim K, Kim S, Spranger M, Kang J. FlavorGraph: a large-scale food-chemical graph for generating food representations and recommending food pairings. Scientific Reports 11, 2021. DOI 10.1038/s41598-020-79422-8. https://github.com/lamypark/FlavorGraph

FlavorGraph deriva a sua volta da:

- FlavorDB (Garg N. et al., Nucleic Acids Research, 2018), CC BY-NC-SA 3.0;
- Recipe1M (Marín J. et al., IEEE TPAMI, 2019), senza condizioni dichiarate per i dati derivati;
- HyperFoods (Veselkov K. et al., Scientific Reports, 2019).

## Incertezza residua

I vettori di FlavorGraph non hanno una licenza esplicita propria e Recipe1M non dichiara condizioni per i dati derivati. Per questo si applica la licenza più restrittiva in gioco. Se un titolare dei diritti lo chiede, il file va tolto. Dettagli in `../FONTI.md`.

## Come è stato generato

`scripts/taste/build_taste.py` con `scripts/taste/mapping.txt`; la versione dei file di partenza è nel campo `version` del file.
