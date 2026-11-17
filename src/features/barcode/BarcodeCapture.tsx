"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isRestrictedCode, needsStoreCodeConfirmation, quantityText, type Product } from "@/core/catalog";
import { compositionFromProduct } from "@/core/nutrition";
import { deleteProductRecord, putProductRecord } from "@/data";
import { Button, Label } from "@/design";
import { NutritionEntry } from "../ai-capture/NutritionFromPhoto";
import { Disclosure } from "../common";
import { Per100Table, ProductNutrients } from "../nutrition/Per100";
import ui from "../ui.module.css";
import { SHELF_PATH, qualityHref } from "../quality/links";
import { translatePackaging } from "./packaging";
import { Scanner, type ScanInfo } from "./Scanner";
import { captureHrefForCode } from "./links";
import { AddToPantry } from "./AddToPantry";
import { ProductSafety } from "./ProductSafety";
import { lookupProduct, type LookupOutcome } from "./lookup";
import { LOOKUP_FAILURE_MESSAGES, NOVA_LABELS, allergenLabel, displayProductCode } from "./messages";
import { RESTRICTED_WARNING_TEXT, RESTRICTED_WARNING_TITLE, storeCodeQuestion } from "./safetyText";
import { checkPackLine, declaredAllergensLine, ignoresRescan, valuesSummary, type RecentAdd } from "./summaries";
import type { LookupFailure } from "./offClient";
import styles from "./BarcodeCapture.module.css";

type View =
  | { kind: "input" }
  | { kind: "searching"; code: string }
  | { kind: "found"; product: Product; from: "memory" | "service"; scanned?: ScanInfo; labelSaved?: LabelSaved; /** Codice interno del negozio: l'utente ha confermato che è ancora il prodotto della scheda. */ confirmed?: true }
  | { kind: "not_found"; code: string; /** L'utente ha detto che la scheda trovata non è il suo prodotto. */ rejected?: true }
  | { kind: "failed"; code: string; reason: LookupFailure };

/** Valori appena letti dalla foto e salvati: la scheda com'era prima, per «Annulla». */
interface LabelSaved {
  previous: Product | undefined;
}

