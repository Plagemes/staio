# Fonti dei dati sugli allergeni

## Che cosa viene dal regolamento

L'elenco dei 14 allergeni (le chiavi di `ALLERGEN_KEYS` e il campo `regulation` di ogni voce in `tables.ts`) è quello
dell'**allegato II del Regolamento (UE) n. 1169/2011** relativo alla fornitura di informazioni sugli alimenti ai
consumatori: cereali contenenti glutine, crostacei, uova, pesce, arachidi, soia, latte, frutta a guscio, sedano, senape,
semi di sesamo, anidride solforosa e solfiti, lupini, molluschi.

## Che cosa NON viene dal regolamento

Tutto il resto è una **compilazione prudente e non esaustiva** fatta per questa app, non una fonte normativa:

- gli alimenti, i derivati e i nomi commerciali associati a ciascun allergene (`terms`);
- i prodotti composti e ciò che contengono «di norma» (`COMPOSITES`): la composizione reale dipende dalla ricetta e
  dalla marca;
- gli ingredienti generici che danno esito incerto (`GENERIC_TERMS`);
- le eccezioni (`masks`, `GENERIC_MASKS`) e gli iponimi delle esclusioni libere (`hyponyms.ts`);
- l'elenco chiuso degli alimenti semplici (`knownFoods.ts`): i nomi e gli alias della tabella di composizione del
  progetto (`src/core/nutrition/data/foods`, letta e mai modificata) più un elenco compilato qui di verdure, frutta,
  tagli di carne, legumi, cereali senza glutine, semi, erbe, spezie pure, oli, sale, zucchero, acqua; e le parole che
  accompagnano un alimento senza cambiarlo (quantità, tagli, stato, colore, provenienza).

## La regola invertita (seconda revisione)

Con allergeni dichiarati un ingrediente è `clear` **solo** se il suo nome (e quello dell'alimento di dispensa
collegato e del prodotto) è fatto per intero di alimenti semplici dell'elenco chiuso e nessuna tabella lo tocca. Tutto
ciò che non si riconosce è `uncertain` con il motivo «nome non riconosciuto», distinto da «ingrediente generico o
composto». Un nome della tabella nutrizionale vale per un allergene solo se l'alimento da cui viene non lo contiene:
«rosso» (alias del tuorlo) non vale per le uova; «fiocchi di mais» non vale per il glutine e non si spezza in «mais».
«Olio» e «olio di semi» senza altro non valgono per arachidi, soia e sesamo. I salumi non sono mai alimenti semplici.

Terza revisione, l'elenco chiuso è più stretto:

- Dalla tabella nutrizionale entrano come semplici solo le voci decise una per una in `SIMPLE_NUTRITION_IDS`
  (elencate anche nel test, per la revisione): alimenti non lavorati o a ingrediente unico. Prodotti da forno,
  cereali da colazione, dolci, salse e condimenti, conserve e sottaceti, bevande (tranne acqua e caffè), piatti
  pronti e salumi non entrano: i loro nomi non valgono per nessun allergene e bloccano il loro intervallo («pomodori
  pelati» non si spezza in «pomodori»). Alcuni alias di voci semplici sono piatti o cose ambigue e sono esclusi
  (`NOT_SIMPLE_ALIASES`: «risotto», «hamburger», «tonno», «yogurt», «grana»…); «pasta» senza altro vale, ma non per uova e soia. Il pane resta `contains`
  per il glutine e diventa `uncertain` per sesamo, latte, soia e uova.
