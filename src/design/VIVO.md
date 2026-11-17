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

## Seconda tappa: schermate da ritoccare (in ordine di resa)

1. **`features/ui.module.css`** (comune a tutte): `.title` e `.emptyTitle` con `font-weight: var(--weight-display)`; `.callout` e `.empty`
   come scheda (`--card-fill`, `--radius-card`, senza filetto); `.input` con fondo `--color-fill` e bordo solo al focus; `.choice` scelta
   piena con `--button-fill` / `--button-text` invece dell'inchiostro; `.dangerSolid` con `--color-on-fill`. Da solo cambia metà dell'app.
2. **Oggi** (`features/today`): anelli di avanzamento per energia e macronutrienti nei colori `--nutrient-*`, acqua `--water`,
   riepilogo in una scheda `--area-today-tint`; scadenze vicine come schede con etichetta di stato.
3. **Salute** (`features/health`, `features/nutrition`): una scheda a colori per nutriente (fondo `-tint`, cifra grande nel colore,
   barra piena), confronto con il riferimento come barra a due toni; titoli di sezione grandi.
4. **Dispensa** (`features/pantry`): righe raggruppate in schede con separatori interni (elenco raggruppato), barra di livello piena,
   foglio del lotto con titolo grande e azioni come pulsanti pieni.
5. **Cattura** (`features/capture`, `ai-capture`, `barcode`): pulsanti grandi nel colore Cattura, mirino e conferma con colore d'area,
   valori letti dall'etichetta con i colori dei nutrienti.
6. **Piano, spesa, ricette, preparazioni** (`features/plan`, `recipes`, `prep`, `quality`): giorni come selettore a segmenti,
   pasti in schede `--area-plan-tint`, macro per pasto con `--nutrient-*`, elementi della spesa spuntati con conferma breve.
7. **Analisi** (`features/analysis`): grafici con `--nutrient-*` e `--state-*` al posto dell'inchiostro, legenda sempre scritta.
8. **Avvisi** (`features/notice.module.css`): avviso fisso su `--color-raised` con ombra, invece della striscia d'inchiostro.

Cosa non si ottiene senza toccare le schermate: titoli pieni (il peso 400 è scritto nei moduli), elenchi raggruppati in schede,
campi pieni, scelte piene a colori (oggi sono nere: usano `--color-ink` come fondo), anelli e schede a colori dei nutrienti.
