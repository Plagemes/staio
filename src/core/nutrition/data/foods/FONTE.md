# Fonte della tabella di composizione degli alimenti

## Banca dati

USDA FoodData Central (FDC), Dipartimento dell'Agricoltura degli Stati Uniti, Agricultural Research Service. Si usano due insiemi di dati generici:

- **SR Legacy**, versione aprile 2018 (ultima versione, non piu' aggiornata): 380 voci su 388.
- **Foundation Foods**, versione 2026-10-29: 8 voci su 388.

Ogni voce riporta in `source` la banca dati, l'identificativo FDC (`fdcId`) e la descrizione originale in inglese.

## Licenza

I dati di FoodData Central sono di pubblico dominio, non coperti da copyright, e pubblicati con licenza CC0 1.0 Universal. Non serve alcun permesso per usarli. La fonte chiede di citare FoodData Central come origine dei dati.

- Dichiarazione ufficiale (sezione "Licensing"): https://fdc.nal.usda.gov/api-guide
- Testo della licenza: https://creativecommons.org/publicdomain/zero/1.0/
- Pagina dei download: https://fdc.nal.usda.gov/download-datasets/

Citazione suggerita: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. https://fdc.nal.usda.gov

## Scaricamento

- Data dello scaricamento: 2026-11-17.
- File: `FoodData_Central_foundation_food_json_2026-10-29.zip` e `FoodData_Central_sr_legacy_food_json_2018-04.zip`, da `https://fdc.nal.usda.gov/fdc-datasets/`.
- La versione dei dati usata e' esportata da `index.ts` come `FOODS_SOURCE_VERSION`.

## Come rigenerare

I file `*.ts` di questa cartella (tranne `foods.test.ts`) sono generati: non vanno modificati a mano.

```
node scripts/nutrition/download-fdc.mjs                       # scarica ed estrae in una cartella temporanea fuori dal progetto
node scripts/nutrition/build-foods.mjs --data <cartella> --report
pnpm exec vitest run src/core/nutrition/data/foods
```

- `download-fdc.mjs` scrive per default in `<cartella temporanea>/staio-fdc` (si cambia con `--out`) e rifiuta cartelle dentro il progetto.
- `build-foods.mjs` legge i JSON e le corrispondenze `scripts/nutrition/matches/<gruppo>.json` (alimento italiano → `fdc`), con questi campi: `id`, `name`, `aliases`, `fdc`, `unit` (modificatore della porzione FDC da cui prendere il peso di un pezzo), `liquid` (ricava la densita'), `state` (forza lo stato), `variantOf` (chiave dei gemelli), `strip` (nutrienti da lasciare assenti perche' aggiunti dall'arricchimento), `approx` (nota sulle corrispondenze approssimative, stampata con `--report`).
- Lo script fallisce se un identificativo FDC non esiste, se un'unita' della fonte non e' quella attesa, se un valore della fonte e' negativo o se mancano energia o macronutrienti.
- Per aggiungere un alimento: cercare la voce FDC, aggiungere la riga al file del gruppo, rigenerare. Gli `id` sono stabili: non rinominarli.

I nomi dei file sono in inglese (regola del progetto); i valori di `group` e i testi mostrati sono in italiano.

## Corrispondenza dei nutrienti

Tutti i valori sono per 100 g (`basis: "g"`, anche per i liquidi) e vengono dalla fonte senza arrotondamenti. Un nutriente non riportato dalla fonte per quella voce e' assente, mai zero. Uno zero e' presente solo se la fonte riporta zero.

| Chiave | Nutriente FDC (id) | Note |
| --- | --- | --- |
| `energyKcal` | Energy, kcal (1008) | in mancanza, Atwater general (2047), poi specific (2048); le voci con solo kJ (1062) sarebbero convertite con 4,184 kcal/kJ |
| `proteinG`, `fatG` | 1003, 1004 | |
| `carbsG` | Carboidrati per differenza (1005) | in mancanza, per somma (1050) |
| `sugarsG` | Zuccheri totali (2000) | in mancanza 1063 |
| `saturatedFatG`, `monounsaturatedFatG`, `polyunsaturatedFatG` | 1258, 1292, 1293 | |
| `fiberG` | Fibra alimentare totale (1079) | in mancanza 2033 (AOAC 2011.25) |
| `waterG` | 1051 | |
| `cholesterolMg` | 1253 | |
| calcio, ferro, magnesio, fosforo, potassio, zinco | 1087, 1089, 1090, 1091, 1092, 1095 | mg |
| `seleniumUg`, `iodineUg` | 1103, 1100 | lo iodio c'e' solo in Foundation Foods |
| `vitaminAUg` | Vitamina A, **RAE** (1106) | vedi i limiti |
| `vitaminCMg` | 1162 | |
| `vitaminDUg` | Vitamina D (D2 + D3), microgrammi (1114) | |
| `vitaminEMg` | alfa-tocoferolo (1109) | |
| `vitaminKUg` | fillochinone, K1 (1185) | non include i menachinoni |
| tiamina, riboflavina, niacina, vitamina B6 | 1165, 1166, 1167, 1175 | niacina in mg, non equivalenti |
| `folateUg` | Folati totali (1177) | non DFE |
| `vitaminB12Ug` | 1178 | |
| `alcoholG`, `caffeineMg` | 1018, 1057 | |

## Valori ricavati (non misurati)

Dichiarati anche in `index.ts` come `DERIVED_NUTRIENTS`.

- **`saltG`**: sodio (1093) in mg × 2,5 ÷ 1000. La fonte non riporta il sale: il valore e' ricavato dal sodio e non distingue il sodio che non viene dal cloruro di sodio.
- **`omega3G`**: somma di ALA (1404), EPA (1278), DPA (1280) e DHA (1272) quando riportati. Presente solo se c'e' l'ALA, oppure sia EPA sia DHA; altrimenti assente.
- **`unitWeightG`**: peso di una porzione a pezzi riportata dalla fonte (`foodPortions.gramWeight` ÷ quantita'), scelta per modificatore esatto nella corrispondenza. Si riferisce alla parte edibile (per esempio un uovo senza guscio, una mela senza torsolo) come la composizione. Presente solo dove la fonte ha una porzione a pezzi.
- **`densityGPerMl`**: solo per i liquidi, peso di una misura di volume riportata dalla fonte (tazza, fl oz, cucchiaio, cucchiaino) diviso il volume che la definisce (tazza USA 236,5882365 ml, fl oz 29,5735295625 ml, cucchiaio 14,78676478125 ml, cucchiaino 4,92892159375 ml), arrotondato a 3 decimali. Assente se la fonte non ha una misura di volume (bevanda di riso, bevanda di avena).
- **`state`**: dedotto dalla descrizione FDC (cotto, crudo, secco, altrimenti come venduto).

## Alimenti arricchiti, zeri e densita'

Regole applicate dallo script e verificate dal test.

- **Arricchimento e fortificazione.** Molte voci statunitensi di pane, pasta, farine, cereali da colazione, bevande vegetali e margarine sono arricchite o fortificate (ferro, tiamina, riboflavina, niacina, folati, calcio, vitamina D, A, B12), mentre in Italia questi prodotti non lo sono. Una voce e' considerata arricchita se la descrizione FDC lo dice (`enriched`, `fortified`, `with added vitamin/calcium...`, senza `unenriched`, `not fortified`, `without added`) oppure se la fonte riporta acido folico (1186), vitamina E aggiunta (1242) o vitamina B12 aggiunta (1246). Per ogni voce a rischio, in ordine di preferenza:
  1. si usa la voce FDC non arricchita se esiste (pasta secca e cotta, riso, farina 00, semola, fiocchi d'avena, biscotti frollini al burro);
  2. altrimenti si tiene l'alimento e si tolgono con `strip` (in `matches/*.json`) i nutrienti toccati dall'arricchimento, che restano **assenti** (dato mancante, non zero): pane bianco a fette, pane tipo francese, pangrattato, cracker, pasta fresca (cruda e cotta), corn flakes, biscotti all'avena, savoiardi, cornetto, plumcake, pan di Spagna, cheesecake, bevande di riso, mandorla e avena, latte al cioccolato, latte di capra e latte intero in polvere (solo vitamina D), margarina (D e A), pane integrale (solo calcio);
  3. se nemmeno questo e' onesto, l'alimento e' omesso (nessuno finora).

  Lo script fallisce se una voce arricchita non ha ne' una voce non arricchita ne' un `strip`. Il test fallisce se un cereale, un pane, una pasta, un riso o un prodotto da forno supera soglie plausibili per un prodotto non arricchito (per esempio ferro oltre 6 mg, folati oltre 190 microgrammi, calcio oltre 120 mg per 100 g), se resta nella descrizione la parola enriched/fortified senza `strip`, o se una bevanda vegetale supera i valori di una bevanda non fortificata. Dove la fonte non ha un'alternativa, il valore reale dei nutrienti tolti e' sconosciuto: il motore li tratta come dato mancante.
- **Zero e dato mancante.** Lo script distingue la fonte che non riporta un nutriente (assente) dalla fonte che riporta zero (scritto, per esempio alcol e caffeina negli alimenti che non ne contengono). Fa eccezione un solo caso: i minerali essenziali (calcio, ferro, magnesio, fosforo, potassio, zinco, selenio) riportati a zero dalla fonte, che in realta' e' un valore non rilevato dallo strumento (nessun alimento ne e' privo, per esempio il ferro di tilapia e yogurt greco in Foundation Foods): restano assenti.
- **Densita'.** `densityGPerMl` e' calcolata dal peso di una misura di volume della fonte e tenuta solo se differisce meno del 5% dalla densita' attesa dalla composizione (somma dei volumi di acqua, proteine, carboidrati, grassi, alcol e residuo minerale). Altrimenti e' omessa: succede per bevanda di mandorla, di riso e di avena e per il brodo vegetale pronto.
- **Gemelli (`variantOf`).** Le voci che sono lo stesso alimento in stati diversi condividono `variantOf` (per esempio "pasta-semola" per "Pasta di semola, secca" e "Pasta di semola, cotta"). Sono 53 gruppi: pasta, riso, cereali in chicco, fiocchi d'avena, legumi secchi e cotti, e le verdure, le carni, il pesce e le uova di cui la tabella ha sia la voce cruda sia quella cotta (carote, patate, spinaci, fagiolini, zucchine, broccoli, bietole, cavolfiori, champignon, salmone d'allevamento, petto di pollo, uovo intero, merluzzo, trota, platessa, gamberi, manzo macinato e hamburger, girello, costata, spalla, vitello, lonza, filetto, spalla e coscia di maiale, coniglio, pollo intero, coscia di pollo, petto di tacchino, pasta all'uovo, patatine fritte). Lo script e il test impongono almeno due voci per gruppo e stati tutti diversi. I nomi dichiarano lo stato ("secca", "cotta"). Gli alias generici ("pasta", "riso", "avena", "lenticchie") stanno su tutte le voci del gruppo; quelli che dicono lo stato ("pasta secca", "porridge") solo sulla voce corrispondente. Riso e pasta cotti usano la voce senza sale aggiunto. I legumi secchi hanno `state: "dried"`.
- **Alimenti diversi non sono gemelli, ma possono condividere un alias generico.** Tonno fresco e in scatola, pomodori freschi e pelati, latte e bevande vegetali, fichi freschi e secchi non condividono `variantOf`. Gli alias generici ("tonno", "pomodori", "pane", "pollo", "formaggio", "prosciutto", "biscotti", "cereali", "succo", "insalata", "pasta", "riso", "olio", "farina", "manzo", "maiale", "pesce") stanno invece su tutte le voci pertinenti, perche' l'interfaccia fa scegliere l'alimento da un elenco di candidati. Restano vietati i nomi mostrati identici (test).
- **Alias e stato.** Nessun alias contraddice lo `state` della voce: un alias con parole come secco, crudo, cotto, lesso, bollito, arrosto, al forno o alla griglia sta solo su voci con lo stato corrispondente (salvo che la parola sia gia' nel nome mostrato, come "prosciutto cotto"). Lo controllano lo script (fallisce) e il test.
- **Nomi onesti.** Quando il dato statunitense differisce in modo rilevante dal prodotto italiano omonimo, il nome lo dice (campo `nameNote` in `matches/*.json`, aggiunto tra parentesi): per esempio "Mozzarella di latte vaccino intero (dato USA, piu' asciutta della fresca italiana)", "Parmigiano stagionato (dato USA, tipo parmesan)", "Panna fresca da montare (36% di grassi, dato USA)", salumi, pane bianco a fette, cornetto, gelato, tagli di manzo.
- **Polenta.** La fonte ha solo la farina di mais integrale cruda e le "corn grits" cotte arricchite (non sono polenta e sono arricchite): non esiste una voce onesta di polenta cotta. L'alias "polenta" non c'e' su nessuna voce; la farina resta come "Farina di mais, integrale" (alias "farina per polenta").
- **Stati secchi.** Frutta disidratata (fichi, albicocche, prugne, datteri, uvetta, pomodori secchi), frutta secca a guscio e semi, e le spezie essiccate sono `dried`.
- **Pane.** Il pane bianco a fette ha nella fonte 9,2 g di fibra per 100 g, che e' fibra aggiunta: la fibra e' tolta (assente), insieme ai nutrienti dell'arricchimento. Non esiste una voce di pane bianco comune senza fibra aggiunta e non arricchito.
- **Mozzarella.** "Mozzarella di latte vaccino intero (dato USA, piu' asciutta della fresca italiana)" (FDC 170845, non a bassa umidita': 299 kcal e circa 50 g di acqua, contro circa 250 kcal e 60 g della fresca) porta l'alias "mozzarella" ed e' la piu' vicina alla fresca; "Mozzarella a bassa umidita' (tipo per pizza)" (FDC 170846) e' una voce a parte, senza l'alias "mozzarella". Nessuna delle due e' mozzarella di bufala.

## Cosa non e' in tabella perche' la fonte non ha una voce onesta

Prosciutto crudo (esiste solo il "country ham" statunitense, un prodotto diverso, affumicato e salato), orata (nessun sparide nella fonte: restano spigola, dentice e tilapia come "pesce bianco"), grissini, gnocchi di patate (solo un "dumpling" ripieno surgelato), ragu' (esistono solo sughi di solo pomodoro e un piatto di ristorante di spaghetti con sugo di carne, aggiunto come tale), muesli (c'e' solo la granola, dichiarata come tale), polenta cotta, mozzarella di bufala, mascarpone, speck, pasta ripiena fresca (c'e' solo la lasagna surgelata ai formaggi).

## Limiti

- I valori si riferiscono ad alimenti **statunitensi** (cultivar, razze, mangimi, arricchimenti, tagli di carne, formulazioni industriali). Possono differire anche in modo sensibile dai prodotti italiani. Per gli alimenti che in Italia hanno una definizione precisa (Parmigiano Reggiano, mortadella, bresaola, pasta, pane) la voce FDC e' la piu' vicina, non l'equivalente: le corrispondenze approssimative sono annotate nei file `matches/*.json` (campo `approx`) e si leggono con `--report`.
- SR Legacy non e' piu' aggiornata (aprile 2018); contiene anche voci di cibi arricchiti (farine, pasta, latte con vitamine): dove disponibile e' stata scelta la voce non arricchita, ma non sempre esiste.
- Il **sale** e' ricavato dal sodio. La **vitamina A** e' in microgrammi di RAE (equivalenti di attivita' del retinolo), non in retinolo equivalenti (RE): per gli alimenti ricchi di carotenoidi RAE e RE differiscono. Non e' stato ricalcolato nulla.
- Lo **iodio** e' assente quasi ovunque (SR Legacy non lo riporta). Spesso assenti anche vitamina K (solo K1), vitamina E, vitamina D, omega 3, zuccheri e selenio. L'assenza significa dato non disponibile, non zero.
- Cenere e fibra solubile/insolubile della fonte non sono nel contratto dei tipi e non sono riportate.
- Le voci di prodotti confezionati (salse, dessert, bevande) rappresentano una formulazione statunitense generica, non un prodotto commerciale italiano.
- Gli alimenti sono 388, meno di quelli della banca dati: sono stati scelti quelli di uso comune in una cucina italiana, dando la precedenza ai freschi e di base.
