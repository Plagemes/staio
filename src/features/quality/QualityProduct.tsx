"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isLocalProduct, validateBarcode, type Product } from "@/core/catalog";
import { Button, Label } from "@/design";
import { captureHrefForCode } from "../barcode/links";
import { lookupProduct } from "../barcode/lookup";
import { BARCODE_PROBLEM_MESSAGES, LOOKUP_FAILURE_MESSAGES } from "../barcode/messages";
import type { LookupFailure } from "../barcode/offClient";
import { LoadingLine } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { KNOWN_PRODUCTS_PATH, SHELF_PATH } from "./links";
import { ProductQuality } from "./ProductQuality";

type Result =
  | { code: string; attempt: number; status: "found"; product: Product; from: "memory" | "service" }
  | { code: string; attempt: number; status: "not_found" }
  | { code: string; attempt: number; status: "failed"; reason: LookupFailure };

/** Pagina `/app/qualita/prodotto?codice=…`: prima i prodotti salvati sul telefono, poi Open Food Facts. */
export function QualityProduct() {
  const search = useSearchParams();
  const check = validateBarcode(search.get("codice") ?? "");
  const code = check.ok ? check.code : "";
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    void lookupProduct(code, { signal: controller.signal }).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.status === "found") setResult({ code, attempt, status: "found", product: outcome.product, from: outcome.from });
      else if (outcome.status === "not_found") setResult({ code, attempt, status: "not_found" });
      else setResult({ code, attempt, status: "failed", reason: outcome.reason });
    });
    return () => controller.abort();
  }, [code, attempt]);

  const current = result && result.code === code && result.attempt === attempt ? result : null;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Qualità del prodotto</h1>
        <Label>Open Food Facts</Label>
      </div>

      {!check.ok ? (
        <div className={ui.empty} role="alert">
          <h2 className={ui.emptyTitle}>Codice non valido</h2>
          <p className={ui.emptyText}>
            {search.get("codice") ? BARCODE_PROBLEM_MESSAGES[check.reason] : "Manca il codice del prodotto: aprilo dallo scaffale o dall'elenco dei prodotti che conosci."}
          </p>
          <div className={ui.row}>
            <Button href={SHELF_PATH}>Modalità scaffale</Button>
            <Button variant="outline" href={KNOWN_PRODUCTS_PATH}>
              Prodotti che conosci
            </Button>
          </div>
        </div>
      ) : null}

      {current?.status === "found" && isLocalProduct(current.product) ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Valori inseriti da te</h2>
          <p className={ui.emptyText}>Questo prodotto non ha un codice a barre: i valori li hai scritti tu, quindi non c&apos;è una scheda di Open Food Facts da valutare.</p>
          <Button variant="outline" href={KNOWN_PRODUCTS_PATH}>
            Prodotti che conosci
          </Button>
        </div>
      ) : null}

      {check.ok && !current ? <LoadingLine text={`Cerco il prodotto ${code}…`} /> : null}

      {current?.status === "found" && !isLocalProduct(current.product) ? (
        <>
          <p className={ui.hint}>
            {current.from === "memory"
              ? "Scheda già letta, salvata sul telefono: la trovi anche senza rete."
              : "Scheda appena letta e salvata sul telefono."}
          </p>
          <ProductQuality product={current.product} />
        </>
      ) : null}

      {current?.status === "not_found" ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Prodotto non trovato</h2>
          <p className={ui.emptyText}>Open Food Facts non conosce il codice {code}: senza i suoi dati non posso valutarlo. Puoi aggiungerlo tu alla dispensa.</p>
          <Button href={captureHrefForCode(code)}>Aggiungi alla dispensa</Button>
        </div>
      ) : null}

      {current?.status === "failed" ? (
        <div className={ui.empty} role="alert">
          <h2 className={ui.emptyTitle}>Non sono riuscito a cercare</h2>
          <p className={ui.emptyText}>{LOOKUP_FAILURE_MESSAGES[current.reason]}</p>
          <div className={ui.row}>
            <Button onClick={() => setAttempt((n) => n + 1)}>Riprova</Button>
            <Button variant="outline" href={KNOWN_PRODUCTS_PATH}>
              Prodotti che conosci
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
