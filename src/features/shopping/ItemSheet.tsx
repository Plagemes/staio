"use client";

import { useId, useState, type ReactElement } from "react";
import { Button } from "@/design";
import { parseQuantityInUnit } from "../actions";
import { ActionList, Sheet, type ActionItem } from "../common";
import ui from "../ui.module.css";
import { itemDetailLines, itemQuantityText } from "./listText";
import type { QuantitylessItem, ViewItem } from "./view";
import styles from "./shopping.module.css";

export type SheetTarget = { kind: "item"; v: ViewItem } | { kind: "plain"; n: QuantitylessItem };

/** Ogni azione è una sola scrittura; dice se è riuscita. Il foglio si chiude solo se lo è. */
export interface ItemActions {
  confirm: () => Promise<boolean>;
  unconfirm: () => Promise<boolean>;
  setQuantity: (value: number) => Promise<boolean>;
  remove: () => Promise<boolean>;
}

const PLACEHOLDER = { pz: "2", ml: "1 l", g: "500 g" } as const;

/** Il foglio «Voce»: tutto ciò che si può sapere e fare su una riga della lista. */
export function ItemSheet({ target, actions, onClose }: { target: SheetTarget; actions: ItemActions; onClose: () => void }): ReactElement {
  const fieldId = useId();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const item = target.kind === "item" ? target.v : null;
  const initial = item ? itemQuantityText(item) : "";
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const changed = item !== null && text.trim() !== initial;

  /** Un solo tocco alla volta: il secondo, mentre la scrittura è in corso, non fa niente. */
  async function act(run: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      ok = await run();
    } catch {
      ok = false;
    }
    if (ok) {
      onClose();
      return;
    }
    setBusy(false);
    setError("Non sono riuscito a salvare. Riprova.");
  }

  function save() {
    if (!item) return;
    const read = parseQuantityInUnit(text, item.unit);
    if (!read.ok) return setError(read.error);
    // scritta in un altro modo ma uguale a prima: niente da salvare, niente avviso
    if (read.quantity.value === item.quantity) return onClose();
    void act(() => actions.setQuantity(read.quantity.value));
  }

  const rows: ActionItem[] = [
    ...(item && !item.confirmed ? [{ id: "confirm", label: "Conferma", onSelect: () => void act(actions.confirm) }] : []),
    ...(item && item.confirmed && !item.isManual ? [{ id: "unconfirm", label: "Torna una proposta", onSelect: () => void act(actions.unconfirm) }] : []),
    { id: "remove", label: "Togli", danger: true, onSelect: () => void act(actions.remove) },
  ];

  const name = target.kind === "item" ? target.v.name : target.n.name;

  return (
    <Sheet
      title={name}
      onClose={onClose}
      busy={busy}
      head={
        item ? (
          <div className={styles.sheetHead}>
            <ul className={styles.sheetReasons}>
              {item.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {itemDetailLines(item).map((line) => (
              <p key={line} className={ui.hint}>
                {line}
              </p>
            ))}
          </div>
        ) : (
          <p className={ui.hint}>Aggiunta da te, senza quantità: c&apos;è in lista e va in negozio, ma non c&apos;è un numero né un prezzo stimato.</p>
        )
      }
      footer={
        item ? (
          <Button type="submit" form={formId} disabled={!changed || busy}>
            Salva
          </Button>
        ) : undefined
      }
    >
      {item ? (
        <form
          id={formId}
          className={ui.field}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          noValidate
        >
          <label className={ui.fieldLabel} htmlFor={fieldId}>
            Quanto
          </label>
          <input
            id={fieldId}
            className={ui.input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={PLACEHOLDER[item.unit]}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
          />
        </form>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <ActionList items={rows} />
    </Sheet>
  );
}
