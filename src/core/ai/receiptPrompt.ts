// Richiesta per la lettura di uno scontrino italiano da una o più foto. La risposta deve essere solo JSON.
import type { FoodCategory } from "@/core/expiry";
import type { AiImage, AiRequest } from "./types";

/**
 * Una riga di aiuto per ogni categoria del motore delle scadenze. Il tipo `Record` obbliga a tenerlo
 * allineato all'elenco delle categorie: se ne aggiungono una, non compila finché manca qui.
 */
export const CATEGORY_HINTS: Record<FoodCategory, string> = {
  red_meat_fresh: "carne rossa fresca (manzo, vitello, maiale, agnello)",
  ground_meat: "carne macinata, hamburger, salsicce fresche",
  poultry: "pollo, tacchino, coniglio e altri volatili freschi",
  fish_fresh: "pesce e frutti di mare freschi",
  cold_cuts_sliced: "affettati e salumi a fette o in vaschetta (prosciutto, mortadella, bresaola)",
  cured_meat_whole: "salumi interi o a pezzo (salame, guanciale, speck intero)",
  milk_fresh: "latte fresco, panna fresca",
  milk_uht: "latte a lunga conservazione (UHT)",
  yogurt: "yogurt, kefir",
  cheese_fresh: "formaggi freschi (mozzarella, ricotta, stracchino, mascarpone)",
  cheese_aged: "formaggi stagionati o a pasta dura (grana, pecorino, provolone)",
  butter: "burro",
  eggs: "uova",
  leafy_vegetables: "verdure a foglia, insalate, erbe aromatiche fresche",
  root_vegetables: "radici e tuberi (patate, carote, cipolle, aglio)",
  other_vegetables: "altre verdure (zucchine, pomodori, peperoni, funghi)",
  fruit_fresh: "frutta fresca (mele, pere, banane, uva)",
  berries: "frutti di bosco (fragole, mirtilli, lamponi)",
  citrus: "agrumi (arance, limoni, mandarini)",
  bread_fresh: "pane fresco, panini, focaccia",
  bread_packaged: "pane confezionato, pancarré, piadine",
  pasta_fresh: "pasta fresca e ripiena (tortellini, gnocchi)",
  pasta_dry: "pasta secca",
  rice_cereals: "riso, cereali, farina, farro, polenta",
  legumes_dry: "legumi secchi",
  canned_closed: "conserve chiuse in scatola o vasetto (pelati, tonno, legumi in scatola)",
  sauces_preserves_opened: "sughi pronti e pesto freschi o da consumare dopo l'apertura",
  leftovers_cooked: "avanzi e piatti cucinati",
  ready_meals: "piatti pronti, pizza, gastronomia",
  frozen_foods: "surgelati e gelati",
  beverages: "bevande (acqua, vino, birra, bibite, succhi chiusi)",
  juices_opened: "succhi freschi o da consumare dopo l'apertura",
  condiments_sauces: "condimenti e salse (olio, aceto, maionese, zucchero, miele, marmellata)",
  pastries_fresh: "dolci freschi (cornetti, torte, pasticcini)",
  snacks_dry: "biscotti, snack, cioccolato, frutta secca",
};

/** Le chiavi ammesse per `category`, nell'ordine dell'elenco di aiuto. */
export const RECEIPT_CATEGORY_KEYS = Object.keys(CATEGORY_HINTS) as FoodCategory[];

export const RECEIPT_UNITS = ["g", "kg", "ml", "cl", "l", "pz"] as const;

export const DEFAULT_RECEIPT_MAX_TOKENS = 8000;

export interface ReceiptRequestOptions {
  images: readonly AiImage[];
  /** Data di oggi `YYYY-MM-DD`: serve se lo scontrino scrive la data senza l'anno. */
  today?: string;
  maxOutputTokens?: number;
}

