"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Product } from "@/core/catalog";
import { assessProduct, personalVerdict, type PersonalStatement, type PersonalVerdict, type QualityAssessment } from "@/core/quality";
import { Label, SectionHeader } from "@/design";
import ui from "../ui.module.css";
import { alternativesView, type AlternativesView } from "./alternatives";
import { pantryLineOf, pantryStockFor, pricesFor } from "./candidates";
import { qualityHref } from "./links";
import { AddToListButton, DimensionList } from "./parts";
import { DATA_NOTE, NOT_MEDICAL, alternativeSentences, notAssessableText, outcomeCountText, priceLine } from "./texts";
import { useQualityContext, type QualityContext } from "./useQuality";
import styles from "./quality.module.css";

export interface ProductQualityProps {
  /** Il prodotto, già letto (da Open Food Facts o dalla memoria del telefono). */
  product: Product;
  /**
   * Dati dell'utente già caricati con `useQualityContext()` (profilo, confronti, obiettivi, prodotti noti, dispensa).
   * Se manca, il componente li carica da sé: passarli serve quando più schede stanno nella stessa pagina,
   * per non calcolare i confronti più volte.
   */
  context?: QualityContext;
}

/**
 * Scheda di qualità di un prodotto: le dimensioni una per una, ognuna con esito, perché e fonte; che cosa
 * aiuta e che cosa pesa per l'utente; se ne ha in casa; le alternative migliori tra i prodotti che conosce
 * con il confronto del prezzo per unità; il pulsante per aggiungere alla lista della spesa.
 * Nessun voto unico. Va montato dentro l'app (usa le notifiche e l'archivio locale).
 */
export function ProductQuality({ product, context }: ProductQualityProps) {
  return context ? <ProductQualityView product={product} context={context} /> : <WithOwnContext product={product} />;
}

function WithOwnContext({ product }: { product: Product }) {
  const context = useQualityContext();
  return <ProductQualityView product={product} context={context} />;
}