- Frutta a guscio e semi sono `uncertain` per frutta a guscio, arachidi e sesamo (stessi impianti).
- Parole di prodotti lavorati («pronto», «confezionato», «surgelato», «precotto», «panato», «misto», «affumicato»,
  «in scatola», «sott'olio»…) rendono la riga `uncertain` per ogni allergene, con il motivo «prodotto lavorato o
  confezionato»; «non trattato» non conta. «Secco», «essiccato», «disidratato» su frutta, verdura e pesce rendono la
  riga `uncertain` per i solfiti.
- Una riga è `clear` solo se nomina UN alimento semplice: più alimenti uniti da «di», «con», «al» («riso con
  piselli», «latte di cocco») o una parola di preparazione («insalata di», «purè», «crema di», «vellutata», «succo»,
  «sugo», «spiedini», «macedonia», «arrosto di»…) danno `uncertain`. Eccezioni: una riga di sola carne («fettine di
  vitello») e un taglio più il suo animale («filetti di orata»). Un taglio da solo («petto», «coda», «lingua») è
  incerto. Gli elenchi con virgole o «e» («sale e pepe») valgono voce per voce. Le cotture casalinghe semplici
  («pollo arrosto», «al forno», «alla griglia») restano innocue.
- Radici che toccavano parole innocue, ora escluse: «zucchero semolato», «pastinaca», «granoturco», «panetto»,
  «pepe in grani», «farinata», «riso glutinoso», «lievito di birra» (glutine); «butternut», «granatina» (latte);
  «olive senza nocciolo», «pesca noce», «granelli» (frutta a guscio); «acetosella» (solfiti); «pecorino sardo»
  (pesce: ora «=sarda», «=sarde»). Controllate e già corrette: grano/grana, orzo/sforzo, pesca/pesce, noce moscata e
  noce di vitello, uva/uovo, latte/lattuga. Il sedano rapa è sedano. Grana padano e provolone sono `uncertain` per le
  uova (lisozima).

Le **esclusioni scritte a mano non seguono la regola invertita**: lì l'utente nomina una cosa precisa e il motore
cerca quella cosa, i suoi iponimi e i prodotti che di solito la contengono; un nome sconosciuto non è sospetto.

Errori di battitura: una parola non riconosciuta a una lettera (aggiunta, tolta, cambiata o scambiata) da una voce
delle tabelle di almeno 6 lettere dà `contains` con la nota «forse intendevi…». Le parole più corte restano incerte.

## Scelte prudenti da conoscere

- Quando un nome è ambiguo l'esito è `contains` o `uncertain`, mai `clear`. Per questo ci sono falsi allarmi voluti:
  per esempio «sedanini» (pasta) risulta sedano, «pesca» no ma «pesce» sì, «panelle» risulta glutine, «grano» e
  «grana» restano voci distinte.
- Pinoli e castagne non sono nell'elenco UE della frutta a guscio, ma restano nella tabella (c'erano già, e il pesto
  li porta spesso insieme ad anacardi).
- Le eccezioni dichiarate «non contiene» sono poche e precise: «burro di cacao» non è latte, «latte di mandorla» è
  frutta a guscio e non latte, «noce moscata», «noce di cocco» e «una noce di burro» non sono frutta a guscio, «uova di
  lompo» sono pesce e non uova, «pasta di mandorle» non è glutine. «Grano saraceno», farine e paste di riso, mais e
  legumi sono incerti per il glutine (contaminazioni e miscele frequenti), non sicuri.
- «Senza glutine» o «gluten free» scritto dopo un alimento rende l'esito **al più incerto** (motivo «dichiarato senza
  glutine»): la dichiarazione è regolata (Reg. UE 828/2014) ma si verifica solo in etichetta. Non vale per i cereali che
  il glutine lo contengono per natura (seitan, farro, orzo, segale, frumento, grano, kamut, spelta, bulgur…): restano
  `contains`. Nessun altro «senza X» toglie l'allergene: «senza lattosio», «senza uova» restano `contains`.
- «Latte di mandorla e di vacca»: la coordinazione riprende la prima parola, l'eccezione non vale più.
- I salumi (mortadella, würstel, prosciutto, salame, cotechino…) sono incerti per tutti gli allergeni: possono
  contenere latte, glutine, soia, senape, pistacchi, solfiti. «Torta», «crostata», «budino» e simili contano gli
  allergeni che contengono di norma (tutti quelli tipici, per esempio la pastiera: glutine, latte, uova).
- Il wasabi in commercio contiene spesso senape: incerto per la senape. Senape e mostarde sono incerte per i solfiti.
- Le negazioni non vengono capite: «riso senza latte» risulta latte. È un falso allarme voluto.

Quarta revisione:

- Piatti scritti come elenchi: `DISH_NAMES` («pasta e fagioli», «patate e cozze», «pollo e peperoni») e ogni «e» tra
  un cereale e una verdura, un legume o un pesce sono `uncertain`. Gli elenchi veri («sale e pepe») restano voce per voce.
- «a pasta gialla», «a pasta filata» e simili (`TEXTURE_WORDS`) non sono la pasta.
- «cappon magro» contiene pesce e crostacei; i crostacei del commercio sono `uncertain` per i solfiti.
- Non sono più incerti: il succo d'agrumi spremuto al momento (con una quantità o «fresco»), le varietà comuni di mele,
  pere, patate, pomodori, uva e arance, gli scopi d'uso («per friggere», `PURPOSE_WORDS`), «sedano rapa», il tè nero
  (non «tè» da solo).

## Limiti

Il controllo legge nomi, note, passi e titoli; non legge le etichette né sa delle tracce («può contenere») e delle
contaminazioni. Non sostituisce la lettura dell'etichetta.