export function BarcodeCapture() {
  const [view, setView] = useState<View>({ kind: "input" });
  const abortRef = useRef<AbortController | null>(null);
  const recentAddRef = useRef<RecentAdd | null>(null);

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

  function onLabelSaved(next: Product, previous: Product | undefined) {
    setView((v) => ({
      kind: "found",
      product: next,
      from: "memory",
      ...(v.kind === "found" && v.scanned ? { scanned: v.scanned } : {}),
      labelSaved: { previous },
      // i valori li ha appena scritti l'utente per questo prodotto
      confirmed: true as const,
    }));
  }

  /** «Non è questo prodotto»: per un codice interno del negozio la scheda trovata non vale; si passa a «non trovato». */
  async function notThisProduct(product: Product) {
    try {
      // la scheda di Open Food Facts era solo una copia salvata per comodità; quella scritta dall'utente non si tocca
      if (product.source === "openfoodfacts") await deleteProductRecord(product.barcode);
    } catch {
      // se l'archivio non risponde la scheda resta in memoria: il collegamento «Non è questo prodotto» si può ripremere
      return;
    }
    setView({ kind: "not_found", code: product.barcode, rejected: true });
  }

  async function undoLabel(code: string, previous: Product | undefined) {
    try {
      if (previous) await putProductRecord({ barcode: code, fetchedAt: previous.fetchedAt, data: previous });
      else await deleteProductRecord(code);
    } catch {
      // se l'archivio non risponde la scheda resta com'è: il tocco si può ripetere
      return;
    }
    setView((v) => {
      if (!previous) return { kind: "not_found", code };
      return { kind: "found", product: previous, from: "memory", ...(v.kind === "found" && v.scanned ? { scanned: v.scanned } : {}) };
    });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Codice a barre</h1>
        <Label>Open Food Facts</Label>
      </div>

      {view.kind === "input" ? (
        <>
          <p className={ui.lead}>Inquadra il codice sulla confezione.</p>
          <Scanner
            autoStart
            onCode={(code, info) => void search(code, info)}
            ignoreCode={(code) => ignoresRescan(recentAddRef.current, code, Date.now())}
          />
          <Disclosure quiet title="Che cosa significa">
            <p>
              Riservatezza: il codice letto viene inviato a Open Food Facts per cercare il prodotto. Non parte nient&apos;altro:
              gli alimenti che registri restano sul telefono.
            </p>
          </Disclosure>
        </>
      ) : null}

      {view.kind === "searching" ? (
        <div className={ui.row}>
          <p className={ui.lead} role="status">
            Cerco il codice {view.code}…
          </p>
          <Button variant="text" onClick={reset}>
            Ferma
          </Button>
        </div>
      ) : null}

      {view.kind === "found" ? (
        <ProductCard
          product={view.product}
          from={view.from}
          scanned={view.scanned}
          labelSaved={view.labelSaved}
          onLabelSaved={onLabelSaved}
          onLabelUndo={() => void undoLabel(view.product.barcode, view.labelSaved?.previous)}
          onNotThisProduct={() => void notThisProduct(view.product)}
          confirmed={view.confirmed === true}
          onConfirm={() => setView({ ...view, confirmed: true })}
          onAgain={reset}
          onAdded={() => {
            // la confezione appena aggiunta può essere ancora inquadrata: il lettore che riparte non la rilegge subito
            recentAddRef.current = { code: view.product.barcode, at: Date.now() };
            reset();
          }}
        />
      ) : null}

      {view.kind === "not_found" ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Prodotto non trovato</h2>
          <p className={ui.emptyText}>
            {view.rejected
              ? `La scheda trovata per il codice ${view.code} non è il tuo prodotto: i codici interni dei negozi cambiano da un negozio all'altro. Scrivi i valori a mano, o aggiungilo a mano.`
              : isRestrictedCode(view.code)
                ? `Open Food Facts non ha una scheda per il codice ${view.code}, che è un codice interno del negozio. Lo aggiungi a mano: ti ricordo il codice nel modulo.`
                : `Open Food Facts non conosce il codice ${view.code}. Lo aggiungi a mano: ti ricordo il codice nel modulo.`}
          </p>
          <div className={ui.row}>
            <Button href={captureHrefForCode(view.code)}>Aggiungi a mano</Button>
            <Button variant="outline" onClick={reset}>
              Altro codice
            </Button>
          </div>
          <NutritionEntry barcode={view.code} product={undefined} safety={(draft) => <ProductSafety product={draft} confirmed />} onSaved={onLabelSaved} />
        </div>
      ) : null}

      {view.kind === "failed" ? (
        <div className={ui.empty} role="alert">
          <h2 className={ui.emptyTitle}>Non sono riuscito a cercare</h2>
          <p className={ui.emptyText}>{LOOKUP_FAILURE_MESSAGES[view.reason]}</p>
          <div className={ui.row}>
            <Button onClick={() => void search(view.code)}>Riprova</Button>
            <Button variant="outline" href={captureHrefForCode(view.code)}>
              Aggiungi a mano
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
  labelSaved,
  onLabelSaved,
  onLabelUndo,
  onNotThisProduct,
  confirmed,
  onConfirm,
  onAgain,
  onAdded,
}: {
  product: Product;
  from: "memory" | "service";
  scanned?: ScanInfo;
  labelSaved?: LabelSaved;
  onLabelSaved: (next: Product, previous: Product | undefined) => void;
  onLabelUndo: () => void;
  onNotThisProduct: () => void;
  confirmed: boolean;
  onConfirm: () => void;
  onAgain: () => void;
  onAdded: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const quantity = product.quantity?.text ?? quantityText(product.quantity);
  // codice interno del negozio con la scheda dell'utente: va confermata a ogni lettura prima di usarla
  const needsConfirm = needsStoreCodeConfirmation(product) && !confirmed;
  const packaging = translatePackaging(product.packaging);
  const meta = [product.brand, quantity].filter(Boolean).join(" · ");
  const packLine = checkPackLine(product.source);
  // valori appena salvati dalla foto o a mano: la riga resta aperta, con «Annulla» in vista
  const [valuesOpen, setValuesOpen] = useState(labelSaved !== undefined);
  const [seenLabelSaved, setSeenLabelSaved] = useState(labelSaved);
  if (seenLabelSaved !== labelSaved) {
    setSeenLabelSaved(labelSaved);
    if (labelSaved) setValuesOpen(true);
  }

  const values = (
    <Disclosure title="Valori e qualità" summary={valuesSummary(product)} open={valuesOpen} onOpenChange={setValuesOpen}>
      <section aria-label="Valori nutrizionali" className={styles.values}>
        <ProductValues product={product} />
        {labelSaved ? (
          <div className={ui.row}>
            <p className={ui.paragraph} role="status">
              Valori salvati sul telefono, legati {displayProductCode(product) === product.barcode ? `al codice ${product.barcode}` : "a questo prodotto"}.
            </p>
            <Button variant="text" onClick={onLabelUndo}>
              Annulla
            </Button>
          </div>
        ) : null}
        {needsConfirm ? null : (
          <NutritionEntry barcode={product.barcode} product={product} safety={(draft) => <ProductSafety product={draft} confirmed />} onSaved={onLabelSaved} />
        )}
      </section>

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
        {product.traces ? (
          <div className={styles.fact}>
            <dt>
              <Label>Possibili tracce</Label>
            </dt>
            <dd>{product.traces.map(allergenLabel).join(", ")}</dd>
          </div>
        ) : null}
        {product.nutriScore || product.nova ? (
          <div className={styles.fact}>
            <dt>
              <Label>Indici</Label>
            </dt>
            <dd>
              {[
                product.nutriScore ? `Nutri-Score ${product.nutriScore.toUpperCase()}` : null,
                product.nova ? `NOVA ${product.nova} (${NOVA_LABELS[product.nova]})` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        ) : null}
        {product.additives ? (
          <div className={styles.fact}>
            <dt>
              <Label>Additivi</Label>
            </dt>
            <dd>{product.additives.length > 0 ? product.additives.join(", ") : "Nessuno dichiarato"}</dd>
          </div>
        ) : null}
        <div className={styles.fact}>
          <dt>
            <Label>Codice</Label>
          </dt>
          <dd className={styles.code}>{displayProductCode(product)}</dd>
        </div>
      </dl>

      <div className={styles.links}>
        <Link href={qualityHref(product.barcode)} className={ui.textLink}>
          Vedi la qualità del prodotto
        </Link>
        <Link href={SHELF_PATH} className={ui.textLink}>
          Confronta sullo scaffale
        </Link>
      </div>
    </Disclosure>
  );

  const meaning = (
    <Disclosure quiet title="Che cosa significa">
      <p>
        {from === "memory"
          ? "Scheda già letta, salvata sul telefono: la trovi anche senza rete. "
          : "Scheda appena letta e salvata sul telefono. "}
        {packLine ?? "I dati vengono da Open Food Facts, un archivio compilato da volontari, e possono essere incompleti o non aggiornati: controlla sulla confezione."}
      </p>
    </Disclosure>
  );

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
          {meta ? <p className={styles.brand}>{meta}</p> : null}
          <p className={styles.declared}>{declaredAllergensLine(product)}</p>
          {packLine ? <p className={styles.declared}>{packLine}</p> : null}
        </div>
      </div>

      {/* avvisi che cambiano la decisione: sempre sopra il modulo, interi */}
      {product.source === "openfoodfacts" && isRestrictedCode(product.barcode) ? (
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>
            <strong>{RESTRICTED_WARNING_TITLE}.</strong> {RESTRICTED_WARNING_TEXT}
          </p>
          <div className={ui.row}>
            <Button variant="outline" onClick={onNotThisProduct}>
              Non è questo prodotto
            </Button>
          </div>
        </div>
      ) : null}

      {needsConfirm ? (
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>
            <strong>{storeCodeQuestion(product.name)}</strong> Finché non lo confermi, non uso i suoi allergeni per il controllo e non aggiungo nulla con quei valori.
          </p>
          <div className={ui.row}>
            <Button onClick={onConfirm}>Sì, è questo</Button>
            <Button variant="outline" onClick={onNotThisProduct}>
              Non è questo prodotto
            </Button>
          </div>
        </div>
      ) : null}

      <ProductSafety product={product} confirmed={confirmed} />

      {needsConfirm ? (
        <>
          <div className={styles.rows}>
            {values}
            {meaning}
          </div>
          <div className={ui.row}>
            <Button variant="outline" onClick={onAgain}>
              Altro codice
            </Button>
          </div>
        </>
      ) : (
        <AddToPantry
          product={product}
          scannedExpiry={scanned?.expiry}
          onAgain={onAgain}
          onAdded={onAdded}
          after={
            <>
              {values}
              {meaning}
            </>
          }
        />
      )}
    </article>
  );
}

/** I valori nutrizionali: se vengono dalla foto dell'etichetta lo dice, altrimenti sono quelli di Open Food Facts. */
function ProductValues({ product }: { product: Product }) {
  const composition = product.labelPhoto?.nutrients ? compositionFromProduct(product) : undefined;
  if (!composition) return <ProductNutrients product={product} />;
  return (
    <Per100Table
      per100={composition.per100}
      basis={composition.basis}
      estimated={false}
      source={
        product.labelPhoto?.by === "manual"
          ? "Inseriti da te, come stampati sull'etichetta. Restano sul telefono, legati a questo codice."
          : "Letti da una foto della tabella nutrizionale e confermati da te: sono quelli stampati sull'etichetta, letti dall'intelligenza artificiale. Restano sul telefono, legati a questo codice."
      }
    />
  );
}
