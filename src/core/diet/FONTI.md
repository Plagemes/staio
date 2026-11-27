# Fonti del confronto «ciò che mangi» e indicazioni delle linee guida

Consultazione: **2026-11-27**. I documenti elencati come «letti» sono stati aperti nell'originale (PDF e pagine web), non ricordati a memoria. I valori stanno in `data/guidelines.ts` (righe e porzioni) e le fonti in `data/sources.ts`; questo file dice da dove viene ogni numero e che cosa è scelta dell'app. Un test (`data/guidelines.test.ts`) confronta i numeri con un'istantanea: chi cambia un valore deve aggiornare anche questo file.

L'app non dà pareri medici: confronta ciò che si è mangiato con indicazioni pubbliche. Le tabelle CREA sono «suggerimenti pratici», non limiti (il testo dice che le porzioni sono «orientative e non prescrittive», p. 59) e non valgono per chi ha patologie particolari.

## Fonti

| Sigla nel codice | Documento | Stato | Indirizzo |
|---|---|---|---|
| `crea-lg-2018` | CREA, *Linee guida per una sana alimentazione*, revisione 2018 (edizione novembre 2019, ISBN 9788833850375; testo approvato il 3/4/2019). Pagine citate: quelle **stampate** (pagina PDF meno 1) | letto | https://www.crea.gov.it/documents/59764/0/LINEE-GUIDA+DEFINITIVO+%281%29.pdf/3c13ff3d-74dc-88d7-0985-4678aec18537?t=1579191262173 |
| `who-sugars-2015` | OMS, *Guideline: Sugars intake for adults and children* (ISBN 978-92-4-154902-8) | letto, pp. 4 e 16 | https://iris.who.int/server/api/core/bitstreams/4be74f01-de93-4596-bbd1-02a97afb1221/content |
| `who-healthy-diet` | OMS, fact sheet «Healthy diet» (26 gennaio 2026) | letto | https://www.who.int/news-room/fact-sheets/detail/healthy-diet |
| `who-salt` | OMS, fact sheet «Salt reduction» (11 maggio 2026) | letto | https://www.who.int/news-room/fact-sheets/detail/salt-reduction |
| `efsa-drv` | EFSA, DRV Finder, «Dietary Fibre», adulti | **ripreso da `core/nutrition/data/reference.ts`** (letto e documentato in `core/nutrition/data/RIFERIMENTI.md`, consultazione 2026-11-17); non riletto per questo modulo | https://multimedia.efsa.europa.eu/drvs/index.htm |
| `nova-fao-2019` | Monteiro e altri, classificazione NOVA, FAO 2019 | **non verificata direttamente**: titolo e indirizzo da controllare prima di citarla; `url` vuoto, `verified: false`. La data 2026-11-27 è quella in cui lo stato è stato registrato, non una lettura | – |
| `app` | Scelte dell'app, elencate qui sotto | non è una fonte esterna | – |

