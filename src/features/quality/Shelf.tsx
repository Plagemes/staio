"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Product } from "@/core/catalog";
import { assessProduct, bestUnitPrice, shelfVerdict } from "@/core/quality";
import { Button, Label, SectionHeader } from "@/design";
import { captureHrefForCode } from "../barcode/links";
import { lookupProduct } from "../barcode/lookup";
import { LOOKUP_FAILURE_MESSAGES } from "../barcode/messages";
import ui from "../ui.module.css";
import { isDoubtfulProduct, displayProductCode } from "./codes";
import { pantryStockFor, pricesFor } from "./candidates";
import { compareTable } from "./compare";
import { OutcomeBadge, AddToListButton, DimensionChips, RestrictedNotice } from "./parts";
import { qualityHref } from "./links";
import { ShelfScanner } from "./ShelfScanner";
import { bringToTop, removeEntry, resolveEntry, selectedProducts, startEntry, toggleSelected, type ShelfEntry } from "./shelfSession";
import { DATA_NOTE, alternativeSentences, notAssessableText, priceLine } from "./texts";
import { useOnline, useQualityContext, type QualityContext } from "./useQuality";
import styles from "./quality.module.css";

function ShelfCard({
  product,
  context,
  selected,
  canSelect,
  onToggle,
  onRemove,
}: {
  product: Product;
  context: QualityContext;
  selected: boolean;
  canSelect: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const verdict = useMemo(() => {
    const prices = pricesFor(context.lots, product.barcode);
    return shelfVerdict({
      product,
      ...(context.comparisons ? { comparisons: context.comparisons } : {}),
      goals: context.goals,
      candidates: context.candidates,
      ...(prices ? { prices } : {}),
      pantry: pantryStockFor(context.lots, product.barcode, product.name),
    });
  }, [product, context]);

  const { assessment, personal, alternative, pantryLine, alternativeReasonText } = verdict;
  const personalLines = [...personal.weighs.map((s) => `Per te pesa: ${s.text}`), ...personal.helps.map((s) => `Per te aiuta: ${s.text}`)];
  const refPrice = alternative ? bestUnitPrice(pricesFor(context.lots, product.barcode), alternative.unitPrice?.per) : undefined;
  const altLabel = alternative ? (assessment.dimensions.find((d) => d.id === alternative.dimension)?.label ?? alternative.dimension) : "";

  if (isDoubtfulProduct(product)) {
    return (
      <article className={styles.shelfCard} aria-label={`Scheda dubbia: ${product.name ?? product.barcode}`}>
        <RestrictedNotice fromUser={product.source !== "openfoodfacts"} />
        <div className={styles.heading}>
          <p className={styles.altName}>
            {product.name ?? "Nome non indicato"}
            {product.brand ? ` (${product.brand})` : ""}
          </p>
          <p className={styles.meta}>{product.barcode}</p>
        </div>
        <p className={styles.quiet}>Nessun verdetto e nessuna alternativa: la scheda potrebbe essere di un altro prodotto.</p>
        <div className={ui.row}>
          <AddToListButton product={product} label="Aggiungi alla spesa" />
          <Button variant="text" onClick={onRemove}>
            Togli
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={styles.shelfCard} aria-label={`Verdetto: ${product.name ?? displayProductCode(product)}`}>
      <div className={styles.heading}>
        <Link className={styles.altName} href={qualityHref(product.barcode)}>
          {product.name ?? "Nome non indicato"}
          {product.brand ? ` (${product.brand})` : ""}
        </Link>
        <p className={styles.meta}>{displayProductCode(product)}</p>
      </div>

      <DimensionChips assessment={assessment} />
      <p className={styles.unknown}>{notAssessableText(assessment)}</p>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Per te</h3>
        {!context.personalReady ? (
          <p className={styles.quiet}>Calcolo come incide su di te…</p>
        ) : personal.status === "insufficient_data" ? (
          <p className={styles.quiet}>Dati insufficienti. {personal.reason}</p>
        ) : personalLines.length > 0 ? (
          <ul className={styles.bullets}>
            {personalLines.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.quiet}>Nessuna affermazione fondata sui dati disponibili.</p>
        )}
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>In casa</h3>
        <p className={styles.quiet}>{pantryLine ?? "Non so se ne hai in casa."}</p>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Alternativa tra i prodotti che conosci</h3>
        {alternative ? (
          <>
            <Link className={styles.altName} href={qualityHref(alternative.product.barcode)}>
              {alternative.product.name ?? displayProductCode(alternative.product)}
              {alternative.product.brand ? ` (${alternative.product.brand})` : ""}
            </Link>
            {alternativeSentences(alternative, altLabel).map((s) => (
              <p key={s} className={styles.dimReason}>
                {s}
              </p>
            ))}
            <p className={styles.dimReason}>{priceLine(alternative, refPrice)}</p>
            <div className={ui.row}>
              <AddToListButton product={alternative.product} label="Aggiungi l'alternativa alla spesa" variant="text" />
            </div>
          </>
        ) : (
          <p className={styles.quiet}>{alternativeReasonText ?? "Tra i prodotti che conosci non ce n'è uno migliore."}</p>
        )}
      </div>

      <div className={ui.row}>
        <AddToListButton product={product} label="Aggiungi alla spesa" />
        <label className={styles.pick}>
          <input type="checkbox" checked={selected} disabled={!selected && !canSelect} onChange={onToggle} />
          Confronta
        </label>
        <Button variant="text" onClick={onRemove}>
          Togli
        </Button>
      </div>
    </article>
  );
}

function StatusCard({ entry, onRetry, onRemove }: { entry: Exclude<ShelfEntry, { status: "found" }>; onRetry: () => void; onRemove: () => void }) {
  return (
    <article className={styles.shelfCard} aria-label={`Codice ${entry.code}`}>
      <p className={styles.meta}>{entry.code}</p>
      {entry.status === "loading" ? (
        <p className={styles.quiet} role="status">
          Cerco il prodotto…
        </p>
      ) : null}
      {entry.status === "not_found" ? (
        <>
          <p className={ui.paragraph}>Open Food Facts non conosce questo codice: senza i suoi dati non posso valutarlo.</p>
          <div className={ui.row}>
            <Button variant="outline" href={captureHrefForCode(entry.code)}>
              Inserisci a mano
            </Button>
            <Button variant="text" onClick={onRemove}>
              Togli
            </Button>
          </div>
        </>
      ) : null}
      {entry.status === "failed" ? (
        <>
          <p className={ui.paragraph} role="alert">
            {entry.reason === "offline"
              ? "Senza rete: questo prodotto non è tra quelli già letti e salvati sul telefono, quindi non è disponibile finché non torna la rete."
              : LOOKUP_FAILURE_MESSAGES[entry.reason]}
          </p>
          <div className={ui.row}>
            <Button variant="outline" onClick={onRetry}>
              Riprova
            </Button>
            <Button variant="text" onClick={onRemove}>
              Togli
            </Button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function CompareSection({ products: all }: { products: Product[] }) {
  const products = useMemo(() => all.filter((p) => !isDoubtfulProduct(p)), [all]);
  const table = useMemo(() => compareTable(products.map((product) => ({ product, assessment: assessProduct(product) }))), [products]);
  return (
    <section className={ui.section} aria-label="Confronto fianco a fianco">
      <SectionHeader label="Fianco a fianco" />
      <p className={styles.small}>Una riga per dimensione. Nessun totale e nessuna classifica: guarda riga per riga.</p>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Tabella di confronto, scorri di lato se serve">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Dimensione</th>
              {table.products.map((p) => (
                <th key={p.barcode} scope="col">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, i) => (
                  <td key={table.products[i].barcode}>
                    <OutcomeBadge outcome={cell.outcome} descriptive={cell.kind === "descriptive"} />
                    {cell.text ? <span className={styles.cellValue}>{cell.text}</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Modalità scaffale: un codice dopo l'altro, un verdetto breve per ciascuno, storico e confronto. */
export function Shelf() {
  const context = useQualityContext();
  const online = useOnline();
  const [entries, setEntries] = useState<ShelfEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  // codici già cercati in questa sessione: uno già in storico non rifà la ricerca (una non trovato non martella la rete)
  const seenRef = useRef(new Set<string>());

  const lookup = useCallback(async (code: string) => {
    const outcome = await lookupProduct(code);
    if (outcome.status === "found") {
      setEntries((prev) => resolveEntry(prev, { code, status: "found", product: outcome.product, from: outcome.from }));
    } else if (outcome.status === "not_found") {
      setEntries((prev) => resolveEntry(prev, { code, status: "not_found" }));
    } else {
      seenRef.current.delete(code);
      setEntries((prev) => resolveEntry(prev, { code, status: "failed", reason: outcome.reason }));
    }
  }, []);

  const handleCode = useCallback(
    (code: string) => {
      if (seenRef.current.has(code)) {
        setEntries((prev) => bringToTop(prev, code));
        return;
      }
      seenRef.current.add(code);
      setEntries((prev) => startEntry(prev, code));
      void lookup(code);
    },
    [lookup],
  );

  const retry = (code: string) => {
    seenRef.current.add(code);
    setEntries((prev) => startEntry(prev, code));
    void lookup(code);
  };

  const remove = (code: string) => {
    seenRef.current.delete(code);
    setEntries((prev) => removeEntry(prev, code));
    setSelected((prev) => prev.filter((c) => c !== code));
  };

  const compared = useMemo(() => selectedProducts(entries, selected), [entries, selected]);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scaffale</h1>
        <Link href="/app/spesa" className={ui.textLink}>
          Torna alla spesa
        </Link>
      </div>
      <p className={ui.lead}>
        In negozio leggi un codice dopo l&apos;altro: per ogni prodotto un verdetto breve, dimensione per dimensione, senza voto unico.
      </p>

      {!online ? (
        <p className={styles.banner} role="status">
          Sei senza rete. Uso i prodotti già letti e salvati sul telefono; un prodotto nuovo non si può cercare finché la rete non torna, e te lo dico
          sulla sua scheda.
        </p>
      ) : null}

      <ShelfScanner onCode={handleCode} />

      <p className={ui.hint}>
        Riservatezza: il codice di un prodotto non ancora salvato viene inviato a Open Food Facts per cercarlo. Non parte nient&apos;altro.
      </p>

      <section className={ui.section} aria-label="Storico della sessione">
        <SectionHeader label="Letti in questa sessione" />
        {entries.length === 0 ? (
          <p className={styles.quiet}>Ancora nessun prodotto letto. Lo storico dura finché resti su questa pagina.</p>
        ) : (
          <>
            <p className={styles.small}>
              Le alternative sono cercate tra i prodotti che conosci: quelli già letti o comprati. Scegli «Confronta» su due o più prodotti (al massimo quattro).
            </p>
            <ul className={styles.history}>
              {entries.map((e) => (
                <li key={e.code}>
                  {e.status === "found" ? (
                    <ShelfCard
                      product={e.product}
                      context={context}
                      selected={selected.includes(e.code)}
                      canSelect={selected.length < 4}
                      onToggle={() => setSelected((prev) => toggleSelected(prev, e.code))}
                      onRemove={() => remove(e.code)}
                    />
                  ) : (
                    <StatusCard entry={e} onRetry={() => retry(e.code)} onRemove={() => remove(e.code)} />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {compared.filter((p) => !isDoubtfulProduct(p)).length >= 2 ? <CompareSection products={compared} /> : null}

      <section className={ui.section} aria-label="Come leggere">
        <Label>Come leggere</Label>
        <ul className={styles.bullets}>
          <li>Grassi, grassi saturi, zuccheri e sale: soglie a semaforo di uno schema britannico volontario, non una norma italiana.</li>
          <li>Nutri-Score e NOVA: raggrupparli in favorevole, intermedio e sfavorevole è una scelta di presentazione.</li>
          <li>«Non valutabile» vuol dire che manca il dato o una fonte: non vuol dire favorevole.</li>
          <li>{DATA_NOTE}</li>
        </ul>
      </section>
    </div>
  );
}
