"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ALLERGEN_CHECK_NOTICE, foldVoice } from "@/core/allergens";
import { getSetting, setSetting, useSetting } from "@/data";
import { Button, Label } from "@/design";
import { hasUsableKey } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { dayOf } from "../format";
import { MIN_PROFILE_AGE, PROFILE_SETTING_KEY, isNutritionProfile, parseAge, type NutritionProfile } from "../nutrition/profile";
import { ALLERGEN_NAMES } from "../recipes/list";
import { declaredLists, readDietDeclarations, useDietDeclarations, writeDeclarationChanges } from "../allergens";
import ui from "../ui.module.css";
import { declarationDiff, splitVoices, type StartChoice } from "./logic";
import styles from "./Onboarding.module.css";

const STEPS = 3;
const READ_ERROR = "Non riesco a leggere ciò che hai già dichiarato: riprova.";
const SAVE_ERROR = "Non sono riuscito a salvare. Riprova, o salta.";

interface OnboardingProps {
  /** Chiude il percorso (fatto o saltato) e ricorda dove si voleva cominciare. */
  onDone: (start?: StartChoice) => void;
}

/**
 * Dopo lo stile: tre domande, tutte saltabili, ognuna con il suo perché. Scrive negli stessi posti dove leggono
 * le ricette, il codice a barre e la Nutrizione (allergeni ed esclusioni, `nutritionProfile`): nessun secondo archivio.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS - 1));

  return (
    <div className={ui.screen}>
      <div className={styles.head}>
        <Label>
          Domanda {step + 1} di {STEPS}
        </Label>
        <button type="button" className={ui.textLink} onClick={() => onDone()}>
          Salta tutto
        </button>
      </div>
      {step === 0 ? <AvoidStep headingRef={heading} onNext={next} /> : null}
      {step === 1 ? <ProfileStep headingRef={heading} onNext={next} /> : null}
      {step === 2 ? <StartStep headingRef={heading} onDone={onDone} /> : null}
    </div>
  );
}

interface StepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
}

function AvoidStep({ headingRef, onNext }: StepProps & { onNext: () => void }) {
  const ids = useId();
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
      onNext();
    } catch {
      setError(SAVE_ERROR);
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.intro}>
        <h1 className={ui.title} ref={headingRef} tabIndex={-1}>
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
          Avanti
        </Button>
        <Button variant="text" onClick={onNext} disabled={busy}>
          Salta
        </Button>
      </div>
    </>
  );
}

function ProfileStep({ headingRef, onNext }: StepProps & { onNext: () => void }) {
  const ids = useId();
  const live = useSetting<unknown>(PROFILE_SETTING_KEY);
  const readFailed = live.error !== undefined && live.error !== null;
  const ready = !live.loading && !readFailed;
  const profile: NutritionProfile | null = isNutritionProfile(live.data) ? live.data : null;
  const [sex, setSex] = useState<"female" | "male" | null>(null);
  const [ageText, setAgeText] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ sex?: string; age?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const shownSex = sex ?? profile?.sex ?? "";
  const shownAge = ageText ?? (profile ? String(profile.age) : "");

  async function onSubmit() {
    const age = parseAge(shownAge);
    const next: typeof errors = {};
    if (shownSex === "") next.sex = "Scegli una delle due opzioni, oppure salta.";
    if (!age.ok) next.age = age.error;
    setErrors(next);
    if (next.sex || next.age || shownSex === "" || !age.ok || !ready) return;
    // nulla toccato in questa schermata: non si scrive
    if (sex === null && ageText === null && profile !== null) {
      onNext();
      return;
    }
    setBusy(true);
    try {
      const fresh = await getSetting<unknown>(PROFILE_SETTING_KEY);
      const base = isNutritionProfile(fresh) ? fresh : null;
      const same = base !== null && base.sex === shownSex && base.age === age.value;
      await setSetting<NutritionProfile>(PROFILE_SETTING_KEY, {
        sex: shownSex,
        age: age.value,
        savedOn: same ? base.savedOn : dayOf(new Date().toISOString()),
        variants: same ? base.variants : {},
      });
      onNext();
    } catch {
      setErrors({ form: "Non sono riuscito a salvare. Riprova, o salta." });
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.intro}>
        <h1 className={ui.title} ref={headingRef} tabIndex={-1}>
          Sesso ed età
        </h1>
        <p className={ui.lead}>
          Servono a scegliere i valori di riferimento per la nutrizione, e restano sul telefono. Puoi cambiarli in Impostazioni, Persona.
        </p>
      </div>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Sesso</legend>
        <div className={ui.choices}>
          {(
            [
              ["female", "Donna"],
              ["male", "Uomo"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={ui.choice}>
              <input
                type="radio"
                name={`${ids}-sex`}
                value={value}
                checked={shownSex === value}
                onChange={() => {
                  setSex(value);
                  setErrors((e) => ({ ...e, sex: undefined }));
                }}
                disabled={!ready}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {errors.sex ? (
          <p className={ui.error} role="alert">
            {errors.sex}
          </p>
        ) : null}
      </fieldset>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-age`}>
          Età
        </label>
        <input
          id={`${ids}-age`}
          className={ui.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={shownAge}
          onChange={(e) => {
            setAgeText(e.target.value);
            setErrors((x) => ({ ...x, age: undefined }));
          }}
          placeholder="42"
          aria-invalid={errors.age ? true : undefined}
          aria-describedby={`${ids}-age-note`}
          disabled={!ready}
        />
        {errors.age ? (
          <p className={ui.error} id={`${ids}-age-note`}>
            {errors.age}
          </p>
        ) : (
          <p className={ui.hint} id={`${ids}-age-note`}>
            In anni. I riferimenti valgono dai {MIN_PROFILE_AGE} anni in su.
          </p>
        )}
      </div>
      {errors.form || readFailed ? (
        <p className={ui.error} role="alert">
          {readFailed ? READ_ERROR : errors.form}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={() => void onSubmit()} disabled={busy || !ready}>
          Avanti
        </Button>
        <Button variant="text" onClick={onNext} disabled={busy}>
          Salta
        </Button>
      </div>
    </>
  );
}

function StartStep({ headingRef, onDone }: StepProps & { onDone: (start?: StartChoice) => void }) {
  const router = useRouter();
  const ai = useAiSettings();
  const photo = ai.ready && hasUsableKey(ai.settings);

  function go(start: StartChoice, href?: string) {
    onDone(start);
    if (href) router.push(href);
  }

  return (
    <>
      <div className={styles.intro}>
        <h1 className={ui.title} ref={headingRef} tabIndex={-1}>
          Da dove vuoi cominciare?
        </h1>
        <p className={ui.lead}>Scegli la strada più comoda adesso. Le altre le trovi sempre nella barra in basso.</p>
      </div>
      <div className={styles.starts}>
        <div className={styles.start}>
          <Button onClick={() => go("pantry", "/app/cattura/veloce")}>Segno cosa ho in casa</Button>
          <div className={ui.row}>
            <button type="button" className={ui.textLink} onClick={() => go("pantry", "/app/cattura/codice")}>
              Leggo un codice a barre
            </button>
            {photo ? (
              <button type="button" className={ui.textLink} onClick={() => go("pantry", "/app/dispensa/foto")}>
                Fotografo il frigo
              </button>
            ) : null}
          </div>
        </div>
        <Button variant="outline" onClick={() => go("meal", "/app/pasto")}>
          Segno cosa mangio
        </Button>
        <Button variant="outline" onClick={() => go("look")}>
          Guardo in giro
        </Button>
      </div>
    </>
  );
}
