"use client";

import { useMemo, useState } from "react";
import type { Lot } from "@/core/ledger";
import { proposePrepRepair, type PrepRepairResult } from "@/core/prep";
import { appendEvents, getAllEvents, getDeviceId } from "@/data";
import { Button, Label } from "@/design";
import { Sheet, closeSheetThen } from "../common";
import { useNotice } from "../notice";
import { Disclosure } from "../common/Disclosure";
import ui from "../ui.module.css";
import { describeRepair, repairItemText, repairSignature, type RepairItem } from "./view";

interface RepairProps {
  item: RepairItem;
  result: Extract<PrepRepairResult, { ok: true }>;
  lots: readonly Lot[];
  onClose: () => void;
}

/** Mostra la correzione proposta e la scrive solo dopo la conferma, con «Annulla». */
export function RepairSheet({ item, result, lots, onClose }: RepairProps) {
  const title = item.title;
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = useMemo(() => describeRepair(result, lots), [result, lots]);

  async function confirm() {
    if (busy || result.events.length + result.voids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // la correzione si ricalcola dall'archivio al tocco; se non è più quella mostrata non si scrive
      const fresh = proposePrepRepair(item.prepId, await getAllEvents(), { deviceId: await getDeviceId() });
      if (!fresh.ok) {
        setError("Non c'è più niente da sistemare per questa preparazione. Chiudi e guarda di nuovo.");
        return;
      }
      // si confrontano lotti e quantità, non solo quante voci: una quantità cambiata nel frattempo non si scrive
      if (repairSignature(fresh) !== repairSignature(result)) {
        setError("Nel frattempo qualcosa è cambiato. Chiudi e riapri «Sistema» per vedere la correzione aggiornata.");
        return;
      }
      const writes = [...fresh.events, ...fresh.voids];
      const written = await appendEvents(writes);
      if (written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      const n = fresh.events.length;
      const v = fresh.voids.length;
      const parts = [
        n > 0 ? `${n === 1 ? "1 ingrediente scalato" : `${n} ingredienti scalati`} (stima)` : "",
        v > 0 ? `${v === 1 ? "1 correzione doppia annullata" : `${v} correzioni doppie annullate`}` : "",
      ].filter(Boolean);
      // foglio chiuso prima dell'avviso
      closeSheetThen(() => notice.show({ message: `Dispensa sistemata per «${title}»: ${parts.join(", ")}.`, undo: writes }));
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Sistema «${title}»`}
      onClose={onClose}
      busy={busy}
      footer={
        <Button disabled={busy || result.events.length + result.voids.length === 0} onClick={() => void confirm()}>
          Scrivi la correzione
        </Button>
      }
    >
      <>
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
        <Disclosure quiet title="Che cosa significa">Non scrivo niente finché non confermi. Dopo, «Annulla» toglie la correzione.</Disclosure>
      </>
    </Sheet>
  );
}
