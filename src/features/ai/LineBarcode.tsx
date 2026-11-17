"use client";

import { useEffect, useRef, useState } from "react";
import { isRestrictedCode, type Product } from "@/core/catalog";
import { Button } from "@/design";
import ui from "../ui.module.css";
import { Scanner } from "../barcode/Scanner";
import { lookupProduct } from "../barcode/lookup";
import { LOOKUP_FAILURE_MESSAGES } from "../barcode/messages";
import { RESTRICTED_WARNING_TEXT, RESTRICTED_WARNING_TITLE } from "../barcode/safetyText";
import { codeOnlyPatch, linkPatch, needsConfirmation, type LinePatch } from "./receiptProduct";
import styles from "./ReceiptCapture.module.css";

/**
 * «Leggi il codice» su una riga dello scontrino: apre la lettura del codice a barre (la stessa del resto dell'app)
 * e collega la riga al prodotto. Nessuna pagina: la lettura si apre sotto la riga e si chiude da sola.
 */
export function LineBarcode({ onLinked, onClose }: { onLinked: (patch: LinePatch) => void; onClose: () => void }) {
  const abortRef = useRef<AbortController | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Product | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function onCode(code: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMessage(null);
    setProposal(null);
    setSearching(true);
    const outcome = await lookupProduct(code, { signal: controller.signal });
    if (controller.signal.aborted) return;
    setSearching(false);
    if (outcome.status === "found") {
      // codice interno del negozio: la scheda si propone, non si collega da sola
      if (needsConfirmation(outcome.product)) setProposal(outcome.product);
      else onLinked(linkPatch(outcome.product));
    }
    else if (outcome.status === "not_found") {
      if (isRestrictedCode(code)) setMessage("Codice interno del negozio, che Open Food Facts non conosce: la riga resta senza codice.");
      else onLinked(codeOnlyPatch(code));
    }
    else setMessage(LOOKUP_FAILURE_MESSAGES[outcome.reason]);
  }

  return (
    <div className={styles.codePanel}>
      <Scanner onCode={(code) => void onCode(code)} disabled={searching} autoStart />
      {searching ? (
        <p className={ui.hint} role="status">
          Cerco il prodotto…
        </p>
      ) : null}
      {proposal ? (
        <div className={ui.field} role="alert">
          <p className={ui.paragraph}>
            <strong>{RESTRICTED_WARNING_TITLE}</strong>
          </p>
          <p className={ui.hint}>{RESTRICTED_WARNING_TEXT}</p>
          <p className={ui.paragraph}>
            Scheda trovata: {[proposal.name, proposal.brand].filter(Boolean).join(" · ") || "senza nome"}. È quella che hai in mano?
          </p>
          <div className={ui.row}>
            <Button variant="outline" onClick={() => onLinked(linkPatch(proposal))}>
              Sì, collega
            </Button>
            <Button variant="text" onClick={() => setProposal(null)}>
              No, non collegare
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className={ui.error} role="alert">
          {message}
        </p>
      ) : null}
      <p className={ui.hint}>Il codice letto viene inviato a Open Food Facts per cercare il prodotto.</p>
      <Button variant="text" onClick={onClose}>
        Chiudi la lettura
      </Button>
    </div>
  );
}
