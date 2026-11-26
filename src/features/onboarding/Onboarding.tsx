"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ALLERGEN_CHECK_NOTICE, foldVoice } from "@/core/allergens";
import { Button } from "@/design";
import { ALLERGEN_NAMES } from "../recipes/list";
import { declaredLists, readDietDeclarations, useDietDeclarations, writeDeclarationChanges } from "../allergens";
import ui from "../ui.module.css";
import { declarationDiff, splitVoices } from "./logic";
import styles from "./Onboarding.module.css";

const READ_ERROR = "Non riesco a leggere ciò che hai già dichiarato: riprova.";
const SAVE_ERROR = "Non sono riuscito a salvare. Riprova, o salta.";

interface OnboardingProps {
  /** Chiude l'introduzione (fatta o saltata): si resta su Oggi. */
  onDone: () => void;
}

/**
 * Dopo lo stile: una domanda sola, saltabile, con il suo perché. Scrive dove leggono le ricette, il codice a barre e la
 * Nutrizione (allergeni ed esclusioni): nessun secondo archivio. Sesso ed età stanno in «Primi passi», in Oggi.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const diet = useDietDeclarations();
  const readFailed = diet.error !== undefined || (diet.state !== undefined && !diet.state.complete);
  const ready = diet.ready && !readFailed;
  // ciò che c'era all'apertura: serve a sapere che cosa si è cambiato qui
  const [baseline, setBaseline] = useState<{ allergens: string[]; excludedFoods: string[] } | null>(null);
  if (ready && baseline === null && diet.state) setBaseline(declaredLists(diet.state));
  const declared = baseline ?? (diet.state ? declaredLists(diet.state) : { allergens: [], excludedFoods: [] });
  const [allergens, setAllergens] = useState<string[] | null>(null);
  const [foods, setFoods] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = allergens ?? declared.allergens;
  const chosenKeys = new Set(chosen.map(foldVoice));
  const foodsText = foods ?? declared.excludedFoods.join(", ");

  const toggle = (name: string) =>
    setAllergens(chosenKeys.has(foldVoice(name)) ? chosen.filter((a) => foldVoice(a) !== foldVoice(name)) : [...chosen, name]);

  async function onSubmit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (allergens !== null || foods !== null) {
        // si rilegge e si applicano solo le differenze fatte qui
        const fresh = declaredLists(await readDietDeclarations());
        const changes = [
          ...declarationDiff("allergens", fresh.allergens, declared.allergens, chosen),
          ...declarationDiff("excludedFoods", fresh.excludedFoods, declared.excludedFoods, splitVoices(foodsText, declared.excludedFoods)),
        ];
        if (changes.length > 0) {
          const result = await writeDeclarationChanges(changes, "onboarding");
          if (!result.ok) {
            setError(result.message || SAVE_ERROR);
            setBusy(false);
            return;
          }
        }
      }
      onDone();
    } catch {
      setError(SAVE_ERROR);
      setBusy(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={styles.intro}>
        <h1 className={ui.title} ref={heading} tabIndex={-1}>
          C&apos;è qualcosa che non puoi o non vuoi mangiare?
        </h1>
        <p className={ui.lead}>
          Lo uso per avvisarti nelle ricette e quando leggi un codice a barre. Le cambi quando vuoi in Impostazioni › Alimentazione.
        </p>
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={ui.fieldLabel}>Allergeni</legend>
        <div className={ui.choices}>
          {ALLERGEN_NAMES.map((a) => (
            <label key={a} className={ui.choice}>
              <input type="checkbox" checked={chosenKeys.has(foldVoice(a))} onChange={() => toggle(a)} disabled={!ready} />
              <span>{a}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-foods`}>
          Altri alimenti da escludere <span className={ui.optional}>(separati da virgola)</span>
        </label>
        <input
          id={`${ids}-foods`}
          className={ui.input}
          type="text"
          value={foodsText}
          onChange={(e) => setFoods(e.target.value)}
          placeholder="coriandolo, olive"
          autoComplete="off"
          disabled={!ready}
        />
        <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p>
      </div>
      {error !== null || readFailed ? (
        <p className={ui.error} role="alert">
          {readFailed ? READ_ERROR : error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={() => void onSubmit()} disabled={busy || !ready}>
          Fatto
        </Button>
        <Button variant="text" onClick={() => onDone()} disabled={busy}>
          Salta
        </Button>
      </div>
    </div>
  );
}
