// I testi del foglio «Aggiungi» che dipendono dall'ora o da ciò che si è fatto. Solo funzioni pure.
import { momentOfMinutes, type MealKind } from "@/core/diary";

const EATEN_HINT: Record<MealKind, string> = {
  breakfast: "Registra colazione",
  lunch: "Registra pranzo",
  dinner: "Registra cena",
  snack: "Registra uno spuntino",
};

/** La riga piccola sotto «Ho mangiato»: il momento dell'ora, lo stesso su cui si apre Registra pasto. `minutes`: minuti dalla mezzanotte. */
export function eatenHint(minutes: number): string {
  return EATEN_HINT[momentOfMinutes(minutes)];
}

/** «Aggiunto alla lista della spesa: latte, pane.» Un nome scritto due volte si dice una volta sola. */
export function shoppingNoticeText(names: readonly string[]): string {
  const seen = new Set<string>();
  const unique = names.filter((name) => {
    const key = name.trim().toLowerCase();
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return `Aggiunto alla lista della spesa: ${unique.join(", ")}.`;
}

/** «Segnato: tè.» in coda all'avviso della spesa, quando nella stessa visita si è segnata anche una bevanda rapida. */
export function drinkNoticeText(name: string): string {
  const text = name.trim();
  return `Segnato: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

/**
 * L'avviso alla chiusura del foglio quando qualcosa è entrato in lista. Se subito dopo si è segnato anche qualcosa da
 * bere, lo dice nella stessa riga: un avviso solo, con un solo «Annulla» per tutto ciò che si è fatto in quella visita.
 */
export function visitNoticeText(names: readonly string[], then?: string): string {
  const shopping = shoppingNoticeText(names);
  return then ? `${shopping} ${then}` : shopping;
}
