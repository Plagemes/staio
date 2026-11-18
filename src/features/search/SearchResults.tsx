"use client";

import type { ReactElement } from "react";
import { Label } from "@/design";
import { ActionList, type ActionItem } from "../common";
import ui from "../ui.module.css";
import type { SearchAction, SearchGroup, SearchResult } from "./searchIndex";
import styles from "./SearchResults.module.css";

interface Props {
  groups: readonly SearchGroup[];
  /** Una riga che fa qualcosa invece di aprire una pagina («Aggiungi “latte” alla spesa»). */
  onAction: (action: SearchAction) => void;
  disabled?: boolean;
}

/** I risultati della ricerca, un gruppo sotto l'altro. Una riga, un'azione: il tocco apre l'oggetto nel suo posto o fa ciò che la riga dice. */
export function SearchResults({ groups, onAction, disabled = false }: Props): ReactElement {
  const toItem = (result: SearchResult): ActionItem => {
    const { action } = result;
    return {
      id: result.id,
      label: result.label,
      ...(result.detail ? { hint: result.detail } : {}),
      ...(result.href !== undefined ? { href: result.href } : action ? { onSelect: () => onAction(action), disabled } : {}),
    };
  };

  return (
    <div className={styles.results}>
      {groups.map((group) => (
        <section key={group.title} className={styles.group} aria-label={group.title}>
          <Label as="h3" className={styles.title}>
            {group.title}
          </Label>
          {group.note ? <p className={ui.hint}>{group.note}</p> : null}
          {group.results.length > 0 ? <ActionList items={group.results.map(toItem)} /> : null}
          {group.footnote ? <p className={ui.hint}>{group.footnote}</p> : null}
        </section>
      ))}
    </div>
  );
}
