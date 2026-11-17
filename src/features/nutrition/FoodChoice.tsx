"use client";

import { Button } from "@/design";
import ui from "../ui.module.css";
import { FoodCandidates } from "./FoodCandidates";
import type { FoodSearch } from "./candidates";
import { stateLabel } from "./labels";
import styles from "./nutrition.module.css";

/**
 * Sotto il nome di una voce libera: l'alimento della tabella corrispondente, da scegliere con un tocco.
 * Il nome scritto non cambia; la scelta diventa `foodId`. Per gli alimenti con gemelli cotto/secco le due voci
 * sono affiancate e non c'è un predefinito. «Nessuno di questi» salva la voce senza alimento scelto.
 */
export function FoodChoice({
  name,
  search,
  foodId,
  none,
  onPick,
  onNone,
  onClear,
}: {
  name: string;
  search: FoodSearch;
  foodId: string | undefined;
  none: boolean;
  onPick: (id: string) => void;
  onNone: () => void;
  onClear: () => void;
}) {
  const chosen = search.byId(foodId);
  if (chosen) {
    return (
      <div className={styles.chosen} role="status">
        <span>
          Alimento scelto: <strong>{chosen.name}</strong>
          {chosen.state ? ` (${stateLabel(chosen.state)})` : ""}
        </span>
        <Button variant="text" onClick={onClear}>
          Cambia
        </Button>
      </div>
    );
  }
  const hasCandidates = search.groups(name).length > 0;
  if (!hasCandidates) return null;
  return (
    <div className={styles.choice}>
      <p className={ui.fieldLabel}>Quale alimento della tabella?</p>
      {none ? (
        <div className={styles.chosen} role="status">
          <span>
            Salvata senza alimento scelto: se il nome non basta a riconoscerla, resterà fuori dai calcoli nutrizionali.
          </span>
          <Button variant="text" onClick={onClear}>
            Scegli
          </Button>
        </div>
      ) : (
        <>
          <FoodCandidates query={name} search={search} onPick={(o) => onPick(o.id)} />
          <Button variant="outline" onClick={onNone}>
            Nessuno di questi
          </Button>
        </>
      )}
    </div>
  );
}