export function receiptInstructions(): string {
  const categories = RECEIPT_CATEGORY_KEYS.map((key) => `- ${key}: ${CATEGORY_HINTS[key]}`).join("\n");
  return `Leggi lo scontrino della spesa mostrato nella foto. È uno scontrino italiano: importi in euro con la virgola, abbreviazioni da cassa, prodotti a peso.

Rispondi SOLO con un oggetto JSON, senza testo prima o dopo, senza markdown, senza commenti. Forma:
{
  "store": testo o null,
  "chain": testo o null,
  "date": "AAAA-MM-GG" o null,
  "lines": [
    {
      "raw": testo,
      "name": testo,
      "kind": "item" oppure "discount",
      "quantity": numero o null,
      "unit": "g" | "kg" | "ml" | "cl" | "l" | "pz" o null,
      "priceCents": numero intero o null,
      "isFood": true oppure false,
      "category": una delle chiavi dell'elenco sotto, oppure null
    }
  ],
  "totalCents": numero intero o null
}

Regole.
- Scrivi solo ciò che leggi. Se un dato non c'è o non si legge, metti null. Non indovinare e non inventare righe.
- store: insegna e punto vendita come stampati in alto. chain: la catena (per esempio Coop, Conad, Esselunga, Lidl, Carrefour) solo se la riconosci con certezza.
- date: la data dello scontrino. Se manca l'anno, usa quello di oggi.
- lines: una voce per ogni articolo acquistato, nell'ordine dello scontrino. Non inserire intestazioni, subtotali, IVA, pagamenti, resto, punti fedeltà, numeri di cassa o di documento.
- raw: il testo della riga come è stampato, abbreviazioni comprese.
- name: il nome interpretato in italiano comune e per esteso (per esempio "PROSC.COTTO AQ" diventa "Prosciutto cotto alta qualità"), senza codici interni.
- quantity e unit: solo se risultano dallo scontrino. "0,532 kg x 7,90 EUR/kg" è quantity 0.532 e unit "kg"; "2 x 1,29" è quantity 2 e unit "pz"; una misura nel nome, come "PASTA 500G", è quantity 500 e unit "g". Altrimenti null.
- priceCents: l'importo totale della riga in centesimi di euro, intero (1,29 € è 129). Per i prodotti a peso è l'importo finale della riga, non il prezzo al chilo.
- Sconti: se sotto un articolo c'è una riga di sconto o promozione, mettila subito dopo con kind "discount" e priceCents NEGATIVO (uno sconto di 0,30 € è -30). Uno sconto che riguarda tutto lo scontrino va in fondo, sempre con kind "discount" e priceCents negativo.
- isFood: true per gli alimenti e le bevande, false per tutto il resto (sacchetti, detersivi, igiene, casa). Per gli sconti metti false.
- category: per gli alimenti, la chiave più adatta tra quelle sotto; altrimenti null. Se nessuna calza, scegli la più vicina o null.
- totalCents: il totale pagato dallo scontrino, in centesimi, intero.

Categorie ammesse per "category":
${categories}`;
}

/** Solo con più foto: con una foto la richiesta resta quella di sempre. */
const PARTS_RULES = `

Più foto.
- Le foto sono parti dello stesso scontrino, nell'ordine dato: la prima è l'inizio, l'ultima la fine. Leggile come un solo scontrino.
- Due foto vicine si sovrappongono: una riga che compare in fondo a una foto e in cima alla successiva è la stessa riga, riportala una volta sola.
- Due righe uguali nella stessa foto sono due articoli: riportale entrambe.
- store, chain e date si leggono in cima, totalCents in fondo.`;

export function buildReceiptRequest(options: ReceiptRequestOptions): AiRequest {
  const today = options.today ? ` Oggi è ${options.today}.` : "";
  const count = options.images.length;
  const text =
    count > 1
      ? `Ecco ${count} foto dello scontrino: sono parti dello stesso scontrino, in ordine dall'alto in basso. Le righe ripetute dove una foto si sovrappone alla successiva vanno riportate una volta sola.${today} Rispondi solo con il JSON.`
      : `Ecco la foto dello scontrino.${today} Rispondi solo con il JSON.`;
  return {
    instructions: count > 1 ? receiptInstructions() + PARTS_RULES : receiptInstructions(),
    text,
    images: options.images,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_RECEIPT_MAX_TOKENS,
  };
}
