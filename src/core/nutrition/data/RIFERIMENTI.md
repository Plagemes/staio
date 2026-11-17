# Valori di riferimento per adulti: fonti, riuso, limiti

Dati in `reference.ts`. Consultazione delle fonti: **17 novembre 2026**.

Tutti i valori vengono dall'EFSA (Autorità europea per la sicurezza alimentare). Nessun numero è stato scritto a memoria: ogni valore è stato letto nei documenti elencati sotto. Un valore non verificabile non è stato inserito.

## Fonti consultate

1. **DRV Finder**, strumento ufficiale EFSA: <https://multimedia.efsa.europa.eu/drvs/index.htm>. L'applicazione carica i propri dati da un file pubblico (`https://multimedia.efsa.europa.eu/drvs/assets/data/languages/en/data.json`, 578 righe); i valori degli adulti (dai 18 anni) sono stati letti da lì. È la fonte principale e la più aggiornata: contiene anche i valori successivi al 2017 (sodio, cloruro, aggiornamenti dei livelli massimi).
2. **Dietary Reference Values for nutrients, Summary report**, EFSA supporting publication 2017:e15121, doi:10.2903/sp.efsa.2017.e15121, approvato il 4 dicembre 2017: <https://www.efsa.europa.eu:443/sites/default/files/2017_09_DRVs_summary_report.pdf>. Usato per confrontare i valori del Finder (carboidrati, fibre, grassi, proteine, acqua, minerali e vitamine) e per le spiegazioni. Non contiene sodio e cloruro (pubblicati nel 2019) né i livelli massimi tollerabili.
3. **Overview on Tolerable Upper Intake Levels as derived by the SCF and the EFSA NDA Panel**, versione 11 (agosto 2025): <https://www.efsa.europa.eu/sites/default/files/2024-05/ul-summary-report.pdf>. Fonte dei livelli massimi tollerabili (UL) e dei livelli sicuri di assunzione; ogni UL inserito coincide con quello del Finder.
4. **Pareri scientifici EFSA** indicati dal Finder per ciascun nutriente (EFSA Journal, indirizzi `onlinelibrary.wiley.com/doi/10.2903/j.efsa.*`). Sono usati come indirizzo preciso di ogni valore PRI, AI e RI; i titoli sono quelli dell'elenco bibliografico del rapporto 2017, tranne il parere sul sodio (titolo ricavato dal risultato di ricerca EFSA) e il parere sugli zuccheri 2022 (titolo dall'elenco del documento 3). I siti Wiley non sono stati aperti direttamente (risposta 403 ai programmi automatici): il loro contenuto non è stato riletto, ci si è basati sul Finder e sui documenti 2 e 3.

Ogni voce di `reference.ts` ha `source` con ente, documento (strumento più parere di riferimento, oppure documento UL con numero di tabella) e indirizzo.

## Condizioni di riuso trovate

