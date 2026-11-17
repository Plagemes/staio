"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { quantityText, type Product } from "@/core/catalog";
import { Button, Label } from "@/design";
import { ProductNutrients } from "../nutrition/Per100";
import ui from "../ui.module.css";
import { qualityHref } from "../quality/links";
import { translatePackaging } from "./packaging";
import { Scanner, type ScanInfo } from "./Scanner";
import { captureHrefForCode } from "./links";
import { AddToPantry } from "./AddToPantry";
import { lookupProduct, type LookupOutcome } from "./lookup";
import { LOOKUP_FAILURE_MESSAGES, NOVA_LABELS, allergenLabel } from "./messages";
import type { LookupFailure } from "./offClient";
import styles from "./BarcodeCapture.module.css";

type View =
  | { kind: "input" }
  | { kind: "searching"; code: string }
  | { kind: "found"; product: Product; from: "memory" | "service"; scanned?: ScanInfo }
  | { kind: "not_found"; code: string }
  | { kind: "failed"; code: string; reason: LookupFailure };

export function BarcodeCapture() {
  const [view, setView] = useState<View>({ kind: "input" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function search(code: string, info?: ScanInfo) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setView({ kind: "searching", code });
    const outcome: LookupOutcome = await lookupProduct(code, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (outcome.status === "found") setView({ kind: "found", product: outcome.product, from: outcome.from, scanned: info });
    else if (outcome.status === "not_found") setView({ kind: "not_found", code });
    else setView({ kind: "failed", code, reason: outcome.reason });
  }

  function reset() {
    abortRef.current?.abort();
    setView({ kind: "input" });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Codice a barre</h1>
        <Label>Open Food Facts</Label>
      </div>

      {view.kind === "input" ? (
        <>
          <p className={ui.lead}>Leggi il codice sulla confezione e cerco il prodotto, così non devi scrivere nome e quantità.</p>
          <Scanner onCode={(code, info) => void search(code, info)} />
          <p className={ui.hint}>
            Riservatezza: il codice letto viene inviato a Open Food Facts per cercare il prodotto. Non parte nient&apos;altro:
            gli alimenti che registri restano sul telefono.
          </p>
        </>
      ) : null}

      {view.kind === "searching" ? (
        <p className={ui.lead} role="status">
          Cerco il codice {view.code}…
        </p>
      ) : null}

      {view.kind === "found" ? <ProductCard product={view.product} from={view.from} scanned={view.scanned} onAgain={reset} /> : null}

      {view.kind === "not_found" ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Prodotto non trovato</h2>
          <p className={ui.emptyText}>
            Open Food Facts non conosce il codice {view.code}. Lo aggiungi a mano: ti ricordo il codice nel modulo.
          </p>
          <div className={ui.row}>
            <Button href={captureHrefForCode(view.code)}>Inserisci a mano</Button>
            <Button variant="outline" onClick={reset}>
              Leggi un altro codice
            </Button>
          </div>
        </div>
      ) : null}

      {view.kind === "failed" ? (
        <div className={ui.empty} role="alert">
          <h2 className={ui.emptyTitle}>Non sono riuscito a cercare</h2>
          <p className={ui.emptyText}>{LOOKUP_FAILURE_MESSAGES[view.reason]}</p>
          <div className={ui.row}>
            <Button onClick={() => void search(view.code)}>Riprova</Button>
            <Button variant="outline" href={captureHrefForCode(view.code)}>
              Inserisci a mano
            </Button>
            <Button variant="text" onClick={reset}>
              Altro codice
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProductCard({
  product,
  from,
  scanned,
  onAgain,
}: {
  product: Product;
  from: "memory" | "service";
  scanned?: ScanInfo;
  onAgain: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const quantity = product.quantity?.text ?? quantityText(product.quantity);
  const packaging = translatePackaging(product.packaging);

  return (
    <article className={styles.card} aria-label="Scheda del prodotto">
      <div className={styles.top}>
        {product.imageUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- immagine remota di Open Food Facts, non ottimizzabile
          <img
            className={styles.image}
            src={product.imageUrl}
            alt=""
            width={96}
            height={96}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <div className={styles.heading}>
          <h2 className={styles.name}>{product.name ?? "Nome non indicato"}</h2>
          {product.brand ? <p className={styles.brand}>{product.brand}</p> : null}
          <p className={styles.code}>{product.barcode}</p>
        </div>
      </div>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>
            <Label>Quantità</Label>
          </dt>
          <dd>{quantity ?? "Non indicata"}</dd>
        </div>
        {packaging.length > 0 ? (
          <div className={styles.fact}>
            <dt>
              <Label>Confezione</Label>
            </dt>
            <dd>{packaging.join(", ")}</dd>
          </div>
        ) : null}
        {product.allergens ? (
          <div className={styles.fact}>
            <dt>
              <Label>Allergeni dichiarati</Label>
            </dt>
            <dd>{product.allergens.map(allergenLabel).join(", ")}</dd>
          </div>
        ) : null}
        <div className={styles.fact}>
          <dt>
            <Label>{product.nutriScore || product.nova ? "Indici" : "Qualità"}</Label>
          </dt>
          <dd>
            {product.nutriScore || product.nova ? (
              <>
                {[
                  product.nutriScore ? `Nutri-Score ${product.nutriScore.toUpperCase()}` : null,
                  product.nova ? `NOVA ${product.nova} (${NOVA_LABELS[product.nova]})` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                <br />
              </>
            ) : null}
            <Link href={qualityHref(product.barcode)} className={ui.textLink}>
              Vedi la qualità del prodotto
            </Link>
          </dd>
        </div>
        {product.additives ? (
          <div className={styles.fact}>
            <dt>
              <Label>Additivi</Label>
            </dt>
            <dd>{product.additives.length > 0 ? product.additives.join(", ") : "Nessuno dichiarato"}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-label="Valori nutrizionali">
        <ProductNutrients product={product} />
      </section>

      <p className={ui.hint}>
        {from === "memory"
          ? "Scheda già letta, salvata sul telefono: la trovi anche senza rete. "
          : "Scheda appena letta e salvata sul telefono. "}
        I dati vengono da Open Food Facts, un archivio compilato da volontari, e possono essere incompleti o non aggiornati: controlla
        sulla confezione.
      </p>

      <AddToPantry product={product} scannedExpiry={scanned?.expiry} onAgain={onAgain} />
    </article>
  );
}
