# Fonti dell'indice di qualità

Consultazione: **2026-11-17**. Le fonti sono state lette direttamente (documenti scaricati e testo dei regolamenti su EUR-Lex), non ricordate a memoria. Il codice non contiene altre soglie o giudizi oltre a quelli elencati qui.

L'indice non dà un voto unico: ogni dimensione ha esito (favorevole, intermedio, sfavorevole, non valutabile), spiegazione e fonte. Un dato mancante dà sempre «non valutabile».

## Verificato e usato

### Grassi, grassi saturi, zuccheri, sale (`thresholds.ts`)

- Fonte: Department of Health, Food Standards Agency e amministrazioni decentrate del Regno Unito, con il British Retail Consortium, *Guide to creating a front of pack (FoP) nutrition label for pre-packed products sold through retail outlets*, aggiornata a novembre 2016 (pubblicata il 19 giugno 2013, ultimo aggiornamento 8 novembre 2016 secondo la pagina di pubblicazione).
- Documento: https://assets.publishing.service.gov.uk/media/5a80cd03ed915d74e33fc7c5/FoP_Nutrition_labelling_UK_guidance.pdf
- Pagina: https://www.gov.uk/government/publications/front-of-pack-nutrition-labelling-guidance
- Dove: Annex 3, **Table 2** (alimenti, per 100 g) e **Table 3** (bevande, per 100 ml). Verde: valore minore o uguale alla soglia bassa; rosso: maggiore della soglia alta; ambra in mezzo.

| Per 100 g (alimenti) | verde fino a | rosso oltre |
|---|---|---|
| Grassi | 3,0 g | 17,5 g |
| Grassi saturi | 1,5 g | 5,0 g |
| Zuccheri totali | 5,0 g | 22,5 g |
| Sale | 0,3 g | 1,5 g |

| Per 100 ml (bevande) | verde fino a | rosso oltre |
|---|---|---|
| Grassi | 1,5 g | 8,75 g |
| Grassi saturi | 0,75 g | 2,5 g |
| Zuccheri totali | 2,5 g | 11,25 g |
| Sale | 0,3 g | 0,75 g |

