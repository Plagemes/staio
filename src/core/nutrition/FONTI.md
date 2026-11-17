# Fonti e scelte di varietà vegetale e distribuzione delle proteine

Vale per `variety.ts` e `proteinSpread.ts`. Nessuna delle due dà una soglia medica né un consiglio: descrivono ciò che è nel diario. Le composizioni degli alimenti vengono dalla tabella descritta in `data/foods/FONTE.md`.

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
