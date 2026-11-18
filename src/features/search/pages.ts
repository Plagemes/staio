// Le pagine che la ricerca del foglio «Aggiungi» sa aprire, con le parole che una persona scriverebbe per trovarle.
// Gli indirizzi sono quelli della mappa in `features/INTEGRAZIONE.md`.

export interface SearchPage {
  label: string;
  href: string;
  /** Oltre al nome della pagina: altre parole con cui la si cerca. */
  keywords: readonly string[];
}

export const SEARCH_PAGES: readonly SearchPage[] = [
  { label: "Spesa", href: "/app/spesa", keywords: ["spesa", "lista"] },
  { label: "Scorte minime", href: "/app/spesa/scorte", keywords: [] },
  { label: "Settimana", href: "/app/piano/settimana", keywords: ["piano", "menu"] },
  { label: "Ricettario", href: "/app/ricette", keywords: ["ricette"] },
  { label: "Preparazioni", href: "/app/preparazioni", keywords: [] },
  { label: "Salute", href: "/app/salute", keywords: ["peso", "umore"] },
  { label: "Nutrizione", href: "/app/salute/nutrizione", keywords: ["calorie", "proteine"] },
  { label: "Analisi", href: "/app/salute/analisi", keywords: [] },
  { label: "Rapporto", href: "/app/salute/rapporto", keywords: ["stampa"] },
  { label: "Ultime azioni", href: "/app/attivita", keywords: ["annulla", "storico"] },
  { label: "Pasti abituali", href: "/app/pasti-abituali", keywords: [] },
  { label: "Impostazioni", href: "/app/impostazioni", keywords: [] },
  { label: "Aspetto", href: "/app/impostazioni/aspetto", keywords: ["tema", "colori", "scuro"] },
  { label: "Avvisi", href: "/app/impostazioni/avvisi", keywords: ["notifiche"] },
  { label: "Sincronizzazione", href: "/app/impostazioni/sincronizzazione", keywords: ["copia", "telefono nuovo"] },
  { label: "Profilo", href: "/app/impostazioni/profilo", keywords: [] },
  { label: "Qualità dei prodotti", href: "/app/qualita", keywords: [] },
  { label: "Controlla le quantità", href: "/app/dispensa/riallinea", keywords: [] },
];
