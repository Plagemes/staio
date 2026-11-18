# Redesign funzionale: comodità d'uso

Questo documento è il progetto definitivo del redesign «utilitario funzionale» dell'app e il piano per realizzarlo. L'aspetto non cambia: restano i cinque temi (compreso «Vivo»), i componenti, i caratteri, i colori e lo stile da registro. Cambiano l'ordine delle schermate, il numero di cose in vista, il comportamento dei comandi, i nomi delle azioni e il fatto che ogni dato si ritrovi e si possa correggere.

È scritto per chi realizza il lavoro. Il nome dell'app non compare: nel codice si usa sempre `APP_NAME`.

## In breve: che cosa cambia per chi usa l'app

**Subito (ondata 1).**

1. **Oggi diventa corta.** In cima c'è «Adesso»: il pulsante per registrare il pasto del momento e, a un tocco, acqua, caffè e tè. Sotto, il diario del giorno. Tutto il resto sta in due righe che si aprono con un tocco.
2. **Quello che tocchi si vede subito.** Il tè segnato compare nel diario sotto gli occhi e il contatore cambia. Lo stato del giorno non dice più «niente registrato» quando qualcosa c'è.
3. **La scheda di un alimento ha un solo pulsante grande**, «Mangiato», con la quantità già proposta e mai «tutta la confezione» per partenza. «Buttato» e «Aperto» sono accanto, il resto è dietro «Altro». Non si scorre più per trovare i pulsanti.
4. **Si corregge quanto ne resta** di un alimento, senza toglierlo e rimetterlo.
5. **In Dispensa c'è la ricerca**, e ciò che sta per scadere è in cima, con il suo titolo.
6. **Dal codice a barre si aggiunge senza scorrere.** Scadenza, luogo e numero di confezioni sono in vista, il pulsante è fisso in basso, e dopo l'aggiunta la fotocamera riparte da sola per il prodotto seguente.
7. **Il tasto indietro del telefono chiude la scheda aperta** invece di cambiare pagina.
8. **Ogni azione dice che cosa è successo e dove**, con «Annulla». Nessuna conferma resta nascosta dietro una scheda.
9. **Le cose si distinguono.** Tre distanze fisse dicono che cosa sta insieme; ogni blocco ha un titolo oppure è una riga che si apre; un solo pulsante pieno per schermata.

**Dopo (ondate 2-5).** Ogni riga del diario si tocca e si corregge. «Ultime azioni» annulla anche dopo ore. Il «+» al centro della barra aggiunge qualunque cosa da qualunque schermata e risponde a «ce l'ho?». Il pasto fuori casa conta, come stima. La spesa entra leggendo i codici di fila. In negozio la lista è viva e lo schermo resta acceso. «Stasera» dice che cosa cucinare e che cosa manca. La cucina non perde il passo né il timer. Le impostazioni dicono come sono impostate e gli allergeni hanno una casa sola. Dopo qualche giorno di pausa l'app aiuta a rimettersi in pari.

**Che cosa non cambia.** L'aspetto e i temi. I dati stanno sul telefono e l'app funziona senza rete. Il registro non cancella mai nulla: ogni correzione è un evento nuovo. Niente si salva senza che si veda. Il controllo degli allergeni resta prudente. Nessun parere medico.

## Registro delle modifiche rispetto alla prima stesura

- **L'app è stata guardata a schermo** (375×812, tema Vivo scuro e Registro) e misurata. Sono entrati nel progetto quattro difetti che dal codice non si vedevano (0.3).
- **Stacco.** Portare lo spazio da 22 a 28 px non basta: oggi il problema è che le distanze dentro un gruppo (10-18 px) e tra i gruppi (22 px) sono quasi uguali, che metà dei blocchi non ha un titolo e che ogni campo è una scheda. Ora ci sono sei regole e le correzioni esatte nei moduli CSS (5.1-5.3).
- **Ondata 1 ridisegnata.** I pezzi comuni si fanno prima, da soli; poi cinque compiti in parallelo su file che non si toccano. La lettura condivisa dei dati esce dall'ondata 1 (non si sente, e rischia): va da sola in testa all'ondata 3. «Mettere in casa» e «Dispensa» sono divisi in due compiti ciascuno. I criteri si verificano con tipi, lint e test; il resto con una lista di controlli a schermo (10).
- **Tolto ciò che complicava:** fogli uno sopra l'altro, pressione lunga e scorrimento laterale, pastiglie di filtro nel diario e in Dispensa, giornale delle impostazioni, barre agganciate alla tastiera, categoria «Altro» (non esiste nel dominio), «Da cosa è fatto» nell'ondata 1.
- **Oggi.** Il diario resta per momenti (colazione, pranzo, cena, spuntini) con tre righe di riepilogo (acqua, corpo, dispensa), invece di una linea del tempo con cinque filtri. Le viste fissate restano dove le ha messe l'utente.
- **Corretti errori di fatto:** dove sta «Chiudi» nella scheda dell'alimento, dove sta la finestra dei 90 minuti, la categoria obbligatoria, la «versione» del registro che non vede le sostituzioni fatte dall'unione di due telefoni (0.3).
- **Le sei schermate di ogni giorno** sono definite blocco per blocco, con testi esatti e con ciò che succede dopo ogni azione (5.4). I percorsi lunghi sono diventati una tabella di casi pratici (7).

**Dopo la verifica a schermo dell'ondata 1 (17 nov 2026).** L'ondata 1 è pubblicata ed è stata guardata con i 32 controlli di 10.3: 25 passano, 3 no, 4 non si possono provare senza un telefono vero. Ne sono venute queste modifiche al progetto.

- **Foglio.** Dentro un passo del foglio («Altro», «Correggi») il tasto indietro chiudeva tutto e buttava via ciò che si stava scrivendo: il foglio riceve `onBack` e il pulsante che conferma un passo sta nel piede, in vista (4.1, 5.4.2).
- **«Spuntino»** prende il posto di «Fuori pasto» nell'ondata 2, non nella 5: a schermo i due nomi stavano uno sopra l'altro (4.10).
- **Diario.** Tolto `buildDayDiary`: il diario si costruisce già con ciò che c'è, e un secondo modello sarebbe un doppione. Le righe diventano toccabili una per una, ognuna con il suo foglio; spostare un pasto riscrive il solo evento `meal` (i consumi lo seguono per `mealId`) (4.4, 8.2).
- **Avviso.** Tolta l'azione in più sull'avviso («Aggiungi alla spesa» quando un alimento finisce): con due comandi l'avviso è già una colonna stretta, e si sistema quello. Tolto l'avviso dopo l'unione di due telefoni: la schermata di sincronizzazione dice già quanti eventi sono arrivati (4.2).
- **«+».** Le quattro azioni sono righe di un elenco, non quattro pulsanti grandi (R4). «Ho comprato» apre la pagina «Aggiungi alla dispensa», che ha già i tre ingressi, invece di una copia del lettore. I risultati della ricerca non hanno pulsanti dentro le righe (R5) e mostrano solo le ricette che il ricettario mostra. `?aggiungi=1`, l'indirizzo incollato e la dettatura passano all'ondata 5, con le scorciatoie (3.2, 3.3, 3.5).
- **Registra pasto.** I pasti abituali si registrano da lì con un tocco; «Saltato» e «Mangiato, senza dettagli» restano solo in Oggi; il segno «senza dato» sulle righe della dispensa esce (si vede in Oggi dopo la registrazione) (5.4.6).
- **Fuori casa.** Il campo `energyKcal` sta sulla voce del pasto, non sull'evento; per gli altri nutrienti la voce è «senza dato» (9.3).
- **Aggiungi a mano.** In Vivo i campi in vista all'apertura sono tre, più l'inizio della scadenza: quattro non ci stanno senza cambiare l'aspetto (5.4.5).
- **Ondata 2 ridisegnata** in dieci mandati su tre passi, con un mandato di correzioni dell'ondata 1 in testa (10.4).

---

## 0. Come leggere questo documento

### 0.1 Le sezioni

1. Obiettivo e misura del successo.
2. Principi.
3. Impianto: barra in basso, «+», ricerca, pagine.
4. Schemi comuni: i comportamenti che si ripetono, ognuno con il suo pezzo.
5. Ordine e stacco: le regole, le correzioni nei CSS, la struttura di arrivo delle schermate.
6. Lista di lavoro: funzioni perse, fuori posto, doppie, incomplete.
7. Casi pratici.
8. Tracciabilità: ogni dato si ritrova e si corregge.
9. Fondamenta tecniche.
10. Piano di realizzazione a ondate.
11. Che cosa non fare.
12. Decisioni che restano al proprietario.
13. Idee oltre il mandato.

### 0.2 Come sono contati i tocchi

Un tocco è un tocco sullo schermo, compreso quello sulla barra in basso. La scrittura con la tastiera è segnata a parte («+ scrittura»), lo scorrimento pure. I conteggi di arrivo valgono dalla seconda volta, quando i valori proposti sono già stati imparati. Le misure in pixel vengono dall'app accesa, a 375×812, con i dati di prova (sei alimenti in frigo, un tè segnato, il latte tra gli allergeni dichiarati).

### 0.3 Che cosa è stato verificato

**A schermo.**

| # | Che cosa si vede | Conseguenza |
|---|---|---|
| 1 | Oggi è alta 2.842 px (3,5 schermate) con dati quasi vuoti e ha 45 elementi toccabili. Nella prima schermata ci sono marchio, data, due pulsanti, una riga di stato e il primo momento. L'acqua comincia a 1.056 px; le bevande sono in una riga chiusa senza titolo | Oggi va accorciata e riordinata (5.4.1) |
| 2 | Con un tè segnato alle 13:11 la riga di stato dice «Ancora niente registrato oggi» | Lo stato del giorno conta anche le bevande |
| 3 | Ogni momento senza pasto mostra tre comandi; con una bevanda dentro, cinque | Un comando in vista, il resto dietro «Altro» |
| 4 | La scheda di un alimento è alta 747 px e si apre mostrando figura, dati e nutrienti. Il primo pulsante sta a 666 px dall'inizio per un alimento semplice (si affaccia appena), a 764 px per uno in scadenza e a 876 px per tre confezioni uguali: sotto il bordo. Il contenuto è alto da 1.052 a 1.320 px e il blocco delle azioni ha da 8 a 14 comandi dello stesso peso | Azioni in vista, dati richiusi (5.4.2) |
| 5 | «Aggiungi alla spesa» dalla scheda di un alimento lascia la scheda aperta e mostra l'avviso sotto di essa: la scheda è modale, quindi l'avviso non si vede e «Annulla» non si può toccare | Dopo un'azione la scheda si chiude; un avviso non nasce mai sotto una scheda (4.1, 4.2) |
| 6 | La scheda del codice a barre (codice 8003170096165) è alta 2.448 px, tre schermate; «Aggiungi alla dispensa» è a 2.098 px. I sei campi sono sei schede uguali alle schede dei dati | Modulo in cima, pulsante fisso (5.4.4) |
| 7 | Il modulo a mano è alto 1.937 px; «Aggiungi alla dispensa» è a 1.643 px; in cima ha cinque collegamenti | Quattro campi in vista, pulsante fisso (5.4.5) |
| 8 | Registra pasto elenca tre righe uguali per tre confezioni dello stesso prodotto; spuntando un alimento è già scelto «Tutto» | Una riga per prodotto; nessuna quantità «tutta» per partenza (5.4.6) |
| 9 | In Spesa, «Spesa del periodo» scrive le categorie con il nome interno in inglese («Eggs», «Leafy_vegetables») | Difetto da correggere subito (`shopping/priceText.ts`, `categoryLabel`) |
| 10 | In Impostazioni, «Rifai l'introduzione» è un pulsante grigio del browser: la classe `ui.textLink` messa su un `<button>` non ne azzera sfondo e bordo | Difetto da correggere subito (`features/ui.module.css`) |
| 11 | In Vivo tutte le schede hanno lo stesso fondo e lo stesso raggio e distano tra loro da 10 a 22 px. Nei temi da registro il titolo di una sezione e le etichette dentro la sezione hanno lo stesso carattere | Regole di stacco (5.1-5.3) |

**Nel codice** (punti in cui le analisi o la prima stesura sbagliavano).

| Affermazione | Com'è davvero | Conseguenza |
|---|---|---|
| I difetti sulla scheda del codice (scadenza, categoria, più confezioni, date diverse, pezzi) sono funzioni mancanti | Esistono tutte in `barcode/AddToPantry.tsx`, ma in fondo a tre schermate | Non servono funzioni nuove: serve metterle in vista |
| Non si può eliminare un prodotto | Si può: «Elimina dalla dispensa», l'ultimo di una decina di pulsanti, in fondo alla scheda | Va in «Altro», dove si trova |
| Tutte le schede dal basso tranne quelle del piano hanno «Chiudi» in basso | La scheda dell'alimento (`pantry/LotSheet.tsx`) lo ha in alto a destra, come quelle del piano; in basso lo hanno le preparazioni e la scelta di cottura. Nessuna aggiunge un passo alla cronologia | Il foglio unico tiene «Chiudi» in testa, a destra, e gestisce l'indietro (4.1) |
| La finestra di 90 minuti del pasto abituale sta in `features/meals.ts` | Sta in `core/diary/selectors.ts` (`habitsToPropose`), ed è un'opzione (`windowMinutes`) | La proposta per tutta la fascia si ottiene senza toccare il nucleo |
| Se il nome non dice niente vale la categoria «Altro» | Le categorie sono 35 e «Altro» non c'è; `features/capture.ts` rifiuta un alimento senza categoria | La categoria resta obbligatoria: si mostra in vista solo quando non è stata riconosciuta |
| La versione del registro è «numero di eventi più ultimo identificativo» | `importEvents` può sostituire il contenuto di un evento con lo stesso identificativo (conflitto nell'unione di due telefoni): numero e ultimo identificativo non cambiano | La lettura condivisa si aggancia a ogni emissione dell'osservazione, non a un conteggio (9.1) |
| Per segnare «Saltato» prima basta cambiare `momentOffer` | `momentOffer` serve anche al piano (`plan/moveMeal.ts`) per decidere quando un pasto è in ritardo | `momentOffer` non si tocca: Oggi offre le dichiarazioni dietro «Altro» da quando il momento comincia |
| Registra pasto non ha ricerca né conteggio | Ha «Cerca in dispensa» (con più di sei alimenti) e il pulsante dice già «Registra cena (1)»; ha anche l'interruttore «Salvalo come pasto abituale», che la prima stesura dimenticava | Si tiene tutto, riordinato |
| La quantità sbagliata si corregge solo eliminando e rifacendo | Vero per l'interfaccia. Nel nucleo ci sono già `correctLot` (cambia la quantità di partenza) e l'evento `adjust` (dice quanto ne resta, mai più di quanto c'era all'inizio) | «Correggi» è lavoro d'interfaccia, con una funzione pura che sceglie tra i due (5.4.2) |
| Su iPhone serve un lettore di codici di ripiego | Esiste già (`barcode/detector.ts`, con la copia locale di `zxing_reader.wasm`) | Niente da fare |

Next 16 integra `history.pushState` e `replaceState` nel suo router (guida locale `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`, «Native History API»): il foglio che risponde al tasto indietro si può fare senza librerie.

---

## 1. Obiettivo e misura del successo

Chi usa l'app con una mano, più volte al giorno, fa le cose di sempre con pochi tocchi, vede subito che cosa è successo e dove, e corregge qualunque cosa senza rifarla. Ogni schermata si spiega in una frase: «qui faccio questo; il resto è dietro un tocco».

| # | Azione di tutti i giorni | Oggi | Arrivo | Ondata |
|---|---|---|---|---|
| 1 | Segnare un tè, un caffè o un bicchiere d'acqua | Tè: 2 tocchi, e la riga compare fuori vista. Acqua: 1 tocco dopo più di una schermata di scorrimento | 1 tocco senza scorrere; il contatore cambia e la riga entra nel diario | 1 |
| 2 | Registrare la colazione di sempre | 1 tocco, ma solo entro 90 minuti dall'ora abituale; altrimenti 7-11 | 1 tocco per tutta la fascia della colazione; «Come ieri» anche senza pasto abituale | 1, poi 2 |
| 3 | Registrare un pranzo di tre alimenti con le quantità | 11 tocchi + 3 scritture; la quantità proposta è la confezione intera | 5 tocchi, senza scrivere per gli alimenti già usati | 2 |
| 4 | Mangiare un pezzo di un alimento in dispensa | 3 tocchi + scorrimento dentro la scheda | 3 tocchi senza scorrere (Dispensa, riga, «Mangiato · 1 pezzo») | 1 |
| 5 | Registrare un pasto fuori casa che conti | 1 tocco ma il giorno esce dalle medie, oppure 5-6 tocchi inventando i grammi | 2 tocchi, come stima; il giorno conta | 2 |
| 6 | Mettere in dispensa un prodotto con il codice | 4 tocchi + due schermate e mezza di scorrimento | 3 tocchi senza scorrere | 1 |
| 7 | Mettere in dispensa 25 prodotti con il codice | Circa 75 tocchi e 50 schermate di scorrimento | 25 tocchi senza scorrere (il lettore riparte da solo); circa 5 con la lettura continua | 1, poi 3 |
| 8 | Correggere una quantità | Pasto: circa 12 tocchi (annulla e rifai). Dispensa: impossibile | Dispensa: 4 tocchi + il numero. Pasto: 3 tocchi | 1, poi 2 |
| 9 | «Ce l'ho?» e aggiungere alla lista della spesa | «Ce l'ho?»: Dispensa e 3-6 schermate di scorrimento. Lista: 4 tocchi + scrittura | «Ce l'ho?»: 2 tocchi + 3 lettere. Lista: 2 tocchi + scrittura, da qualunque schermata | 1, poi 2 |
| 10 | Cucinare stasera una ricetta salvata | 5 tocchi per il primo passo; passo e timer si perdono con l'indietro | 2 tocchi da «Stasera»; passo e timer si ritrovano | 4 |

Quattro criteri si controllano a vista, a ogni ondata:

- Nessuna azione cambia un dato senza lasciare una riga che si ritrova e che si può toccare per correggerla o toglierla.
- Il tasto indietro del telefono, e lo scorrimento dal bordo su iPhone, chiudono il foglio aperto e non fanno perdere un lavoro in corso.
- Ogni schermata ha un solo pulsante pieno e al massimo due secondari in vista.
- Nessun «Sei sicuro?» tranne per «Cancella tutti i dati»: al suo posto c'è «Annulla».

---

## 2. Principi

| # | Principio | Regola pratica |
|---|---|---|
| 1 | **Ogni funzione sta dove nasce il bisogno** | Un comando compare sull'oggetto o nella schermata in cui serve. Oltre a quello, al massimo un ingresso generale (il «+» o la ricerca), che porta allo stesso posto e mai a una copia |
| 2 | **Tutto è tracciato, con tutto si può interagire** | Ogni scrittura lascia una riga nel diario del giorno o nella storia dell'oggetto. Ogni cosa a schermo si tocca per vederla, correggerla, spostarla, toglierla |
| 3 | **Una cosa principale per schermata** | Un pulsante pieno, al massimo due secondari, il resto dietro «Altro» o in una riga che si apre. Le cose legate stanno vicine, quelle diverse lontane (sezione 5) |
| 4 | **Il caso comune in un tocco** | La scelta più probabile è già fatta e si vede. La quantità non parte mai da «tutta la confezione» |
| 5 | **Correggere costa meno che sbagliare** | Ogni azione ha «Annulla». Ogni dato si corregge sul posto. Una correzione è un evento nuovo: il registro resta solo in aggiunta |
| 6 | **Un nome per ogni azione, una casa per ogni cosa** | Stesso verbo ovunque (4.10). Ogni funzione ha una sola schermata; gli altri ingressi la aprono, non la copiano |
| 7 | **Nulla si salva senza che si veda, nulla si perde** | Ciò che è dedotto (scontrino, foto, memoria, stime) arriva come proposta visibile e modificabile. Il lavoro in corso sopravvive al tasto indietro |
| 8 | **Prudenza dove conta** | Il controllo degli allergeni non diventa mai più permissivo né meno visibile. Le stime portano il loro segno. Un avviso che cambia una decisione resta una riga sempre in vista: si richiude solo la spiegazione. Nessun parere medico |
| 9 | **Una mano, senza rete, su entrambi i telefoni** | L'azione principale sta in basso. Tutto funziona senza rete. Ciò che su iPhone non esiste ha sempre una via dentro l'app |
| 10 | **Semplice batte completo** | Una miglioria che aggiunge una scelta ne toglie almeno una altrove. Ciò che serve di rado si nasconde finché non serve. Tra due soluzioni vince quella con meno comandi in vista |

---

## 3. Impianto

### 3.1 La barra resta, il centro diventa «+» (ondata 2)

La barra in basso resta di cinque posti con gli stessi nomi e gli stessi colori d'area: **Oggi · Dispensa · ＋ · Piano · Salute**. Cambia solo il pulsante centrale: oggi è una fotocamera senza scritta che apre il modulo a mano (`design/components/BottomNav.tsx`); diventa «+», che apre il foglio «Aggiungi» da qualunque schermata. Mantiene dimensione, posizione e colore (`--capture-fill`, `--capture-text`); cambia il disegno dell'icona, perché una fotocamera che apre un elenco tradirebbe l'aspettativa. È l'unica modifica di disegno del progetto (decisione 12.1).

Nell'ondata 1 il pulsante centrale resta com'è, ma la pagina che apre diventa «Aggiungi alla dispensa», con «Leggi un codice» come prima azione (5.4.5).

Alternativa scartata: una barra per momento d'uso (Oggi · Cucina · ＋ · Dispensa · Dati). Cambia nomi e colori d'area a cui le persone sono abituate e obbliga a riscrivere `areaOf`, la mappa, il service worker e quasi tutti i ritorni. Quasi tutto il vantaggio si ottiene con il «+» e con «Stasera», senza spostare niente.

### 3.2 Il foglio «Aggiungi»

Si apre dal basso con il foglio unico (4.1). Dall'alto in basso:

1. **Campo «Cerca o scrivi»**, non attivo all'apertura (la tastiera non copre l'elenco). È la ricerca (3.3).
2. **Quattro righe** (`ActionList`, non una griglia di pulsanti: R4), sempre nello stesso ordine, ognuna con una riga piccola che dice che cosa apre:
   - «Ho mangiato»: apre Registra pasto sul momento dell'ora;
   - «Ho bevuto»: mostra nel foglio «Acqua +200 ml» e le bevande rapide; un tocco segna e chiude il foglio;
   - «Ho comprato»: apre la pagina «Aggiungi alla dispensa» (5.4.5), che ha già «Leggi un codice», «Scontrino», «Più alimenti» e il modulo a mano: una casa sola, nessuna copia;
   - «Alla spesa»: mostra nel foglio una riga di scrittura; Invio aggiunge, la voce compare in un elenco dentro il foglio e il campo resta pronto per la seguente; «Fatto» chiude, e l'avviso con «Annulla» vale per tutte le voci aggiunte.
