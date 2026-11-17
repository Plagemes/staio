"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lot } from "@/core/ledger";
import type { PrepRepairResult } from "@/core/prep";
import { appendEvents } from "@/data";
import { Button, Label } from "@/design";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import styles from "./prep.module.css";
import { describeRepair, repairItemText, type RepairItem } from "./view";

interface RepairProps {
  item: RepairItem;
  result: Extract<PrepRepairResult, { ok: true }>;
  lots: readonly Lot[];
  onClose: () => void;
}

/** Mostra la correzione proposta e la scrive solo dopo la conferma, con «Annulla». */
export function RepairSheet({ item, result, lots, onClose }: RepairProps) {
  const title = item.title;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = useMemo(() => describeRepair(result, lots), [result, lots]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  const close = () => ref.current?.close();

  const writes = [...result.events, ...result.voids];

  async function confirm() {
    if (busy || writes.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const written = await appendEvents(writes);
      if (written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      close();
      const n = result.events.length;
      const v = result.voids.length;
      const parts = [
        n > 0 ? `${n === 1 ? "1 ingrediente scalato" : `${n} ingredienti scalati`} (stima)` : "",
        v > 0 ? `${v === 1 ? "1 correzione doppia annullata" : `${v} correzioni doppie annullate`}` : "",
      ].filter(Boolean);
      notice.show({ message: `Dispensa sistemata per «${title}»: ${parts.join(", ")}.`, undo: writes });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.sheetBody}>
        <h2 id={titleId} className={styles.sheetTitle}>
          Sistema «{title}»
        </h2>
        <p className={ui.paragraph}>{repairItemText(item)}</p>
        <p className={ui.paragraph}>{view.explanation}</p>
        {view.lines.length > 0 ? (
          <>
            <Label>Verrebbe tolto dalla dispensa</Label>
            <ul className={ui.bullets}>
              {view.lines.map((l, i) => (
                <li key={i} className={ui.paragraph}>
                  {l}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {view.redundant > 0 ? (
          <>
            <Label>Correzioni da annullare</Label>
            <p className={ui.paragraph}>
              {view.redundant === 1 ? "Una correzione scritta prima non serve più" : `${view.redundant} correzioni scritte prima non servono più`}: {view.redundant === 1 ? "la annullo" : "le annullo"}, così la dispensa torna giusta.
            </p>
          </>
        ) : null}
        {view.shortfalls.length > 0 ? (
          <>
            <Label>In dispensa ne resta meno</Label>
            <ul className={ui.bullets}>
              {view.shortfalls.map((l, i) => (
                <li key={i} className={ui.hint}>
                  {l}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {view.lines.length === 0 && view.redundant === 0 ? <p className={ui.hint}>Non c&apos;è niente da scrivere.</p> : null}
        {view.skipped.length > 0 ? (
          <>
            <Label>Non posso sistemare</Label>
            <ul className={ui.bullets}>
              {view.skipped.map((l, i) => (
                <li key={i} className={ui.hint}>
                  {l}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.menu}>
          <Button disabled={busy || writes.length === 0} onClick={() => void confirm()}>
            Scrivi la correzione
          </Button>
          <Button variant="text" onClick={close}>
            Non ora
          </Button>
        </div>
        <p className={ui.hint}>Non scrivo niente finché non confermi. Dopo, «Annulla» toglie la correzione.</p>
      </div>
    </dialog>
  );
}
