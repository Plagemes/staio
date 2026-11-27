"use client";

// Riquadro compatto della qualità di un prodotto, da montare dove il prodotto compare. Rimanda alla scheda completa.
import Link from "next/link";
import type { Product } from "@/core/catalog";
import { qualityGlance } from "./glance";
import { qualityHref } from "./links";
import { OutcomeBadge } from "./parts";
import styles from "./quality.module.css";

export interface QualityGlanceProps {
  product: Product;
  /** Testo del collegamento alla scheda completa. */
  linkLabel?: string;
}

export function QualityGlance({ product, linkLabel = "Perché e alternative" }: QualityGlanceProps) {
  const view = qualityGlance(product);
  if (!view) return null;
  return (
    <section className={styles.glance} aria-label="Qualità del prodotto">
      <p className={styles.glanceHead}>
        <strong>Qualità:</strong> <span className={styles.small}>{view.line}</span>
      </p>
      {view.chips.length > 0 ? (
        <ul className={styles.chips}>
          {view.chips.map((c) => (
            <li key={c.id} className={styles.chip}>
              <span>{c.label}:</span>
              <OutcomeBadge outcome={c.outcome} />
            </li>
          ))}
          {view.hidden > 0 ? <li className={styles.chip}>e altre {view.hidden}</li> : null}
        </ul>
      ) : null}
      <Link className={styles.link} href={qualityHref(product.barcode)}>
        {linkLabel}
      </Link>
    </section>
  );
}
