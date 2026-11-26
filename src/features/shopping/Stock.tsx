"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { emptyStockConfig, removeMinimum, setMinimum, type StockConfig } from "@/core/shopping";
import { Label, cx } from "@/design";
import { getSetting } from "@/data";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { stockLine, suggestedText } from "./listText";
import { SETTING_KEYS, isStockConfig } from "./settings";
import { StockSheet, type StockActions } from "./StockSheet";
import { stockRows, type StockRow } from "./stockView";
import { useShoppingData } from "./useShoppingData";
import { useSettingsUndo } from "./useSettingsUndo";
import styles from "./shopping.module.css";

/** Prima di scrivere, la scorta si rilegge dall'archivio: ciò che è a schermo può essere di un istante fa. */
async function readStock(): Promise<StockConfig> {
  const stored = await getSetting<unknown>(SETTING_KEYS.stock);
  return isStockConfig(stored) ? stored : emptyStockConfig();
}

export function Stock() {
  const data = useShoppingData();
  const undo = useSettingsUndo(data.save);
  const [openId, setOpenId] = useState<string | null>(null);
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

  const open = openId === null ? undefined : rows.find((r) => r.id === openId);
  // il prodotto non c'è più (la scorta è stata tolta e non è abituale): il foglio non ha più di cui parlare
  if (openId !== null && !open) setOpenId(null);

  /** Scrittura, chiusura del foglio, avviso: il foglio si chiude prima che l'avviso nasca. */
  function actionsFor(row: StockRow): StockActions {
    const run = async (message: string, change: (stock: StockConfig) => StockConfig) => {
      setOpenId(null);
      const stock = await readStock();
      await undo.apply(message, { [SETTING_KEYS.stock]: change(stock) }, { [SETTING_KEYS.stock]: stock });
    };
    return {
      set: (value) => void run(`Scorta minima di ${row.name}: ${value} ${row.unit}.`, (stock) => setMinimum(stock, row.name, row.unit, value)),
      remove: () => void run(`Tolta la scorta minima di ${row.name}.`, (stock) => removeMinimum(stock, row.name, row.unit)),
    };
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scorte minime</h1>
        <Label>Scelte da te</Label>
      </div>
      <p className={ui.lead}>Sotto la scorta minima un prodotto va nella lista della spesa. Il suggerimento viene dai tuoi consumi: lo confermi tu.</p>
      {rows.length === 0 ? (
        <EmptyState
          title="Ancora nessun prodotto abituale"
          text="Qui compariranno i prodotti che compri spesso, ognuno con la scorta minima da impostare e, quando i consumi bastano, un suggerimento da confermare."
          actionLabel="Aggiungi un acquisto"
        />
      ) : (
        <ul className={cx(styles.list, ui.group)}>
          {rows.map((r) => (
            <li key={r.id} className={styles.line}>
              <button type="button" className={styles.lineButton} aria-haspopup="dialog" onClick={() => setOpenId(r.id)}>
                <span className={styles.lineName}>{r.name}</span>
                <span className={styles.lineNote}>{stockLine(r)}</span>
                {suggestedText(r) ? <span className={styles.lineNote}>{suggestedText(r)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link href="/app/spesa" className={ui.textLink}>
        Torna alla lista della spesa
      </Link>

      {open ? <StockSheet key={open.id} row={open} actions={actionsFor(open)} onClose={() => setOpenId(null)} /> : null}

      {undo.node}
    </div>
  );
}
