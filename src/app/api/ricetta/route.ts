import { handleImportRequest } from "@/server/recipe-import";

// Ambiente Node (predefinito). Con Cache Components attivo l'export `runtime` non è ammesso
// (neppure 'nodejs'): la rotta usa `node:https` e `node:dns`, quindi non può girare su Edge.
// Il tempo massimo di esecuzione resta sopra il limite di scarico (8 s) del gestore.
export const maxDuration = 10;

/**
 * Scarica la pagina indicata e restituisce la ricetta estratta. Non salva nulla.
 * La richiesta deve portare un'intestazione `Origin` uguale all'origine dell'app (altre origini si
 * ammettono con `RECIPE_IMPORT_ALLOWED_ORIGINS`, separate da virgole): i browser la inviano da soli.
 */
export async function POST(request: Request): Promise<Response> {
  return handleImportRequest(request);
}
