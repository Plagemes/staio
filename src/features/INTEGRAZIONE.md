# Dove vive ogni funzione

Regola del proprietario: ogni funzione nasce dove nasce il bisogno, ed è raggiungibile in modo intuitivo, con una mano sola. Questo file dice dove sta ogni pagina e come ci si arriva. Va aggiornato a ogni pagina nuova.

## Regole

1. Una funzione compare dove nasce il bisogno (non solo in una pagina a sé, non solo nell'elenco della sua area).
2. Le Impostazioni servono solo a configurare. Nessuna funzione d'uso quotidiano è raggiungibile solo da lì.
3. Oggi segue l'ordine del bisogno: avvisi, cosa fare adesso (azioni, proposte, pasti del giorno, piano, bevande, acqua), cosa scade, nutrienti, viste fissate e assistente, registro. Una sezione vuota non occupa spazio.
4. Stessa azione, stesso nome ovunque: «Aggiungi alla dispensa», «Aggiungi alla spesa», «Sposta», «Annulla», «Torna a …» per i ritorni.
5. Azioni quotidiane a due tocchi al massimo dalla schermata in cui servono.
6. Nessun vicolo cieco: dopo un salvataggio si vede il risultato o si torna dov'era, con la conferma (avviso con «Annulla»).
7. Una pagina nuova: scrivere qui da dove si raggiunge, e dove porta il ritorno. Se va usata senza rete, aggiungerla anche a `public/sw.js`.

## Mappa delle pagine (`src/app/app/**`)

Barra in basso: Oggi, Dispensa, Cattura, Piano, Salute. Aree: Spesa, Qualità, Ricette, Preparazioni vivono sotto Piano; Impostazioni, Assistente, Pasto e Pasti abituali sotto Oggi.

| Pagina | Da dove si raggiunge | Ritorno |
|---|---|---|
| `/app` Oggi | barra in basso | - |
| `/app/assistente` | Oggi (scheda «Chiedi», sopra il registro; intestazione delle viste fissate) | Torna a Oggi |
| `/app/pasto` Registra pasto | Oggi (pulsante, momenti del giorno), Cattura, Salute, scheda di un lotto («Mangiato in un pasto») | Torna a Oggi; dopo il salvataggio torna a Oggi con avviso |
| `/app/pasto/frase`, `/app/pasto/foto` | dentro Registra pasto («Scrivi o detta», «Foto del piatto») | «Registra a mano»; dopo il salvataggio «Torna a Oggi» |
| `/app/pasti-abituali` | Oggi (link «Pasti abituali» sotto la proposta), Impostazioni > Persona | Torna a Oggi |
| `/app/impostazioni` | ingranaggio in Oggi | Torna a Oggi |
| `/app/impostazioni/profilo`, `aspetto`, `ai`, `video`, `sincronizzazione`, `avvisi` | Impostazioni; profilo anche da Nutrizione e Piano; avvisi anche da Oggi («Avvisi»); ai anche dall'assistente | Torna alle impostazioni |
| `/app/dispensa` | barra in basso | - |
| `/app/dispensa/frigo` (3D) | Dispensa (scheda «Vedi in 3D») | Elenco |
| `/app/dispensa/foto` | Dispensa («Controlla con una foto») | Torna alla dispensa |
| `/app/dispensa/riallinea` | Dispensa (quando ci sono quantità da controllare) | Torna alla dispensa |
| `/app/cattura` | barra in basso | «Vai alla dispensa» |
| `/app/cattura/codice` | Cattura, Qualità (cartella `barcode`, non toccata qui) | - |
| `/app/cattura/scontrino` | Cattura, In negozio («Scontrino») | - |
| `/app/cattura/veloce` | Cattura, Dispensa vuota | Cattura, «Vai alla dispensa» |
| `/app/piano` | barra in basso | - |
| `/app/piano/settimana` | Piano, Oggi (pianificato, «Settimana») | - |
| `/app/piano/obiettivi`, `/app/piano/verifica` | Piano; Verifica e Obiettivi si rimandano tra loro | Torna al piano |
| `/app/spesa` | Piano, Oggi (se ci sono voci), ricetta | Torna al piano |
| `/app/spesa/negozio` | Spesa («Vai in negozio») | Torna alla lista della spesa |
| `/app/spesa/scorte` | Spesa, Piano | Torna alla lista della spesa |
| `/app/qualita` | Spesa, Salute («Qualità dei prodotti») | Torna alla spesa |
| `/app/qualita/scaffale` | Spesa, In negozio, Cattura, Qualità | Torna alla spesa |
| `/app/qualita/prodotti` | Qualità | Torna a Qualità |
| `/app/qualita/prodotto` | scheda di un lotto con codice, lettura del codice, Qualità, Scaffale | link a Qualità |
| `/app/ricette` | Piano, preparazioni, scheda ricetta | - |
| `/app/ricette/vedi`, `nuova`, `importa` | Ricettario | Torna al ricettario |
| `/app/ricette/cucina`, `cucinata` | scheda ricetta («Cucinala ora») | Torna alla ricetta |
| `/app/ricette/idee` | Oggi («Da mangiare prima»), Dispensa («Cosa cucinare»), Ricettario | Torna al ricettario |
| `/app/ricette/abbinamenti` | scheda ricetta («Con cosa sta bene»), scheda di un alimento in dispensa («Con cosa sta bene»), Ricettario | Torna alla ricetta / al ricettario |
| `/app/ricette/condivisa` | condivisione dal telefono (manifest), Importa | Torna al ricettario |
| `/app/preparazioni`, `/nuova` | Piano, Ricettario, scheda ricetta | Torna alle preparazioni |
| `/app/salute` | barra in basso | - |
| `/app/salute/nutrizione`, `analisi`, `esperimenti`, `rapporto` | Salute (riga di pulsanti in cima); nutrizione anche da Oggi («Nutrienti di oggi»); esperimenti e rapporto anche da Analisi | Torna a Salute |

## Scelte fatte

- Oggi: «Da mangiare prima» e i nutrienti sono saliti sopra il registro, che passa in fondo ed è nascosto se vuoto; «Pianificato per oggi» precede «Nel piano, non fatti»; la riga «Scala una bustina da…» resta subito dopo Bevande; gli avvisi restano in cima e dicono «Avvisi», non «Impostazioni».
- Impostazioni raggruppate: Persona (profilo, pasti abituali), Aspetto, Intelligenza artificiale (AI, ricette da video), Dati e dispositivi (dati, sincronizzazione, avvisi, copie, cancellazione).
- Il rimando agli abbinamenti dalla scheda di un alimento passa `?alimento=Nome`: la pagina parte già con quel nome cercato.
- Titolo unico per gli abbinamenti da ricetta e da alimento: «Con cosa sta bene».

## Proposta non applicata

La barra in basso non è stata toccata. Spesa e Qualità vivono sotto Piano: se in uso reale la Spesa risulta troppo nascosta, valutare di darle un posto proprio nella barra al posto di una voce meno usata.