Letti ma **fuori dalle fonti del codice** (solo qui, mai nei testi dei consigli): IARC, comunicato n. 240 del 26 ottobre 2015 (https://www.iarc.who.int/wp-content/uploads/2018/07/pr240_E.pdf); OMS, Q&A sulla carcinogenicità di carne rossa e trasformata, 23 settembre 2026 (https://www.who.int/news-room/questions-and-answers/item/cancer-carcinogenicity-of-the-consumption-of-red-meat-and-processed-meat); OMS, consultazione sul modello di profilo degli alimenti (2/11/2026).

## Righe delle linee guida

Convenzioni di `GuidelineRow`:
- `perDay` / `perWeek`: la Tab. 9.1 dà una frequenza suggerita per livello; nel codice è il `min`. Un tetto c'è solo dove la fonte lo scrive.
- `maxPerDay` / `maxPerWeek`: massimo scritto dalla fonte (zucchero, miele e marmellata), oppure riga con asterisco letto come massimo (vedi sotto).
- `occasional` / `notAdvised`: nessun numero; `targetFor` dà `undefined`.
- Livelli: 1500 / 2000 / 2500 kcal, nell'ordine della tabella. L'assegnazione delle colonne è stata verificata sulle immagini delle pagine (nel PDF la tabella è ruotata e le celle di frequenza sono unite su più righe).
- Quota integrale in frazione 0..1; zuccheri liberi in punti percentuali dell'energia (10 = 10%).

| Riga | Tipo | 1500 / 2000 / 2500 | Dove nella fonte | Lettura |
|---|---|---|---|---|
| `vegetables` | perDay | 2 ½ / 2 ½ / 3 | CREA Tab. 9.1, p. 131, righe «Verdura fresca» e «Insalate» (cella unita) | **interpretazione**: le porzioni di verdura e insalata si sommano |
| `fruit` | perDay | 2 / 3 / 3 | CREA Tab. 9.1, p. 131, righe «Frutta fresca» e «Frutta essiccata» (cella unita) | **interpretazione**: la frutta essiccata non zuccherata è un'alternativa alla fresca, non si aggiunge. Succhi e centrifughe non contano (cap. 2, p. 46) |
| `vegFruitTotal` | gramsPerDayMin | min 400 g | CREA cap. 2, pp. 46-48 («almeno 5 porzioni»; «raccomandazione minima di 400g/die»); OMS «Healthy diet»: almeno 400 g sopra i 10 anni | letto |
| `bread` | perDay | 2 ½ / 3 ½ / 4 ½ | CREA Tab. 9.1, p. 130, «Pane» | letto |
| `grains` | perDay | 1 / 1 ½ / 1 ½ | CREA Tab. 9.1, p. 130, «Pasta, riso, mais, farro, orzo ecc.» | letto |
| `breadSubstitutes` | maxPerWeek | 1 / 1 / 1 | CREA Tab. 9.1, p. 130, «Sostituti del pane*» | **interpretazione**: asterisco = «possibile frequenza inferiore», letto come massimo |
| `sweetBakery` | maxPerWeek | ½ / 2 / 2 | CREA Tab. 9.1, p. 130, «Prodotti da forno dolci*» | **interpretazione** (asterisco); due porzioni nella riga (50 g e 30 g biscotti): l'app usa 50 g |
| `breakfastCereals` | maxPerWeek | ½ / 2 / 3 | CREA Tab. 9.1, p. 130, «Cereali per la prima colazione*» | **interpretazione** (asterisco) |
| `potatoes` | perWeek | 1 / 2 / 2 | CREA Tab. 9.1, p. 130, «Patate» (nota 4); «Tuberi» ha gli stessi valori | letto |
| `wholeGrainShare` | shareMin | min 0,5 | CREA cap. 3, p. 55: «almeno metà delle porzioni di cereali» integrali | letto |
| `legumes` | perWeek | testo: min 2; tabella 3 / 3 / 3 | CREA cap. 3, p. 59 («2-4 porzioni a settimana… nulla vieta un consumo maggiore») e Tab. 9.1, p. 132 | **interpretazione**: vince il testo (`textRange`), ma si tiene solo l'estremo basso (2) perché il testo non pone un tetto |
| `fish` | perWeek | 2 / 2 / 3 | CREA Tab. 9.1, p. 131; cap. 5, p. 75 («almeno 2-3 volte a settimana») | letto |
| `fishPreserved` | maxPerWeek | 0 / 1 / 1 | CREA Tab. 9.1, p. 131, «Pesce conservato*» | **interpretazione** (asterisco); lo 0 a 1500 kcal è il valore scritto |
| `whiteMeat` | perWeek | 1 / 2 / 3 | CREA Tab. 9.1, p. 131, «Carne bianca» | letto |
| `redMeat` | maxPerWeek | 1 / 1 / 1 | CREA Tab. 9.1, p. 131, «Carne rossa*»; testo p. 127 | **interpretazione** (asterisco) |
| `processedMeat` | occasional | – | CREA Tab. 9.3, p. 140: «CONSUMO OCCASIONALE, se lo si desidera, limitarlo a piccole quantità, saltuariamente» | letto; nessuna frequenza numerica |
| `eggs` | perWeek | testo: 2-4; tabella 2 / 3 / 4 | CREA Tab. 9.1, p. 132; testo pp. 87 e 127 (contano anche le uova come ingrediente) | letto; vince il testo (`textRange` 2-4). Il testo dice anche che non vi è ragione di porre limiti netti |
| `milkYogurt` | perDay | 3 / 3 / 3 | CREA Tab. 9.1, p. 132, «Latte» e «Yogurt» (cella unita) | **interpretazione**: 3 porzioni in totale. Incoerenza interna: il cap. 5 (p. 75) scrive «una tazza di latte o yogurt» al giorno |
| `cheese` | perWeek | 3 / 3 / 3 | CREA Tab. 9.1, p. 132, formaggi fino al 25% e oltre il 25% di grassi (cella unita) | **interpretazione**: 3 porzioni in totale; la fonte non lo scrive |
| `oilsFats` | perDay | 2 / 3 / 4 | CREA Tab. 9.1, p. 132, «Oli e grassi da condimento» (cella unica per olio, burro e altri grassi) | letto |
| `nutsSeeds` | perWeek | 1 / 2 / 2 ½ | CREA Tab. 9.1, p. 133 | letto |
| `cakesIceCream` | occasional | – | CREA Tab. 9.3, p. 139 | letto; nessuna frequenza |
| `snacksChocolate` | occasional | – | CREA Tab. 9.3, p. 139 (snack, patatine, barrette, cioccolato, creme spalmabili) | letto; il PDF mette sotto la stessa cella anche la frutta essiccata con zucchero, candita o sciroppata: in app è un dolce |
| `sugaryDrinks` | occasional | – | CREA Tab. 9.3, p. 139 | letto; nessun limite in ml |
| `sugar` | maxPerDay | 1 / 1 ½ / 2 | CREA Tab. 9.3, p. 140, «Zucchero» | letto sull'immagine |
| `honeyJam` | maxPerWeek | 1 / 2 / 2 | CREA Tab. 9.3, p. 140, «Miele, marmellata» | letto sull'immagine |
| `alcohol` | notAdvised | – | CREA Tab. 9.3, p. 139; cap. 8: «CONSUMO NON CONSIGLIATO» | letto; nessun consiglio in questa versione |
| `salt` | gramsPerDayMax | max 5 g | CREA cap. 7, p. 101 («inferiore a 5g al giorno»); OMS «Healthy diet» e «Salt reduction» (meno di 5 g, 2 g di sodio) | letto. Il limite di 4 g per gli anziani (p. 101) non è applicato: l'app non conosce l'età |
| `freeSugars` | percentEnergyMax | max 10 % | OMS 2015, «Recommendations», pp. 4 e 16: raccomandazione **forte**, meno del 10% dell'energia | letto. Il 5% è «condizionale» (evidenza di qualità molto bassa) e non è una soglia dell'app. Il 15% degli zuccheri semplici totali (CREA cap. 6, p. 92) riguarda un'altra quantità |
| `fiber` | gramsPerDayMin | min 25 g | EFSA DRV Finder, assunzione adeguata per gli adulti, tramite `core/nutrition/data/reference.ts` | ripreso dal modulo, non riletto qui |

## Porzioni standard

Tutte dalle colonne «Porzione standard» delle Tab. 9.1 e 9.3 del CREA (pp. 130-133 e 139-140). Il CREA dichiara di riprenderle dai LARN IV (SINU 2014, nota 1, p. 133). **I LARN non sono stati verificati**: il link citato dal CREA oggi risponde con la home di sinu.it. Per ogni porzione il codice riporta riga e pagina nel campo `where`.

Base (`basis`): la nota 1 dice che le porzioni sono riferite al crudo al netto degli scarti o, in alcuni casi, al prodotto pronto (latte e derivati, pane, alcuni dolciumi). Sono `ready` quelle elencate dalla nota (latte, yogurt, formaggi, pane, dolciumi) e, **per lettura dell'app**, quelle con peso sgocciolato, conservate o bevande: legumi e soia, pesce conservato, carni trasformate, sostituti del pane, cereali da colazione, bevande zuccherate, zucchero, miele e marmellata. Le altre sono `raw`.

Limiti: la riga «Prodotti da forno dolci» ha due porzioni (50 g e 30 g per i biscotti) e la tabella ne può tenere una (50 g). La lattina di bevanda zuccherata (330 ml) e la pasta ripiena (125 g) non hanno una chiave propria.

## Scelte dell'app (fonte `app`)

Non vengono dalle fonti: sono decisioni dell'app, dichiarate qui e da riportare nelle schermate «Come è calcolato».

- **Livello energetico:** 2000 kcal di partenza (`DEFAULT_LEVEL`), modificabile nell'impostazione `quality.eaten.level`. La fonte presenta 1500, 2000 e 2500 kcal come «esempi ipotetici» e non dice come assegnarli a una persona.
- **Celle unite della Tab. 9.1:** verdura e insalate si sommano; frutta fresca ed essiccata sono alternative; latte e yogurt sono 3 porzioni in totale; i formaggi sono 3 in totale. Le righe con asterisco (sostituti del pane, dolci da forno, cereali da colazione, pesce conservato, carne rossa) sono lette come massimo. Tutte marcate `interpretation`.
- **Soglie di «occasionale»** (`OCCASIONAL_PER_WEEK`, nel motore dei consigli): carni trasformate 1, torte e gelati 2, snack e cioccolato 2, bevande zuccherate 1 a settimana. Sono numeri dell'app: la fonte scrive solo «consumo occasionale» e non dà frequenze. Si supera = «più che occasionale». I testi citano solo «consumo occasionale secondo le Linee guida».
- **Soglie di dati sufficienti** (`DIET_THRESHOLDS`): almeno 4 giorni con dati, 4 giorni completi, copertura 0,7. Per dire «sotto» servono 6 giorni e copertura 0,8. Andamento: almeno 4 settimane e variazione relativa di almeno 15% (sotto è «stabile»).
- **Asimmetria del minimo:** «sopra» si può dire anche con dati parziali (il minimo conosciuto supera già il tetto), «sotto» no: con dati incompleti si dice «almeno».
- **Fattibilità, priorità e quota minima di porzione** (`MIN_SHARE_OF_PORTION`): costanti dell'app nel motore dei consigli.
- **Lavorazione dei generici:** la mappa NOVA per gli alimenti della tabella interna è dichiarata e **sempre stimata**. Anche la categoria del lotto e le parole del nome danno solo stime. L'equivalente crudo a parità di energia, quando mancano le rese, è una scelta dell'app.
- **Ultra-processati (NOVA):** nessuna soglia ufficiale nelle fonti lette (il CREA non usa il termine né la classificazione NOVA; l'OMS ha solo una bozza di consultazione per misure regolatorie, senza limiti individuali). L'app mostra la quota e l'andamento personale; la regola `processedShareUp` confronta con la mediana delle proprie settimane. La fonte NOVA FAO 2019 è citata come **non verificata direttamente**.
- **Zuccheri liberi:** stima per difetto (dolci, zucchero, miele, marmellata, bevande zuccherate e succhi). Le fonti non permettono di separare gli zuccheri aggiunti dentro altri alimenti (yogurt zuccherato e simili). «Sotto il 10%» non si dichiara mai.
- **Esclusi in questa versione:** alcol (`notAdvised`, nessun consiglio); latte e yogurt (solo descrittivi: incoerenza tra p. 75 e Tab. 9.1); acqua (c'è già l'obiettivo dell'acqua).
- **Come si conta una parte (`GROUP_PORTION_KEY`, in `week.ts`):** una parte senza `portionKey` prende la porzione più comune del suo gruppo, così le voci riconosciute solo dal nome contano. I gruppi senza voce (bevande, condimenti, piatti misti) contano 1 porzione per occasione, stimata. La classificazione assegna comunque la porzione più precisa possibile.
- **Riga riconosciuta:** una riga di Oggi conta come classificata se almeno il 50% (di energia o di parti) è riconosciuto; sotto, resta «da classificare» e non entra nei conteggi.
- **Porzione per occasione:** le porzioni di un pasto sono arrotondate a 0,5, con un minimo di 0,5; senza grammi l'occasione vale 1 porzione, stimata.
- **Volte, non porzioni, per gli occasionali:** per carni trasformate, dolci, snack e bevande zuccherate l'unità è «volte nella settimana» (le occasioni distinte, `rowTallies[riga].occasions`); i testi scrivono «N volte» da lì, non dal valore dell'indicatore.
- **Quota minima di porzione nelle ricette (`MIN_SHARE_OF_PORTION`, 0,5):** in una ricetta un gruppo conta solo se i suoi ingredienti arrivano almeno a metà della porzione standard (mezzo cucchiaio d'olio o un pizzico di formaggio non contano).
- **Unità:** un pezzo vale una porzione (stima); tra massa e volume, senza densità, 1 g = 1 ml (stima).
- **Mappature dei gruppi (stime dichiarate, in `data/foodGroups.ts`, `categories.ts`, `nameRules.ts`):** l'anatra resta carne rossa; l'hummus conta tra i legumi; la castagna tra la frutta secca; il latte condensato tra i dolci; le bevande vegetali (soia, avena, riso, mandorla) tra le altre bevande, non nel latte; biscotti e cornetti sono prodotti da forno dolci; il cioccolato è tra gli snack; i fiocchi d'avena sono cereali per la colazione e integrali.
- **Formaggi freschi e stagionati:** il confine è 300 kcal ogni 100 g (`CHEESE_FRESH_MAX_KCAL`); il CREA divide i formaggi per grassi (fino al 25% e oltre), l'app non ha sempre quel dato.
- **Integrale:** un prodotto è integrale se il primo ingrediente dell'elenco è un cereale o una farina integrale (criterio del CREA, p. 53); la categoria del lotto («integrale» nel nome della categoria) è una stima. Senza elenco degli ingredienti resta una stima.
- **Lavorazione di un prodotto:** viene solo dal valore NOVA del prodotto (certezza «etichetta»); senza, vale la mappa dei generici, stimata.
- **Soglia di «ripetuto» negli andamenti personali (`OWN_TREND_MIN_WEEKS`):** servono almeno 3 settimane chiuse e sufficienti perché la mediana delle proprie settimane abbia senso (confronto di `processedShareUp`). Non è la soglia di 4 settimane dell'andamento dei quadri.
- **Fattibilità e certezza (`ACTION_FEASIBILITY`, `CERTAINTY_FACTOR`):** la priorità di un consiglio è gravità × fattibilità della prima azione × certezza. Fattibilità: cucina con ciò che c'è 1, ricetta con almeno metà degli ingredienti in casa 0,9, «metti nel piano» 0,8, alternativa 0,7, apri la ricetta 0,6, aggiungi alla spesa 0,5, apri il dettaglio 0,2. Certezza: misurato o da etichetta 1, stimato 0,75. Sono numeri dell'app, senza fonte esterna.
- **Nomi per la spesa (`SHOPPING_NAME_OF_GROUP`):** «Aggiungi alla spesa» scrive un nome generico per il gruppo cercato (verdura di stagione, frutta di stagione, lenticchie, pasta integrale, pesce, frutta secca): una mappa dell'app, non una raccomandazione di prodotto.
- **Dolci, snack e bevande zuccherate insieme (`sweetsDrinksOften`):** una regola sola per tre righe; il fatto mostrato è la riga che supera di più la propria soglia di «occasionale» e la gravità si misura su quella.
- **Ricette proposte:** le ricette con un allergene o un alimento escluso dall'utente non arrivano mai al motore (le filtra il collante in `features/diet`, con il controllo di `core/allergens`), e il motore stesso scarta una ricetta marcata `clear: false`.
- **Righe senza consigli:** pane, pasta, patate, carne bianca, formaggi, grassi, uova, zucchero, miele e marmellata hanno un indicatore ma nessuna regola di consiglio.
- **IARC e OMS sulle carni:** solo qui, mai nei consigli, che citano il CREA. IARC (2015): carne trasformata nel Gruppo 1 («sufficient evidence in humans» per il tumore del colon-retto), carne rossa nel Gruppo 2A. I gruppi indicano la solidità dell'evidenza, non la probabilità di ammalarsi. Il comunicato aggiunge che per una persona il rischio «remains small» e che la carne rossa ha valore nutritivo; l'OMS non ha fissato un limite numerico. Il CREA non cita la IARC per la carne: scrive che le carni trasformate «possono costituire un rischio per la salute» (p. 127).
- **Correzioni dell'utente non sincronizzate:** `quality.classOverrides` ha la stessa natura di `foodOverrides` (interpretazione di un nome, non un fatto del diario) e non passa da un telefono all'altro con la sincronizzazione.
- **Ricalcolo del passato:** se cambiano le tabelle di mappatura, le settimane passate si ricalcolano e anche gli esiti dei consigli possono cambiare. Va detto in «Come è calcolato».
- **«Settimane passate»:** sono regole ricalcolate sul registro, non consigli che l'utente ha visto: confronti tra settimane, non sappiamo che cosa abbia visto o fatto.

## Non verificato

- CREA, *Dossier scientifico* (2018): contenuto non letto, solo esistenza e indirizzo.
- LARN IV (SINU 2014), porzioni standard: documento non raggiungibile; le porzioni sono quelle del CREA.
- Fonte NOVA FAO 2019, linea guida OMS sugli ultra-processati, eventuali documenti del Ministero della Salute sugli ultra-processati: non trovati o non letti.
- CREA, Tab. 1.2 (bambini e adolescenti) e Tab. 9.2: fuori ambito, solo adulti. Il confronto non vale per minori, gravidanza e allattamento.
- EFSA: il valore delle fibre non è stato riletto in questo lavoro.
