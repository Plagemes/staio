"use client";

import { CookIdeas } from "../recipes/CookIdeas";

/**
 * `/app/ricette/abbinamenti` (con `?ricetta=` o `?alimento=`). È la pagina «Cosa cucinare» aperta sulla scheda «Con cosa sta
 * bene»: nessun rimando, così senza rete l'indirizzo resta quello salvato dal service worker.
 */
export const Pairings = () => <CookIdeas start="abbinamenti" />;