- Rapporto 2017 (documento 2): «Reproduction is authorised provided the source is acknowledged.» (© European Food Safety Authority, 2017).
- Panoramica UL (documento 3): stessa formula, © European Food Safety Authority, 2025.
- Avviso legale del sito EFSA (<https://www.efsa.europa.eu/en/legalnotice>): «Re-use is authorised, provided that EFSA is acknowledged as the source of the material.» Singoli documenti possono avere avvisi propri con condizioni specifiche; il materiale di terzi resta soggetto ai diritti dei titolari; il logo EFSA non si può usare senza permesso scritto. L'avviso non tratta l'uso commerciale.
- DRV Finder: nel codice dell'applicazione compare solo «Copyright @2025 EFSA»; non ho trovato per lo strumento un avviso di riuso separato. Si applica per analogia l'avviso generale, ma non è una condizione scritta per lo strumento.
- Conseguenza pratica: citare l'EFSA come fonte (lo fa il campo `source`), non usare il logo, non far credere che l'EFSA approvi l'app. Un avviso di fonte visibile nell'interfaccia resta da decidere.

## Cosa contiene `reference.ts`

55 voci per adulti, dai 18 anni. Tipo e numero: 24 PRI, 15 AI, 14 UL, 2 RI. Non tutte hanno un importo: vedi sotto.

- **Con importo numerico**: 21 PRI, 14 AI, 7 UL (calcio, iodio, selenio, zinco, vitamine B6, D, E) e i 2 intervalli RI (carboidrati 45-60% dell'energia, grassi totali 20-35% dell'energia).
- **Senza importo (`amount` assente), con spiegazione in `note`**:
  - proteine, PRI 0,83 g per kg di peso corporeo al giorno (non convertito: servirebbe un peso);
  - tiamina, PRI 0,1 mg per MJ, e niacina, PRI 1,6 mg NE per MJ (non convertiti: servirebbe l'energia);
  - grassi saturi e zuccheri: nessun UL, EFSA raccomanda l'assunzione più bassa possibile; nessuna soglia numerica;
  - sale: vedi punto sotto;
  - UL di ferro, magnesio, folato, vitamina A e niacina: valgono solo per una forma o una fonte, vedi sotto.
- **Conversioni dichiarate**: l'acqua da litri a grammi (1 L = 1000 g, densità 1 g/mL assunta); vitamina A in µg RE, folato in µg DFE, vitamina D in µg VDE, vitamina E come alfa-tocoferolo (unità come nel Finder, spiegate nella nota).

## Punti in cui la fonte è ambigua o non si lascia rappresentare con i tipi di `types.ts`

- **Sale e sodio**: EFSA fissa per il sodio una «assunzione sicura e adeguata» di 2 g/giorno (parere 2019), che non è né un PRI, né un AI, né un UL. Nelle fonti consultate non c'è il fattore sodio-sale, quindi non ho calcolato i grammi di sale. La voce `saltG` ha `kind: "AI"` (il Finder la paragona alla definizione di AI) senza importo, con il valore e le cautele EFSA in nota. Chi la usa non deve trattarla come un limite sul sale.
- **Livelli massimi (UL) ridotti a nota**: l'app li confronterebbe con l'assunzione totale dalla dieta, ma valgono solo per una forma o una fonte. Il numero e la condizione stanno in nota, `amount` è assente.
  - Magnesio, 250 mg/giorno: solo sali facilmente dissociabili in integratori, acqua o aggiunti agli alimenti, non il magnesio degli alimenti; è inferiore all'AI (300-350).
  - Folato, 1000 µg/giorno: solo acido folico e sali del 5-metiltetraidrofolato aggiunti o in integratori.
  - Vitamina A, 3000 µg RE/giorno: solo vitamina A preformata (retinolo ed esteri), non i carotenoidi, che l'app somma in RE.
  - Niacina, nicotinamide 900 mg/giorno e acido nicotinico libero 10 mg/giorno: forme libere, non la niacina legata degli alimenti (il parere SCF nota che il rossore non è stato riportato per le forme legate; la nicotinamide è la forma di integratori e arricchimenti). Una sola voce con entrambi i valori. Ambito riletto nel testo del parere SCF raccolto in EFSA, 2006, *Tolerable Upper Intake Levels for Vitamins and Minerals*: <https://www.efsa.europa.eu/sites/default/files/efsa_rep/blobserver_assets/ndatolerableuil.pdf>.
- **Livelli massimi che restano con importo**, perché la fonte li riferisce all'assunzione totale da tutte le fonti: calcio (2500 mg: «from all sources», SCF/EFSA 2006), iodio (600 µg) e zinco (25 mg: confrontati con l'assunzione totale da alimenti e integratori, 2006), vitamina E (300 mg alfa-tocoferolo: confronto con assunzioni da alimenti e integratori, 2006), selenio (255 µg: il parere 2023 cita anche le noci del Brasile tra le fonti che possono superarlo) e vitamina B6 (12 mg, tutte le forme). Per la vitamina D (100 µg VDE) il Finder indica D2, D3 e calcidiolo (fino a 10 µg da integratori) come forme comprese: la nota del Finder non limita il valore a una fonte, quindi lo tratto come riferito all'assunzione totale di vitamina D. Per selenio e B6 il testo dei pareri 2023 non è stato letto per intero (siti Wiley bloccati): ho letto solo i riassunti riportati da repertori (DOAJ, HAL, PubMed) e le note del Finder, senza restrizione di forma o fonte.
- **Ferro**: per gli adulti EFSA non fissa un UL; indica un livello sicuro di assunzione di 40 mg/giorno (parere 2024), riportato solo in nota (superarlo non implica un rischio certo).
- **Ferro nelle donne**: EFSA distingue premenopausa (PRI 16 mg) e postmenopausa (PRI 11 mg) per stato mestruale, non per età. Il Finder mostra due righe con fasce 18-59 e dai 40 anni, sovrapposte. Ho inserito le due voci con `variant` e senza limite superiore di età inventato. Il confronto con il profilo non può sceglierle: serve un'informazione sullo stato mestruale che il profilo non ha.
- **Zinco**: EFSA dà quattro PRI per adulti secondo il livello di fitati nella dieta (LPI 300, 600, 900, 1200 mg/giorno), nessuno preferito. Ho inserito tutti e quattro (voci con `variant`, 8 PRI in totale tra uomini e donne); lo UL (25 mg/giorno) è unico.
- **Vitamina E, UL 300 mg**: l'EFSA segnala che la revisione è in corso.
- **Voci con più valori per lo stesso profilo** (zinco, ferro nelle donne): chi legge `REFERENCE_VALUES` deve usare `variant` (esposto dal tipo `ReferenceEntry`) o la nota; `ReferenceValue` da solo non li distingue.

## Nutrienti di `NutrientKey` senza valore in `reference.ts`

- `energyKcal`: EFSA dà il fabbisogno medio (AR) in MJ/giorno per sesso, età e livello di attività fisica; `ReferenceKind` non ha il tipo AR.
- `monounsaturatedFatG`, `polyunsaturatedFatG`: EFSA non ha fissato valori di riferimento (rapporto 2017, sezione grassi).
- `omega3G`: EFSA dà AI per l'acido alfa-linolenico (0,5% dell'energia) e per EPA+DHA (250 mg/giorno), non per gli omega-3 totali; far corrispondere i due a una sola chiave sarebbe un'interpretazione.
- `cholesterolMg`: EFSA ha deciso di non proporre un valore di riferimento per il colesterolo (rapporto 2017).
- `alcoholG`, `caffeineMg`: nessun valore dietetico di riferimento EFSA trovato nelle fonti consultate; non inseriti.
- Sale in grammi: vedi sopra.

