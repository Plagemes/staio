# Come si scrive una ricetta

Una ricetta è un oggetto TypeScript (o JSON) di poche righe: tipo `Recipe` in `recipe.ts`. Il generatore ne ricava un modello a incisione; il seme aggiunge piccole variazioni di proporzione e inclinazione. Il validatore (`validateRecipe`) rifiuta refusi, campi sconosciuti e valori fuori limite con messaggi in italiano: usatelo.

## Dove metterla

1. Creare `src/models3d/catalog/<categoria>.ts` che esporta `export const FRUTTA_RECIPES: readonly Recipe[] = [...]`.
2. Aggiungerlo all'elenco `SOURCES` in `catalog/index.ts`.
3. `pnpm exec vitest run src/models3d`: i test controllano id unici, validità e generabilità di tutte le ricette registrate (aggiungere il file alla lista in `catalog.test.ts` se si vuole contarlo a parte).

## Campi comuni

| Campo | Regola |
|---|---|
| `id` | minuscole, cifre, trattini; max 48; unico: `pera-abate` |
| `name` | italiano, max 60 caratteri |
| `category` | `frutta verdura erbe latticini formaggi uova carne pesce pane pasta-riso dispensa conserve bevande surgelati dolci condimenti altro` |
| `archetype` | `lathe box bag elongated leaf cluster wedge` |
| `heightCm` | 0.3–250. Altezza reale dell'oggetto nella posa del modello (coricato = spessore, non lunghezza) |
| `params` | dipende dall'archetipo, vedi sotto |
| `details` | opzionale: `stem`, `leaf`, `cap`, `label` (ammessi solo dove indicato) |
| `hatch` | opzionale: `density` 0.4–2.5 (default 1; più basso per vetro e superfici chiare), `cross` (default true; false = niente secondo tratteggio) |
| `pose` | opzionale: `tiltDeg` −90…90, inclinazione attorno a z. 90 = coricato. Il modello viene poi appoggiato su y = 0 |
| `variation` | opzionale 0–1 (default 1): intensità delle differenze fra semi. 0 per oggetti che devono essere identici |

Unità: ovunque le misure sono **relative all'altezza del corpo principale (= 1)**, salvo diversa indicazione. Il modello finale è normalizzato ad altezza 1. Con `pose` inclinata l'altezza è quella dopo l'inclinazione.

## Dettagli (`details`)

