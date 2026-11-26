"use client";

import { useState } from "react";
import type { RecipeIngredient } from "@/core/recipes";
import { Button } from "@/design";
import { Disclosure, Sheet, closeSheetThen } from "../common";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { quantityText } from "./common";
import { addToShoppingListWithUndo, proposalFromShortfalls } from "./shopping";

/** «Aggiunte alla spesa: 3 voci.», con la nota sulle voci senza quantità. */
export function addedMessage(added: number, withoutQuantity: number): string {
  const voci = `${added} ${added === 1 ? "voce" : "voci"}`;
  const senza = withoutQuantity > 0 ? ` ${withoutQuantity === 1 ? "Una è entrata" : `${withoutQuantity} sono entrate`} senza quantità («q.b.»).` : "";
  return `Aggiunte alla spesa: ${voci}.${senza}`;
}

/** «Che cosa manca»: ciò che serve per questa ricetta e non c'è, con le quantità; un tocco lo porta alla spesa. */
export function MissingSheet({ shortfalls, have, onClose }: { shortfalls: readonly RecipeIngredient[]; have: readonly string[]; onClose: () => void }) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (busy || shortfalls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // `addManualEntries` rilegge la lista della spesa prima di scrivere
      const r = await addToShoppingListWithUndo(proposalFromShortfalls(shortfalls).entries);
      closeSheetThen(() => notice.show({ message: r.added === 0 ? "Niente da aggiungere." : addedMessage(r.added, r.withoutQuantity), ...(r.added === 0 ? {} : { onUndo: r.undo }) }));
    } catch {
      setError("Non sono riuscito ad aggiungere alla spesa. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Che cosa manca"
      onClose={onClose}
      busy={busy}
      footer={
        <Button disabled={busy || shortfalls.length === 0} onClick={() => void add()}>
          {busy ? "Aggiungo…" : `Aggiungi alla spesa (${shortfalls.length})`}
        </Button>
      }
    >
      <div className={ui.form}>
        {shortfalls.length === 0 ? (
          <p className={ui.paragraph}>Hai tutto in casa.</p>
        ) : (
          <ul className={ui.group} aria-label="Quello che manca">
            {shortfalls.map((s, i) => (
              <li key={i} className={ui.paragraph}>
                {quantityText(s.quantity)} {s.name}
              </li>
            ))}
          </ul>
        )}
        {have.length > 0 ? (
          <Disclosure title="Hai già" summary={`${have.length} ${have.length === 1 ? "ingrediente" : "ingredienti"}`}>
            <p className={ui.paragraph}>{have.join(", ")}.</p>
          </Disclosure>
        ) : null}
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
