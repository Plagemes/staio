# Fonti e scelte di varietà vegetale, distribuzione delle proteine e stima del pasto fuori casa

Vale per `variety.ts`, `proteinSpread.ts` e `outOfHome.ts`. Nessuna delle tre dà una soglia medica né un consiglio: descrivono ciò che è nel diario, o dichiarano una stima. Le composizioni degli alimenti vengono dalla tabella descritta in `data/foods/FONTE.md`.

## Varietà vegetale

- Che cosa si conta: alimenti diversi della tabella nei gruppi verdura, frutta, legumi, frutta a guscio e semi, cereali integrali, erbe. Stati diversi dello stesso alimento (secco e cotto, `variantOf`) valgono uno. Alcune forme lavorate valgono la pianta d'origine (passata di pomodoro = pomodoro, burro di arachidi = arachidi, hummus = ceci, tofu e tempeh = soia, frutta secca essiccata = il frutto).
- Scelte dell'app, non di una fonte: le patate non si contano (ricche di amido, spesso trattate a parte); i cereali integrali sono pasta, riso, farina, pane, fiocchi d'avena, bulgur, quinoa e miglio; le erbe sono basilico, prezzemolo, rosmarino, timo, origano e alloro (le spezie non entrano); i piatti misti (minestrone in scatola) non si contano. Si possono rivedere.
- Cosa non si riconosce: prodotti letti dal codice a barre, porzioni di preparazioni e alimenti non in tabella non si possono assegnare a un vegetale. Sono contati come «voci non riconosciute» e rendono il conteggio un minimo («almeno»).
- Un giorno senza dati non è un giorno senza vegetali: si dichiarano i giorni con dati e quelli completi (stessa regola della nutrizione: colazione, pranzo e cena tracciati o dichiarati). Il conteggio usa anche i giorni incompleti, perché dice cosa è stato mangiato, ma lo segna come minimo.
- Monotonia: un alimento (esclusi olio, condimenti e bevande) presente in più della metà dei pasti registrati nei 7 giorni, con almeno 4 pasti: sotto, la proporzione non dice niente. Il 4 e la metà sono scelte dell'app per non segnalare casi banali, non valori di letteratura.

## Il riferimento divulgativo dei «30 vegetali a settimana»

L'indicazione circola dai risultati dell'American Gut Project: McDonald D. et al., «American Gut: an Open Platform for Citizen Science Microbiome Research», mSystems 3(3), 2018, doi:10.1128/mSystems.00031-18. Chi riferiva più di 30 tipi di vegetali a settimana mostrava una maggiore diversità del microbiota intestinale rispetto a chi ne riferiva 10 o meno. È uno studio osservazionale con alimenti dichiarati dai partecipanti: non è una soglia clinica né una raccomandazione di un ente sanitario, e l'app non la usa. Non compare nell'interfaccia e non c'è alcun obiettivo numerico: si mostrano il conteggio e quello della settimana prima.

## Distribuzione delle proteine

- Giorni completi secondo `computeIntake` (`DayIntake.complete`) negli ultimi 7 giorni: gli altri non entrano nelle medie.
- Momenti: colazione, pranzo, cena e «altro» (spuntini e consumi di dispensa senza pasto). Un momento principale dichiarato senza voci («ho mangiato fuori», «saltato») non ha dati e non vale zero: non entra nella media di quel momento. «Altro» assente in un giorno completo vale zero.
- Le voci senza il dato proteine rendono il momento parziale («almeno»); la certezza è la peggiore tra le voci (le stime restano stime).
- Non c'è nessun valore di riferimento in questa sezione: i riferimenti per le proteine stanno in `data/RIFERIMENTI.md` e si vedono nel confronto della schermata Nutrizione.

## Stima del pasto fuori casa

Vale per `outOfHome.ts`. Di un pasto mangiato fuori casa non si conoscono gli alimenti: l'app scrive una stima della sola energia, la mostra sempre come stima (con la tilde, mai «misurato») e dice da dove viene. Non è un parere e non è un obiettivo: non dice quanto si dovrebbe mangiare.

### Che cosa è una fonte

- **2.000 kcal al giorno.** È l'apporto di riferimento di energia per un adulto medio fissato dal regolamento (UE) n. 1169/2011 del Parlamento europeo e del Consiglio, relativo alla fornitura di informazioni sugli alimenti ai consumatori, allegato XIII, parte B («Consumi di riferimento di elementi energetici e di determinati elementi nutritivi diversi dalle vitamine e dai sali minerali (adulti)»: energia 8 400 kJ / 2 000 kcal). È il valore usato sulle etichette per le percentuali «% AR». Testo: <https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169>. È un riferimento per l'etichettatura, uguale per tutti: non è il fabbisogno di una persona.

### Che cosa è una scelta del progetto (nessuna fonte)