3. **«Altro»**: Peso, umore, integratori (Salute) · Cosa cucinare · Importa una ricetta · Foto del frigo · Chiedi · Ultime azioni.

«Ho bevuto», «Alla spesa» e «Altro» sono passi dello stesso foglio, con «Indietro» (4.1). Su iPhone queste quattro righe fanno le veci delle scorciatoie dell'icona, che lì non esistono.

### 3.3 Ricerca

Vive nel campo del foglio «Aggiungi»: una sola casella per cercare e per aggiungere. Cerca senza rete e senza intelligenza artificiale: alimenti in casa, ricette, pasti abituali, pagine e impostazioni. I risultati sono raggruppati (In casa, Azioni, Ricette, Pasti abituali, Pagine), al massimo cinque per gruppo. Una riga, un'azione (R5): il tocco apre l'oggetto nel suo posto oppure fa l'azione scritta sulla riga; dentro le righe non ci sono pulsanti. Scrivendo «latte»:

- In casa: «Latte intero · 1 l · Frigo · ~3 giorni»; il tocco apre la sua scheda in Dispensa, dove c'è «Mangiato».
- Azioni: «Aggiungi “latte” alla spesa», «Aggiungi “latte” alla dispensa».
- Se in casa non c'è: «Non ne hai in casa.», e sotto le due azioni.

Le ricette nei risultati sono solo quelle che il ricettario mostra, con lo stesso controllo di allergeni ed esclusioni: una ricetta nascosta lì non compare qui. I prodotti già letti con il codice non sono un gruppo a sé: si trovano dalla Spesa e dalla scheda dell'alimento.

Nell'ondata 5, con le scorciatoie, il campo riconosce un indirizzo incollato («Importa la ricetta da questo indirizzo»: è la via per iPhone, dove la condivisione verso l'app non esiste). Le liste lunghe hanno inoltre il loro filtro sul posto, con la stessa regola di confronto dei nomi (senza maiuscole né accenti): Dispensa (ondata 1), Registra pasto (ondata 2), Ricettario, Spesa. Non c'è una seconda lente nelle intestazioni.

### 3.4 Che cosa si accorpa, si sposta, si nasconde

| Che cosa | Dove va | Ondata |
|---|---|---|
| «Momenti di oggi», «Bevande», «Acqua», «Registro di oggi», «Pianificato per oggi» | **Diario di oggi**, in Oggi | 1 |
| «Da mangiare prima» | Riga richiusa «In scadenza» in Oggi; gruppo «In scadenza» in cima alla Dispensa | 1 |
| I riquadri in fondo alla Dispensa (controlla le quantità, cosa cucinare, 3D, foto) | «Altro» nell'intestazione della Dispensa | 1 |
| I cinque collegamenti in cima al modulo a mano | Tre ingressi chiari («Leggi un codice», «Scontrino», «Più alimenti»); gli altri due spariscono da lì | 1 |
| Spesa e In negozio | Una pagina con la modalità «Sono in negozio» | 3 |
| Scorte minime; Verifica del piano | Sezioni richiuse di Spesa e di Settimana | 3, 4 |
| Idee con ciò che hai; Con cosa sta bene | Una pagina con due schede | 4 |
| Allergeni, esclusioni, obiettivi, struttura del piano | Impostazioni > Persona > «Alimentazione» | 4 |
| Acqua e bevande in Salute | Solo l'andamento; si segnano da Oggi | 4 |
| Qualità dei prodotti tra i pulsanti di Salute | Si raggiunge dal prodotto, dalla Spesa e dalla ricerca | 4 |
| Scrivi o detta, Foto del piatto | In «Altro» di Registra pasto, solo con la chiave | 2 |

Le pagine non aumentano: ne nasce una («Ultime azioni», `/app/attivita`, ondata 2) e quattro diventano sezioni di un'altra, con il vecchio indirizzo che rimanda (`/app/spesa/negozio`, `/app/spesa/scorte`, `/app/piano/verifica`, `/app/ricette/abbinamenti`); `/app/piano/obiettivi` si sposta in `/app/impostazioni/alimentazione`.

### 3.5 Collegamenti diretti

