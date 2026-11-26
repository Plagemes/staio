"use client";

import { Label, SectionHeader, Value } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { changeText, unitPriceText } from "./priceText";
import type { ShoppingView } from "./view";
import styles from "./shopping.module.css";

/** Storico dei prezzi per prodotto: ultimo, di solito, minimo e massimo. Stime dagli acquisti con prezzo. Sta dentro «Costi e prezzi», già richiusa. */
export function Prices({ view }: { view: ShoppingView }) {
  const { products, notComparable, singlePurchase } = view.histories;
  return (
    <section className={ui.section} aria-label="Prezzi">
      <SectionHeader label="Prezzi" />
      {products.length === 0 ? (
        <p className={ui.paragraph}>Servono due acquisti con prezzo dello stesso prodotto.</p>
      ) : (
        <ul className={styles.table}>
          {products.map((h) => (
            <li key={h.id} className={styles.rowLine}>
              <span>{h.name}</span>
              <strong>
                <Value certainty="estimated">{unitPriceText({ cents: h.last.cents, per: h.per })}</Value>
              </strong>
              <span className={styles.rowSub}>
                Ultimo {formatCalendarDate(h.last.date)}{h.last.store ? ` da ${h.last.store}` : ""}; di solito {unitPriceText(h.usual)} ({changeText(h)}); minimo {unitPriceText(h.lowest)}, massimo {unitPriceText(h.highest)}; {h.observations} acquisti.
              </span>
            </li>
          ))}
        </ul>
      )}
      {notComparable > 0 ? (
        <p className={ui.hint}>
          {notComparable} {notComparable === 1 ? "prodotto è comprato" : "prodotti sono comprati"} in unità diverse: restano fuori dal confronto.
        </p>
      ) : null}
      {singlePurchase > 0 ? <p className={ui.hint}>{singlePurchase} {singlePurchase === 1 ? "prodotto ha" : "prodotti hanno"} un solo acquisto con prezzo: non c&apos;è ancora uno storico.</p> : null}
      <Label>Stime</Label>
    </section>
  );
}
