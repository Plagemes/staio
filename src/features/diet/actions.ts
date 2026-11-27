// Le azioni dei consigli: dove porta ognuna, e quelle che scrivono (spesa, «Lascia così») con il loro «Annulla».
// Niente si scrive nel piano da qui: «Metti nel piano» apre il foglio che c'è già (`features/recipes/PlanSheet.tsx`).
import { DISMISSED_SETTING_KEY, isDismissedList, rememberDismissed } from "@/core/briefing";
import type { AdviceAction } from "@/core/diet";
import { getSetting, setSetting } from "@/data";
import { ideasHref } from "../ai-capture/ideasFood";
import { qualityHref } from "../quality/links";
import { addManualEntries, type AddToListResult } from "../shopping/add";
import type { ManualInput } from "../shopping/manual";
import { dietHref, recipeHref } from "./links";
import { DISMISSED_TEXT, OPEN_SHOPPING_LABEL, SHOPPING_FAILED_TEXT, addedToShoppingText } from "./texts";

export const SHOPPING_PATH = "/app/spesa";

/** Dove porta un'azione che si apre con un tocco; `undefined` per quelle che scrivono o aprono un foglio. */
export function hrefOf(action: AdviceAction): string | undefined {
  switch (action.kind) {
    case "cookWithPantry":
      return ideasHref(action.foodName);
    case "openRecipe":
      return recipeHref(action.recipeId);
    case "seeAlternative":
      return qualityHref(action.toBarcode);
    case "openDetail":
      return dietHref(action.anchor ? { anchor: action.anchor } : {});
    case "addToPlan":
    case "addToShopping":
      return undefined;
  }
}

/** Un avviso come quello di `useNotice`: messaggio, «Annulla», un rimando. */
export interface NoticeLike {
  show(notice: { message: string; onUndo?: () => Promise<void>; link?: { label: string; href: string } }): void;
}

export interface ActionDeps {
  notice: NoticeLike;
  /** Predefinito: `addManualEntries` (l'unico punto di scrittura della lista). */
  addToList?: (entries: readonly ManualInput[]) => Promise<AddToListResult>;
}

export type ActionResult =
  /** Da aprire con un collegamento. */
  | { href: string }
  /** Da aprire nel foglio «Metti nel piano» con questa ricetta. */
  | { sheet: "plan"; recipeId: string; servings: number; title: string }
  /** Scritto nella lista della spesa (0 se non c'era niente da aggiungere). */
  | { added: number }
  | { failed: true };

/**
 * Esegue un'azione al tocco. «Aggiungi alla spesa» scrive con `addManualEntries` e mostra l'avviso con «Annulla» e
 * «Apri la spesa»; «Metti nel piano» restituisce il foglio da aprire; le altre il collegamento.
 */
export async function runAdviceAction(action: AdviceAction, deps: ActionDeps): Promise<ActionResult> {
  if (action.kind === "addToPlan") return { sheet: "plan", recipeId: action.recipeId, servings: action.servings, title: action.title };
  if (action.kind === "addToShopping") {
    const add = deps.addToList ?? ((entries: readonly ManualInput[]) => addManualEntries(entries));
    try {
      const result = await add(action.names.map((product) => ({ product })));
      if (result.added > 0) {
        deps.notice.show({
          message: addedToShoppingText(action.names),
          onUndo: result.undo,
          link: { label: OPEN_SHOPPING_LABEL, href: SHOPPING_PATH },
        });
      }
      return { added: result.added };
    } catch {
      deps.notice.show({ message: SHOPPING_FAILED_TEXT });
      return { failed: true };
    }
  }
  return { href: hrefOf(action) as string };
}

/**
 * «Lascia così»: la chiave `diet:<regola>:<settimana>` entra in `briefing.dismissed`, rileggendo la lista prima di
 * scrivere. «Annulla» la toglie di nuovo (solo quella).
 */
export async function dismissAdvice(key: string): Promise<{ undo(): Promise<void> }> {
  const current = await getSetting<unknown>(DISMISSED_SETTING_KEY);
  const list = isDismissedList(current) ? current : [];
  const had = list.includes(key);
  await setSetting(DISMISSED_SETTING_KEY, rememberDismissed(list, key));
  return {
    undo: async () => {
      if (had) return;
      const now = await getSetting<unknown>(DISMISSED_SETTING_KEY);
      await setSetting(DISMISSED_SETTING_KEY, (isDismissedList(now) ? now : []).filter((k) => k !== key));
    },
  };
}

/** «Lascia così» con il suo avviso. */
export async function dismissWithNotice(key: string, notice: NoticeLike): Promise<void> {
  const { undo } = await dismissAdvice(key);
  notice.show({ message: DISMISSED_TEXT, onUndo: undo });
}
