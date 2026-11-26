"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { assessProduct } from "@/core/quality";
import { Button } from "@/design";
import { usePantry } from "@/data";
import { RESTRICTED_WARNING_TITLE } from "../barcode/safetyText";
import { LoadingLine } from "../shell/EmptyState";
import { useProducts } from "../nutrition/useNutrition";
import { Disclosure } from "../common/Disclosure";
import ui from "../ui.module.css";
import { isDoubtfulProduct, displayProductCode } from "./codes";
import { knownProductRows } from "./candidates";
import { SHELF_PATH, qualityHref } from "./links";
import { DATA_NOTE, outcomeCountText } from "./texts";
import styles from "./quality.module.css";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** `/app/qualita/prodotti`: i prodotti già letti o comprati, quelli tra cui si cercano le alternative. */
export function KnownProducts() {
  const products = useProducts();
  const pantry = usePantry();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => (products ? knownProductRows(products.values(), pantry.data?.lots ?? []) : []), [products, pantry.data]);
  const shown = useMemo(() => {
    const q = fold(query);
    if (q === "") return rows;
    return rows.filter((r) => fold(`${r.product.name ?? ""} ${r.product.brand ?? ""} ${r.product.barcode}`).includes(q));
  }, [rows, query]);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Prodotti che conosci</h1>
        <Link href="/app/qualita" className={ui.textLink}>
          Torna a Qualità
        </Link>
      </div>
      <Disclosure quiet title="Che cosa significa">
        Quelli che hai già letto con la fotocamera o comprato. Le alternative migliori si cercano soltanto qui: nessun prodotto che non conosci.
      </Disclosure>

      {!products ? (
        <LoadingLine />
      ) : rows.length === 0 ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Ancora nessun prodotto</h2>
          <p className={ui.emptyText}>Quando leggi un codice a barre il prodotto resta sul telefono e compare qui, anche per cercarlo senza rete.</p>
          <Button href={SHELF_PATH}>Modalità scaffale</Button>
        </div>
      ) : (
        <>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor="known-search">
              Cerca per nome, marca o codice
            </label>
            <input id="known-search" className={ui.input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </div>
          <p className={ui.hint}>
            {shown.length} {shown.length === 1 ? "prodotto" : "prodotti"} su {rows.length}.
          </p>
          <ul className={styles.known}>
            {shown.map(({ product, inLedger, inPantry }) => (
              <li key={product.barcode} className={styles.knownRow}>
                <Link href={qualityHref(product.barcode)}>
                  {product.name ?? "Nome non indicato"}
                  {product.brand ? ` (${product.brand})` : ""}
                </Link>
                <p className={styles.meta}>{displayProductCode(product)}</p>
                <p className={styles.small}>
                  {isDoubtfulProduct(product) ? RESTRICTED_WARNING_TITLE : outcomeCountText(assessProduct(product))}
                </p>
                {inLedger || inPantry ? (
                  <div className={styles.tags}>
                    {inPantry ? <span className={styles.tag}>In casa</span> : null}
                    {inLedger ? <span className={styles.tag}>Comprato o dichiarato</span> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={ui.hint}>{DATA_NOTE}</p>
        </>
      )}
    </div>
  );
}
