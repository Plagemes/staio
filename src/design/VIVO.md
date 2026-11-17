# Tema Vivo

Chiave `vivo`, nome «Vivo». Colori pieni, ognuno con un significato fisso; superfici piene al posto dei filetti; titoli senza grazie.
Registro resta il predefinito e non cambia: tutte le variabili nuove hanno nel tema di base il valore che prima era scritto a mano
(lo verifica `themes.test.ts`, «variabili nuove: nel tema di base…»).

## Regola dei colori

- Ogni colore dice una cosa sola dentro il suo livello: **area** (cromia dell'interfaccia: barra in basso, accento, pulsanti pieni),
  **dato** (nutrienti, acqua), **stato** (scadenze, stime). Lo stesso tono può tornare in due livelli diversi (fibre e «a posto»
  sono entrambi verdi), mai due volte nello stesso livello.
- Il colore non porta mai da solo l'informazione: c'è sempre il testo, e per gli stati anche la forma (pallino pieno = scaduto,
  anello = in scadenza, nessun segno = a posto, tilde e puntini = stima).
- Ogni colore ha la sua variante `-tint` (fondo tinto). Garanzie, chiaro e scuro (test `themes.test.ts`):
  colore su carta, superficie e sul proprio `-tint` ≥ 4,5; `--color-on-fill` sopra il colore pieno ≥ 4,5;
  `--color-ink` e `--color-graphite` sul `-tint` ≥ 4,5. In chiaro i colori sono scuri e il testo sopra è bianco; in scuro sono chiari e il testo sopra è nero.

## Mappa (nomi esatti delle variabili)

| Significato | Variabile | Fondo tinto | Chiaro | Scuro |
|---|---|---|---|---|
| Area Oggi | `--area-today` | `--area-today-tint` | blu #0062cc | #4ba3ff |
| Area Dispensa | `--area-pantry` | `--area-pantry-tint` | verde acqua #00756b | #3ccbb4 |
| Area Cattura | `--area-capture` | `--area-capture-tint` | indaco #4e4bd0 | #8e8cff |
| Area Piano | `--area-plan` | `--area-plan-tint` | viola #8a3ab9 | #cf8bf3 |
| Area Salute | `--area-health` | `--area-health-tint` | rosa #b8246c | #ff7ab8 |
| Area corrente | `--area-current` | `--area-current-tint` | dall'attributo `data-area` | |
| Proteine | `--nutrient-protein` | `--nutrient-protein-tint` | blu reale #2f55d4 | #7f9dff |
| Carboidrati | `--nutrient-carbs` | `--nutrient-carbs-tint` | ambra #985c00 | #ffc145 |
| Grassi | `--nutrient-fat` | `--nutrient-fat-tint` | lilla #7a45c4 | #b99aff |
| Fibre | `--nutrient-fiber` | `--nutrient-fiber-tint` | verde #1f7a35 | #4fd16b |
| Acqua | `--water` | `--water-tint` | ciano #00718f | #5ccff0 |
| A posto | `--state-ok` | `--state-ok-tint` | verde #1f7a35 | #4fd16b |
| In scadenza | `--state-near` | `--state-near-tint` | arancio #b14a00 | #ff9f43 |
| Scaduto | `--state-expired` | `--state-expired-tint` | rosso #c62828 | #ff6f61 |
| Stima | `--state-estimate` | `--state-estimate-tint` | ardesia #55607a | #a3aec4 |

Neutri nuovi: `--color-fill` (fondo dei segmenti e dei controlli neutri), `--color-raised` (voce rialzata sul fondo), `--color-on-fill`
(testo sopra un colore pieno). Le `--color-*` di sempre esistono anche in Vivo: carta #f2f2f7 / nero #000000, superficie #ffffff / #1c1c1e;
`--color-accent` = Oggi, `--color-signal` = scaduto, `--color-ochre` = in scadenza, `--color-bar-fill` = Dispensa. Il 3D legge queste.

**Negli altri temi** le stesse variabili esistono e valgono: aree = `--color-accent`; nutrienti, acqua, «a posto» = `--color-ink`;
«in scadenza» = `--color-ochre`; «scaduto» = `--color-signal`; «stima» = `--color-graphite`; tutti i `-tint` = `transparent`;
`--color-on-fill` = `--color-on-ink`; `--color-fill` e `--color-raised` = `--color-surface`. Usarle non cambia nulla fuori da Vivo.

## Colore dell'area

La shell mette `data-area="today|pantry|capture|plan|health"` sul contenitore dell'app; ogni voce della barra in basso porta il suo.
Sotto Vivo, un elemento con `data-area` ridefinisce `--area-current(-tint)` e i rimandi che ne dipendono:
`--color-accent`, `--color-focus`, `--button-fill`, `--button-quiet-fill`, `--button-quiet-text`, `--nav-current`.
Così link, pulsanti pieni, anello del focus e barre di avanzamento prendono il colore della sezione senza toccare le schermate.
Chi dichiara una variabile che rimanda a un'altra deve sapere che il rimando si risolve dove è dichiarato: un nuovo rimando
che dipende dall'area va aggiunto alla regola `[data-palette="vivo"] [data-area]` in `themes.css`.

## Variabili di forma (in `tokens.css`, valori di Registro; Vivo le ridefinisce)

- Titoli: `--font-display` (Vivo: Instrument Sans, già caricato), `--weight-display` (400 → 700), `--tracking-title`, `--font-brand` (il marchio resta con grazie).
- Etichette: `--label-font`, `--label-size`, `--label-case`, `--label-tracking`, `--label-color`.
- Titoli di sezione: `--section-font`, `--section-size`, `--section-case`, `--section-tracking`, `--section-color`, `--section-weight`, `--section-rule-width`.
- Schede: `--card-fill`, `--card-fill-hover`, `--card-border`, `--card-shadow`, `--radius-card`.
- Pulsanti: `--button-fill`, `--button-text`, `--button-quiet-fill`, `--button-quiet-border`, `--button-quiet-text`, `--radius-button`.
- Segmenti: `--tabs-gap`, `--tabs-fill`, `--tabs-pad`, `--tabs-radius`, `--tabs-rule-width`, `--tab-grow`, `--tab-pad-x`, `--tab-radius`, `--tab-indicator`, `--tab-selected-fill`, `--tab-selected-shadow`.
- Barra in basso: `--nav-fill`, `--nav-rule-width`, `--nav-backdrop`, `--nav-current`, `--capture-fill`, `--capture-text`.
- Etichette di stato: `--chip-strength`, `--chip-pad-y`, `--chip-pad-x`, `--chip-radius`.
- Cifre in griglia: `--figure-gap`, `--figure-fill`, `--figure-radius`, `--figure-pad-x`, `--figure-follow-pad`, `--figure-divider`, `--figure-grid-rule`.
- Barre: `--bar-height`, `--bar-radius`, `--progress-height`, `--progress-track`.
- Movimento: `--motion-fast`, `--press-transform` (Vivo: leggera pressione 0,97; `none` con riduzione del movimento), `--press-opacity`.
- In Vivo anche `--radius-sm` 10px, `--radius-md` 14px: tutti i campi, le schede e i pulsanti delle schermate si arrotondano già.

Tutte le variabili valgono anche su un contenitore con `data-palette` / `data-theme`: più anteprime di temi diversi convivono nella stessa pagina (`ThemePreview`).

## Seconda tappa: le schermate

Regola: ogni cambiamento sta in regole `:global([data-palette="vivo"]) .classe` dentro i moduli delle schermate, oppure in
markup neutro (attributi `data-*`, classi senza regole fuori da Vivo, `ProgressRing` che negli altri temi è `display: none`).
I `font-weight: 400` scritti accanto a `--font-display` sono diventati `var(--weight-display)` (400 nel tema di base).
`src/features/vivoScope.test.ts` controlla che classi e attributi aggiunti per Vivo abbiano regole solo sotto Vivo.

### Misure comuni (le stesse in tutte le schermate)

| Pezzo | Resa |
|---|---|
| Scheda | `--radius-card` (18 px), margini `--space-7` / `--space-8`, fondo `--color-surface`, `--card-shadow` |
| Elenco raggruppato | `ui.group`: scheda con `padding-inline: --space-8`; le righe tengono il loro separatore, l'ultimo resta fuori |
| Scheda colorata | `ui.tile` + `ui.tone` con `data-tone="today|pantry|capture|plan|health|water|ok|near|expired|estimate"`: fondo `-tint`, accento e pulsanti nel colore |
| Stato di una riga o scheda | striscia a sinistra (4 px nelle righe, 6 px nelle schede) nel colore dello stato; lo stato resta scritto |
| Scelte (`ui.choices`) | segmenti su guida `--color-fill`; scelta fatta `--button-fill` / `--button-text`, in grassetto |
| Campi | i campi di `.screen > .form` e di `ui.fields` sono schede; legenda dentro la scheda; focus con anello `--area-current-tint` |
| Pulsanti secondari pieni | `--color-fill` su carta o superficie, `--color-surface` dentro una scheda tinta |
| Interruttore | `ui.switch`: 51×31, spento con bordo dei controlli, acceso `--button-fill` |

### Fatto

- **Oggi**: data grande in grassetto sotto il marchio (`.dayLabel`), frecce e impostazioni nel colore dell'area; avvisi come
  schede tinte per livello (`data-level`: urgente `--state-expired`, presto `--state-near`, informazione `--area-today`);
  momenti del giorno come schede con striscia per stato (`data-status`: registrato `--state-ok`, non tracciato
  `--state-estimate`, saltato grigio, da fare `--area-today`); proposta abituale come scheda tinta di Oggi; «Da mangiare
  prima» e «Registro di oggi» raggruppati, con la striscia dello stato di scadenza (`data-state`); bevande e acqua in schede
  `--water`, con anello (`ProgressRing`) accanto al numero e barra `tone="water"`; energia in una scheda, macronutrienti con
  il colore del nutriente (`Figure nutrient`).
- **Dispensa**: elenco raggruppato sotto i segmenti con striscia di scadenza; «senza data» come pastiglia neutra; stima con
  bordo tratteggiato nella pastiglia; «Vedi in 3D» (Dispensa), «Controlla con una foto» (Cattura) e «Riallinea» (in
  scadenza) come riquadri colorati con l'azione in pastiglia; foglio del lotto con modello 3D su riquadro chiaro e dati in
  scheda; scena del frigo su una scheda `--color-surface` (`.scene`).
- **Cattura e scheda del codice a barre**: campi in schede, scelte a segmenti, contatori pieni, suggerimenti e scorciatoie a
  pastiglia, intestazione del prodotto e dati in schede, valori per 100 g con il colore dei nutrienti.
- **Salute, Piano, Ricette, Impostazioni**: titoli in grassetto, riquadri di Salute come schede, giorni del piano come schede,
  avvisi del piano tinti «scaduto», esiti nei colori degli stati, elenchi delle ricette e ingredienti raggruppati, passi
  numerati in un tondo colorato, voci delle impostazioni come schede.
- **Comuni**: `.empty`, `.callout`, `.danger`, avviso a comparsa con angoli e ombra delle schede.

### Resta

- Icone colorate nelle voci di menu: le Impostazioni non hanno icone, quindi non ne ho aggiunte (sarebbe markup nuovo).
- Anelli per energia e macronutrienti: non c'è un obiettivo con cui confrontarli (scelta del prodotto), quindi solo cifre
  colorate. Quando esisteranno gli obiettivi del Piano su Oggi, `ProgressRing` / `ProgressLine` hanno già i toni dei nutrienti.
- Non ancora ritoccate: Analisi (grafici con `--nutrient-*` e `--state-*`), spesa, preparazioni, qualità, assistente,
  cattura con IA e scontrino (ereditano titoli, campi, scelte e avvisi comuni), pagina `/modelli`.
- Schermate con moduli dentro una sezione (per esempio la ricerca del Ricettario) non hanno i campi in scheda: la regola vale
  per `.screen > .form` e `ui.fields`.