- **La ripartizione tra i momenti.** Colazione 20% (400 kcal), pranzo 40% (800 kcal), cena 30% (600 kcal), spuntino 10% (200 kcal). Il regolamento dà solo il totale del giorno: dividerlo così tra i momenti è una scelta di questa app, fatta per avere numeri tondi e plausibili, e non viene da un ente né da uno studio. Si può rivedere.
- **Le tre taglie.** «Leggero» vale 0,6 volte il pasto «normale», «abbondante» 1,5 volte. Sono fattori scelti dall'app per distinguere tre casi a parole, non misure.
- **Quando si usa il valore personale.** Con almeno cinque pasti registrati in quel momento (colazione, pranzo, cena o spuntino) negli ultimi 30 giorni, oggi compreso, il pasto «normale» si ricava da quelli, non dal valore di riferimento. Cinque e trenta sono scelte dell'app: sotto, pochi pasti direbbero poco.
- **Quali pasti entrano.** Solo quelli di cui si conosce l'energia di ogni voce. Restano fuori: i pasti con una voce senza dato; quelli che contengono già una stima «fuori casa» (una stima fatta sui pasti registrati non deve rientrarvi); i pasti fatti solo di bevande (tutte le voci in millilitri); i pasti minimi, sotto un quarto del pasto di riferimento del loro momento (100 kcal a colazione, 200 a pranzo, 150 a cena, 50 per uno spuntino). Un caffè a colazione è registrato bene, ma non dice quanto si mangia quando si fa colazione fuori: cinque colazioni da un espresso darebbero una colazione fuori casa da una decina di kcal. Il quarto è una scelta dell'app.
- **Il valore di mezzo, non la media.** Dei pasti che entrano si prende la mediana: metà valgono di più, metà di meno. Un solo pasto registrato male (9.000 kcal al posto di 900) sposta molto la media e quasi per niente la mediana. Scelta dell'app.
- **Limiti attorno al valore di riferimento.** Il valore personale resta tra la metà e il doppio del pasto di riferimento del momento (a pranzo tra 400 e 1.600 kcal, prima del fattore della taglia). Fuori da lì è più probabile un errore di registrazione, o un'abitudine di casa che non si trasferisce a un pasto fuori. Metà e doppio sono scelte dell'app, non di una fonte.
- **L'arrotondamento.** Alla decina di kcal: una stima non ha cifre più fini. Mai meno di 10 kcal e mai più di 5.000 (il limite che la validazione del diario accetta per una voce).

### Che cosa la stima non fa

- **Solo l'energia.** Nessun valore per proteine, carboidrati, grassi, fibre, sale o micronutrienti: non c'è modo di stimarli senza sapere che cosa si è mangiato. Per questi nutrienti la voce è un dato mancante, e i totali del giorno che la comprendono sono un minimo («almeno»).
- **Non si ricalcola.** Il numero scritto nel diario è quello del momento della registrazione: se poi il valore personale cambia, i pasti già registrati restano come sono. Si corregge solo a mano, cambiando la taglia.
- **Non migliora la certezza.** La voce è sempre `estimated`, e rende stimata l'energia del pasto e del giorno in cui entra.
- **Il giorno conta.** Un pasto fuori casa stimato vale come pasto tracciato: il giorno può essere completo ed entrare nelle medie di Nutrizione, con l'energia segnata come stima. «Mangiato, senza dettagli» resta la strada per dire che il dato manca del tutto: quel giorno esce dalle medie.

### Come si legge un giorno con un pasto fuori casa

Sono regole dell'app, non di una fonte.

- **Quanta parte manca.** La stima è una voce sola, senza peso: contata per voci direbbe che manca poco («una voce su otto») anche quando vale metà giornata. Per i nutrienti che la stima non copre (tutti tranne l'energia) la quota di dato mancante del giorno, e del pasto, è almeno la parte di energia stimata fuori casa sull'energia totale. Un pranzo fuori che vale metà dell'energia del giorno dice «manca circa metà». Se anche altre voci non hanno il dato, vale la quota più alta.
- **Dispendio stimato ed energia negli esperimenti.** Un giorno in cui la stima fuori casa vale più del 10% dell'energia (la stessa quota oltre cui non conta un giorno con energia parziale) non entra nel bilancio con il peso né nel confronto dell'energia tra due periodi: lì il numero del giorno è in buona parte un valore generico, non ciò che si è mangiato, e l'errore non si vedrebbe. I giorni lasciati fuori sono contati e detti. La proiezione del peso usa solo le pesate e non cambia.
- **Associazioni tra alimenti ed esiti.** Un giorno con una stima fuori casa non entra: di quel pasto non si conoscono gli alimenti, quindi il giorno non si può mettere né tra quelli «con» né tra quelli «senza» un alimento. Si dice quanti sono.
- **Aderenza di un esperimento.** I giorni con una stima fuori casa restano tra quelli controllati, con un'avvertenza: l'alimento escluso potrebbe essere stato in quel pasto, e l'aderenza misurata può essere più alta del vero.
- **Rapporto del periodo.** Una stima fuori casa non è un alimento né una quantità mangiata: non entra tra i cibi più mangiati, nelle quantità né tra i piatti. Si conta a parte («Pasti fuori casa: N»).
