"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { ReferenceWithVariant, Sex } from "@/core/nutrition";
import { Button, Label } from "@/design";
import { dayOf } from "../format";
import { setSetting } from "../localSettings";
import { LoadingLine } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { NutritionDisclaimer } from "./Disclaimer";
import { REFERENCE_KIND_LABELS, VARIANT_HELP, formatNutrient, nutrientLabel, variantLabel } from "./labels";
import { MIN_PROFILE_AGE, PROFILE_SETTING_KEY, currentAge, parseAge, variantChoices, type NutritionProfile } from "./profile";
import { saveNutritionProfile, useNutritionProfile, useReferences } from "./useNutrition";

interface EditorProps {
  initial: NutritionProfile | null;
  refs: readonly ReferenceWithVariant[];
  today: string;
}

function Editor({ initial, refs, today }: EditorProps) {
  const ids = useId();
  const [sex, setSex] = useState<Sex | "">(initial?.sex ?? "");
  const [ageText, setAgeText] = useState(initial ? String(currentAge(initial, today)) : "");
  const [variants, setVariants] = useState<Record<string, string>>(initial?.variants ?? {});
  const [errors, setErrors] = useState<{ sex?: string; age?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);

  const ageReading = parseAge(ageText);
  const choices = useMemo(
    () => (sex !== "" && ageReading.ok ? variantChoices(refs, { sex, ageYears: ageReading.value, variants }) : []),
    // la lettura dell'età cambia solo con il testo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refs, sex, ageText, variants],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (sex === "") next.sex = "Scegli una delle due opzioni: serve a trovare i riferimenti giusti.";
    if (!ageReading.ok) next.age = ageReading.error;
    setErrors(next);
    setSaved(false);
    if (next.sex || next.age || sex === "" || !ageReading.ok) return;
    // si tengono solo le scelte che esistono ancora per questo profilo
    const valid = new Set(choices.map((c) => c.key));
    const kept = Object.fromEntries(Object.entries(variants).filter(([k]) => valid.has(k)));
    try {
      await saveNutritionProfile({ sex, age: ageReading.value, savedOn: today, variants: kept });
      setVariants(kept);
      setSaved(true);
    } catch {
      setErrors({ form: "Non sono riuscito a salvare il profilo. Riprova." });
    }
  }

  async function onRemove() {
    try {
      await setSetting(PROFILE_SETTING_KEY, null);
      setSex("");
      setAgeText("");
      setVariants({});
      setSaved(false);
    } catch {
      setErrors({ form: "Non sono riuscito a rimuovere il profilo." });
    }
  }

  return (
    <form className={ui.form} onSubmit={onSubmit} noValidate>
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
                checked={sex === value}
                onChange={() => {
                  setSex(value);
                  setSaved(false);
                  setErrors((e) => ({ ...e, sex: undefined }));
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className={ui.hint}>I valori di riferimento sono definiti per questi due gruppi.</p>
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
          value={ageText}
          onChange={(e) => {
            setAgeText(e.target.value);
            setSaved(false);
            setErrors((x) => ({ ...x, age: undefined }));
          }}
          placeholder="42"
          aria-invalid={errors.age ? true : undefined}
          aria-describedby={errors.age ? `${ids}-age-error` : `${ids}-age-hint`}
        />
        {errors.age ? (
          <p className={ui.error} id={`${ids}-age-error`}>
            {errors.age}
          </p>
        ) : (
          <p className={ui.hint} id={`${ids}-age-hint`}>
            In anni. I riferimenti valgono dai {MIN_PROFILE_AGE} anni in su; gravidanza e allattamento non sono coperti.
          </p>
        )}
      </div>

      {choices.length > 0 ? (
        <section className={ui.field} aria-label="Scelte facoltative">
          <Label>Scelte facoltative</Label>
          <p className={ui.hint}>
            Per alcuni nutrienti esistono più valori di riferimento. Se non scegli, uso quello predefinito e te lo dico accanto al numero.
          </p>
          {choices.map((c) => (
            <fieldset key={c.key} className={ui.field}>
              <legend className={ui.fieldLabel}>
                {nutrientLabel(c.nutrient)} <span className={ui.optional}>({REFERENCE_KIND_LABELS[c.kind]})</span>
              </legend>
              {VARIANT_HELP[c.nutrient] ? <p className={ui.hint}>{VARIANT_HELP[c.nutrient]}</p> : null}
              <div className={ui.choices}>
                <label className={ui.choice}>
                  <input
                    type="radio"
                    name={`${ids}-${c.key}`}
                    checked={variants[c.key] === undefined}
                    onChange={() => {
                      setVariants((v) => {
                        const next = { ...v };
                        delete next[c.key];
                        return next;
                      });
                      setSaved(false);
                    }}
                  />
                  <span>Predefinita</span>
                </label>
                {c.options.map((o) => (
                  <label key={o.variant} className={ui.choice}>
                    <input
                      type="radio"
                      name={`${ids}-${c.key}`}
                      checked={variants[c.key] === o.variant}
                      onChange={() => {
                        setVariants((v) => ({ ...v, [c.key]: o.variant }));
                        setSaved(false);
                      }}
                    />
                    <span>
                      {variantLabel(o.variant)}
                      {o.amount !== undefined ? ` · ${formatNutrient(c.nutrient, o.amount)}` : ""}
                    </span>
                  </label>
                ))}
              </div>
              {variants[c.key] === undefined ? (
                <p className={ui.hint}>
                  Predefinita: {c.kind === "UL" ? "il valore più basso" : "il valore più alto"}
                  {c.applied ? ` (${variantLabel(c.applied)})` : ""}.
                </p>
              ) : null}
            </fieldset>
          ))}
        </section>
      ) : null}

      {errors.form ? (
        <p className={ui.error} role="alert">
          {errors.form}
        </p>
      ) : null}
      {saved ? (
        <p className={ui.callout} role="status">
          Profilo salvato su questo telefono.{" "}
          <Link href="/app/salute/nutrizione" className={ui.textLink}>
            Vai alla nutrizione
          </Link>
        </p>
      ) : null}

      <div className={ui.row}>
        <Button type="submit">Salva il profilo</Button>
        {initial ? (
          <Button variant="text" onClick={() => void onRemove()}>
            Rimuovi il profilo
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ProfileForm() {
  const { profile, ready } = useNutritionProfile();
  const refs = useReferences();
  const now = useNow();

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Profilo</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>
      <p className={ui.lead}>
        Sesso ed età servono solo a scegliere i valori di riferimento con cui confrontare ciò che mangi. Restano su questo telefono.
      </p>
      {!ready || !refs || !now ? (
        <LoadingLine />
      ) : (
        <Editor initial={profile} refs={refs} today={dayOf(now)} />
      )}
      <NutritionDisclaimer short />
    </div>
  );
}