Valori EFSA per adulti che esistono ma non hanno una chiave in `NutrientKey`, quindi non inclusi: cloruro, rame, fluoruro, manganese, molibdeno, biotina, colina, acido pantotenico, acido linoleico, acido alfa-linolenico, EPA+DHA, acidi grassi trans, cromo (per il cromo EFSA non ha fissato valori).

## Livelli massimi: nutrienti per cui EFSA non ha fissato un UL

Proteine, grassi totali, carboidrati, fibre, grassi saturi, zuccheri, vitamine B1, B2, B12, C, K, biotina, acido pantotenico, potassio, fosforo, sodio, cloruro (per ferro, manganese, fluoruro esistono solo livelli sicuri). Non sono voci nei dati, tranne grassi saturi e zuccheri che richiedono la raccomandazione qualitativa.

## Limiti

- Solo adulti dai 18 anni. **Esclusi**: gravidanza, allattamento, infanti, bambini e adolescenti (età sotto i 18 anni). Per gli adulti dai 75 anni il Finder non distingue nulla in più.
- Valori di riferimento per popolazioni sane, non per singoli o per condizioni mediche; l'app confronta assunzioni con riferimenti e non dà pareri medici.
- Nessun AR (fabbisogno medio) incluso, perché `ReferenceKind` non lo prevede.
- I valori possono essere rivisti dall'EFSA (revisione degli UL della vitamina E in corso; fluoruro rivisto nel 2025). Rileggere il Finder e la panoramica UL prima di aggiornare i dati, mai a memoria.
- Verifica incrociata: i valori PRI, AI e RI del Finder sono stati confrontati con le tabelle e il testo del rapporto 2017 (identici, vitamine e minerali in particolare); gli UL con la panoramica UL (identici). Fanno eccezione sodio e cloruro, assenti dal rapporto 2017 e letti solo nel Finder. Le tabelle del PDF sono state lette come testo estratto, non come immagine.