| Parametro | Pagina | Effetto | Ondata |
|---|---|---|---|
| `?giorno=YYYY-MM-DD` | Oggi | Apre quel giorno (esiste) | — |
| `?lotto=<id>` | Dispensa | Apre la scheda di quell'alimento | 1 |
| `?momento=`, `?giorno=`, `?lotto=` | Registra pasto | Esistono | — |
| `?voce=<id evento>` | Oggi | Mostra il giorno di quell'evento, scorre fino alla riga e la evidenzia | 2 |
| `?pasto=<mealId>` | Registra pasto | Aggiunge voci a un pasto esistente | 2 |
| `?aggiungi=1` | qualunque | Apre il foglio «+» (serve solo alle scorciatoie dell'icona) | 5 |
| `?negozio=1` | Spesa | Apre la modalità negozio | 3 |

Una pagina che legge un parametro con `useSearchParams` va avvolta in `<Suspense>` nel suo file `page.tsx`, come fa già `src/app/app/page.tsx`: senza, la build si ferma. Il service worker ignora il testo dopo «?» nella chiave della cache: senza rete ogni collegamento apre la pagina giusta e il parametro lo legge la pagina. Un identificativo che non esiste più dice «Non c'è più» e offre la schermata di partenza.

### 3.6 Che cosa cambia su iPhone

| Limite di iPhone | Come lo affronta il progetto |
|---|---|
| Nessuna scorciatoia dell'icona | Le stesse azioni sono i pulsanti grandi del foglio «Aggiungi» |
| Nessuna condivisione verso l'app | Il campo «Cerca o scrivi» e Importa riconoscono un indirizzo incollato |
| Nessun tasto indietro nell'app installata; c'è lo scorrimento dal bordo | Il foglio unico aggiunge un passo alla cronologia: lo scorrimento chiude il foglio invece di lasciare la pagina; ogni pagina tiene il suo «Torna a …» |
| Nessuna vibrazione | Ogni conferma è visiva |
| Schermo acceso solo da iOS 18.4 nelle app installate | Se manca, una riga lo dice (esiste già in cucina; si estende al negozio) |
| Avvisi solo con app installata e permesso | Il riepilogo arriva all'apertura, in «Da guardare oggi» |
| La tastiera copre ciò che è fisso in basso | La barra fissa dei moduli sta sopra la barra di navigazione e non insegue la tastiera: Invio passa al campo seguente e l'ultimo campo conferma (4.6). Da provare su un iPhone vero a ogni ondata |

---

## 4. Schemi comuni

Ogni schema è un comportamento che si ripete in tutta l'app, con un pezzo condiviso. I pezzi nuovi sono solo di comportamento: stanno in `src/features/common/` e sono fatti con ciò che esiste già (`Button` nelle tre varianti, `Label`, `SectionHeader`, le classi di `features/ui.module.css`, le variabili di `tokens.css` e `themes.css`). La cartella `src/design/` non riceve componenti nuovi. Le regole per Vivo stanno in coda ai moduli CSS sotto `:global([data-palette="vivo"])`, come prescrive `src/design/VIVO.md`, e `features/vivoScope.test.ts` continua a valere: nessun pezzo nuovo usa, fuori dalle regole di Vivo, gli attributi `data-tone`, `data-state`, `data-status`, `data-level`, `data-nutrient`, `data-estimated`.

### 4.1 Foglio dal basso unico, con il tasto indietro

Oggi ci sono cinque fogli fatti in cinque modi (`plan/Sheet.tsx`, `pantry/LotSheet.tsx`, `PrepSheet` in `prep/Preps.tsx`, `prep/RepairSheet.tsx`, `CookChoice` in `recipes/RecipeView.tsx`). Nessuno aggiunge un passo alla cronologia.

**Pezzo.** `features/common/Sheet.tsx`, costruito come la scheda dell'alimento di oggi: `<dialog>` aperto con `showModal()`, maniglia, angoli e ombra delle schede. In testa il titolo e «Chiudi» a destra; il corpo scorre; il piede è fisso e porta l'azione principale. Il foglio è aperto finché è montato: per chiuderlo da codice basta smettere di renderlo.

```ts
interface SheetProps {
  title: string;
  onClose: () => void;      // chiamata una volta, a foglio chiuso
  children: ReactNode;      // corpo, scorre
  titleHidden?: boolean;    // il titolo resta per il lettore dello schermo; lo mostra `head` (scheda dell'alimento)
  head?: ReactNode;         // sotto il titolo: figura, stato, avviso
  footer?: ReactNode;       // fisso in fondo: pulsante principale e, al massimo, una riga di secondari
  busy?: boolean;           // azione in corso: «Chiudi» e il tocco fuori non chiudono
  onBack?: () => void;      // dall'ondata 2: il foglio è in un passo interno; tasto indietro ed Esc tornano al passo prima
}
```

**Regole.**

1. **Un foglio alla volta.** Mai un foglio sopra un foglio. Dentro un foglio, «Altro» o un passo in più cambiano il contenuto dello stesso foglio, con «Indietro» per tornare. In un passo che ha un solo pulsante che conferma («Salva»), il piede porta «Indietro» a sinistra e quel pulsante, pieno, a destra: non sta mai in fondo al corpo che scorre.
2. **Chiusura.** «Chiudi», tocco fuori, Esc, tasto indietro, scorrimento dal bordo su iPhone: tutte passano da una sola funzione. Dentro un passo interno (`onBack`) il tasto indietro, lo scorrimento dal bordo ed Esc tornano al passo prima e non chiudono; «Chiudi» e il tocco fuori chiudono sempre.
3. **Cronologia.** All'apertura il foglio aggiunge un passo (`history.pushState`, conservando lo stato che il router di Next tiene in `history.state`). Alla chiusura lo toglie, se è ancora in cima. «Indietro» del telefono chiude il foglio e basta. Un collegamento dentro il foglio mette la pagina nuova al posto del passo del foglio, così tornando indietro non resta un passo vuoto. Dopo una ricarica il segno del foglio nella cronologia viene ripulito e nessun foglio si riapre da solo.
4. **Dopo un'azione riuscita il foglio si chiude** e l'avviso compare sopra la barra. Un avviso non nasce mai mentre un foglio è aperto (0.3, riga 5): se il foglio resta aperto (errore, passo intermedio), l'esito è una riga dentro il foglio.
5. **Altezza.** Quanto il contenuto, fino al 92% dello schermo. Ciò che serve per decidere e l'azione principale si vedono senza scorrere.
6. **Riduci movimento.** Nessuna animazione di salita (regola già globale in `globals.css`).

**Dove si usa.** Ondata 1: scheda dell'alimento, «Altro» delle pagine, «Bevande» in Oggi, e i sette fogli del piano attraverso `plan/Sheet.tsx`, che diventa un involucro del nuovo. Poi: preparazioni, riparazione, foglio «Aggiungi», voce del diario, misure di Salute. `CookChoice` sparisce (ondata 4).

Su Android recente un `<dialog>` modale può chiudersi già da solo con il tasto indietro del sistema; restano comunque scoperti lo scorrimento dal bordo su iPhone e i browser più vecchi. Il foglio unico regge entrambi i casi: se la chiusura arriva dal sistema, toglie il suo passo; se arriva dalla cronologia, si chiude. Va provato sui due telefoni (10.3).

### 4.2 Dopo ogni azione: l'avviso con «Annulla», e «Ultime azioni»

Oggi c'è un solo avviso alla volta (`features/notice.tsx`: 15 secondi, sostituito dal successivo), con «Annulla» e un collegamento facoltativo.

**Regole dell'avviso (da subito).**

- Il testo dice che cosa è successo e dove: verbo al passato, che cosa, dove; per un alimento che entra, anche la scadenza.
- Comandi: «Annulla» e al massimo un collegamento («Vedi in Oggi», «Vedi»).
- Nessuna domanda di conferma prima di un'azione che ha «Annulla». Resta solo quella di «Cancella tutti i dati».
- Un'azione che non cambia nulla non mostra avvisi.
- Dove c'è una barra fissa (4.6) l'avviso sta sopra di essa.
- Con due comandi («Annulla» e un collegamento) il testo occupa tutta la larghezza e i comandi stanno sotto: a schermo, accanto ai comandi, il testo andava su cinque righe.
- L'avviso non porta altre azioni: una terza scelta («Aggiungi alla spesa» quando un alimento finisce) non ci sta e resta alla lista della spesa, che lo propone già.

I testi di oggi che già lo fanno restano come sono (li scrivono `features/actions.ts`, `pantry/eaten.ts`, `barcode/directAdd.ts`); cambiano quelli segnati «nuovo».

| Azione | Testo dell'avviso | Collegamento |
|---|---|---|
| Mangiato dalla dispensa | «Segnato a pranzo: 100 g di piadina» | Vedi in Oggi |
| Bevanda o acqua | Il testo di oggi («Aggiunta acqua: 200 ml.») | — (la riga è già sotto gli occhi) |
| Pasto registrato | «Registrato: pranzo con pasta, insalata, mela.» | Vedi in Oggi |
| Entrata in dispensa | «Aggiunto alla dispensa: latte, 1 l, in frigo. Scadenza stimata: 22 nov 2026.» | Vedi (nuovo) |
| Spostato | «Spostato in freezer: petto di pollo.» | — |
| Aperto | «Segnato aperto: latte.» più la nuova scadenza: «Dopo l'apertura: entro 21 nov 2026.» (nuovo) | — |
| Corretto | «Corretto: petto di pollo, ne restano 250 g.» (nuovo) | — |
| Lista della spesa | «Aggiunto alla lista della spesa: latte.» | — |
| Tolto | «Tolto: pranzo saltato.» (nuovo; oggi «Annullato: …») | — |

**«Ultime azioni»** (`/app/attivita`, ondata 2; codice in `src/features/activity/`).

- Elenco per giorno, ultimi 14 giorni, delle operazioni dell'utente. Un'operazione è l'insieme degli eventi scritti insieme: stesso `deviceId` e `recordedAt` entro un secondo. `correctLot` scrive il suo `updateLot` un millisecondo dopo: la finestra lo tiene insieme. Va scritto un test per ogni costruttore usato da un'azione dell'interfaccia: gli eventi di un'azione formano una sola operazione.
- Il testo di ogni riga viene da una funzione pura, `describeOperation` (`activity/operations.ts`, con test), e dice che cosa, quando, dove (collegamento alla riga del diario o alla scheda dell'alimento).
- «Annulla» scrive un `void` per ogni evento dell'operazione non ancora annullato, annullamenti compresi (è la regola dell'avviso). Se dopo sono arrivati eventi che ne dipendono (un acquisto già in parte mangiato), o se l'operazione è stata corretta da una venuta dopo, «Annulla» non c'è e la riga dice perché e che cosa annullare prima (per la dispensa, la regola che usa già `journal.ts`). Un'operazione annullata mostra «Annullata · Rifai». Un gruppo di soli annullamenti non è una riga: cambia lo stato di ciò che ha annullato.
- Un'azione arrivata dall'altro telefono porta « · dall'altro telefono». Non c'è un avviso dopo l'unione: la schermata di sincronizzazione dice già quanti eventi sono arrivati.
- Le modifiche che non stanno nel registro (lista della spesa, obiettivi, memorie) non entrano qui: tengono il loro «Annulla» sull'avviso (`onUndo`, già esistente) e si correggono nella loro schermata.
- Si raggiunge dall'intestazione del Diario di oggi, da Impostazioni > Dati, dal «+» > Altro e dalla ricerca.

### 4.3 Quantità

Oggi la quantità è un campo di testo libero, e sia la scheda dell'alimento sia Registra pasto propongono la confezione intera.

**Pezzo.** `features/common/QuantityPicker.tsx` (solo interfaccia): una riga di pastiglie e, dietro l'ultima («Altra quantità»), un campo numerico con l'unità fissa accanto e i tasti «−» e «+».

```ts
interface QuantityOption { id: string; label: string; value: number; estimated?: boolean }
interface QuantityValue { value: number; estimated: boolean; optionId?: string }   // optionId: la pastiglia scelta; assente se il numero è scritto a mano
interface QuantityPickerProps {
  label: string;                          // «Quanto»
  unit: "g" | "ml" | "pz";
  options: readonly QuantityOption[];     // le pastiglie, già calcolate da chi chiama
  value: QuantityValue | null;            // null = nessuna scelta
  onChange: (value: QuantityValue | null) => void;
  max?: number;                           // quanto ne resta
  error?: string | null;
}
```

**Pastiglie, in quest'ordine**, solo quelle sensate e senza doppioni:

1. «Il solito (150 g)»: l'ultima quantità usata per quel nome, se non supera ciò che resta.
2. Per gli alimenti a pezzi, le scelte di `pieceChoices` (`features/pieces.ts`): «Una piadina», «2 piadine», «Mezza piadina». Per ciò che si conta e basta (uova): «1 pz», «2 pz».
3. Per più confezioni uguali: «1 confezione», «Tutte (3)».
4. Per ciò che si pesa: «~Metà (200 g)», stima, con la tilde.
5. «Tutto (400 g)»: sempre esplicito, mai già scelto.
6. «Altra quantità».

**Partenza.** «Il solito» se c'è; altrimenti un pezzo per gli alimenti a pezzi o che si contano; altrimenti nessuna scelta: il pulsante principale è spento e sotto si legge «Scegli quanto». Mai «Tutto», «Tutte» o «1 confezione».

**Campo.** `inputMode="decimal"`; l'unità non si scrive; passi di «−» e «+»: 1 per i pezzi, 10 g sotto i 200 g e 50 g sopra, 50 ml. Oltre ciò che resta: errore sotto il campo, «Ne restano 60 g».

**Memoria delle porzioni.** `features/portions.ts`: una sola impostazione (`portions.v1`) con una mappa dal nome normalizzato all'ultima quantità mangiata, al massimo 300 nomi (esce il meno usato di recente). Si scrive dopo un «Mangiato» riuscito; propone, non salva.

**Dove si usa.** Ondata 1: scheda dell'alimento. Ondata 2: Registra pasto, modifica di una voce del diario. Poi: revisione dello scontrino, lista della spesa.

### 4.4 Modifica sul posto di una voce del diario (ondata 2)

Oggi su un pasto c'è solo «Annulla questo pasto», con una domanda. Solo i consumi nati dal tocco in Dispensa e le bevande hanno comandi per riga.

- **Una voce del pasto è una riga che si tocca** (nome e quantità a sinistra, nutrienti o «senza dato» a destra, nessun comando sulla riga). Il tocco apre il foglio «Voce»: Quantità (4.3) con «Salva» nel piede; «Cambia momento» (un passo dello stesso foglio); «Apri l'alimento» (`/app/dispensa?lotto=`); «Collega i valori» se la voce è senza dato (porta a Nutrizione, «Voci non riconosciute»: una casa sola); «Togli».
- **In fondo a un pasto aperto c'è un solo comando, «Altro»**, che apre il foglio «Pasto» (il titolo del pasto apre e chiude la riga, quindi non può aprire un foglio): «Aggiungi qui» (`/app/pasto?pasto=<mealId>`), «Cambia momento o ora» (momento, giorno, ora), «Ripeti adesso», «Togli il pasto».
- **«Altro» di un momento senza pasto** apre un foglio con «Come ieri», «Fuori casa» (leggero, normale, abbondante), «Saltato», «Mangiato, senza dettagli».
- **Scritture**, tutte eventi nuovi, tutte con una sola scrittura, avviso e «Annulla»: una voce della dispensa si corregge con `correct` (annulla il consumo e lo riscrive con `replaces`); una voce della dispensa cambia momento con `moveConsumes` (`core/diary/placeConsume.ts`); una voce libera, e il momento, il giorno o l'ora di tutto il pasto, si correggono annullando l'evento `meal` e scrivendone uno nuovo con lo stesso `mealId` (i consumi restano legati al pasto dal `mealId`, quindi lo seguono senza essere riscritti). Le funzioni stanno in `core/diary/editMeal.ts` (nuovo, puro, con test): `currentMeal`, `changeConsumeQuantity`, `changeItem`, `removeItem`, `moveItem`, `rewriteMeal`, `appendItems`. I costruttori che usano le regole di `features/meals.ts` stanno in `features/mealEdit.ts`: `buildAppendToMeal`, `buildRepeatMeal`.
- **Stesso schema per le altre righe:** una bevanda apre il foglio «Bevanda» («Cambia ora», «Togli»); nella riga «Acqua» ogni bicchiere ha «Togli»; nella riga «Corpo» peso, umore, sintomi e integratori hanno «Togli», e il peso si corregge dal suo foglio.
- **Casi:** un pasto che resta senza voci sparisce (regola già in `deriveDiary`); lo spostamento a un giorno passato non riporta indietro la dispensa, e lo dice; due telefoni che correggono lo stesso pasto prima di unirsi: per i consumi vale `core/ledger/supersede.ts`, per i pasti la derivazione segnala `duplicate_meal` e ne conta uno. Serve un test di unione per questo caso.

### 4.5 Riga richiusa, «Altro», «Che cosa significa»

Oggi ci sono una ventina di `<details>` scritti a mano, e non esiste un elenco di azioni secondarie.

**`features/common/Disclosure.tsx`.** Una sezione richiusa: titolo e, sulla stessa riga, un riepilogo che dice che cosa c'è dentro senza aprirla («Nutrienti · ~241 kcal · ~45 g proteine»). Si tocca tutta la riga. È costruita su `<details>`: funziona senza script e con il lettore dello schermo. Con `quiet` è la riga piccola «Che cosa significa», per le spiegazioni lunghe (fonti, limiti, riservatezza, nessun parere medico).

```ts
interface DisclosureProps {
  title: string;
  summary?: ReactNode;      // che cosa c'è dentro, in una riga
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  quiet?: boolean;          // «Che cosa significa»: testo piccolo, senza riepilogo
}
```

**`features/common/ActionList.tsx`.** L'elenco delle azioni secondarie, una per riga (48 px), nell'ordine d'uso; le distruttive in fondo, dopo un filetto, nel colore di `ui.danger`. `MoreActions` è il pulsante «Altro» (variante `text`) che apre il foglio con l'elenco; dentro un foglio si usa `ActionList` da sola (4.1, regola 1).

```ts
interface ActionItem { id: string; label: string; hint?: string; href?: string; onSelect?: () => void; danger?: boolean; disabled?: boolean }
function ActionList(props: { items: readonly ActionItem[] }): ReactElement
function MoreActions(props: { items: readonly ActionItem[]; label?: string; title?: string }): ReactElement
```

### 4.6 Barra fissa e campi

**`features/common/ActionBar.tsx`.** La barra con l'azione principale di un modulo, fissa sopra la barra di navigazione (il modello è la barra di «Seleziona» in Dispensa). Riserva da sola lo spazio in fondo alla pagina e sposta l'avviso sopra di sé (variabile `--action-bar-height`, letta da `notice.module.css`). Non insegue la tastiera.

**Campi.**

- Tastiera giusta: `inputMode="decimal"` per quantità e prezzi, `numeric` per i codici.
- Invio passa al campo seguente; sull'ultimo conferma, se il modulo è valido. Oggi nel modulo a mano il nome annuncia «Avanti» ma Invio invia il modulo e dà errore.
- Date: sempre il campo con i quattro tasti rapidi («Tra 3 giorni», «Tra 1 settimana», «Tra 2 settimane», «Tra 1 mese», `barcode/expiryShortcuts.ts`) e, con la chiave, «Leggi la data dalla foto». Oggi mancano nel modulo a mano e nelle correzioni della Dispensa.
- Categoria: si vede nel riepilogo di «Altri dettagli» quando è stata proposta (dal prodotto, dalla memoria, dal nome); è un campo in vista, obbligatorio, solo quando non è stata riconosciuta.
- Moduli: campi essenziali in vista, il resto in «Altri dettagli», richiuso, con il riepilogo di ciò che contiene già; azione principale nella barra fissa.
- Errori: sotto il campo, con il campo evidenziato; mai solo in fondo.

### 4.7 «Da cosa è fatto» (ondata 3)

Oggi nessun numero si apre. Un tocco su un numero calcolato apre un foglio con: il numero e che cosa misura; le parti, una per riga, con valore e segno di certezza, ognuna con il collegamento alla sua origine; una riga di controllo («Somma delle voci: 1.240 kcal. 2 voci senza valori non contano»); e, se è una stima, perché lo è e come renderla certa. Per le medie: i giorni contati e quelli esclusi, con il motivo. Il contenuto viene da funzioni pure accanto al dato (`core/nutrition/breakdown.ts`, `core/ledger`, `core/shopping`). Si usa per energia e nutrienti di Oggi, medie di Nutrizione, valore della dispensa, costi della Spesa, e per ogni segno di stima.

### 4.8 Stati

- **Vuoto.** `shell/EmptyState.tsx` resta il modello (titolo, una riga, un'azione). Una sezione vuota non occupa spazio.
- **Caricamento.** La riga «Apro i dati del telefono…» resta finché non c'è la lettura condivisa (9.1); poi i dati restano in memoria tra una pagina e l'altra e la riga si vede solo al primo avvio.
- **Errore di archivio.** Una scheda che dice che cosa non si è potuto leggere, con «Riprova».
- **Senza rete.** La striscia della shell resta. Ciò che richiede la rete lo dice al tocco e non perde il lavoro.
- **Prima volta.** Suggerimenti di una riga, una volta sola, nel punto in cui servono (chiavi `hint.<nome>` nelle impostazioni locali).
- **Ripetizioni.** Le frasi informative che oggi tornano a ogni visita («vale come stima», «la dispensa non torna indietro nel tempo», «Un vuoto non vuol dire che hai saltato il pasto») vanno dietro «Che cosa significa».

### 4.9 Memoria delle scelte

Oggi ci sono tre memorie separate (per codice in `barcode/memory.ts`, per riga di scontrino in `ai/receiptMemoryStore.ts`, per nome solo in «Registra acquisti») e nessuna nel modulo a mano, dove il luogo parte sempre da Frigo.

- **Ondata 1.** `features/memory/itemDefaults.ts` (nuovo, con test): una sola impostazione (`itemDefaults.v1`) con una mappa dal nome normalizzato a categoria, luogo e quantità dell'ultima volta, al massimo 300 nomi. La legge e la scrive il modulo a mano. Precedenza del luogo: scelta fatta dall'utente in questo modulo; poi la memoria per quel nome; poi la regola per categoria (`defaultLocation`); poi Frigo.
- **Ondata 3.** La leggono anche la revisione dello scontrino, «Registra acquisti» e «Più alimenti». La memoria per codice resta la prima fonte per i prodotti con il codice.
- **Regole.** Una memoria propone, non salva: il valore compare già scelto, si vede e si cambia. Una correzione dell'utente sostituisce la memoria. Tutto si cancella da Impostazioni > Dati > «Memorie» (ondata 4).

### 4.10 Un nome per ogni azione

| Azione | Parola | Non più |
|---|---|---|
| Mangiare un alimento della dispensa | Mangiato | Una mangiata, Mangiata in parte, Un pezzo mangiato, Mezzo pezzo, Tutte mangiate (sono scelte di quantità) |
| Registrare un pasto | Registra (pulsante: «Registra pranzo») | Registra pasto, Registralo, Segna il primo pasto |
| Segnare una bevanda, l'acqua, una misura | Segna | Aggiungi, Registra peso |
| Dire che un pasto non c'è stato | Saltato | — |
| Dire che si è mangiato senza i dettagli | Mangiato, senza dettagli (dall'ondata 2 anche «Fuori casa», con la stima) | Mangiato, non registrato |
| Mettere in casa | Aggiungi alla dispensa | Cattura, Inserisci a mano, Aggiungi alimento, Ho già in casa |
| Mettere in lista | Aggiungi alla spesa | Aggiungi alla lista, Aggiungi a mano |
| Cambiare un dato registrato | Correggi | Modifica (resta per le ricette, che si scrivono), Cambia la data, Cambia quantità |
| Togliere una riga o un elemento | Togli | Rimuovi, Cancella, Rifiuta, Annulla questo pasto |
| Togliere un alimento inserito per errore o finito | Elimina dalla dispensa | — |
| Rimettere com'era l'ultima azione | Annulla (solo sull'avviso e in «Ultime azioni») | «Annulla» per uscire da un modulo (diventa Chiudi) o per fermare una richiesta (diventa Ferma) |
| Chiudere un foglio | Chiudi | Esci |
| Tornare al passo prima dentro un foglio | Indietro | — |
| Tornare alla schermata di partenza | Torna a … | Vai alla dispensa, Elenco |
| Riallineare le quantità | Controlla le quantità | Riallinea |
| Cucinare | Cucina | Cucinala ora, Segui i passi |
| Il diario della giornata | Diario di oggi (di un giorno passato: «Diario di lunedì 16») | Registro di oggi, Momenti di oggi, Pasti del giorno |
| Il quarto momento della giornata | Spuntino | Fuori pasto |

Ogni compito applica il glossario ai testi dei file che possiede. «Spuntino» al posto di «Fuori pasto» si applica nell'ondata 2 (mandati 2Z, 2B, 2H): dopo l'ondata 1 i due nomi comparivano insieme nella stessa schermata.

---

## 5. Ordine e stacco nelle schermate

### 5.1 Perché oggi i gruppi non si distinguono

Verificato nei moduli CSS e a schermo.

1. **Le distanze sono quasi uguali.** `ui.screen` mette 22 px (`--space-10`) tra qualunque coppia di blocchi; `ui.form` 18 px tra i campi; in Vivo le schede dei momenti distano 10 px; la scheda del codice (`BarcodeCapture.module.css`, `.card`) e la scheda dell'alimento (`LotSheet.module.css`, `.body`) mettono 18 px tra tutti i loro blocchi. Tra «dentro un gruppo» e «tra due gruppi» il rapporto va da 1,2 a 2,2: l'occhio non lo coglie.
2. **Metà dei blocchi non ha un titolo.** In Oggi i due pulsanti, la riga di stato, «Bevande», il collegamento alle idee e «Chiedi» galleggiano tra le sezioni, a 22 px da entrambi i vicini. Lo stesso vale per i quattro riquadri in fondo alla Dispensa e per i collegamenti sciolti di Piano e Spesa.
3. **In Vivo ogni campo è una scheda** (regole `.screen > .form > .field` e `.fields > .field` di `ui.module.css`), uguale per fondo e raggio alle schede dei dati, degli avvisi e delle azioni. Quando tutto è una scheda, la scheda non segnala più niente.
4. **Nei temi da registro** le schede non si disegnano: lo stacco viene solo da spazio, intestazioni e filetti. Ma il titolo di una sezione e le etichette interne hanno lo stesso carattere (li distingue solo il filetto sotto il titolo), e tra due righe di un elenco c'è quasi lo stesso vuoto che tra due sezioni (10 + 10 px di margine interno contro 22).
5. **Troppi comandi con lo stesso peso:** da 8 a 14 nella scheda di un alimento, da 3 a 5 per ogni momento di Oggi, tre collegamenti sotto ogni riga di «Da mangiare prima».
6. **Le richiusure non dicono che cosa nascondono**, e il testo di servizio è spesso più lungo del contenuto.

### 5.2 Le sei regole

Usano solo ciò che esiste. L'unica aggiunta al tema sono tre nomi di spazio che puntano a valori della scala.

**R1. Tre distanze.** Più due cose sono legate, più stanno vicine.

| Tra che cosa | Nome | Valore |
|---|---|---|
| Sezioni di una schermata | `--gap-section` → `--space-12` | 28 px (oggi 22) |
| Cose diverse nella stessa sezione o nello stesso foglio (un selettore e i pulsanti, un campo e il campo dopo nei temi da registro) | `--gap-group` → `--space-8` | 16 px |
| Cose uguali in fila (schede di un elenco, campi-scheda di un gruppo in Vivo, pulsanti, pastiglie) | `--gap-item` → `--space-4` | 8 px |

Il titolo di una sezione resta a 6 px dal suo contenuto (`SectionHeader`, com'è oggi): più di quattro volte più vicino al suo contenuto che al blocco di sopra.

**R2. Niente blocchi orfani.** In una schermata ogni blocco è una di quattro cose: la testata; il blocco d'azione (uno solo, il primo); una sezione che comincia con `SectionHeader`; una riga richiusa (`Disclosure`). I collegamenti per spostarsi stanno nell'intestazione della sezione (uno) o sono l'ultima riga della sezione, mai tra due sezioni.

**R3. Una scheda è un oggetto.** Mai una scheda dentro una scheda. La scheda tinta (`ui.tile` con `ui.tone`) è solo del blocco d'azione e degli avvisi che cambiano una decisione. In Vivo i campi di uno stesso gruppo stanno a 8 px l'uno dall'altro, dentro un contenitore `ui.fields`: si leggono come un gruppo, e la sezione dopo sta a 28 px con il suo titolo. Nei temi da registro la scheda non si disegna: il blocco d'azione è segnato dall'etichetta (`Label`) e dal posto in cima.

**R4. Un pulsante pieno.** Un solo `variant="primary"` per schermata o per foglio; al massimo due `outline` in vista; il resto in «Altro». Mai una griglia di pulsanti uguali: oltre tre scelte dello stesso tipo si usano le pastiglie (`ui.choices`). I collegamenti di testo servono a spostarsi, non ad agire. Le azioni distruttive stanno in fondo ad «Altro», dopo un filetto. Un'azione che adesso non ha senso sparisce; resta spenta solo se manca un dato che l'utente può dare, e la riga sotto dice quale.

**R5. Una riga, un comando.** In un elenco ogni riga ha al massimo un comando in vista. Gli altri compaiono toccando la riga.

**R6. Ciò che non serve ogni volta è richiuso, e dice che cosa contiene.** Ogni blocco è aperto (si usa a ogni visita), richiuso (una riga con titolo e riepilogo) oppure a richiesta (in «Altro»). Al massimo cinque blocchi per schermata. Una riga di testo di servizio per blocco; le spiegazioni lunghe dietro «Che cosa significa». Un avviso che cambia una decisione (allergene, scaduto, codice del negozio) resta sempre una riga in vista.

### 5.3 Le correzioni esatte

| File | Oggi | Dopo | Chi |
|---|---|---|---|
| `src/design/tokens.css`, blocco comune, sotto «Spaziature» | — | `--gap-section: var(--space-12); --gap-group: var(--space-8); --gap-item: var(--space-4);` | 1A |
| `features/ui.module.css`, `.screen` | `gap: var(--space-10)` | `gap: var(--gap-section)` | 1A |
| `features/ui.module.css`, `.form` | `gap: var(--space-9)` | `gap: var(--gap-group)` | 1A |
| `features/ui.module.css`, in coda, solo Vivo | — | `:global([data-palette="vivo"]) .fields { gap: var(--gap-item); }` | 1A |
| `features/ui.module.css`, `.textLink` | su un `<button>` resta il pulsante grigio del browser | azzerare `background`, `border`, `padding`, `font`, `cursor` | 1A |
| `today/Today.module.css`, Vivo, `.momentList` | `gap: var(--space-5)` | `gap: var(--gap-item)`; blocchi senza titolo tolti (5.4.1) | 1C |
| `pantry/LotSheet.module.css`, `.body` | `gap: var(--space-9)` tra sette blocchi | corpo del foglio a `--gap-group`; righe richiuse in fila (5.4.2) | 1B |
| `barcode/BarcodeCapture.module.css`, `.card` e `.add` | `gap: var(--space-9)` e `--space-7` tra tutto | sezioni a `--gap-section`; campi in `ui.fields` (5.4.4) | 1D |
| `capture/Capture.module.css` | campi a 18 px, pulsante in fondo | campi in `ui.fields`; barra fissa (5.4.5) | 1E |

Effetto nei cinque temi. In Vivo: le schede di un gruppo stanno a 8 px, i gruppi a 28 px con il loro titolo in grassetto. Nei temi da registro: 28 px e il filetto forte del titolo separano le sezioni; dentro, le righe restano divise dai filetti sottili. Nessun colore, carattere, raggio o ombra cambia. `themes.test.ts` resta verde: i tre nomi stanno nel blocco comune e nessun tema li ridefinisce.

### 5.4 Le sei schermate di ogni giorno

Per ognuna: la frase che la spiega, lo schema, i blocchi nell'ordine, i testi esatti, che cosa succede dopo ogni azione, i casi da coprire. Le misure valgono per un telefono da 375×812: sopra la barra di navigazione restano 728 px.

#### 5.4.1 Oggi

**«Qui registro quello che mangio e bevo adesso, e vedo com'è andata la giornata.»** File: `features/today/`. Ondata 1 (compito 1C).

```
┌────────────────────────────────────────┐
│ marchio                                │
│ ‹  Mar 17 nov  ›                    ⚙  │ testata, com'è oggi
│                                        │
│ ADESSO                                 │ blocco d'azione (scheda tinta in Vivo)
│ [        Registra cena               ] │ unico pulsante pieno
│ (Acqua +200 ml) (Caffè) (Tè) (Altro)   │ un tocco segna
│ Oggi: acqua 0,6 l di 2 l · Tè          │ cambia sotto il dito
│                                        │
│ Da guardare oggi      Tutti gli avvisi │ solo se c'è qualcosa, al massimo 3 righe
│ Domani: latte intero                 › │
│                                        │
│ Diario di oggi                         │
│ Mancano colazione e pranzo.            │ una riga di stato
│ Colazione            [Registra] Altro  │
│ Pranzo               [Registra] Altro  │
│   13:11 · Tè, 200 ml                   │
│ ▾ Cena   19:51 · petto di pollo  ~240 kcal │ il momento in corso è aperto
│ ▸ Acqua · 0,6 l di 2 l                 │
│ ▸ Dispensa · 6 movimenti               │
│ ─ ─ ─ ─ ─ fine della prima schermata ─ │
│ ▸ In scadenza · 3 alimenti · petto di pollo, ~2 giorni │
│ ▸ Nutrienti · ~241 kcal · ~45 g proteine │
│ Chiedi                               › │
└────────────────────────────────────────┘
```

| # | Blocco | Stato | Che cosa assorbe |
|---|---|---|---|
| 0 | Testata: marchio, giorno con le frecce, impostazioni. In un giorno passato compare «Oggi» per tornare | Sempre | — |
| 1 | **Adesso** | Aperto. Solo per oggi | «Registra pasto», proposte del pasto abituale, «Pasti abituali», Bevande, Acqua, proposta di scalare la bustina |
| 2 | **Da guardare oggi** (`DayBriefing`, al massimo tre righe, più «da rivedere») | Aperto, solo se c'è qualcosa | Avvisi del giorno, «Spesa: N voci» (riga «Lista della spesa: 3 voci»), «Nel piano, non fatti» (riga «Nel piano, non fatti: 2», che apre l'elenco sotto) |
| 3 | **Diario di oggi** | Aperto | Momenti di oggi, Pianificato per oggi, Registro di oggi |
| 4 | **In scadenza** | Riga richiusa, solo se c'è qualcosa | Da mangiare prima, «Idee di ricette con ciò che hai» |
| 5 | **Nutrienti** | Riga richiusa | Nutrienti di oggi |
| — | Viste fissate (se l'utente ne ha) e «Chiedi» | In fondo, come oggi | — |

«Aggiungi alimento» esce da Oggi: è il pulsante al centro della barra. Con i dati di prova la schermata passa da 2.842 px a meno di due schermate, e i comandi in vista da 45 a circa 15.

**Adesso.** L'etichetta è «Adesso». Il pulsante dipende dall'ora e dal diario:

| Situazione | Pulsante | Tocco |
|---|---|---|
| Momento in corso (colazione 5:00-10:30, pranzo 10:30-15:30, cena 18:30-23:00) senza pasto, e c'è un pasto abituale di quel momento non ancora registrato oggi | Pieno: «Registra: Solita colazione», con sotto gli alimenti in una riga; accanto, di testo, «Un altro pasto» | Registra subito il pasto abituale |
| Momento in corso senza pasto, senza pasto abituale | Pieno: «Registra colazione» (pranzo, cena) | Apre Registra pasto su quel momento |
| Momento in corso già registrato o dichiarato, oppure ora fuori dai tre momenti | A contorno: «Registra uno spuntino» | Apre Registra pasto su «Spuntino» |

Il pasto abituale vale per tutta la fascia del momento, non più per 90 minuti: `habitsToPropose` con `windowMinutes` largo, poi il filtro sul momento in corso; se sono più d'uno, il più vicino all'ora.

Le pastiglie sono sempre quattro: «Acqua +200 ml», «Caffè», «Tè», «Altro». «Altro» apre il foglio «Bevande», con tutte le bevande rapide (un tocco segna e chiude il foglio) e, in fondo, «Acqua: un'altra quantità», che chiude il foglio e apre la riga «Acqua» del diario. Sotto le pastiglie una riga dice il conto del giorno: «Oggi: acqua 0,6 l di 2 l · Tè × 2, Caffè espresso».

**Diario di oggi.** Sotto il titolo, una riga di stato che conta solo i momenti già cominciati e conta anche le bevande: «Ancora niente registrato oggi.», «Per ora solo bevande.», «Mancano colazione e pranzo.», «Fin qui tutto registrato.», «Giornata completa.». Poi una riga per momento cominciato (i momenti futuri non compaiono):

| Momento | Riga | Comandi |
|---|---|---|
| Senza pasto | «Pranzo» e sotto «niente registrato»; se nel piano c'è qualcosa: «nel piano: pasta al forno» | «Registra» (a contorno) e «Altro» (testo). «Altro» apre sotto la riga «Saltato» e «Mangiato, senza dettagli» |
| Dichiarato | «Pranzo · saltato», «Pranzo · mangiato, senza dettagli» | «Cambia», «Togli» |
| Registrato | Richiuso: «Colazione», con il riepilogo «8:10 · latte, pane, marmellata · ~420 kcal». Il momento in corso parte aperto | Aperto mostra le voci con quantità e nutrienti; sulle voci nate da «Mangiato» in Dispensa «Cambia momento» e «Togli»; in fondo «Togli il pasto» |
| Bevande del momento | Una riga per bevanda: «13:11 · Tè, 200 ml» | Toccando la riga: «Cambia ora», «Togli», e «Scala dalla dispensa» se in casa c'è di che |
| Spuntini | Solo se c'è qualcosa fuori dai tre momenti | Come sopra |

In coda al diario, due righe richiuse: «Acqua · 0,6 l di 2 l» (c'è sempre, per oggi; dentro, la scheda dell'acqua di oggi con le altre quantità e l'obiettivo) e «Dispensa · 6 movimenti» (solo se ce ne sono; dentro, ciò che oggi è entrato, è stato buttato, aperto, spostato o corretto, senza ripetere ciò che è già nei pasti; toccando una riga: «Togli», oppure il motivo per cui non si può). Dall'ondata 2 si aggiunge «Corpo» (peso, umore, integratori) e ogni riga apre il suo foglio di modifica (4.4).

**In scadenza.** Riepilogo: quanti sono e il primo, con il testo del suo segno di scadenza: «3 alimenti · petto di pollo, ~2 giorni». Dentro: gli alimenti scaduti o che scadono entro tre giorni, ognuno con «Sposta in freezer», «Cosa cucinare», «Con cosa sta bene» come oggi, e in fondo «Tutta la dispensa». Dall'ondata 2 (a schermo erano nove collegamenti per tre alimenti): ogni alimento è una riga sola che apre la sua scheda in Dispensa, dove «Sposta in freezer» è in testa e il resto in «Altro»; in fondo «Cosa cucinare» e «Tutta la dispensa».

**Nutrienti.** Riepilogo: «~241 kcal · ~45 g proteine», oppure «per ora solo bevande: ~1 kcal», oppure «niente da calcolare». Dentro: il blocco di oggi, con le avvertenze dietro «Che cosa significa», e «Nutrizione».

**Giorno passato.** Niente «Adesso», «Da guardare», «In scadenza», «Nutrienti». Titolo «Diario di lunedì 16». Tutti i momenti si possono registrare o dichiarare. La riga «Acqua» dice solo il totale di quel giorno, se c'è; la riga «Dispensa» mostra i movimenti di quel giorno. In fondo la riga richiusa «Aggiungi una bevanda dimenticata» (momento e ora, come oggi).

**Dopo ogni azione.**

| Azione | Che cosa si vede | Dove finisce | Annulla |
|---|---|---|---|
| «Registra: Solita colazione» | Il momento nel diario diventa registrato e resta aperto; «Adesso» passa a «Registra uno spuntino»; avviso «Registrato: Solita colazione.» | Pasto e consumi nel registro, come oggi | Sull'avviso |
| «Acqua +200 ml» | Il conto sotto le pastiglie cambia, e con lui la riga «Acqua» del diario; avviso «Aggiunta acqua: 200 ml.» | Evento `water` | Sull'avviso |
| «Caffè», «Tè» | Il conto cambia; la riga «13:11 · Tè, 200 ml» compare nel momento dell'ora, in vista; avviso. Se in casa c'è tè o caffè, sotto le pastiglie la proposta di scalarlo | Evento `drink` | Sull'avviso; poi «Togli» sulla riga |
| «Saltato», «Mangiato, senza dettagli» | La riga diventa «Pranzo · saltato»; lo stato del giorno si aggiorna; avviso «Segnato: pranzo saltato.» | Dichiarazione, come oggi | Sull'avviso; poi «Togli» |
| «Togli» su pasto, bevanda, dichiarazione, movimento | Nessuna domanda: la riga sparisce; avviso «Tolto: …» | Un `void` | Sull'avviso |

**Casi da coprire.** Dopo mezzanotte e prima delle 5 il momento è «spuntino»; su una voce mangiata prima delle 4, «Cambia momento» offre anche i momenti di ieri (oggi questa scelta sta solo nel riquadro della scheda dell'alimento, che sparisce). Un pasto abituale con un alimento finito si registra come oggi, con la voce libera stimata, e l'avviso lo dice. Un consumo senza pasto (di prima, o di una preparazione) compare nel momento della sua ora con la domanda «In quale momento lo metti?», come oggi. Un pasto pianificato per un momento ancora vuoto si legge nella riga del momento. Il diario vuoto alla prima apertura mostra la scheda guidata di oggi (`FirstStepToday`). Errore di salvataggio: una riga sotto il blocco in cui è nato.

#### 5.4.2 Scheda di un alimento

**«Qui dico che cosa ne ho fatto: mangiato, buttato, aperto. Il resto è dietro “Altro”.»** File: `features/pantry/LotSheet.tsx`, `LotActions.tsx`. Ondata 1 (compito 1B).

```
┌────────────────────────────────────────┐
│                  ▬                     │
│ [figura]  Petto di pollo       Chiudi  │
│           Frigo · restano 400 g        │
│           (~2 giorni)                  │
│ Sta per scadere.     [Sposta in freezer] │ solo se serve
│                                        │
│ Quanto                                 │
│ (Il solito 150 g) (~Metà 200 g)        │
│ (Tutto 400 g) (Altra quantità)         │
│                                        │
│ ▸ Dettagli · Pollame · entrato il 17 nov │
│ ▸ Valori nutrizionali · ~120 kcal per 100 g │
├────────────────────────────────────────┤
│ [       Mangiato · 150 g             ] │ piede fisso
│ [Buttato]    [Aperto]          Altro   │
└────────────────────────────────────────┘
```

| # | Blocco | Stato |
|---|---|---|
| 1 | Testa: figura (come oggi), nome, una riga di stato («Frigo · restano 400 g · aperto 3 giorni fa»), il segno di scadenza | Sempre |
| 2 | Riga d'avviso, solo se l'alimento si può ancora salvare congelandolo: «Sta per scadere.» con «Sposta in freezer» e, in piccolo, la scadenza che avrebbe in freezer | Solo se serve |
| 3 | Scelta della confezione, se sono più d'una uguale: «Hai 3 confezioni uguali. Agisci su» | Solo se serve |
| 4 | «Quanto»: il selettore di quantità (4.3) | Aperto |
| 5 | «Dettagli»: riepilogo «Pollame · entrato il 17 nov · scadenza stimata»; dentro quantità con la barra, scadenza spiegata, categoria, entrata, prezzo | Richiuso |
| 6 | «Valori nutrizionali»: riepilogo «~120 kcal per 100 g · stima», oppure «mancano»; dentro la tabella e, se mancano, «Collega a un alimento» e «Scrivi i valori a mano» | Richiuso |
| 7 | «Storia» (ondata 2): «Comprato il 12 nov · aperto il 14 · mangiato 2 volte» | Richiuso |
| — | Piede: «Mangiato · 150 g» pieno; sotto «Buttato» e «Aperto» a contorno (se è già aperto, al suo posto «Sposta»), e «Altro» | Fisso |

Tutto si vede senza scorrere: nel caso più alto (avviso, tre confezioni, pezzi) il contenuto sta in circa 640 px su 747. Oggi: sette blocchi aperti e da 8 a 14 comandi. Dopo: un pulsante pieno, due a contorno, «Altro».

**Dove va ogni comando di oggi.**

| Oggi | Dopo |
|---|---|
| «Un pezzo mangiato», «Mezzo pezzo», «Una mangiata», «Tutte mangiate (N)», «Mangiata in parte» | Pastiglie del selettore («Una piadina», «Mezza piadina», «1 confezione», «Tutte (3)», «Altra quantità»). Il pulsante è sempre «Mangiato · …» |
| «Buttato» | Secondario in vista. Apre nello stesso foglio motivo e quantità |
| «Aperto» / «Una aperta» | Secondario in vista finché l'alimento è chiuso |
| «Sposta» | Secondario in vista quando «Aperto» non c'è; altrimenti prima voce di «Altro» |
| «Modifica», «Cambia la data» | «Correggi», in «Altro»: quanto ne resta, nome, categoria, scadenza (con i tasti rapidi), prezzo; per più confezioni, «Vale per» |
| «Mangiato in un pasto» | «Aggiungi a un pasto», in «Altro» |
| «Aggiungi alla spesa» | In «Altro». Chiude la scheda e mostra l'avviso |
| «Con cosa sta bene», «Cosa cucinare», «Qualità» | In «Altro» («Qualità del prodotto» solo con il codice) |
| «Elimina dalla dispensa» | Ultima voce di «Altro», dopo un filetto. Dentro: «Inserito per sbaglio», «Finito», «Buttato», come oggi |

Ordine di «Altro»: Sposta (se non è in vista), Correggi, Aggiungi alla spesa, Aggiungi a un pasto, Cosa cucinare, Con cosa sta bene, Qualità del prodotto, filetto, Elimina dalla dispensa. «Altro», «Buttato», «Sposta», «Correggi» ed «Elimina» cambiano il contenuto dello stesso foglio, con «Indietro». Nei passi con un solo pulsante che conferma («Correggi»: «Salva»; «Buttato»: «Segna buttato»; «Sposta») quel pulsante sta nel piede, accanto a «Indietro»: a schermo, in fondo al corpo, non si vedeva (corretto nell'ondata 2). Il tasto indietro dentro un passo torna al passo prima (4.1).

**«Correggi»: quanto ne resta.** Una funzione pura (`pantry/correctQuantity.ts`, con test) sceglie gli eventi:

- valore uguale a quello che risulta: nessun evento;
- valore fino alla quantità di partenza: un `adjust` con il rimasto voluto;
- valore sopra la quantità di partenza (era stata scritta male all'ingresso): `correctLot` sulla creazione, con quantità di partenza uguale al rimasto voluto più ciò che risulta già consumato; se dopo la dispensa derivata non dà il rimasto voluto, anche un `adjust`;
- mai un consumo o uno scarto finto;
- prima di restituire gli eventi, la funzione deriva la dispensa con essi e controlla che il rimasto sia quello voluto.

**Dopo ogni azione** la scheda si chiude e l'avviso compare sopra la barra.

| Azione | Avviso | Dove finisce |
|---|---|---|
| «Mangiato · 150 g» | «Segnato a cena: 150 g di petto di pollo» · Annulla · Vedi in Oggi | Nel diario, nel momento dell'ora (come oggi). In Oggi la voce ha «Cambia momento». La porzione si ricorda |
| «Buttato», poi motivo e quantità | «Segnato buttato: 150 g di petto di pollo (scaduto).» · Annulla | Registro; riga «Dispensa» del diario |
| «Aperto» | «Segnato aperto: latte. Dopo l'apertura: entro 21 nov 2026.» · Annulla | Registro; la scadenza cambia, e l'avviso dice come |
| «Sposta», poi il luogo | «Spostato in freezer: petto di pollo.» · Annulla | Registro |
| «Correggi» | «Corretto: petto di pollo, ne restano 250 g.» oppure «Corretto: petto di pollo.» · Annulla | Registro (`adjust`, `correctLot`, `updateLot`) |
| «Aggiungi alla spesa» | «Aggiunto alla lista della spesa: petto di pollo.» · Annulla | Lista della spesa |
| «Elimina dalla dispensa» | «Eliminato: petto di pollo.» · Annulla | Registro |

**Casi da coprire.** Alimento finito: «Di questo alimento non resta niente», con «Aggiungi alla spesa» ed «Elimina dalla dispensa». Più confezioni uguali: pastiglie «1 confezione» e «Tutte (3)», più i pezzi se ci sono. Alimento scaduto: lo dice il segno di scadenza nella testa; niente riga del freezer; i comandi restano gli stessi. Quantità oltre il rimasto: errore sotto il campo. Alimento in freezer: «Mangiato» non chiede niente. Dopo «Mangiato» su una confezione intatta il gruppo in Dispensa cambia: la riga si aggiorna. La stessa scheda si apre dal frigo in 3D (`src/app/app/dispensa/frigo/Fridge.tsx`) e da `/app/dispensa?lotto=`.

#### 5.4.3 Dispensa

**«Qui trovo un alimento e vedo che cosa scade. Toccandolo dico che cosa ne ho fatto.»** File: `features/pantry/Pantry.tsx`. Ondata 1 (compito 1F).

```
┌────────────────────────────────────────┐
│ Dispensa                8 voci   Altro │
│ [ Cerca in dispensa                  ] │
│ [Tutto][Frigo][Freezer][Credenza]      │ come oggi
│ 3 quantità da controllare  [Controlla] │ solo se serve
│ IN SCADENZA (3)                        │
│ Petto di pollo            ▬▬  ~2 giorni │
│ Latte intero              ▬▬  ~3 giorni │
│ Mousse cacao protein · 3 × 170 g  3 giorni │
│ IL RESTO (3)                           │
│ Spinaci                   ▬▬  ~4 giorni │
│ Uova                      ▬▬ ~14 giorni │
│ Yogurt                    ▬▬ ~14 giorni │
│ Valore stimato: 142 €                  │ solo se ci sono prezzi
└────────────────────────────────────────┘
```

| # | Blocco | Stato |
|---|---|---|
| 1 | Intestazione: «Dispensa», «8 voci», «Altro» (Seleziona più alimenti, Controlla le quantità, Cosa cucinare, Vedi in 3D, Controlla con una foto) | Sempre |
| 2 | Campo «Cerca in dispensa»: filtra mentre si scrive, senza maiuscole né accenti, in tutti i luoghi | Sempre |
| 3 | Luoghi: Tutto · Frigo · Freezer · Credenza | Come oggi |
| 4 | Riga «3 quantità da controllare» con «Controlla» | Solo se ce ne sono |
| 5 | Elenco in due gruppi con etichetta: «In scadenza (N)» (scaduti o entro tre giorni) e «Il resto (N)», dove N è il numero di righe. Se un gruppo è vuoto la sua etichetta non c'è | Aperto |
| 6 | «Valore stimato: 142 €» | Una riga, solo se ci sono prezzi |

Spariscono le tre cifre in cima (le voci sono nell'intestazione, «in scadenza» è il titolo del primo gruppo, il valore è la riga in fondo) e i quattro riquadri in fondo. Non c'è un pulsante pieno: le righe sono le azioni; per aggiungere c'è il pulsante al centro della barra.

**Dopo ogni azione.** Tocco su una riga: si apre la scheda (5.4.2). «Altro» > «Seleziona più alimenti»: la selezione di oggi, con la sua barra. Ricerca senza risultati: «Nessun alimento con “pane”.» e il pulsante «Aggiungi “pane” alla spesa» (avviso con «Annulla»): è la risposta a «ce l'ho?».

**Casi da coprire.** `/app/dispensa?lotto=<id>` apre la scheda di quell'alimento; se non c'è più: «Questo alimento non c'è più.» sopra l'elenco. Dispensa vuota: la scheda guidata di oggi. Un luogo senza alimenti: il testo di oggi. La ricerca con un luogo scelto cerca comunque dappertutto, e ogni riga dice dove sta.

#### 5.4.4 Scheda del codice a barre

**«Qui confermo quando scade e dove lo metto, e aggiungo.»** File: `features/barcode/BarcodeCapture.tsx`, `AddToPantry.tsx`, `ProductSafety.tsx`. Ondata 1 (compito 1D).

```
┌────────────────────────────────────────┐
│ [foto]  Mousse cacao protein           │
│         Piacersi CONAD · 170 g         │
│ ┌ Attenzione: contiene ciò che hai   ┐ │ il riquadro di oggi, per intero,
│ └ dichiarato · CONTIENE latte …      ┘ │ sopra il modulo
│ Ne hai già 3 in dispensa.              │
│                                        │
│ Aggiungi alla dispensa                 │ titolo di sezione
│ Scadenza  [ gg/mm/aaaa ]               │
│  (Tra 3 giorni)(1 settimana)(2 settimane)(1 mese) │
│  Senza data uso una stima: 1 dic 2026. │
│ Dove lo metti  (Frigo)(Freezer)(Credenza) │
│ Quante confezioni   [−] 1 [+]   170 g  │
│ ▸ Altri dettagli · Yogurt · senza pezzi · senza prezzo │
│ ▸ Valori e qualità · 76 kcal per 100 g │
│ Che cosa significa                     │
├────────────────────────────────────────┤
│ [ Aggiungi alla dispensa ] Altro codice │ barra fissa
└────────────────────────────────────────┘
```

Prima del codice la pagina è il lettore, con la fotocamera che si accende da sola (`Scanner` con `autoStart`), il campo «Oppure scrivi le cifre» e la riga «Che cosa significa» con la nota di riservatezza. Mentre cerca: «Cerco il codice…» e «Ferma».

| # | Blocco | Stato |
|---|---|---|
| 1 | Testa: foto, nome, marca e quantità in una riga | Sempre |
| 2 | Avvisi che cambiano la decisione, sopra il modulo: il riquadro degli allergeni e delle esclusioni com'è oggi, per intero («contiene», «tracce», «incerto», con il perché e le note); codice interno del negozio, con «Non è questo prodotto»; conferma di una scheda scritta dall'utente («Sì, è questo» / «Non è questo prodotto») | Sempre in vista, se ci sono |
| 3 | «Ne hai già 3 in dispensa.» | Una riga, se è vero |
| 4 | Sezione «Aggiungi alla dispensa»: Scadenza (data, quattro tasti rapidi, la stima che vale senza data, «Leggi la data dalla foto» con la chiave; con più confezioni, «Date diverse»), Dove lo metti (proposto), Quante confezioni. In cima, solo se mancano: Nome, Quantità di una confezione, Categoria | Aperto |
| 5 | «Altri dettagli»: riepilogo «Yogurt · da consumare entro · senza pezzi · senza prezzo»; dentro Categoria, Tipo di data, Pezzi dentro la confezione, Prezzo, e «Apri il modulo completo» | Richiuso; si apre da solo se lì c'è un errore |
| 6 | «Valori e qualità»: riepilogo «76 kcal per 100 g · da etichetta», oppure «valori mancanti»; dentro la tabella, «Modifica i valori» e la foto dell'etichetta, confezione, allergeni e tracce dichiarati, indici, additivi, «Vedi la qualità del prodotto», «Confronta sullo scaffale» | Richiuso |
| 7 | «Che cosa significa»: da dove vengono i dati, che sono salvati sul telefono, la riservatezza | Riga piccola |
| — | Barra fissa: «Aggiungi alla dispensa» (con più confezioni: «Aggiungi 3 confezioni») e, di testo, «Altro codice» | Sempre |

Da tre schermate a una: «Aggiungi alla dispensa» si vede sempre, e senza allergeni dichiarati si vedono senza scorrere anche i tre campi.

**Dopo ogni azione.**

| Azione | Che cosa succede |
|---|---|
| «Aggiungi alla dispensa» | Scrive come oggi. Si torna al lettore, con la fotocamera accesa per il prodotto seguente. Avviso, con il testo di oggi: «Aggiunto alla dispensa: Mousse cacao protein, 170 g, in frigo. Scadenza stimata: 1 dic 2026.» · Annulla · Vedi (apre la scheda in Dispensa). La scelta di categoria, luogo e pezzi si ricorda per quel codice, come oggi |
| «Altro codice» | Torna al lettore senza scrivere niente |
| Un tasto rapido della data | Riempie il campo; la nota dice da dove viene la data |
| «Non è questo prodotto» | Come oggi: si passa a «non trovato» |

**Casi da coprire.** *Non trovato:* «Prodotto non trovato», con «Aggiungi a mano» (pieno: apre il modulo con il codice già dentro, e dopo il salvataggio torna al lettore), «Altro codice» e i valori a mano come oggi. *Ricerca fallita o senza rete:* «Riprova», «Aggiungi a mano», «Altro codice». *Codice interno del negozio:* l'avviso sta in cima; finché una scheda scritta dall'utente non è confermata non c'è la barra «Aggiungi» e gli allergeni restano «incerto», come oggi. *Categoria non riconosciuta:* il campo Categoria è in cima alla sezione, obbligatorio. *Data letta dal codice:* già nel campo, con la nota «Data letta dal codice: controllala». *Fotocamera negata:* resta il campo delle cifre, con il messaggio di oggi. *Doppio tocco:* una sola scrittura (`singleFlight`, già presente). Nessun avviso di sicurezza diventa meno visibile di oggi.

#### 5.4.5 Aggiungi alla dispensa, a mano

**«Qui scelgo come far entrare la spesa; a mano bastano quattro campi.»** File: `features/capture/Capture.tsx`. Ondata 1 (compito 1E).

```
┌────────────────────────────────────────┐
│ Aggiungi alla dispensa                 │
│ [        Leggi un codice             ] │ tre ingressi, a contorno
│ [ Scontrino ]      [ Più alimenti ]    │
│                                        │
│ A mano                                 │ titolo di sezione
│ Nome       [ Latte, uova, petto di… ]  │
│ Quantità   [ 500 g, 1 l, 6 uova ]  Confezioni [−] 1 [+] │
│ Dove lo metti  (Frigo)(Freezer)(Credenza) │
│ Scadenza   [ gg/mm/aaaa ]              │
│  (Tra 3 giorni)(1 settimana)(2 settimane)(1 mese) │
│ ▸ Altri dettagli · Latte fresco (proposta) · senza prezzo │
├────────────────────────────────────────┤
│ [      Aggiungi alla dispensa        ] │ barra fissa: l'unico pulsante pieno
└────────────────────────────────────────┘
```

| # | Blocco | Stato |
|---|---|---|
| 1 | Titolo «Aggiungi alla dispensa» e i tre ingressi, tutti a contorno: «Leggi un codice» a tutta larghezza, sotto «Scontrino» e «Più alimenti» | Sempre |
| 2 | Sezione «A mano»: Nome (con i suggerimenti), Quantità e Confezioni sulla stessa riga, Dove lo metti (proposto dalla memoria per nome, poi dalla categoria; una riga dice da dove viene la proposta), Scadenza (data, quattro tasti rapidi, «Senza data uso una stima dalla categoria.», e con la chiave «Leggi la data dalla foto») | Aperto |
| 3 | Categoria, come campo in vista, solo se dal nome non si riconosce | Solo se serve |
| 4 | «Altri dettagli»: riepilogo «Latte fresco (proposta) · senza prezzo»; dentro Categoria, Tipo di data, Pezzi dentro la confezione, «Date diverse» con più confezioni, «Ce l'avevo già», Prezzo, Valori nutrizionali | Richiuso; si apre da solo se lì c'è un errore |
| — | Barra fissa: «Aggiungi alla dispensa» | Sempre |

Escono dalla pagina i collegamenti «Hai mangiato? Registra un pasto…» e «In negozio? Confronta sullo scaffale» (non c'entrano con l'aggiungere) e «Vai alla dispensa» (c'è la barra in basso).

Misurato a schermo dopo l'ondata 1: nei temi da registro all'apertura si vedono tre campi e mezzo; in Vivo, dove ogni campo è una scheda, due. Con la correzione dell'ondata 2 (quantità e confezioni sulla stessa riga anche in Vivo, niente etichetta accanto al titolo, «Categoria» solo dopo un nome non riconosciuto) in Vivo si vedono per intero Nome, Quantità con le confezioni e «Dove lo metti», più l'inizio di «Scadenza». Quattro campi interi non ci stanno senza cambiare l'aspetto delle schede.

**Dopo ogni azione.** «Aggiungi alla dispensa»: avviso con lo stesso testo della scheda del codice («Aggiunto alla dispensa: latte, 1 l, in frigo. Scadenza stimata: 24 nov 2026.») · Annulla · Vedi; il modulo si svuota e il cursore torna sul nome, per il prossimo; luogo, categoria e quantità si ricordano per quel nome. Se il modulo era arrivato da un codice non trovato, dopo il salvataggio si torna al lettore. Invio nel nome passa alla quantità; nella quantità conferma.

**Casi da coprire.** *Nome già usato:* luogo, categoria e quantità dell'ultima volta arrivano proposti, e si vedono. *Nome di una scheda con valori salvati:* la proposta «Uso i valori salvati per …» resta com'è oggi, mai in silenzio. *Senza scadenza* (sale, zucchero): la categoria dà una stima lunga; lo dice la riga sotto il campo. *Più confezioni con date diverse:* «Date diverse» in «Altri dettagli». *Quantità non scritta:* errore sotto il campo, con il campo a fuoco.

#### 5.4.6 Registra pasto

**«Qui scelgo che cosa ho mangiato e quanto; “Registra” è sempre in basso.»** File: `features/meal/Meal.tsx`. Ondata 2 (mandato 2F).

```
┌────────────────────────────────────────┐
│ Registra cena                    Altro │
│ oggi · 19:55 · Cambia                  │
│ [ Cerca o scrivi un alimento         ] │
│ Nel piatto (1)                         │
│ Spinaci                          Togli │
│  Quanto (Il solito 80 g)(~Metà)(Tutto 150 g)(Altra quantità) │
│ I tuoi pasti abituali         Gestisci │ solo a piatto vuoto
│ Solita cena · pollo, insalata, pane    │ un tocco lo registra
│ Di solito a cena                       │
│ (Petto di pollo · 150 g) (Insalata · 80 g) (Pane · 60 g) │
│ Dalla dispensa                         │
│ ☐ Latte intero · 1 l · ~3 giorni       │
│ ☐ Mousse cacao protein · 3 confezioni da 170 g │
├────────────────────────────────────────┤
│ [        Registra cena (1)           ] │ barra fissa
└────────────────────────────────────────┘
```

| # | Blocco | Stato |
|---|---|---|
| 1 | Testa: «Registra cena»; sotto, giorno e ora con «Cambia» (momento, giorno, ora: l'ora si cambia anche per oggi; alle 21 il pranzo propone le 13:00); «Altro» (Fuori casa in tre taglie, Come ieri, Scrivi o detta e Foto del piatto solo con la chiave, Pasti abituali) | Sempre |
| 2 | «Cerca o scrivi un alimento»: filtra la dispensa; un nome che in casa non c'è diventa «Aggiungi “pizza” come voce libera» | Sempre |
| 3 | «Nel piatto (N)»: le voci scelte, ognuna con il selettore di quantità (mai con «Tutto» già scelto) e «Togli»; se la quantità supera la confezione aperta, il resto si prende dalla seguente, e la riga lo dice | Solo se c'è qualcosa |
| 4 | «I tuoi pasti abituali»: fino a tre, prima quelli del momento; un tocco registra subito; «Gestisci» porta alla loro pagina | Solo a piatto vuoto, se ce ne sono |
| 5 | «Di solito a cena»: fino a sei alimenti usati più spesso in quel momento, con la porzione ricordata; un tocco li mette nel piatto | Solo se ci sono |
| 6 | «Dalla dispensa»: una riga per prodotto (non per confezione), in ordine di scadenza; spuntata, sale in «Nel piatto» | Aperto |
| 7 | «Salvalo come pasto abituale» | In fondo |
| — | Barra fissa: «Registra cena (2)»; spento, con «Scegli quanto per: …», finché una voce non ha la quantità | Sempre |

«Saltato» e «Mangiato, senza dettagli» non stanno qui: stanno in Oggi, in «Altro» del momento (una casa sola).

**Dopo.** Si torna a Oggi (o al giorno scelto) sulla riga del pasto, evidenziata (`?voce=`), con l'avviso «Registrato: cena con spinaci, pane.» · Annulla. **Casi:** dispensa vuota (solo voci libere e pasti abituali); pasto di un giorno passato (la dispensa si scala adesso, e lo dice una riga); aggiunta a un pasto esistente (`?pasto=`: titolo «Aggiungi a cena», pulsante «Aggiungi (2)»). Un alimento senza valori si vede in Oggi dopo la registrazione («senza dato», con «Collega i valori»), non qui.

**Pasti abituali** (`features/habits/Habits.tsx`): ogni riga ha «Registra adesso» e «Altro» (Cambia nome e ora, Cambia gli alimenti, Ritira, senza domanda e con «Annulla»). Si raggiungono da Registra pasto, dalla ricerca e da Impostazioni.

### 5.5 Le altre schermate

Stesse regole. Per ognuna: che cosa resta aperto, che cosa si richiude, l'azione principale.

| Schermata | Frase | Aperto | Richiuso o in «Altro» | Azione principale | Ondata |
|---|---|---|---|---|---|
| Piano (`plan/PlanHome.tsx`) | «Qui vedo che cosa mangio stasera e nei prossimi giorni» | «Stasera e domani» con «Cucina» e «Che cosa manca»; «Questa settimana», una riga per giorno; Ricette · Spesa · Preparazioni nell'intestazione | «Altro»: Proponi la settimana, Copia la settimana scorsa, Verifica del piano | «Proponi la settimana» se è vuota, altrimenti «Cucina» | 4 |
| Settimana (`plan/Week.tsx`) | «Qui metto i pasti nei giorni» | Si apre su oggi; giorni passati in una riga; ogni voce ha un comando in vista e gli altri al tocco | «Verifica», «Copia», «Tipo di giornata» | «Aggiungi» nel momento, con il foglio che resta aperto | 4 |
| Spesa (`shopping/Shopping.tsx`) | «Qui tengo la lista e la spunto in negozio» | Campo «Aggiungi alla spesa»; «Da comprare (N)» per reparto, righe compatte con il perché in piccolo | «Costi e prezzi: questo mese 212 €», «Sospese (N)», Scorte minime | Barra fissa «Vado a fare la spesa» | 3 |
| Salute (`health/Health.tsx`) | «Qui segno le misure e guardo l'andamento» | «Segna»: Peso · Umore · Sintomo · Integratore; Peso (ultimo valore e 30 giorni); Integratori di oggi | Umore, energia e sonno (media); Acqua e bevande (solo andamento); riga «Andamento»: Nutrizione, Analisi, Esperimenti, Rapporto | «Segna» | 4 |
| Nutrizione (`nutrition/Nutrition.tsx`) | «Qui vedo le medie rispetto ai riferimenti» | Periodo e «Giorni contati: 5 di 7 · perché»; energia e macronutrienti; fino a sei nutrienti | Altri nutrienti; costo per nutriente; «Che cosa significa» | — | 3 |
| Scheda di una ricetta (`recipes/RecipeView.tsx`) | «Qui decido se cucinarla» | Titolo e stato («35 min · hai 6 ingredienti su 8»); sicurezza, se ci sono allergeni dichiarati; ingredienti | Passi, valori, storia; «Altro»: Modifica, Con cosa sta bene, Condividi, Elimina | «Cucina»; a contorno «Metti nel piano», «Che cosa manca» | 4 |
| Impostazioni (`settings/Settings.tsx`) | «Qui vedo come è impostata l'app» | Righe con il valore attuale: Alimentazione («Allergeni: latte»), Aspetto («Vivo»), Dati («ultima copia: 3 giorni fa»), Funzioni («chiave attiva») | Informazioni; «Cancella tutti i dati» in fondo | — | 4 |

---

## 6. Lista di lavoro: funzioni perse, fuori posto, doppie, incomplete

Ogni riga ha un compito che la chiude (i codici sono nella sezione 10). I tipi: **persa** (esiste ma non si trova), **fuori posto** (lontana dal bisogno), **doppia** (due case), **incompleta** (manca la modifica, il ritorno o un caso pratico), **rotta** (a schermo non funziona), **mancante**.

### 6.1 Entrata in casa e dispensa

| # | Funzione | Tipo | Oggi | Dopo | Compito |
|---|---|---|---|---|---|
| 1 | Aggiungere dopo la lettura del codice | Persa | In fondo a tre schermate | Modulo in cima, barra fissa | 1D |
| 2 | Scadenza, luogo, confezioni, date diverse, pezzi nella scheda del codice | Persa | Esistono, sotto la piega | Scadenza, luogo e confezioni in vista; il resto in «Altri dettagli» | 1D |
| 3 | Il lettore dopo un'aggiunta | Incompleta | Va riacceso a mano a ogni prodotto | Riparte da solo; poi lettura continua | 1D, 3B |
| 4 | Prodotto non trovato | Incompleta | Dopo «Inserisci a mano» non si torna al lettore | Si torna al lettore | 1D, 1E |
| 5 | Ricerca del prodotto in rete | Incompleta | Fino a 8 secondi senza poter fermare; senza rete il codice si perde | «Ferma»; poi il codice resta «da completare» | 1D, 3B |
| 6 | Ingressi della pagina di aggiunta | Persa | Due pulsanti e tre collegamenti di testo | Tre ingressi chiari | 1E |
| 7 | Luogo nel modulo a mano | Incompleta | Parte sempre da Frigo | Memoria per nome, poi regola per categoria | 1E |
| 8 | Invio nel campo del nome | Rotta | Annuncia «Avanti» ma invia il modulo e dà errore | Passa al campo seguente | 1E |
| 9 | Suggerimenti del nome | Fuori posto | Vengono dal catalogo dei modelli | Prima i nomi già usati, poi il catalogo | 1E |
| 10 | Tasti rapidi della data | Incompleta | Solo nella scheda del codice | Anche nel modulo a mano e in «Correggi» | 1E, 1B |
| 11 | Scontrino | Incompleta | Una sola foto | Più foto per uno scontrino lungo | 3C |
| 12 | Revisione dello scontrino | Incompleta | Tutti i campi di ogni riga aperti; la quantità indovinata non è segnalata | Aperte solo le righe incerte; «Salva» fisso | 3C |
| 13 | «Più alimenti» (oggi «Aggiunta rapida») | Incompleta | Salva sempre come «già in casa» | Scelta «Appena comprati / Già in casa», ricordata | 3C |
| 14 | Cercare in dispensa | Mancante | Solo i luoghi | Campo di ricerca; senza risultati, «Aggiungi alla spesa» | 1F |
| 15 | Cifre e riquadri della Dispensa | Fuori posto | Tre cifre in cima, quattro riquadri in fondo | Intestazione, gruppo «In scadenza», «Altro» | 1F |
| 16 | Azioni della scheda di un alimento | Fuori posto | Da 8 a 14 pulsanti sotto i dati | Un pulsante pieno, due a contorno, «Altro» | 1B |
| 17 | Quantità di «Mangiato» | Incompleta | Propone tutta la confezione | Porzione ricordata, mai «tutto» per partenza | 1B, 2D |
| 18 | Correggere quanto ne resta | Mancante | Solo eliminando e riaggiungendo | «Correggi» | 1B |
| 19 | Dove finisce ciò che si mangia dalla scheda | Persa | Lo dice un riquadro in fondo alla scheda, sotto «Elimina» | Avviso con il momento e «Vedi in Oggi»; voce nel diario | 1B, 1C |
| 20 | «Aggiungi alla spesa» dalla scheda | Rotta | L'avviso nasce sotto la scheda | La scheda si chiude, l'avviso si vede | 1B |
| 21 | Aprire un alimento da un collegamento | Mancante | `/app/dispensa?lotto=` non apre nulla | Apre la scheda | 1F |
| 22 | Selezione multipla | Incompleta | Solo «Elimina» | Anche «Sposta» e «Aggiungi alla spesa» | 5D |
| 23 | Scorte minime | Doppia | Collegamento in Piano e in Spesa | Sezione richiusa della Spesa | 3D |
| 24 | Categorie nella «Spesa del periodo» | Rotta | Nomi interni in inglese | Nomi italiani (`FOOD_CATEGORY_LABELS`) | 1A |

### 6.2 Diario, pasti e salute

| # | Funzione | Tipo | Oggi | Dopo | Compito |
|---|---|---|---|---|---|
| 25 | Bevande da Oggi | Persa | In una riga chiusa; la bevanda compare più in alto, fuori vista | Pastiglie in «Adesso»; riga nel diario | 1C |
| 26 | Acqua | Incompleta | In fondo a Oggi; nessun elenco di ciò che si è segnato | Pastiglia e riga nel diario; poi elenco con «Togli» per bicchiere | 1C, 2A |
| 27 | Acqua e bevande | Doppia | In Oggi e in Salute | Si segnano da Oggi; Salute mostra l'andamento | 1C, 4D |
| 28 | Stato del giorno | Rotta | «Niente registrato» con una bevanda segnata; «mancano» anche i momenti futuri | Conta le bevande e solo i momenti cominciati | 1C |
| 29 | Dichiarare «Saltato» | Incompleta | Solo dopo un'ora fissa (10:00, 14:30, 21:00) | Da quando il momento comincia, dietro «Altro» | 1C |
| 30 | Registro di oggi | Doppia, incompleta | Elenco a parte, solo dispensa, con domanda prima di annullare | Riga «Dispensa» del diario; poi «Ultime azioni» | 1C, 2B |
| 31 | Proposta del pasto abituale | Incompleta | Solo entro 90 minuti dall'ora abituale | Per tutta la fascia; poi «Come ieri» | 1C, 2D |
| 32 | Pasto pianificato per oggi | Fuori posto | Blocco a parte; «Registralo» porta alla settimana | Si legge nel momento del diario; poi si registra con le voci del piano | 1C, 4B |
| 33 | Correggere un pasto | Incompleta | Solo annullarlo tutto, con domanda | Modifica sul posto | 2A |
| 34 | Voci senza valori | Incompleta | Nessun segno nel pasto | Segno «senza dato» e «Collega i valori» | 2A |
| 35 | Annullare dopo il primo avviso | Mancante | Dopo il secondo avviso il primo non si annulla più | «Ultime azioni» | 2B |
| 36 | Pasti abituali | Persa | Collegamento che compare solo con una proposta | «Di solito» in Registra pasto; «Registra adesso» e alimenti modificabili nella loro pagina | 2D |
| 37 | Ora del pasto | Incompleta | Si sceglie solo per un giorno passato | Sempre, anche per oggi | 2D |
| 38 | Confezioni uguali in Registra pasto | Incompleta | Una riga per confezione, tutte uguali | Una riga per prodotto | 2D |
| 39 | Pasto fuori casa | Incompleta | La dichiarazione toglie il giorno dalle medie | «Fuori casa» con una stima che conta | 2E |
| 40 | Giorni contati in Nutrizione | Incompleta | Il testo contraddice il calcolo | I giorni esclusi, con il motivo | 3E |
| 41 | Integratori | Incompleta | Senza dose ricordata | Dose e ora; «Preso» a un tocco | 4D |
| 42 | Peso, umore, sintomi | Incompleta | Elenchi che non si correggono | Ogni riga si corregge e si toglie | 2A, 4D |
| 43 | Dettatura | Persa | Solo nella frase del pasto | Anche nel campo del «+» e in Registra pasto | 2C, 2D |
| 44 | «Rifai l'introduzione» | Rotta | Pulsante grigio del browser | Collegamento come gli altri | 1A |

### 6.3 Piano, ricette e spesa

| # | Funzione | Tipo | Oggi | Dopo | Compito |
|---|---|---|---|---|---|
| 45 | Piano di oggi | Incompleta | La pagina Piano non dice nulla di oggi | «Stasera e domani» in cima | 4B |
| 46 | Aggiungere al piano | Incompleta | Il foglio si chiude a ogni voce e riparte da «alimento» | Resta aperto e ricorda l'ultima scelta | 4B |
| 47 | Verifica del piano | Fuori posto | Pagina a parte | Sezione richiusa della Settimana | 4B |
| 48 | Cominciare a cucinare | Incompleta | Un foglio con tre collegamenti prima del primo passo | «Cucina» va al primo passo | 4C |
| 49 | Mettere una ricetta nel piano | Mancante | Dalla ricetta non si può | «Metti nel piano» | 4C |
| 50 | Cucina | Incompleta | Passo e timer si perdono con l'indietro | Stato salvato; «Stai cucinando: riprendi» in Oggi | 4C |
| 51 | Dopo aver cucinato | Incompleta | Niente avanzi | «È avanzato qualcosa?» crea la porzione in frigo | 4C |
| 52 | Filtri del ricettario | Incompleta | Si perdono tornando indietro | Nell'indirizzo della pagina | 4C |
| 53 | Salvare una ricetta su iPhone | Incompleta | Nessun incolla | «Incolla l'indirizzo»; riconoscimento nel «+» | 4C, 5A |
| 54 | Allergeni ed esclusioni | Doppia | Tre posti, due archivi | Una casa, un archivio, unione mai meno severa | 4A |
| 55 | Obiettivi e struttura | Fuori posto | In Piano | Impostazioni > Alimentazione | 4E |
| 56 | Lista in negozio | Incompleta | È una copia fatta all'inizio del giro: ciò che si aggiunge dopo non entra | Lista viva | 3D |
| 57 | Schermo in negozio | Incompleta | Si spegne | Resta acceso | 3D |
| 58 | Costi, spesa del periodo, prezzi | Fuori posto | Tre blocchi aperti in fondo alla Spesa | Una riga richiusa | 3D |

### 6.4 Impianto

| # | Funzione | Tipo | Oggi | Dopo | Compito |
|---|---|---|---|---|---|
| 59 | Fogli dal basso | Doppia, incompleta | Cinque realizzazioni; l'indietro esce dalla pagina | Un foglio solo | 1A, poi chi possiede ogni foglio |
| 60 | Stacco tra i blocchi | Rotta | Distanze quasi uguali, blocchi senza titolo | Sei regole | 1A, poi ogni compito sulle sue schermate |
| 61 | Aggiungere da qualunque schermata | Mancante | Ogni cosa nella sua area | Il «+» | 2C |
| 62 | Ricerca | Mancante | Sei ricerche locali, nessuna generale | Nel foglio «Aggiungi» | 2C |
| 63 | Impostazioni | Incompleta | Nessuno stato in vista | Ogni riga dice il valore attuale | 4E |
| 64 | Scorciatoie dell'icona | Mancante | Il manifest non ne ha | Quattro su Android | 5A |
| 65 | Giorni senza registrazioni | Mancante | Si ricostruiscono a mano | «Mettiamoci in pari» | 5B |
| 66 | Primo avvio | Incompleta | Stile e tre domande, poi niente | Una domanda; «Primi passi» nella prima settimana | 5C |
| 67 | Caricamento | Incompleta | Ogni pagina rilegge tutto il registro, più volte | Lettura condivisa | 3A |
| 68 | Nomi delle azioni | Doppia | Nove formule per registrare un pasto, quattro significati di «Annulla» | Glossario | Tutti; ripasso in 5D |

---

## 7. Casi pratici

Che cosa fa l'app nelle situazioni di tutti i giorni. Tra parentesi l'ondata in cui il comportamento arriva, se non è la prima.

**Torno dalla spesa.**

| Situazione | Che cosa faccio | Che cosa fa l'app |
|---|---|---|
| Ho 25 prodotti con il codice | Centro della barra, «Leggi un codice», poi un tocco per prodotto | Il lettore riparte da solo dopo ogni aggiunta. (3) Lettura continua: ogni codice una riga, lo stesso codice «×2», poi «Aggiungi tutti», con un solo «Annulla» |
| Tre yogurt uguali, due scadenze | «Quante confezioni» a 3, poi «Date diverse» | Tre confezioni con le loro date; in Dispensa una riga sola che dice le scadenze |
| Frutta, pane, banco: niente codice | «A mano»: nome, quantità | Luogo, categoria e quantità dell'ultima volta arrivano proposti. La scadenza, senza data, è una stima e lo dice |
| Carne pesata, con il codice del negozio | Leggo il codice | Avviso in cima: il codice vale solo in quel negozio; «Non è questo prodotto» porta ai dati a mano. Gli allergeni restano «incerto» |
| Il prodotto non è nell'archivio | «Aggiungi a mano» | Il modulo ha già il codice; dopo il salvataggio torno al lettore. I valori nutrizionali si possono scrivere a mano o leggere dalla foto dell'etichetta, come oggi |
| Sono senza rete | Leggo il codice | I prodotti già letti si ritrovano dal telefono. Per gli altri: «Aggiungi a mano». (3) Il codice resta «da completare» e si completa quando torna la rete |
| Ne avevo già | — | «Ne hai già 3 in dispensa.» sopra il modulo; non blocca |
| Ho lo scontrino | «Scontrino» | Come oggi. (3) Più foto; aperte solo le righe dubbie |
| Metto il pollo in freezer | Dispensa, riga, «Altro», «Sposta» | L'avviso dice il luogo; la scadenza si ricalcola |
| Apro il latte | Riga, «Aperto» | L'avviso dice la nuova scadenza |

**Mangio e bevo.**

| Situazione | Che cosa faccio | Che cosa fa l'app |
|---|---|---|
| La colazione di sempre | «Registra: Solita colazione» in «Adesso» | Un tocco, per tutta la fascia della colazione |
| Un frutto al volo | Dispensa, cerco «mela», riga, «Mangiato», con un pezzo già proposto | Finisce nel diario come spuntino o nel pasto del momento; l'avviso dice dove. (2) Dal «+», scrivendo «mela» |
| Mezzo pacco di pasta per due | Riga, «~Metà», «Mangiato» | Segnato come stima; la volta dopo «Il solito» |
| Un caffè, un bicchiere d'acqua | Pastiglia in «Adesso» | Il conto cambia; la riga è nel diario |
| Finisco il latte | «Tutto (200 ml)», «Mangiato» | L'alimento esce dalla dispensa. La lista della spesa lo propone come oggi. (2) L'avviso offre «Aggiungi alla spesa» |
| Qualcosa che non è in dispensa | «Registra pranzo», voce a mano | Voce libera, segnata come stima |
| Mangio fuori | «Altro» sul momento, «Mangiato, senza dettagli» | Il momento è dichiarato; il giorno non entra nelle medie, e lo dice. (2) «Fuori casa: leggero, normale, abbondante»: conta, come stima |
| Salto il pranzo | «Altro» sul momento, «Saltato» | Si può dire da quando il momento comincia, non più solo dopo le 14:30 |
| Mangio dopo mezzanotte | Come sempre | Va negli spuntini del giorno nuovo; «Cambia momento» lo sposta, anche alla cena di ieri |
| Ho un allergene dichiarato | Leggo il codice | «Contiene: latte» resta sopra «Aggiungi», con il perché. Non blocca. Mai la parola «compatibile» |

**Dimentico.**

| Situazione | Che cosa faccio | Che cosa fa l'app |
|---|---|---|
| È sera e non ho registrato il pranzo | Riga «Pranzo» del diario, «Registra» | Il pasto va nel pranzo. (2) L'ora proposta è quella tipica del pranzo, non quella di adesso |
| Ieri non ho registrato la cena | Riga «Ieri nel registro manca: cena» in «Da guardare», oppure la freccia del giorno | Registra pasto si apre su ieri, con l'ora proposta |
| Un caffè di ieri | Giorno di ieri, «Aggiungi una bevanda dimenticata» | Momento e ora, come oggi |
| Tre giorni senza registrare | (5) «Mettiamoci in pari» | Un giorno alla volta, una scelta già fatta per momento; nulla tocca la dispensa |
| Non so quanta pasta resta | Riga, «Altro», «Correggi»; oppure «Controlla le quantità» | Scrive quanto ne resta, senza inventare consumi |

**Sbaglio.**

| Situazione | Che cosa faccio | Che cosa fa l'app |
|---|---|---|
| Ho toccato «Acqua» due volte | «Annulla» sull'avviso | Toglie l'ultimo bicchiere. (2) L'elenco dei bicchieri, con «Togli» |
| Segnato a pranzo, ma era cena | In Oggi, sulla voce, «Cambia momento» | Sposta il consumo; nei nutrienti conta una volta |
| Ho segnato 150 g, erano 80 | «Togli» sulla voce e la rifaccio dalla scheda. (2) Tocco sulla voce, quantità, «Salva» | Corretto con un evento nuovo |
| Quantità o data sbagliata entrando | Dispensa, riga, «Altro», «Correggi» | Quanto ne resta, nome, categoria, scadenza, prezzo |
| Lo stesso prodotto aggiunto due volte | «Annulla» sull'avviso; dopo, «Elimina dalla dispensa», «Inserito per sbaglio» | Tolto come se non fosse mai entrato. (2) «Ultime azioni» |
| Buttato o eliminato per sbaglio | «Annulla» sull'avviso; dopo, riga «Dispensa» del diario, «Togli» | L'alimento torna. (2) «Ultime azioni», «Rifai» |
| Ho chiuso la scheda a metà | Niente | Non è stato scritto nulla |
| Ho premuto indietro con una scheda aperta | — | Si chiude la scheda; la pagina resta |

**In negozio, in cucina, con due telefoni.**

| Situazione | Che cosa fa l'app |
|---|---|
| «Ce l'ho?» davanti allo scaffale | Dispensa, ricerca: la riga dice quanto e dove; se non c'è, «Aggiungi alla spesa». (2) Lo stesso dal «+», da qualunque schermata |
| Aggiungo una voce mentre giro | (3) Entra nella spesa in corso; lo schermo resta acceso |
| Che cosa cucino con ciò che scade | «In scadenza» in Oggi, «Cosa cucinare» |
| Manca un ingrediente | La sostituzione nasce sotto l'ingrediente (esiste). (4) «Che cosa manca» lo manda in lista |
| Telefonata a metà cottura | (4) Passo e timer si ritrovano; il timer ha contato anche ad app chiusa |
| Ne ho cucinato di più | (4) «È avanzato qualcosa?» crea la porzione in frigo, con la sua scadenza |
| Secondo telefono | Gli eventi si uniscono come oggi. (2) Un avviso dice quante operazioni sono arrivate |
| Telefono nuovo | Ripristino dalla copia, come oggi; niente introduzione |

---

## 8. Tracciabilità e interazione

Il registro traccia già tutto ciò che vi entra. I buchi sono di due tipi: dati che esistono ma non si vedono o non si toccano, e dati che stanno nelle impostazioni e cambiano senza traccia.

### 8.1 I buchi e come si chiudono

| # | Che cosa cambia | Che cosa manca oggi | Come si chiude | Compito |
|---|---|---|---|---|
| 1 | Consumo dalla scheda di un alimento | La conferma sta in fondo alla scheda; la voce è fuori vista | Avviso con il momento; voce nel diario, nel momento in corso aperto | 1B, 1C |
| 2 | Bevanda toccata | La riga compare fuori vista; lo stato dice «niente» | Riga nel diario, conto in «Adesso», stato corretto | 1C |
| 3 | Acqua | Nessun elenco, nessun «Togli» | Riga «Acqua»; poi elenco dei bicchieri | 1C, 2A |
| 4 | Entrate, scarti, spostamenti | Si vedono solo oggi, in fondo | Riga «Dispensa» del diario, anche nei giorni passati; poi storia dell'alimento | 1C, 2B |
| 5 | Aperto, spostato, corretto, data cambiata | La derivazione calcola la storia (`history` in `core/ledger/derive.ts`), nessuna schermata la mostra | «Storia» nella scheda dell'alimento | 2B |
| 6 | Quanto ne resta | Non si può correggere | «Correggi», con `adjust` o `correctLot` | 1B |
| 7 | Eliminato dalla dispensa | Non si ritrova | «Ultime azioni», con «Rifai» | 2B |
| 8 | Pasti, piano, ricette, preparazioni | Si annullano solo nei primi 15 secondi o con un percorso dedicato | «Ultime azioni» per tutte le famiglie di eventi | 2B |
| 9 | Voci di un pasto | Non si correggono | Modifica sul posto | 2A |
| 10 | Eventi arrivati dall'altro telefono | Arrivano senza che nulla lo dica | Avviso dopo l'unione; in «Ultime azioni» la riga dice da quale telefono | 2B |
| 11 | Ripristino da una copia; eventi di una versione più nuova; anomalie della derivazione | Invisibili | Una riga ciascuno in «Ultime azioni» | 2B |
| 12 | Allergeni ed esclusioni | Due archivi, nessuna traccia | Una casa; nella pagina, «Cambiato il 12 nov» | 4A |
| 13 | Memorie (luoghi, porzioni, categorie) | Invisibili | Impostazioni > Dati > «Memorie», con «Dimentica» | 4E |
| 14 | Numeri calcolati e stime | Non si aprono; non si sa da dove vengono | «Da cosa è fatto» | 3E |
| 15 | Consumi fatti dalla cucina o da un pasto abituale | Si vedono come pasto, non dalla dispensa | Storia dell'alimento: «Mangiato a cena (pasta al forno)» | 2B |

### 8.2 Il diario del giorno

È una sola sezione di Oggi, uguale per oggi e per i giorni passati, ordinata per momenti: colazione, pranzo, cena, spuntini. Dentro ogni momento, in ordine di ora: il pasto con le sue voci, le bevande. In coda le righe di riepilogo: acqua, corpo (peso, umore, sintomi, integratori), dispensa (entrate, scarti, spostamenti, correzioni). Ogni riga si tocca.

- **Ondata 1.** La struttura, costruita sui dati che Oggi legge già (`deriveDiary`, `mealsWithPantry`, `drinksByMoment`, `buildJournal`): 5.4.1.
- **Ondata 2.** Ogni riga si tocca e apre il suo foglio di modifica (4.4): «Voce», «Pasto», «Bevanda», «Peso». Si aggiungono la riga «Corpo» e, dentro «Acqua», l'elenco dei bicchieri. Ogni riga porta nel markup l'identificativo del suo evento (`id="voce-<id evento>"`), e `/app?voce=<id>` la mostra e la evidenzia; lo stesso succede dopo un tocco su una bevanda in «Adesso» (a schermo la riga nuova nasceva sotto la piega). Non c'è una funzione `buildDayDiary`: il diario si costruisce già con `deriveDiary`, `mealsWithPantry`, `drinksByMoment` e `buildJournal`, e un secondo modello delle stesse righe sarebbe un doppione da tenere allineato.

Non c'è una linea del tempo unica con i filtri: per chi guarda la giornata, «che cosa ho mangiato a pranzo» conta più dell'ora esatta, e una lista mista di pasti, pesate ed entrate rifarebbe il registro affollato da cui si parte.

### 8.3 La storia di un alimento (ondata 2)

`buildLotStory` in `core/ledger/story.ts` (nuovo, puro, con test) unisce la storia che la derivazione calcola già per ogni lotto ai pasti in cui è stato mangiato (tramite `mealId`) e agli annullamenti. Righe dalla più recente: mangiato (quantità, momento, collegamento al pasto), buttato (motivo), spostato (con la nuova scadenza), aperto, corretto (prima e dopo), comprato (data, negozio, prezzo, come è entrato), annullato. Nella scheda è la riga richiusa «Storia», con il riepilogo «Comprato il 12 nov · aperto il 14 · mangiato 2 volte».

---

## 9. Fondamenta tecniche

Solo ciò che serve all'esperienza. Sei cose non devono rompersi mai:

- **registro:** solo in aggiunta; ogni correzione è un evento nuovo;
- **due telefoni:** l'unione per identificativo resta la stessa;
- **copia e ripristino:** come oggi;
- **allergeni:** il controllo non diventa mai più permissivo né meno visibile;
- **senza rete:** tutto funziona;
- **temi:** i cinque temi restano identici; `themes.test.ts` e `vivoScope.test.ts` restano verdi.

### 9.1 Lettura condivisa dei dati (ondata 3, da sola)

**Oggi.** Ogni gancio di `src/data/hooks.ts` apre la sua osservazione, che rilegge e riordina tutto il registro (`getAllEvents`). `usePantry` è chiamato in 35 punti, `useEventLog` in 21, `useDiary` in 15. `NotificationRunner` legge quattro famiglie a ogni pagina, anche con gli avvisi spenti. Con pochi eventi non si sente; con migliaia sì.

**Dopo.** Un solo modulo, `src/data/shared.ts`, tiene un'unica osservazione del registro (`liveEvents`), con il conto di chi la usa. A ogni emissione nasce un nuovo elenco di eventi: le derivazioni (dispensa, diario, piano, ricette, preparazioni) si calcolano una volta per elenco, alla prima richiesta, e restano in memoria finché l'elenco è quello. I ganci mantengono nome e forma: nessuna schermata cambia.

**Perché così.** La «versione» non è un conteggio: l'unione di due telefoni può sostituire il contenuto di un evento senza cambiare né il numero né l'ultimo identificativo (0.3). L'osservazione di Dexie emette a ogni scrittura della tabella, comprese `importEvents`, il ripristino e le scritture di un'altra scheda del browser.

**Perché da sola.** Non cambia nessuna firma, ma cambia i tempi con cui i dati arrivano a ogni schermata: se parte insieme ai compiti sulle schermate, un difetto non si sa a chi attribuirlo. Parte per prima nell'ondata 3, senza altro in corso, e si chiude con la lista di controlli a schermo delle ondate 1 e 2.

**Verifica.** Test: una derivazione per emissione; dopo `appendEvents`, `importEvents` (anche con sostituzione di un evento esistente) e ripristino, i ganci danno lo stato nuovo. Le derivazioni condivise sono congelate in sviluppo, così una schermata che le modifica per sbaglio si vede subito. Misura a schermo del tempo di apertura di Oggi con 5.000 eventi, prima e dopo.

### 9.2 Stato che sopravvive al tasto indietro e alla chiusura

- **Fogli:** 4.1.
- **Cucina (ondata 4):** `recipes/cookSession.ts` salva ricetta, passo, porzioni e timer (istante di partenza e durata) nelle impostazioni locali. Oggi mostra «Stai cucinando: riprendi».
- **Bozze (ondata 3):** revisione dello scontrino, lettura continua, giro in negozio. Una bozza si propone («Hai una spesa a metà · Riprendi · Scarta»), non si apre da sola; si cancella al salvataggio, con «Scarta», o dopo sette giorni. Nulla di una bozza entra nel registro prima della conferma.

### 9.3 Il pasto fuori casa (ondata 2)

Un evento `meal` con una voce «Fuori casa · normale», certezza `estimated`; la voce (`MealItem`) porta un campo facoltativo nuovo, `energyKcal` (numero tra 0 e 5.000). Nessun nuovo tipo di evento. La stima è la media personale dei pasti registrati in quel momento negli ultimi 30 giorni, per 0,6 (leggero), 1 (normale) o 1,5 (abbondante); con meno di cinque pasti si usa un valore di riferimento scritto in `core/nutrition/FONTI.md` (una quota di 2.000 kcal al giorno per momento: la ripartizione è una scelta del progetto, e lì va detto), e la riga dice «stima generica». La stima dà solo l'energia: per gli altri nutrienti la voce è «senza dato», con il meccanismo che c'è già per le voci non riconosciute, così la schermata Nutrizione dice «almeno». Il giorno conta come «completo, con stime». Il numero scritto non si ricalcola quando la media cambia. È un conto, non un parere.

Da verificare prima di scrivere il codice, con un test: che un telefono con la versione vecchia accetti l'evento con il campo in più nella voce (`core/diary/validate.ts`, `core/diary/foreign.ts`) e lo legga come un pasto con una voce senza valori. Se lo rifiuta, il compito si ferma e lo riporta: il formato va scelto di nuovo prima di scrivere altro.

### 9.4 Allergeni: una casa sola (ondata 4, per prima e da sola)

Un solo archivio in `features/allergens.ts`. Alla prima apertura unisce i due archivi di oggi, prendendo per ogni voce la scelta più severa: è un'unione, mai una scelta tra i due. I vecchi archivi restano in lettura per una versione. Test con i tre casi (solo nel primo, solo nel secondo, in entrambi con valori diversi). Revisione indipendente obbligatoria. Nessuna schermata dice «compatibile».

### 9.5 Scorciatoie dell'icona e incolla (ondata 5)

Il manifest (`src/app/manifest.ts`) riceve `shortcuts`: «Registra un pasto» (`/app/pasto`), «Leggi un codice» (`/app/cattura/codice`), «Lista della spesa» (`/app/spesa`), «Aggiungi» (`/app?aggiungi=1`). Le pagine sono già nella cache del service worker. Su iPhone il campo del «+» riconosce un indirizzo incollato; gli appunti non si leggono mai senza un gesto dell'utente.

---

## 10. Piano di realizzazione a ondate

### 10.1 Regole per tutte le ondate

- **File in esclusiva.** Ogni compito ha i suoi file. Due compiti che girano insieme non toccano mai lo stesso file. Gli altri file si importano, non si modificano; i nomi e le firme che un altro compito importa non cambiano (ogni mandato li elenca).
- **I pezzi comuni vengono prima.** Un pezzo usato da più schermate si consegna e si verifica prima che le schermate partano. Nessun accordo «sulle firme» tra compiti paralleli: chi esegue non può importare ciò che non esiste. Chi, in un'ondata successiva, aggiunge un pezzo a `src/features/common/` lo importa dal suo file e non tocca `common/index.ts`: lo aggiorna il passo di integrazione.
- **File comuni con un solo responsabile.** `public/sw.js`, `src/app/manifest.ts`, `src/features/INTEGRAZIONE.md`, `src/features/vivoScope.test.ts` si toccano solo nel passo di integrazione, alla fine di ogni ondata. Le pagine in `src/app/app/` restano involucri: le tocca solo il compito che possiede la schermata, per aggiungere `<Suspense>` o una pagina nuova, e lo dichiara.
- **Chi esegue non vede l'app.** Verifica con i tipi, il lint e i test. Tutto ciò che si giudica solo a schermo (altezze, stacco, tasto indietro, tastiera) lo verifica chi integra, con la lista dell'ondata.
- **Test.** I test automatici sono su funzioni pure (Vitest gira in ambiente `node`): ogni scelta che scrive eventi o cambia un testo calcolato sta in una funzione pura con il suo test.
- **Revisione indipendente** per i compiti critici: chi non ha scritto il codice controlla quelli che scrivono eventi, toccano allergeni o cambiano conti.
- **Un'ondata alla volta.** Ogni ondata si pubblica da sola e non lascia schermate a metà. I mandati di un'ondata si scrivono dopo la verifica a schermo della precedente.
- **Difficoltà.** *Meccanico*: sostituzioni e spostamenti. *Ben specificato*: una schermata o un modulo con regole chiare. *Difficile*: più file, comportamento che non si può provare senza schermo, molti casi. *Critico*: scrive eventi, tocca allergeni o conti.

### 10.2 Ondata 1: ordine nelle schermate di ogni giorno

**Che cosa sente l'utente.** Oggi è corta e dice che cosa fare adesso; acqua, caffè e tè a un tocco. La scheda di un alimento ha un pulsante. Si corregge quanto ne resta. In Dispensa si cerca. Dal codice a barre si aggiunge senza scorrere. Il tasto indietro chiude le schede. Le cose si distinguono.

**Ordine.** Prima 1A, da solo. Poi 1B, 1C, 1D, 1E, 1F insieme. Poi l'integrazione.

| Compito | Che cosa consegna | File in esclusiva | Difficoltà | Revisione |
|---|---|---|---|---|
| **1A** Pezzi comuni e stacco | Foglio unico con il tasto indietro, riga richiusa, «Altro», selettore di quantità, barra fissa; le tre distanze; i due difetti a schermo (categorie in inglese, pulsante grigio) | `src/features/common/` (nuovo), `src/design/tokens.css`, `src/features/ui.module.css`, `src/features/notice.module.css`, `src/features/plan/Sheet.tsx`, `src/features/plan/sheet.module.css`, `src/features/shopping/priceText.ts` e il suo test | Difficile | No; verifica a schermo obbligatoria prima di far partire gli altri |
| **1B** Scheda dell'alimento | 5.4.2 | In `src/features/pantry/`: `LotSheet.tsx`, `LotActions.tsx`, `LotSheet.module.css`, `LotNutrition.tsx`, `EatenPanel.tsx`, `SaveExpiring.tsx`, `saveActions.ts`, più i nuovi `correctQuantity.ts`, `quantityOptions.ts`, `usePortions.ts`; `src/features/portions.ts` (nuovo); `src/app/app/dispensa/frigo/Fridge.tsx` | Critico | Sì (scrive correzioni) |
| **1C** Oggi | 5.4.1 | `src/features/today/` (tutto), `src/features/meals.ts` e i suoi tre test, `src/features/journal.ts` e il suo test, `src/features/nutrition/TodayNutrition.tsx` | Difficile | No |
| **1D** Scheda del codice a barre | 5.4.4 | `src/features/barcode/` (tutto) | Difficile | Sì (allergeni e codici del negozio: nessun avviso meno visibile) |
| **1E** Aggiungi a mano | 5.4.5 | `src/features/capture/` (tutto), `src/features/memory/` (nuovo, con test) | Difficile | No |
| **1F** Dispensa | 5.4.3 | In `src/features/pantry/`: `Pantry.tsx`, `Pantry.module.css`, `SelectionBar.tsx`, `rows.tsx`, `groups.ts`, più il nuovo `filter.ts`; `src/app/app/dispensa/page.tsx` | Ben specificato | No |
| **Integrazione 1** | Mappa aggiornata, classi di Vivo dichiarate nel test, versione della cache, titolo della pagina di aggiunta, controlli completi, verifica a schermo | `src/features/INTEGRAZIONE.md`, `src/features/vivoScope.test.ts`, `public/sw.js`, `src/app/app/cattura/page.tsx`, `src/design/VIVO.md` | Meccanico | — |

**Criteri verificabili senza schermo** (uguali per tutti): `tsc --noEmit`, `eslint` sulle cartelle toccate e `vitest run` verdi, compresi `themes.test.ts` e `vivoScope.test.ts`; ogni funzione pura nuova ha il suo test; nessun file fuori dall'elenco è stato modificato; nei file posseduti non restano i testi che il glossario toglie.

**Confini tra i compiti paralleli.** 1B e 1F lavorano nella stessa cartella su file diversi: la Dispensa (1F) monta la scheda (1B) con le proprietà di oggi, che non cambiano. 1C importa da `pantry/` (`groups.ts`, `rows.tsx`, `SaveExpiring.tsx`, `eaten.ts`): 1B e 1F non ne cambiano nomi né firme. 1D importa da `capture/` (`PackControls.tsx`, `saveCapture.ts`, `localProduct.ts`) e 1E da `barcode/` (`directAdd.ts`): nessuno dei due cambia ciò che l'altro importa. `features/actions.ts`, `features/lots.ts`, `features/labels.ts`, `features/drinks.ts`, `features/health/` e tutto `src/core/` non si toccano in questa ondata.

### 10.3 Verifica a schermo dell'ondata 1

A 375×812, in Vivo scuro e in Registro chiaro, con i dati di prova.

1. **Oggi.** Senza scorrere si vedono «Adesso» con il pulsante e le quattro pastiglie, «Da guardare» se c'è, l'inizio del diario. La pagina è alta meno di due schermate. Tocco su «Tè»: il conto cambia e la riga compare nel diario senza scorrere. Lo stato non dice mai «niente registrato» con qualcosa di segnato. Alle 12 si può dire «Saltato» per il pranzo.
2. **Scheda di un alimento.** All'apertura si vede «Mangiato · …» senza scorrere, per un alimento semplice, per uno in scadenza e per tre confezioni uguali. Un solo pulsante pieno. Nessuna quantità «tutta» già scelta. «Aggiungi alla spesa» chiude la scheda e l'avviso si vede. «Correggi» a 250 g su un alimento da 400 g lascia 250 g e non crea un consumo.
3. **Tasto indietro.** Con la scheda aperta, indietro la chiude e la pagina resta; un secondo indietro lascia la pagina. Lo stesso per «Altro» della Dispensa e per i fogli del piano. Dopo una ricarica nessun foglio si riapre e l'indietro non resta «a vuoto».
4. **Dispensa.** La ricerca filtra mentre si scrive; senza risultati offre «Aggiungi alla spesa». «In scadenza» è in cima con il suo titolo. `/app/dispensa?lotto=<id>` apre la scheda.
5. **Codice a barre** (8003170096165). «Aggiungi alla dispensa» si vede senza scorrere; «Contiene: latte» è sopra il modulo; dopo l'aggiunta si torna al lettore e l'avviso ha «Annulla». Un codice non trovato porta al modulo a mano e, dopo il salvataggio, di nuovo al lettore.
6. **A mano.** Quattro campi in vista e la barra fissa; Invio nel nome passa alla quantità; il luogo cambia con la categoria; la seconda volta lo stesso nome arriva con luogo e categoria proposti.
7. **Stacco.** Nessun blocco senza titolo tra due sezioni. In Vivo le schede di un gruppo distano 8 px e i gruppi 28. Nei quattro temi da registro nessuna differenza oltre lo spazio tra le sezioni.
8. **Su un telefono vero**, Android e iPhone: tasto indietro e scorrimento dal bordo sul foglio; la barra fissa con la tastiera aperta; la fotocamera che riparte dopo un'aggiunta.

### 10.4 Ondata 2: tutto tracciato, tutto si corregge

**Che cosa sente l'utente.** Ogni riga del diario si tocca e si corregge. «Ultime azioni» annulla anche dopo ore. Il «+» aggiunge da qualunque schermata e risponde a «ce l'ho?». Il pranzo si registra in cinque tocchi. Il pasto fuori casa conta.

Il piano è stato rifatto dopo la verifica a schermo dell'ondata 1: i compiti troppo grandi sono stati divisi (nessuno supera due schermate complesse), ed è entrato un mandato di correzioni. I mandati completi, l'ordine, le domande per la revisione e i controlli a schermo stanno nella cartella dei mandati dell'ondata 2 (`ORDINE.md`).

**Ordine.** Passo 1: 2Z, 2Y, 2A insieme. Passo 2: 2B, 2H, 2C, 2D, 2E, 2F insieme. Passo 3: 2G da solo. Poi l'integrazione.

| Mandato | Che cosa consegna | File in esclusiva | Difficoltà | Revisione |
|---|---|---|---|---|
| **2Z** Correzioni dell'ondata 1 | Pulsante che conferma nel piede dei passi della scheda; ritorno al lettore dopo «Aggiungi a mano»; modulo a mano in Vivo; «Spuntino»; avviso con due comandi; testi; «Il solito» per le monoporzioni | In `features/pantry/`: `LotSheet.tsx`, `LotActions.tsx`, `quantityOptions.ts`, `eaten.ts`; `features/capture/Capture.tsx`; in `features/barcode/`: `BarcodeCapture.tsx`, `AddToPantry.tsx`; `features/notice.tsx` e il suo CSS; solo testi in `meals.ts`, `drinks.ts`, `health/Drinks.tsx`, `nutrition/WeekSections.tsx`, `settings/Settings.tsx` | Ben specificato | No; verifica a schermo |
| **2Y** Foglio: indietro dentro un passo | 4.1: `onBack` | `features/common/Sheet.tsx`, `sheetHistory.ts` | Difficile | No; verifica su telefono |
| **2A** Correggere un pasto (funzioni pure) | 4.4: `core/diary/editMeal.ts`, `features/mealEdit.ts` | quei due file, i loro test, `core/diary/index.ts` | Critico | Sì |
| **2B** Oggi: pasti e voci | 4.4: una riga per voce, fogli «Voce» e «Pasto», «Come ieri», momenti passati vuoti in una riga | In `features/today/`: `MealMoments.tsx`, `MealLines.tsx`, `EntrySheet.tsx`, `MealSheet.tsx` (nuovi), `editText.ts` (nuovo) | Difficile | Sì |
| **2H** Oggi: il resto del diario | 8.2: foglio «Bevanda», bicchieri, riga «Corpo», «In scadenza» senza collegamenti, la riga nuova in vista, `?voce=`, niente doppioni in «Da guardare» | Gli altri file di `features/today/`; `features/health/WaterCard.tsx` | Difficile | Sì, breve |
| **2C** Ultime azioni | 4.2 | `features/activity/` (nuovo), `src/app/app/attivita/page.tsx` (nuovo), `features/journal.ts`, un collegamento in `settings/Settings.tsx` | Critico | Sì |
| **2D** Storia dell'alimento | 8.3; `onBack` collegato alla scheda | `core/ledger/story.ts` (nuovo), `core/ledger/index.ts`, `features/pantry/LotSheet.tsx`, `LotHistory.tsx` e `storyText.ts` (nuovi) | Ben specificato | Sì, breve |
| **2E** «+» e ricerca | 3.1-3.3 | `design/components/BottomNav.tsx` e il suo CSS, `features/shell/AppShell.tsx`, `features/shell/AddSheet.tsx` (nuovo), `features/search/` (nuovo) | Difficile | Sì, solo sulle ricette nei risultati |
| **2F** Registra pasto e pasti abituali | 5.4.6 | `features/meal/`, `features/habits/` | Difficile | Sì (quantità che passa da una confezione all'altra) |
| **2G** Fuori casa (dopo 2B e 2F, da solo) | 9.3 | `core/diary/types.ts`, `validate.ts`, `items.ts`, `editMeal.ts`; `core/nutrition/intake.ts`, `outOfHome.ts` (nuovo), `FONTI.md`; `features/meals.ts`; gli ingressi in `today/MealMoments.tsx`, `today/EntrySheet.tsx`, `meal/Meal.tsx` | Critico | Sì, obbligatoria |
| **Integrazione 2** | `/app/attivita` nella cache e nella mappa; classi di Vivo nel test | `public/sw.js`, `INTEGRAZIONE.md`, `vivoScope.test.ts`, `VIVO.md` | Meccanico | — |

Nelle tabelle delle sezioni 6 e 8 le sigle dell'ondata 2 sono quelle della prima stesura: 2A lì vale 2A, 2B e 2H di qui; 2B vale 2C e 2D; 2C vale 2E; 2D vale 2F; 2E vale 2G.

**Uscito dall'ondata 2:** `buildDayDiary`; l'azione in più sull'avviso; l'avviso dopo l'unione di due telefoni; `?aggiungi=1`, l'indirizzo incollato e la dettatura nel «+» (ondata 5); il segno «senza dato» in Registra pasto.

### 10.5 Ondata 3: la spesa entra da sola

**Che cosa sente l'utente.** Tutta la spesa entra leggendo i codici di fila. Lo scontrino lungo si fotografa in più pezzi. In negozio la lista è viva e lo schermo resta acceso. I numeri si aprono e dicono da che cosa sono fatti. Le pagine si aprono subito anche con mesi di dati.

**Ordine.** 3A da solo, con la sua verifica a schermo; poi 3B, 3C, 3D, 3E insieme; poi l'integrazione.

| Compito | Che cosa consegna | File in esclusiva | Difficoltà | Revisione |
|---|---|---|---|---|
| **3A** Lettura condivisa (per prima, da sola) | 9.1 | `src/data/hooks.ts`, `derived.ts`, `pantry.ts`, `diary.ts`, `shared.ts` (nuovo), `features/notifications/NotificationRunner.tsx` | Critico | Sì |
| **3B** Lettura continua dei codici | Fotocamera sempre accesa, una riga per codice, lo stesso codice «×2», «Aggiungi tutti» con un solo «Annulla»; codici «da completare» senza rete; la bozza sopravvive alla chiusura | `features/barcode/`, `features/quality/ShelfScanner.tsx` | Difficile | Sì (codici del negozio, doppioni) |
| **3C** Scontrino e «Più alimenti» | Più foto; aperte solo le righe incerte; «Salva» fisso; «Appena comprati / Già in casa»; memoria per nome (4.9) | `features/ai/`, `features/quick/`, `features/quickAdd.ts` | Difficile | Sì (dati dedotti) |
| **3D** Spesa e negozio | Una pagina con «Sono in negozio»; lista viva; schermo acceso; righe compatte; «Registra acquisti» già compilato; Scorte, costi e prezzi richiusi | `features/shopping/`, `core/shopping/`, `features/common/useWakeLock.ts` (nuovo) | Difficile | No |
| **3E** Nutrizione e «Da cosa è fatto» | 4.7; giorni contati con il motivo; avvertenze dietro «Che cosa significa» | `features/nutrition/`, `core/nutrition/breakdown.ts` (nuovo), `features/common/Breakdown.tsx` (nuovo) | Difficile | Sì (nutrizione) |
| **Integrazione 3** | Rimandi dei vecchi indirizzi della Spesa | `public/sw.js`, `INTEGRAZIONE.md`, pagine `spesa/negozio` e `spesa/scorte` | Meccanico | — |

Dopo aver usato l'ondata 1 si decide se 3B serve davvero o se il lettore che riparte da solo basta (decisione 12.6).

### 10.6 Ondata 4: cucina, piano, salute, impostazioni

**Che cosa sente l'utente.** «Stasera» dice che cosa cucinare e che cosa manca. La cucina non perde il passo né il timer, e alla fine chiede degli avanzi. Salute mostra l'andamento. Le impostazioni dicono come sono impostate. Gli allergeni hanno una casa sola.

**Ordine.** 4A da solo, con la revisione; poi 4B, 4C, 4D, 4E insieme; poi 4F; poi l'integrazione.

| Compito | Che cosa consegna | File in esclusiva | Difficoltà | Revisione |
|---|---|---|---|---|
| **4A** Allergeni: una casa sola (per primo, da solo) | 9.4 | `features/allergens.ts` (nuovo, con test) e, nei file che oggi leggono o scrivono i due archivi, solo la lettura e la scrittura | Critico | Sì, obbligatoria |
| **4B** Piano | «Stasera e domani», «Che cosa manca» con «Aggiungi alla spesa», foglio che resta aperto, settimane passate, Verifica come sezione | `features/plan/` (tranne `Goals.tsx`), `core/plan/missing.ts` (nuovo) | Difficile | No |
| **4C** Ricette e cucina | «Cucina» diretto; stato salvato; timer dal testo; fine con pasto, avanzi e voto; «Metti nel piano»; filtri nell'indirizzo; «Incolla l'indirizzo»; Idee e abbinamenti in una pagina | `features/recipes/`, `features/recipes-video/`, `features/prep/`, `features/taste/`, `features/ai-capture/RecipeIdeas.tsx` | Difficile | Sì (allergeni in cucina; la dispensa si scala solo con la conferma) |
| **4D** Salute | 5.5: «Segna», peso, integratori con la dose; acqua e bevande solo come andamento | `features/health/` | Ben specificato | No |
| **4E** Impostazioni | Righe con lo stato; pagina «Alimentazione» (allergeni, esclusioni, obiettivi, struttura); «Memorie» | `features/settings/`, `features/plan/Goals.tsx`, `src/app/app/impostazioni/alimentazione/page.tsx` (nuova) | Ben specificato | Sì (tocca la schermata degli allergeni) |
| **4F** Oggi: «Stasera» e «Riprendi» (dopo 4B e 4C) | Nel momento del diario «Cucina» e «Che cosa manca»; in «Da guardare» «Stai cucinando: riprendi» | `features/today/` | Ben specificato | No |
| **Integrazione 4** | Pagina nuova e rimandi | `public/sw.js`, `INTEGRAZIONE.md`, pagine `piano/obiettivi`, `piano/verifica`, `ricette/abbinamenti` | Meccanico | — |

### 10.7 Ondata 5: scorciatoie, recupero, primo avvio, ripasso

**Che cosa sente l'utente.** Su Android l'icona offre le quattro azioni più usate. Dopo qualche giorno di pausa l'app aiuta a rimettersi in pari. Il primo avvio è più corto. Le parole sono le stesse ovunque.

**Ordine.** 5A, 5B, 5C insieme; poi i quattro compiti del ripasso insieme; poi l'integrazione.

| Compito | Che cosa consegna | File in esclusiva | Difficoltà | Revisione |
|---|---|---|---|---|
| **5A** Scorciatoie e incolla | 9.5 | `src/app/manifest.ts`, `features/shell/AddSheet.tsx`, `features/recipes/Import.tsx` | Ben specificato | No |
| **5B** Recupero dei giorni | «Mettiamoci in pari»: un giorno alla volta, una scelta già fatta per momento (pasto abituale, come il giorno prima, fuori casa, saltato, non ricordo); nulla tocca la dispensa; tutto è una sola operazione annullabile | `core/diary/catchup.ts` (nuovo), `features/catchup/` (nuovo), `features/today/DayBriefing.tsx` | Difficile | Sì |
| **5C** Primo avvio | Una domanda dopo lo stile (allergie ed esclusioni); «Primi passi» in «Adesso» per la prima settimana; suggerimenti di una riga, una volta | `features/onboarding/`, `features/settings/StyleChoice.tsx`, `src/pwa/InstallHint.tsx`, `features/today/Now.tsx`, `features/common/hints.ts` (nuovo) | Ben specificato | No |
| **5D** Ripasso, in quattro compiti per area | Glossario applicato (compreso «Spuntino»); nessun testo di servizio oltre una riga senza «Che cosa significa»; nessun blocco orfano; selezione multipla con «Sposta» e «Aggiungi alla spesa» | (1) `capture`, `barcode`, `quick`, `ai`, `pantry`, `realign`; (2) `today`, `meal`, `habits`, `health`, `nutrition`, `analysis`; (3) `plan`, `recipes`, `recipes-video`, `prep`, `shopping`, `quality`, `taste`; (4) `shell`, `settings`, `notifications`, `sync`, `assistant`, `onboarding`, più `drinks.ts`, `meals.ts`, `actions.ts` per i soli testi | Meccanico | No |

---

## 11. Che cosa non fare

- Non cambiare colori, caratteri, raggi, ombre, icone (tranne il segno «+» al centro della barra) e non aggiungere temi. Le uniche differenze visibili sono le distanze (5.2).
- Non cancellare né modificare eventi: si aggiunge sempre un evento nuovo. Non scrivere consumi o scarti finti per far tornare una quantità.
- Non aggiungere tipi di evento se basta un campo facoltativo o un evento esistente.
- Non salvare nulla di dedotto (scontrino, foto, memoria, stima, recupero dei giorni) senza mostrarlo prima.
- Non rendere un avviso sugli allergeni meno visibile di oggi. Non usare «compatibile» o «sicuro per te». Nessun consiglio di salute.
- Non mettere un foglio sopra un foglio. Non mostrare un avviso mentre un foglio è aperto.
- Non lasciare un blocco senza titolo tra due sezioni; non mettere un'azione frequente solo in un collegamento di testo.
- Non usare fuori dalle regole di Vivo gli attributi `data-tone`, `data-state`, `data-status`, `data-level`, `data-nutrient`, `data-estimated`.
- Non toccare `momentOffer` (serve al piano), `features/actions.ts` e `src/core/` fuori dai compiti che li possiedono.
- Non affidare una funzione essenziale a ciò che iPhone non ha: scorciatoie dell'icona, condivisione verso l'app, vibrazione, sincronizzazione periodica.
- Non mandare in rete ricerche, memorie o il diario. Non leggere gli appunti senza un gesto dell'utente.
- Non aggiungere tutorial a più schermate, caroselli o animazioni decorative.
- Non aggiungere una pagina senza toglierne un'altra.
- Non toccare lo stesso file da due compiti in parallelo, né `sw.js` fuori dal passo di integrazione.
- Non mettere in `src/core/` codice che usa React, la rete o il disco. Non scrivere il nome dell'app nel codice: si usa `APP_NAME`.

---

## 12. Decisioni che restano al proprietario

| # | Decisione | Proposta | Se non si decide |
|---|---|---|---|
| 1 | Il centro della barra diventa «+» al posto della fotocamera (ondata 2) | Sì: è l'ingresso unico per aggiungere | Si fa |
| 2 | Le sezioni passano da 22 a 28 px in tutti i temi, e in Vivo i campi di un gruppo si avvicinano a 8 px | Sì: è ciò che fa vedere lo stacco | Si fa |
| 3 | Dopo «Mangiato» la scheda dell'alimento si chiude e l'avviso dice dove è finito (oggi resta aperta con un riquadro in fondo) | Sì: una regola sola dopo ogni azione | Si chiude |
| 4 | In Oggi «Da mangiare prima» diventa la riga richiusa «In scadenza» (solo ciò che scade entro tre giorni) | Sì | Si fa |
| 5 | Il pasto fuori casa, stimato, conta nelle medie di Nutrizione (ondata 2) | Sì, segnato come stima | Conta, come stima |
| 6 | La lettura continua dei codici (ondata 3) | Si decide dopo aver usato il lettore che riparte da solo | Si fa |
| 7 | Pressione lunga e scorrimento laterale sulle righe | No per ora: prima le azioni a un tocco; si rivaluta dopo l'ondata 2 | Non si fanno |
| 8 | «Chiedi» esce da Oggi quando c'è la ricerca del «+»; le viste fissate restano | Sì | Si fa |

---

## 13. Idee oltre il mandato

- Scorciatoie sulle righe: pressione lunga per «Altro», scorrimento per «Mangiato · il solito» in Dispensa e «Preso» in Spesa (decisione 12.7).
- Numero sull'icona dell'app con ciò che scade oggi, dove il telefono lo permette.
- Calendario del mese per saltare a un giorno passato, con i giorni registrati segnati.
- «Chiudi la giornata»: la sera, un tocco per ogni momento rimasto vuoto.
- Foto del piatto facoltativa in una riga del diario.
- «Spesa tipo»: una lista salvata da ricaricare con un tocco; «Ricompra» dagli alimenti finiti di recente.
- Unione dei doppioni in dispensa; avviso quando si aggiunge due volte lo stesso prodotto in pochi minuti.
- Storia dei prezzi di un prodotto, con il negozio più conveniente tra quelli usati.
- Avanzi proposti nel piano dei giorni seguenti.
- Lettura della data di scadenza dalla fotocamera durante la lettura continua.
- Lista della spesa inviata come testo a un'altra persona, senza server.
- Scelta della schermata d'avvio.




