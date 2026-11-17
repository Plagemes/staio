"use client";

import { useState } from "react";
import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import { Button } from "@/design";
import ui from "../ui.module.css";
import styles from "./recipes.module.css";
import { blockedStillNote, clearText, confirmButtonText, type ConfirmableDoubt, type IngredientFlag } from "./safety";
import { useConfirmationActions } from "./useConfirmations";
import type { RecipeSafetyState } from "./useRecipeSafety";

/** Detto una volta nel pannello: la conferma è parola dell'utente, non un controllo dell'app. */
export const CONFIRMATION_NOTICE =
  "La conferma è una tua dichiarazione: l'app non ha verificato l'ingrediente e non rileva tracce né contaminazioni. Vale solo per gli allergeni che hai dichiarato adesso; puoi revocarla quando vuoi.";

/**
 * L'esito del controllo per una ricetta: contiene, non verificabile, confermato da te, nessuna corrispondenza (mai
 * «sicura»). Un ingrediente non verificabile si conferma da qui, uno alla volta: «ho letto l'etichetta, per me va bene».
 */
export function SafetyPanel({
  state,
  notice = true,
  title = "Allergeni ed esclusioni",
  heading,
}: {
  state: RecipeSafetyState;
  notice?: boolean;
  title?: string;
  /** Un titolo visibile sopra il pannello. */
  heading?: string;
}) {
  const actions = useConfirmationActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "none") return null;
  const head = heading ? <h2 className={ui.fieldLabel}>{heading}</h2> : null;
  if (state.status === "loading") {
    return (
      <section className={ui.section} aria-label={title}>
        {head}
        <p className={ui.hint}>Controllo gli ingredienti…</p>
      </section>
    );
  }
  const { safety, declared } = state;

  async function run(id: string, action: () => Promise<string | null>) {
    setBusy(id);
    setError(null);
    const failed = await action();
    setBusy(null);
    if (failed) setError(failed);
  }
  const confirm = (d: ConfirmableDoubt) => run(`c${d.index}`, () => actions.confirm(d.subject, declared));

  return (
    <section className={ui.section} aria-label={title}>
      {head}
      {safety.contains.length > 0 ? (
        <div role="alert" className={styles.safetyContains}>
          <strong>Contiene qualcosa che hai dichiarato</strong>
          {safety.contains.map((l, i) => (
            <p key={i} className={styles.safetyLine}>
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {safety.uncertain.length > 0 ? (
        <div className={styles.safetyUncertain}>
          <strong>Non verificabile</strong>
          {safety.uncertain.map((l, i) => (
            <p key={i} className={styles.safetyLine}>
              {l}
            </p>
          ))}
          {safety.doubts.length > 0 ? (
            <>
              <p className={styles.safetyLine}>
                Se hai letto l&apos;etichetta e per te va bene, puoi confermare un ingrediente alla volta.
              </p>
              {safety.doubts.map((d) => (
                <div key={d.index} className={ui.row}>
                  <Button variant="outline" disabled={busy !== null} onClick={() => void confirm(d)}>
                    {confirmButtonText(d.name, declared.allergens)}
                  </Button>
                </div>
              ))}
              {safety.contains.length > 0 ? <p className={styles.safetyLine}>{blockedStillNote()}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
      {safety.confirmed.length > 0 ? (
        <div className={styles.safetyConfirmed}>
          <strong>Confermato da te</strong>
          {safety.confirmed.map((c) => (
            <div key={c.key} className={ui.field}>
              <p className={styles.safetyLine}>
                «{c.name}»: {c.text} per {c.allergens.join(", ")}.
              </p>
              <div className={ui.row}>
                <Button
                  variant="text"
                  disabled={busy !== null}
                  onClick={() => void run(`r${c.key}`, () => actions.revoke(c.key, c.name))}
                >
                  Revoca la conferma di «{c.name}»
                </Button>
              </div>
            </div>
          ))}
          {safety.contains.length > 0 ? <p className={styles.safetyLine}>{blockedStillNote()}</p> : null}
          <p className={styles.safetyLine}>{CONFIRMATION_NOTICE}</p>
        </div>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      {safety.verdict === "clear" ? <p className={ui.paragraph}>{clearText(declared, safety.confirmed.length)}</p> : null}
      {notice ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      {safety.doubts.length > 0 && safety.confirmed.length === 0 ? <p className={ui.hint}>{CONFIRMATION_NOTICE}</p> : null}
    </section>
  );
}

/** Accanto all'ingrediente: «contiene latte», «non so cosa contiene: controlla l'etichetta» o «confermato da te il…». */
export function FlagText({ flag }: { flag: IngredientFlag | undefined }) {
  if (!flag) return null;
  const tone = flag.verdict === "contains" ? styles.flagContains : flag.verdict === "confirmed" ? styles.flagConfirmed : styles.flagUncertain;
  return <span className={tone}>{flag.text}</span>;
}