Limiti da conoscere:
- È uno schema **britannico e volontario**, non una norma italiana. La fonte stessa dice che le soglie «basse» coincidono con le indicazioni «a basso contenuto» del Reg. (CE) 1924/2006 (nota 8 e 9 del documento).
- La fonte prevede anche criteri **per porzione** (rosso oltre una quota dell'assunzione di riferimento, per porzioni sopra 100 g o 150 ml): non applicati, perché il prodotto non porta la porzione.
- La fonte distingue alimenti e bevande ma non definisce «bevanda». **Scelta nostra:** si usa la tabella delle bevande solo se i valori sono per 100 ml **e** il prodotto ha la categoria Open Food Facts `beverages`. Valori per 100 ml senza quella categoria: non valutabile (non si sa quale tabella usare e non si converte in grammi senza densità).

### Nutri-Score (`definitions.ts`)

- Si usa la lettera già presente nel prodotto, letta da Open Food Facts, **senza ricalcolarla**.
- Fonte della scala: Santé publique France, pagina Nutri-Score, http://www.santepubliquefrance.fr/nutri-score: punteggio calcolato per 100 g o 100 ml, cinque colori dal verde scuro all'arancione scuro, lettere da A a E.
- **Scelta nostra, non della fonte:** l'esito raggruppa la scala per posizione (A e B favorevole, C intermedio, D ed E sfavorevole). La pagina consultata non riporta l'abbinamento esatto colore-lettera, quindi non lo si usa; la lettera è sempre mostrata accanto all'esito.

### Grado di lavorazione NOVA (`definitions.ts`)

- Fonte: FAO, Monteiro C.A., Cannon G., Lawrence M., Costa Louzada M.L., Pereira Machado P., *Ultra-processed foods, diet quality, and health using the NOVA classification system*, Roma 2019: https://www.fao.org/3/ca5644en/ca5644en.pdf (Table 1 e pp. 6-8). Definizioni dei quattro gruppi in parafrasi italiana.
- Il gruppo del prodotto è quello di Open Food Facts, che lo calcola da ingredienti e categorie con un metodo che la sua pagina definisce ancora sperimentale: https://world.openfoodfacts.org/nova
- **Scelta nostra:** la FAO non assegna voti ai gruppi. L'esito riassume ciò che il documento dice: gruppo 1 «base di una dieta sana» (favorevole); gruppi 2 e 3 «possono essere usati in eccesso, con moderazione danno piatti equilibrati» (intermedio); gruppo 4 «tipicamente nutrizionalmente squilibrato, tende a essere consumato in eccesso e a sostituire gli altri gruppi» (sfavorevole). La motivazione è riportata in ogni spiegazione.

### Additivi (`additives.ts`)

Un giudizio esiste solo per questi, con la fonte; per ogni altro additivo si mostrano solo presenza e numero.

- **E171 biossido di titanio**: Regolamento (UE) 2022/63 della Commissione del 14 gennaio 2022, https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32022R0063. Considerando 11-12: nel parere del 6 maggio 2021 l'EFSA ha concluso che non può più essere considerato sicuro come additivo alimentare; l'autorizzazione negli alimenti è eliminata. Articolo 2: i prodotti conformi alle norme precedenti al 7 febbraio 2022 potevano restare sul mercato fino al 7 agosto 2022 e poi fino al termine minimo di conservazione. Esito: sfavorevole. Il regolamento lo lascia autorizzato come colorante nei medicinali (non rilevante per gli alimenti).
- **E102, E104, E110, E122, E124, E129** (tartrazina, giallo di chinolina, giallo tramonto, carmoisina, Ponceau 4R, rosso allura): Regolamento (CE) 1333/2008, allegato V, https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32008R1333. Obbligo di avvertenza in etichetta: può influire negativamente sull'attività e l'attenzione dei bambini. Esito: intermedio (è un obbligo di etichetta, non un divieto).

### Densità di nutrienti

Proteine e fibre per 100 kcal, calcolate dai valori del prodotto. Descrittiva: nessuna soglia, nessun giudizio.

### Sul voto personale, l'impatto e le alternative

Non usano soglie proprie: si fondano sul confronto con i riferimenti del motore nutrizionale (passato come parametro, con le fonti di `src/core/nutrition/data`), sugli obiettivi indicati dall'utente, sul semaforo sopra e sui dati del prodotto. Per sale, zuccheri e grassi saturi i riferimenti del progetto non hanno un valore numerico: in quel caso si mostra l'assunzione e si dice che non si può dire se è alta.

## Non verificato e lasciato fuori

- **Giudizi di rischio su altri additivi** (conservanti, antiossidanti, emulsionanti, dolcificanti, nitriti e altri): non ho letto le rivalutazioni EFSA né i regolamenti specifici, quindi nessun giudizio. In particolare non sono inseriti i numeri E dei polioli (avvertenza «un consumo eccessivo può avere effetti lassativi», Reg. UE 1169/2011 allegato III punto 2.4) né dell'aspartame (punto 2.3): il testo consultato richiama la sostanza ma non riporta i numeri E, che non ho verificato.
- **Soglie «ricco di» / «fonte di» per proteine e fibre** (Reg. CE 1924/2006): non consultate, quindi la densità resta senza soglie e il voto personale per proteine e fibre dice solo quanto ne contiene il prodotto.
- **Soglie del Nutri-Score** e abbinamento esatto lettera-colore: non ricalcolati e non verificati.
- **Soglie italiane o dell'Unione europea per il semaforo**: non esiste uno schema ufficiale UE obbligatorio; non ne ho trovato uno da usare al posto di quello britannico.
- **Criteri per porzione** del semaforo: non applicabili senza la porzione.
- **Valori di riferimento numerici per sale, zuccheri e grassi saturi**: non nei dati del progetto (vedi `src/core/nutrition/data/RIFERIMENTI.md`).
