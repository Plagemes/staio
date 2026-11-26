"use client";

import { CookIdeas } from "../recipes/CookIdeas";

/**
 * `/app/ricette/idee`, con `?alimento=Nome` per partire da un alimento (Oggi, scheda di un lotto). È la pagina «Cosa cucinare»
 * aperta sulla scheda «Idee»: nessun rimando, così senza rete l'indirizzo resta quello salvato dal service worker.
 */
export const RecipeIdeas = () => <CookIdeas start="idee" />;