function Statements({ title, items }: { title: string; items: PersonalStatement[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <ul className={styles.bullets}>
        {items.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ul>
    </div>
  );
}

function PersonalSection({ verdict, context }: { verdict: PersonalVerdict; context: QualityContext }) {
  if (!context.personalReady) {
    return (
      <p className={styles.quiet} role="status">
        Calcolo come incide su di te…
      </p>
    );
  }
  return (
    <div className={styles.group}>
      {verdict.status === "insufficient_data" ? (
        <p className={styles.quiet}>{verdict.reason}</p>
      ) : (
        <>
          <Statements title="Per te pesa" items={verdict.weighs} />
          <Statements title="Per te aiuta" items={verdict.helps} />
          <Statements title="Da sapere" items={verdict.info} />
          {verdict.weighs.length === 0 && verdict.helps.length === 0 ? (
            <p className={styles.quiet}>Nessuna affermazione fondata sui dati disponibili: non dico né che ti aiuta né che ti pesa.</p>
          ) : null}
        </>
      )}
      {context.profileMissing ? (
        <p className={styles.small}>
          Senza sesso ed età non posso confrontare con i valori di riferimento.{" "}
          <Link href="/app/impostazioni/profilo" className={ui.textLink}>
            Compila il profilo
          </Link>
        </p>
      ) : null}
      {context.goals.length === 0 ? (
        <p className={styles.small}>
          Puoi indicare un obiettivo (per esempio ridurre il sale) nella{" "}
          <Link href="/app/qualita" className={ui.textLink}>
            pagina della qualità
          </Link>
          : lo uso per dire se il prodotto ti aiuta.
        </p>
      ) : null}
    </div>
  );
}

function Alternatives({ view, assessment }: { view: AlternativesView; assessment: QualityAssessment }) {
  const labelOf = (id: string) => assessment.dimensions.find((d) => d.id === id)?.label.toLowerCase() ?? id;
  return (
    <div className={styles.group}>
      <p className={styles.small}>
        Cerco tra i prodotti che conosci: quelli che hai già letto con la fotocamera o comprato. Non propongo altro.
      </p>
      {view.status === "no_category" || view.status === "nothing_to_improve" ? <p className={styles.quiet}>{view.reason}</p> : null}
      {view.status === "none" ? (
        <p className={styles.quiet}>{view.reason ?? "Tra i prodotti che conosci non ce n'è uno migliore."}</p>
      ) : null}
      {view.groups.map((g) => (
        <div key={g.dimension} className={styles.group}>
          <h3 className={styles.groupTitle}>Meglio su {g.label.toLowerCase()}</h3>
          {g.alternatives.map((alt) => (
            <article key={alt.product.barcode} className={styles.alt} aria-label={`Alternativa: ${alt.product.name ?? alt.product.barcode}`}>
              <Link className={styles.altName} href={qualityHref(alt.product.barcode)}>
                {alt.product.name ?? alt.product.barcode}
                {alt.product.brand ? ` (${alt.product.brand})` : ""}
              </Link>
              {alternativeSentences(alt, g.label).map((s) => (
                <p key={s} className={styles.dimReason}>
                  {s}
                </p>
              ))}
              {alt.alsoBetter.length > 0 ? <p className={styles.dimReason}>Meglio anche su: {alt.alsoBetter.map(labelOf).join(", ")}.</p> : null}
              <p className={styles.dimReason}>{priceLine(alt, view.referenceUnitPrice)}</p>
              <div className={ui.row}>
                <AddToListButton product={alt.product} label="Aggiungi l'alternativa alla spesa" />
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}

function ProductQualityView({ product, context }: { product: Product; context: QualityContext }) {
  const assessment = useMemo(() => assessProduct(product), [product]);
  const verdict = useMemo(() => personalVerdict(product, context.comparisons, context.goals), [product, context.comparisons, context.goals]);
  const alternatives = useMemo(() => {
    const prices = pricesFor(context.lots, product.barcode);
    return alternativesView({ product, ...(prices ? { prices } : {}) }, context.candidates);
  }, [product, context.candidates, context.lots]);
  const stock = useMemo(() => pantryStockFor(context.lots, product.barcode, product.name), [context.lots, product.barcode, product.name]);

  return (
    <article className={styles.card} aria-label="Scheda di qualità del prodotto">
      <div className={styles.heading}>
        <h2 className={styles.name}>{product.name ?? "Nome non indicato"}</h2>
        {product.brand ? <p className={styles.meta}>{product.brand}</p> : null}
        <p className={styles.meta}>{product.barcode}</p>
      </div>

      <section className={ui.section} aria-label="Dimensioni">
        <SectionHeader label="Dimensioni, una per una" />
        <p className={styles.counts}>{outcomeCountText(assessment)}</p>
        <p className={styles.unknown}>{notAssessableText(assessment)}</p>
        <p className={styles.small}>Nessun voto unico: ogni dimensione ha il suo esito, il suo perché e la sua fonte.</p>
        <DimensionList assessment={assessment} />
      </section>

      <section className={ui.section} aria-label="Per te">
        <SectionHeader label="Per te" />
        {context.ready ? <PersonalSection verdict={verdict} context={context} /> : <p className={styles.quiet}>Apro i dati del telefono…</p>}
      </section>

      <section className={ui.section} aria-label="In casa">
        <SectionHeader label="In casa" />
        <p className={ui.paragraph}>{context.ready ? pantryLineOf(product, stock) : "Apro i dati del telefono…"}</p>
      </section>

      <section className={ui.section} aria-label="Alternative tra i prodotti che conosci">
        <SectionHeader label="Alternative tra i prodotti che conosci" />
        {context.ready ? <Alternatives view={alternatives} assessment={assessment} /> : <p className={styles.quiet}>Apro i dati del telefono…</p>}
      </section>

      <div className={ui.row}>
        <AddToListButton product={product} variant="primary" />
      </div>

      <section className={ui.section} aria-label="Come leggere la scheda">
        <Label>Come leggere la scheda</Label>
        <ul className={styles.bullets}>
          <li>Grassi, grassi saturi, zuccheri e sale usano le soglie a semaforo di uno schema britannico volontario: non è una norma italiana né europea.</li>
          <li>Raggruppare Nutri-Score e NOVA in favorevole, intermedio e sfavorevole è una scelta di presentazione di questa app; la lettera e il gruppo restano sempre visibili.</li>
          <li>Gli additivi senza una valutazione ufficiale verificata si elencano soltanto, senza giudizio.</li>
          <li>{DATA_NOTE}</li>
          <li>{NOT_MEDICAL}</li>
        </ul>
      </section>
    </article>
  );
}
