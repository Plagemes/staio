// Quale momento di oggi, ancora nascosto, si mostra lo stesso perché ha qualcosa nel piano. Logica pura.
import type { MealKind } from "@/core/diary";
import type { DeclarableKind, MomentOffer } from "../meals";

export interface PlannedMomentFacts {
  kind: DeclarableKind;
  /** Niente dentro: né pasto o dichiarazione, né bevande, né alimenti sciolti. */
  empty: boolean;
}

/**
 * Il primo momento nascosto (non ancora cominciato) e vuoto che ha voci pianificate, nell'ordine della giornata.
 * Gli altri momenti nascosti restano nascosti. `offerOf` è `momentOffer`: qui non si decide quando comincia un momento.
 */
export function nextPlannedHidden(
  moments: readonly PlannedMomentFacts[],
  planned: readonly { meal: MealKind }[],
  offerOf: (kind: DeclarableKind) => MomentOffer,
): DeclarableKind | undefined {
  return moments.find((m) => m.empty && offerOf(m.kind) === "hidden" && planned.some((p) => p.meal === m.kind))?.kind;
}

/** Per una voce del piano che non si sa più espandere: «Non trovo più «Pasta al forno»: non so che cosa serve.» */
export function unresolvedText(name: string | undefined): string {
  return name ? `Non trovo più «${name}»: non so che cosa serve.` : "Non trovo più questa voce: non so che cosa serve.";
}
