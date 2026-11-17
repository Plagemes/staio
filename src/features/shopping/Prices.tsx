"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Label, SectionHeader, Value } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import { changeText, unitPriceText } from "./priceText";
import type { ShoppingView } from "./view";
import styles from "./shopping.module.css";

/** Storico dei prezzi per prodotto, richiudibile: ultimo, di solito, minimo e massimo. Stime dagli acquisti con prezzo. */
export function Prices({ view }: { view: ShoppingView }) {
  const [open, setOpen] = useState(false);
  const { products, notComparable, singlePurchase } = view.histories;
  const panelId = "shopping-prices";
  return (
    <section className={ui.section} aria-label="Prezzi">
      <div className={ui.head}>
        <SectionHeader label="Prezzi" />
        <Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          {open ? "Nascondi" : "Mostra"}
        </Button>
      </div>
      <div id={panelId} hidden={!open}>
        {open ? (
          <>
            {products.length === 0 ? (
              <p className={ui.paragraph}>Servono almeno due acquisti dello stesso prodotto con il prezzo per vedere come cambia. Il prezzo si scrive alla cattura o si legge dallo scontrino.</p>
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
                {notComparable} {notComparable === 1 ? "prodotto è stato comprato" : "prodotti sono stati comprati"} in unità diverse (per esempio a pezzi e a peso): senza il peso del pezzo non li confronto, restano fuori.
              </p>
            ) : null}
            {singlePurchase > 0 ? <p className={ui.hint}>{singlePurchase} {singlePurchase === 1 ? "prodotto ha" : "prodotti hanno"} un solo acquisto con prezzo: non c&apos;è ancora uno storico.</p> : null}
            <Label>Stime</Label>
          </>
        ) : null}
      </div>
      <Link href="/app/salute/nutrizione" className={ui.textLink}>
        Costo per nutriente
      </Link>
    </section>
  );
}
