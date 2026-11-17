import { formatQuantity } from "@/core/units";
import { ExpiryTag, Value } from "@/design";
import { dayOf, relativeDay } from "../format";
import { LOCATION_LABELS } from "../labels";
import { expiryTagView, type PantryEntry } from "../lots";
import styles from "./rows.module.css";

/** Riga di dettaglio: luogo, apertura e quantità rimasta. */
export function entryDetail(entry: PantryEntry, today: string) {
  const { lot } = entry;
  const remaining = formatQuantity({ value: lot.remaining, unit: lot.unit });
  const quantity =
    lot.remaining < lot.initial ? `${remaining} di ${formatQuantity({ value: lot.initial, unit: lot.unit })}` : remaining;
  return (
    <>
      {LOCATION_LABELS[lot.location]}
      {lot.openedAt ? ` · aperto ${relativeDay(dayOf(lot.openedAt), today)}` : ""}
      {" · "}
      <Value certainty={lot.remainingCertainty === "estimated" ? "estimated" : "measured"}>{quantity}</Value>
    </>
  );
}

export function entryExpiry(entry: PantryEntry) {
  const tag = expiryTagView(entry);
  if (!tag) return <span className={styles.noDate}>senza data</span>;
  return (
    <ExpiryTag level={tag.level} estimated={tag.estimated}>
      {tag.text}
    </ExpiryTag>
  );
}
