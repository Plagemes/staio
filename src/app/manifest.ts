import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/config";

/** Colore della carta del tema chiaro: il manifest non legge le variabili CSS. */
const PAPER = "#f6f5f1";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: `${APP_TAGLINE}: tutto il cibo che entra in casa, viene mangiato o buttato.`,
    lang: "it",
    dir: "ltr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: PAPER,
    theme_color: PAPER,
    categories: ["food", "lifestyle", "health"],
    // Android: l'app compare nel menu «Condividi». Il link spesso arriva dentro `text`: la pagina lo ricava da lì.
    share_target: {
      action: "/app/ricette/condivisa",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    // Android: pressione lunga sull'icona. Senza `icons` proprie vale l'icona dell'app.
    shortcuts: [
      { name: "Registra un pasto", short_name: "Pasto", description: "Segna ciò che hai mangiato", url: "/app/pasto" },
      { name: "Leggi un codice", short_name: "Codice", description: "Leggi il codice a barre di un prodotto", url: "/app/cattura/codice" },
      { name: "Lista della spesa", short_name: "Spesa", description: "Apri la lista della spesa", url: "/app/spesa" },
      { name: "Aggiungi", short_name: "Aggiungi", description: "Apri il foglio per aggiungere", url: "/app?aggiungi=1" },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
