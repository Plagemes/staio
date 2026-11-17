"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import { Button, cx } from "@/design";
import ui from "../ui.module.css";
import styles from "./ActionList.module.css";
import { Sheet } from "./Sheet";
import { closeSheetThen } from "./sheetHistory";

export interface ActionItem {
  id: string;
  label: string;
  /** Una riga piccola sotto l'etichetta. */
  hint?: string;
  href?: string;
  onSelect?: () => void;
  /** Azione distruttiva: va in fondo, dopo un filetto, nel colore di `ui.danger`. */
  danger?: boolean;
  disabled?: boolean;
}

/** Le voci nell'ordine dato, con le distruttive in fondo qualunque sia il loro posto nell'elenco. */
function ordered(items: readonly ActionItem[]): ActionItem[] {
  return [...items.filter((item) => !item.danger), ...items.filter((item) => item.danger)];
}

/** L'elenco delle azioni secondarie, una per riga. Dentro un foglio si usa da sola. */
export function ActionList({ items }: { items: readonly ActionItem[] }): ReactElement {
  const rows = ordered(items);
  const firstDanger = rows.findIndex((item) => item.danger);

  return (
    <ul className={cx(styles.list, ui.group)}>
      {rows.map((item, index) => {
        const content = (
          <>
            <span className={styles.label}>{item.label}</span>
            {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
          </>
        );
        const rowClass = cx(styles.row, item.danger ? styles.danger : undefined);
        return (
          <li key={item.id} className={cx(styles.item, index > 0 && index === firstDanger ? styles.afterRule : undefined)}>
            {item.href !== undefined && !item.disabled ? (
              <Link className={rowClass} href={item.href} onClick={item.onSelect}>
                {content}
              </Link>
            ) : (
              <button type="button" className={rowClass} disabled={item.disabled} onClick={item.onSelect}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Il pulsante «Altro»: apre un foglio con l'elenco. Scelta una voce il foglio si chiude, poi parte l'azione. */
export function MoreActions({ items, label = "Altro", title = "Altro" }: { items: readonly ActionItem[]; label?: string; title?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <></>;

  const close = () => setOpen(false);
  const closing = items.map((item) => ({
    ...item,
    // l'azione parte a foglio chiuso: può navigare o aprire un altro foglio
    onSelect: () => closeSheetThen(() => item.onSelect?.()),
  }));

  return (
    <>
      <Button variant="text" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Sheet title={title} onClose={close}>
          <ActionList items={closing} />
        </Sheet>
      ) : null}
    </>
  );
}
