"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { removeMinimum, setMinimum } from "@/core/shopping";
import { Button, Label } from "@/design";
import { parseQuantityInUnit } from "../actions";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { SETTING_KEYS } from "./settings";
import { stockRows, type StockRow } from "./stockView";
import { useShoppingData, type ShoppingData } from "./useShoppingData";
import { useSettingsUndo } from "./useSettingsUndo";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

export function Stock() {
  const data = useShoppingData();
  const undo = useSettingsUndo(data.save);
  const rows = useMemo(() => (data.plan.pantry && data.plan.today ? stockRows(data.plan.pantry, data.stock, data.plan.today) : []), [data.plan.pantry, data.plan.today, data.stock]);
  if (data.error) return <StorageError />;
  if (!data.ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Scorte minime</h1>
        <LoadingLine />
      </div>
    );
  }
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scorte minime</h1>
        <Label>Scelte da te</Label>
      </div>
      <p className={ui.lead}>
        Sotto la scorta minima, un prodotto finisce nella lista della spesa. Il suggerimento viene dai tuoi consumi ed è una stima: non lo applico mai da solo, lo confermi tu.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          title="Ancora nessun prodotto abituale"
          text="Qui compariranno i prodotti che compri spesso, ognuno con la scorta minima da impostare e, quando i consumi bastano, un suggerimento da confermare."
          actionLabel="Aggiungi un acquisto"
        />
      ) : (
        <ul className={styles.items}>
          {rows.map((r) => (
            <StockCard key={`${r.id}-${r.minimum ?? "none"}`} row={r} data={data} undo={undo} />
          ))}
        </ul>
      )}
      <Link href="/app/spesa" className={ui.textLink}>
        Torna alla lista della spesa
      </Link>
      {undo.node}
    </div>
  );
}

function StockCard({ row, data, undo }: { row: StockRow; data: ShoppingData; undo: Undo }) {
  const id = useId();
  const [text, setText] = useState(row.minimumText ?? "");
  const [error, setError] = useState<string | null>(null);
  const prev = { [SETTING_KEYS.stock]: data.stock };

  async function apply(value: number) {
    await undo.apply(`Scorta minima di ${row.name}: ${value} ${row.unit}.`, { [SETTING_KEYS.stock]: setMinimum(data.stock, row.name, row.unit, value) }, prev);
  }

  async function submit() {
    const r = parseQuantityInUnit(text, row.unit);
    if (!r.ok) return setError(r.error);
    setError(null);
    await apply(r.quantity.value);
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <h2 className={styles.itemName}>{row.name}</h2>
        <span className={styles.itemQty}>{row.minimumText ? `minimo ${row.minimumText}` : "nessun minimo"}</span>
      </div>
      <p className={styles.meta}>{row.stockText}.</p>
      {row.suggestionText ? <p className={styles.meta}>{row.suggestionText}.</p> : <p className={styles.meta}>{row.noSuggestionText}</p>}
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={id}>
          Scorta minima
        </label>
        <div className={styles.inline}>
          <input id={id} className={ui.input} value={text} onChange={(e) => setText(e.target.value)} placeholder={row.unit === "pz" ? "2" : row.unit === "ml" ? "1 l" : "500 g"} autoComplete="off" aria-invalid={error ? true : undefined} />
          <Button onClick={() => void submit()}>Salva</Button>
        </div>
        {error ? <p className={ui.error}>{error}</p> : null}
      </div>
      <div className={styles.actions}>
        {row.suggestion ? (
          <button type="button" className={styles.action} onClick={() => void apply(row.suggestion!.suggested)}>
            Conferma il suggerimento
          </button>
        ) : null}
        {row.minimum !== undefined ? (
          <button
            type="button"
            className={styles.actionDanger}
            onClick={async () => {
              setText("");
              await undo.apply(`Tolta la scorta minima di ${row.name}.`, { [SETTING_KEYS.stock]: removeMinimum(data.stock, row.name, row.unit) }, prev);
            }}
          >
            Togli la scorta
          </button>
        ) : null}
      </div>
    </li>
  );
}