| Dettaglio | Campi | Ammesso in |
|---|---|---|
| `stem` picciolo | `length` 0.02–0.5, `thickness` (raggio) 0.005–0.08, `bend` −1…1 (default 0.4) | lathe, elongated |
| `leaf` foglia | `count` 1–5, `length` 0.1–0.8, `width` 0.15–0.8 (largh./lungh., default 0.45) | lathe, elongated |
| `cap` tappo | `kind` `screw`/`cork`/`lid`, `height` 0.01–0.25 (default 0.05), `radius` 0.02–1.5 (default: raggio dell'imboccatura), `signal`, `offset` [x, z] −1…1 (solo box) | lathe, box |
| `label` fascia | `from` < `to` in 0–1 (frazioni dell'altezza, distanza minima 0.03), `signal` | lathe, box |

`signal: true` disegna quella parte nel colore segnale (rosso): usarlo solo per ciò che deve spiccare.
Foglie e picciolo su `lathe` si attaccano al punto più alto del profilo (l'ultimo punto), quindi con una fossetta in cima (mela) il picciolo parte dal fondo della fossetta.

## lathe: solido di rotazione (frutta, uova, bottiglie, barattoli)

`params`: `profile` (3–40 punti `[raggio, y]` dal basso verso l'alto, raggio 0–4, y −4…4, raggio massimo ≤ 3 volte l'altezza), `smooth` (default true), `segments` (12–96, default 56).
Il profilo viene scalato così che l'altezza sia 1, quindi si possono usare le unità che si vuole. Estremi con raggio 0 chiudono il solido; un estremo con raggio > 0 viene chiuso con un disco.

- `smooth: true`: curva morbida che passa dai punti (frutta, uova, 8–12 punti).
- `smooth: false`: segmenti con spigoli vivi (barattoli, bottiglie, vasetti). Per una spalla arrotondata mettere più punti ravvicinati.

```ts
{ id: "pera", name: "Pera", category: "frutta", archetype: "lathe", heightCm: 10,
  params: { profile: [[0, 0], [0.34, 0.01], [0.62, 0.18], [0.76, 0.5], [0.72, 0.86], [0.54, 1.2], [0.37, 1.5], [0.29, 1.74], [0.2, 1.92], [0, 2]] },
  details: { stem: { length: 0.16, thickness: 0.017, bend: 0.5 }, leaf: { count: 1, length: 0.3, width: 0.4 } } }
```

Frutti ovali coricati (limone, uovo): `pose: { tiltDeg: 65 }`. Bottiglie e barattoli: `smooth: false` + `cap` + `label`, senza `pose` (con tappo o etichetta non si inclinano mai).

## box: confezioni, brick, vaschette

`params`: `size` `[larghezza, altezza, profondità]` (ogni lato 0.05–20, rapporto fra lato più lungo e più corto ≤ 30; contano solo i rapporti), `bevel` 0–0.5 (raggio dello smusso come frazione del lato più corto; 0 = spigoli vivi con linee di spigolo, 0.05–0.2 = confezioni morbide).
`label` è una targhetta sulla faccia frontale (80% della larghezza). `cap.offset` colloca il tappo sul piano superiore.

```ts
{ id: "brick-succo", name: "Brick di succo", category: "bevande", archetype: "box", heightCm: 17,
  params: { size: [7, 17, 5], bevel: 0.1 },
  details: { cap: { kind: "screw", height: 0.04, offset: [0.5, 0.4] }, label: { from: 0.3, to: 0.72 } } }
```

## bag: sacchetto morbido (pasta, riso, farina, snack)

`params`: `size` come in box, `pinch` 0.02–0.3 (saldatura piatta in testa e in fondo, frazione dell'altezza, default 0.08), `wrinkle` 0–1 (pieghe casuali, default 0.3). Nessun dettaglio ammesso.

```ts
{ id: "pacco-pasta", name: "Pacco di pasta", category: "pasta-riso", archetype: "bag", heightCm: 25,
  params: { size: [0.45, 1, 0.16], pinch: 0.06, wrinkle: 0.25 } }
```

## elongated: carota, zucchina, baguette, salame

L'asse va dal basso (t = 0) alla cima (t = 1) e ha lunghezza 1; i raggi sono relativi alla lunghezza.
`params`: `radii` (2–12 coppie `[t, raggio]`, t da 0 a 1 strettamente crescente, raggio 0–0.5, almeno uno > 0), `bend` −1…1 (curva dell'asse, default 0), `ratio` 0.4–1.6 (schiacciamento della sezione, default 1), `wobble` 0–0.3 (irregolarità, default 0.04). Raggio 0 a un estremo = punta; raggio > 0 = estremo chiuso piatto.
Quasi sempre serve `pose.tiltDeg` (60–85) perché l'oggetto stia disteso. `stem` e `leaf` si attaccano alla cima (t = 1).

```ts
{ id: "carota", name: "Carota", category: "verdura", archetype: "elongated", heightCm: 4,
  pose: { tiltDeg: 72 },
  params: { radii: [[0, 0], [0.08, 0.03], [0.5, 0.06], [0.9, 0.075], [1, 0.07]], bend: 0.15 },
  details: { leaf: { count: 4, length: 0.3, width: 0.18 } } }
```

## leaf: cespo o mazzo di foglie (insalata, erbe)

`params`: `layout` (`rosette` = cespo, `bunch` = mazzo di steli con una foglia ciascuno), `count` 3–48, `width` 0.15–1.2 (largh./lungh. della foglia), `spread` 0–1 (apertura; sopra 0.75 il cespo si appiattisce), `curl` −1…1 (negativo = punte che cadono; con rosette i valori efficaci sono circa metà), `frill` 0–1 (bordo ondulato), `stalk` 0–2 (solo bunch: stelo/foglia, default 1). Nessun dettaglio ammesso.

```ts
{ id: "lattuga", name: "Lattuga", category: "verdura", archetype: "leaf", heightCm: 14,
  params: { layout: "rosette", count: 22, width: 0.66, spread: 0.6, curl: -0.45, frill: 0.35 } }
{ id: "prezzemolo", name: "Prezzemolo", category: "erbe", archetype: "leaf", heightCm: 25,
  params: { layout: "bunch", count: 14, width: 0.5, spread: 0.5, curl: 0.1, stalk: 1.2 } }
```

## cluster: grappolo di elementi (uva, pomodorini, olive)

`params`: `layout` (`hanging` = grappolo appeso con gambo, `heap` = mucchietto sul piano, `truss` = rametto con frutti alternati), `count` 3–60, `elementRadius` 0.03–0.4 (relativo all'altezza del grappolo), `elongation` 0.7–1.6 (altezza/larghezza dell'elemento, default 1), `spread` 0.1–1 (larghezza del grappolo, default 0.5), `stalk` 0–0.6 (gambo in cima, default 0.2). Gli elementi si respingono finché si toccano: con `count` alto e `elementRadius` basso il grappolo si allunga. Nessun dettaglio ammesso.

```ts
{ id: "grappolo-uva", name: "Grappolo d'uva", category: "frutta", archetype: "cluster", heightCm: 14,
  params: { layout: "hanging", count: 38, elementRadius: 0.085, elongation: 1.15, spread: 0.7, stalk: 0.18 } }
```

## wedge: fetta, spicchio (formaggio, torta, agrume tagliato)

Settore di cilindro alto 1 con l'apice a un lato. `params`: `radius` 0.3–6 (relativo all'altezza: 2 = alto quanto un quarto del diametro), `angleDeg` 10–180, `bulge` 0–0.25 (rigonfiamento del bordo curvo, default 0.04), `rind` (default true: il bordo curvo è una parte a sé, più fitta, come la crosta). Nessun dettaglio ammesso.

```ts
{ id: "spicchio-parmigiano", name: "Spicchio di parmigiano", category: "formaggi", archetype: "wedge", heightCm: 8,
  params: { radius: 2.2, angleDeg: 38, bulge: 0.06, rind: true } }
```

## Consigli

- Partire da un'ricetta di `catalog/seed.ts` dello stesso archetipo e cambiare i numeri.
- Il tratteggio si orienta sulle coordinate UV: forme tonde e lisce rendono meglio con pochi punti ben scelti; troppi punti ravvicinati in un profilo `smooth` creano ondulazioni.
- Provare la ricetta in `/modelli` (aggiungendola al registro) con più semi: `ModelViewer` accetta `seed`.
- Non servono nomi di app, né testo diverso dall'italiano nei nomi.
