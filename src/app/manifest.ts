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
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
