"use client";

import { useId, useState } from "react";
import { Button, SectionHeader } from "@/design";
import { formatQuantity } from "@/core/units";
import { formatPrice, parsePriceCents } from "../format";
import ui from "../ui.module.css";
import { dismiss, setQuantity } from "./decisions";
import { SETTING_KEYS } from "./settings";
import type { ShoppingData } from "./useShoppingData";
import type { useSettingsUndo } from "./useSettingsUndo";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

const NO_SPLIT: Record<string, string> = {
  fewer_than_two_stores: "Ho prezzi di un solo negozio: per confrontare ne servono almeno due. Quando registri acquisti con negozio e prezzo, li confronto.",
  no_saving: "Dividere la spesa su due negozi non farebbe risparmiare, con i prezzi che ho.",
  no_comparable_single_store: "Non c'è un negozio con un prezzo osservato per tutte le voci: un confronto onesto non è possibile.",
};

/** Costo stimato, confronto tra negozi e tetto di spesa. Tutto dagli ultimi prezzi osservati: sono stime. */
export function Costs({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const view = data.view!;
  const id = useId();
  const [text, setText] = useState(data.budgetCents !== null ? (data.budgetCents / 100).toFixed(2).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const nameOf = new Map(view.items.map((i) => [i.id, i.name]));
  const c = view.comparison;

  async function saveBudget() {
    const r = parsePriceCents(text);
    if (!r.ok) return setError("Scrivi il tetto in euro, per esempio 80 o 79,50.");
    setError(null);
    await undo.apply(`Tetto di spesa: ${formatPrice(r.cents)}.`, { [SETTING_KEYS.budget]: r.cents }, { [SETTING_KEYS.budget]: data.budgetCents });
  }

  if (view.items.length === 0) return null;

  return (
    <>
      <section className={ui.section} aria-label="Costo stimato">
        <SectionHeader label="Costo stimato" />
        <p className={styles.costLine}>{view.cost.text}</p>
        <p className={ui.hint}>È l&apos;ultimo prezzo che hai registrato per ogni prodotto, per la quantità in lista: una stima, non un preventivo.</p>
      </section>

      <section className={ui.section} aria-label="Confronto tra negozi">
        <SectionHeader label="Dove conviene" />
        {c.singles.length === 0 ? (
          <p className={ui.paragraph}>Non ho ancora prezzi per negozio. Quando registri acquisti con il negozio e il prezzo, qui confronto i negozi per questa lista.</p>
        ) : (
          <>
            <ul className={styles.table}>
              {c.singles.map((s) => (
                <li key={s.storeKey} className={styles.rowLine}>
                  <span>
                    {s.store}
                    {c.bestSingle?.storeKey === s.storeKey ? " · il più conveniente" : ""}
                  </span>
                  <strong>{formatPrice(s.costCents)}</strong>
                  <span className={styles.rowSub}>
                    {s.pricedItemIds.length} {s.pricedItemIds.length === 1 ? "voce con prezzo" : "voci con prezzo"}
                    {s.missingItemIds.length > 0 ? `; ${s.missingItemIds.length} qui senza prezzo, non contate` : ""}. Stima.
                  </span>
                </li>
              ))}
            </ul>
            {c.unpricedCount > 0 ? <p className={ui.hint}>{c.unpricedCount} {c.unpricedCount === 1 ? "voce non ha" : "voci non hanno"} alcun prezzo osservato e restano fuori da ogni stima.</p> : null}
            {c.split ? (
              <div className={styles.card}>
                <p className={styles.costLine}>
                  <strong>
                    Dividendo tra {c.split.stores[0]} e {c.split.stores[1]}
                  </strong>{" "}
                  spendi circa {formatPrice(c.split.costCents)} invece di {formatPrice(c.split.baselineCents)} tutto da {c.split.baselineStore}: risparmio stimato {formatPrice(c.split.savingsCents)}.
                </p>
                <ul className={styles.split}>
                  {c.split.stores.map((store) => (
                    <li key={store}>
                      {store}: {c.split!.assignments.filter((a) => a.store === store).map((a) => nameOf.get(a.itemId) ?? a.itemId).join(", ")}
                    </li>
                  ))}
                </ul>
                {c.split.uncoveredItemIds.length > 0 ? <p className={ui.hint}>Fuori dal confronto: {c.split.uncoveredItemIds.map((i) => nameOf.get(i) ?? i).join(", ")} (nessun prezzo in questi due negozi).</p> : null}
              </div>
            ) : c.noSplitReason ? (
              <p className={ui.paragraph}>{NO_SPLIT[c.noSplitReason]}</p>
            ) : null}
          </>
        )}
      </section>

      <section className={ui.section} aria-label="Tetto di spesa">
        <SectionHeader label="Tetto di spesa" />
        <p className={ui.hint}>Facoltativo. Se la lista lo supera, ti propongo riduzioni, dalle voci più deboli: le accetti una per una.</p>
        <form
          className={ui.field}
          onSubmit={(e) => {
            e.preventDefault();
            void saveBudget();
          }}
        >
          <label className={ui.fieldLabel} htmlFor={id}>
            Tetto in euro
          </label>
          <div className={styles.inline}>
            <input id={id} className={ui.input} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="80" autoComplete="off" aria-invalid={error ? true : undefined} />
            <Button type="submit">Salva</Button>
            {data.budgetCents !== null ? (
              <Button
                variant="outline"
                onClick={async () => {
                  setText("");
                  await undo.apply("Tetto di spesa tolto.", { [SETTING_KEYS.budget]: null }, { [SETTING_KEYS.budget]: data.budgetCents });
                }}
              >
                Togli
              </Button>
            ) : null}
          </div>
          {error ? <p className={ui.error}>{error}</p> : null}
        </form>

        {view.budget ? (
          view.budget.totalBeforeCents <= view.budget.capCents ? (
            <p className={styles.costLine}>
              Sei dentro il tetto: stima {formatPrice(view.budget.totalBeforeCents)} su {formatPrice(view.budget.capCents)}
              {view.budget.unpricedCount > 0 ? `, senza contare ${view.budget.unpricedCount} ${view.budget.unpricedCount === 1 ? "voce senza prezzo" : "voci senza prezzo"}` : ""}.
            </p>
          ) : (
            <>
              <p className={styles.costLine}>
                Stima {formatPrice(view.budget.totalBeforeCents)}, tetto {formatPrice(view.budget.capCents)}. Accettando tutte le riduzioni scenderesti a circa {formatPrice(view.budget.totalAfterCents)}
                {view.budget.totalAfterCents > view.budget.capCents ? ": non basta, le voci senza prezzo o non riducibili restano" : ""}.
              </p>
              {view.budget.adjustments.map((a) => (
                <div key={a.itemId} className={styles.adjust}>
                  <span>
                    {a.action === "remove"
                      ? `Togliere ${a.name} (${formatQuantity({ value: a.fromQuantity, unit: a.unit })}): risparmi circa ${formatPrice(a.savedCents)}.`
                      : `Ridurre ${a.name} da ${formatQuantity({ value: a.fromQuantity, unit: a.unit })} a ${formatQuantity({ value: a.toQuantity, unit: a.unit })}: risparmi circa ${formatPrice(a.savedCents)}.`}
                  </span>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() =>
                        undo.apply(
                          a.action === "remove" ? `Tolto per il tetto: ${a.name}.` : `Ridotto per il tetto: ${a.name}.`,
                          { [SETTING_KEYS.decisions]: a.action === "remove" ? dismiss(data.decisions, a.itemId, view.today) : setQuantity(data.decisions, a.itemId, a.toQuantity) },
                          { [SETTING_KEYS.decisions]: data.decisions },
                        )
                      }
                    >
                      Accetta
                    </button>
                  </div>
                </div>
              ))}
            </>
          )
        ) : null}
      </section>
    </>
  );
}
