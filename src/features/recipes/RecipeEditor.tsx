"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Certainty } from "@/core/ledger";
import { Button } from "@/design";
import { createFoodSearch } from "../nutrition/candidates";
import { FoodChoice } from "../nutrition/FoodChoice";
import { useFoods } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import {
  addLeftoverAsIngredient,
  addLeftoverAsStep,
  buildRecipeFields,
  emptyErrors,
  emptyIngredient,
  emptyStep,
  type FormErrors,
  type IngredientRow,
  type RecipeForm,
  type StepRow,
} from "./form";
import { recipeEventFromFields } from "./model";
import styles from "./recipes.module.css";

interface RecipeEditorProps {
  initial: RecipeForm;
  /** Presente se si modifica una ricetta che esiste già: la nuova versione la sostituisce. */
  recipeId?: string;
  /** Voto da conservare nella nuova versione. */
  rating?: number;
  /** `measured` se scritta a mano, `estimated` se letta da una pagina o da un testo. */
  certainty: Certainty;
  title: string;
  /** Avviso in cima (per esempio «bozza da rivedere»). */
  banner?: ReactNode;
  /** Righe che l'importazione non ha saputo collocare. */
  leftovers?: readonly string[];
  saveLabel?: string;
}

export function RecipeEditor({ initial, recipeId, rating, certainty, title, banner, leftovers = [], saveLabel = "Salva la ricetta" }: RecipeEditorProps) {
  const router = useRouter();
  const ids = useId();
  const foods = useFoods();
  const search = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);
  const { recordWith, busy } = useRecord();
  const [form, setForm] = useState<RecipeForm>(initial);
  const [errors, setErrors] = useState<FormErrors>(emptyErrors());
  const [pending, setPending] = useState<string[]>(() => [...leftovers]);

  const set = <K extends keyof RecipeForm>(key: K, value: RecipeForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors(emptyErrors());
  };
  const patchIngredient = (id: number, change: Partial<IngredientRow>) => {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((r) =>
        r.id === id
          ? {
              ...r,
              // cambiare il nome cambia la domanda: la scelta fatta per il nome vecchio non vale più
              ...(change.name !== undefined && change.name !== r.name ? { foodId: undefined, none: false } : {}),
              ...change,
            }
          : r,
      ),
    }));
    setErrors(emptyErrors());
  };
  const patchStep = (id: number, change: Partial<StepRow>) => {
    setForm((f) => ({ ...f, steps: f.steps.map((r) => (r.id === id ? { ...r, ...change } : r)) }));
    setErrors(emptyErrors());
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const built = buildRecipeFields(form);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    let savedId = recipeId;
    const result = await recordWith((deviceId) => {
      const res = recipeEventFromFields(
        built.fields,
        { now: new Date().toISOString(), deviceId },
        { certainty, ...(recipeId ? { recipeId } : {}), ...(rating !== undefined ? { rating } : {}) },
      );
      if (!res.ok) throw new Error(res.error);
      savedId = res.event.recipeId;
      return { events: [res.event], message: recipeId ? `Ricetta aggiornata: ${built.fields.title}.` : `Ricetta salvata: ${built.fields.title}.` };
    });
    if (result.ok && savedId) router.push(`/app/ricette/vedi?id=${encodeURIComponent(savedId)}`);
    else if (!result.ok) setErrors({ ...emptyErrors(), general: result.error });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>{title}</h1>
      </div>
      {banner}

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-title`}>
            Titolo
          </label>
          <input
            id={`${ids}-title`}
            className={ui.input}
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            autoComplete="off"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${ids}-title-err` : undefined}
          />
          {errors.title ? (
            <p className={ui.error} id={`${ids}-title-err`}>
              {errors.title}
            </p>
          ) : null}
        </div>

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-serv`}>
            Porzioni
          </label>
          <input
            id={`${ids}-serv`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            value={form.servingsText}
            onChange={(e) => set("servingsText", e.target.value)}
            autoComplete="off"
            aria-invalid={errors.servings ? true : undefined}
          />
          <p className={ui.hint}>Le quantità degli ingredienti sono per questo numero di porzioni.</p>
          {errors.servings ? <p className={ui.error}>{errors.servings}</p> : null}
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>
            Tempi in minuti <span className={ui.optional}>(facoltativi)</span>
          </legend>
          <div className={styles.three}>
            {(
              [
                ["prep", "prepText", "Preparazione"],
                ["cook", "cookText", "Cottura"],
                ["total", "totalText", "Totale"],
              ] as const
            ).map(([key, field, label]) => (
              <div key={key} className={ui.field}>
                <label className={ui.hint} htmlFor={`${ids}-${key}`}>
                  {label}
                </label>
                <input
                  id={`${ids}-${key}`}
                  className={ui.input}
                  type="text"
                  inputMode="numeric"
                  value={form[field]}
                  onChange={(e) => set(field, e.target.value)}
                  autoComplete="off"
                  aria-invalid={errors.times[key] ? true : undefined}
                />
                {errors.times[key] ? <p className={ui.error}>{errors.times[key]}</p> : null}
              </div>
            ))}
          </div>
        </fieldset>

        <section className={ui.field} aria-labelledby={`${ids}-ing`}>
          <h2 className={ui.fieldLabel} id={`${ids}-ing`}>
            Ingredienti
          </h2>
          <p className={ui.hint}>Lascia vuota la quantità per «quanto basta». Un numero senza unità vale come pezzi.</p>
          <div className={styles.rows}>
            {form.ingredients.map((row, index) => (
              <div key={row.id} className={styles.row}>
                <div className={styles.rowFields}>
                  <input
                    className={ui.input}
                    type="text"
                    value={row.quantityText}
                    onChange={(e) => patchIngredient(row.id, { quantityText: e.target.value })}
                    placeholder="200 g"
                    autoComplete="off"
                    aria-label={`Quantità dell'ingrediente ${index + 1}`}
                    aria-invalid={errors.ingredients[row.id] ? true : undefined}
                  />
                  <input
                    className={ui.input}
                    type="text"
                    value={row.name}
                    onChange={(e) => patchIngredient(row.id, { name: e.target.value })}
                    placeholder="Farina 00"
                    autoComplete="off"
                    aria-label={`Nome dell'ingrediente ${index + 1}`}
                    aria-invalid={errors.ingredients[row.id] ? true : undefined}
                  />
                </div>
                <input
                  className={ui.input}
                  type="text"
                  value={row.note}
                  onChange={(e) => patchIngredient(row.id, { note: e.target.value })}
                  placeholder="Nota (setacciata, a temperatura ambiente…)"
                  autoComplete="off"
                  aria-label={`Nota dell'ingrediente ${index + 1}`}
                />
                {search && row.name.trim().length >= 2 ? (
                  <FoodChoice
                    name={row.name}
                    search={search}
                    foodId={row.foodId}
                    none={row.none === true}
                    onPick={(id) => patchIngredient(row.id, { foodId: id, none: false })}
                    onNone={() => patchIngredient(row.id, { foodId: undefined, none: true })}
                    onClear={() => patchIngredient(row.id, { foodId: undefined, none: false })}
                  />
                ) : null}
                {errors.ingredients[row.id] ? <p className={ui.error}>{errors.ingredients[row.id]}</p> : null}
                <Button
                  variant="text"
                  onClick={() => setForm((f) => ({ ...f, ingredients: f.ingredients.filter((r) => r.id !== row.id) }))}
                >
                  Togli
                </Button>
              </div>
            ))}
          </div>
          <div>
            <Button variant="outline" onClick={() => setForm((f) => ({ ...f, ingredients: [...f.ingredients, emptyIngredient()] }))}>
              Aggiungi un ingrediente
            </Button>
          </div>
          <p className={ui.hint}>
            La scelta dell&apos;alimento della tabella è facoltativa: serve a calcolare i nutrienti. Senza scelta, il nome basta se è riconoscibile.
          </p>
        </section>

        <section className={ui.field} aria-labelledby={`${ids}-steps`}>
          <h2 className={ui.fieldLabel} id={`${ids}-steps`}>
            Passi
          </h2>
          <div className={styles.rows}>
            {form.steps.map((row, index) => (
              <div key={row.id} className={styles.row}>
                <textarea
                  className={styles.textarea}
                  value={row.text}
                  onChange={(e) => patchStep(row.id, { text: e.target.value })}
                  aria-label={`Passo ${index + 1}`}
                  aria-invalid={errors.steps[row.id] ? true : undefined}
                />
                <div className={styles.rowFieldsWide}>
                  <label className={ui.hint} htmlFor={`${ids}-m${row.id}`}>
                    Durata in minuti, se serve un timer
                  </label>
                  <input
                    id={`${ids}-m${row.id}`}
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    value={row.minutesText}
                    onChange={(e) => patchStep(row.id, { minutesText: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                {errors.steps[row.id] ? <p className={ui.error}>{errors.steps[row.id]}</p> : null}
                <Button variant="text" onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((r) => r.id !== row.id) }))}>
                  Togli
                </Button>
              </div>
            ))}
          </div>
          <div>
            <Button variant="outline" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }))}>
              Aggiungi un passo
            </Button>
          </div>
        </section>

        {pending.length > 0 ? (
          <section className={ui.field} aria-labelledby={`${ids}-left`}>
            <h2 className={ui.fieldLabel} id={`${ids}-left`}>
              Righe che non ho riconosciuto
            </h2>
            <p className={ui.hint}>Non le ho scartate: scegli dove vanno, oppure lasciale fuori.</p>
            {pending.map((line, i) => (
              <div key={`${i}-${line}`} className={styles.leftover}>
                <p className={styles.leftoverText}>{line}</p>
                <div className={ui.row}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForm((f) => addLeftoverAsIngredient(f, line));
                      setPending((p) => p.filter((_, j) => j !== i));
                    }}
                  >
                    Come ingrediente
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForm((f) => addLeftoverAsStep(f, line));
                      setPending((p) => p.filter((_, j) => j !== i));
                    }}
                  >
                    Come passo
                  </Button>
                  <Button variant="text" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                    Lascia fuori
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-eq`}>
            Attrezzatura <span className={ui.optional}>(separata da virgola)</span>
          </label>
          <input id={`${ids}-eq`} className={ui.input} type="text" value={form.equipmentText} onChange={(e) => set("equipmentText", e.target.value)} placeholder="forno, frullatore" autoComplete="off" />
        </div>

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-tags`}>
            Etichette <span className={ui.optional}>(separate da virgola)</span>
          </label>
          <input id={`${ids}-tags`} className={ui.input} type="text" value={form.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="primo, veloce, vegetariano" autoComplete="off" />
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>
            Fonte <span className={ui.optional}>(facoltativa)</span>
          </legend>
          <label className={ui.hint} htmlFor={`${ids}-url`}>
            Indirizzo
          </label>
          <input
            id={`${ids}-url`}
            className={ui.input}
            type="url"
            inputMode="url"
            value={form.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
            placeholder="https://"
            autoComplete="off"
            aria-invalid={errors.sourceUrl ? true : undefined}
          />
          {errors.sourceUrl ? <p className={ui.error}>{errors.sourceUrl}</p> : null}
          <label className={ui.hint} htmlFor={`${ids}-author`}>
            Autore
          </label>
          <input id={`${ids}-author`} className={ui.input} type="text" value={form.sourceAuthor} onChange={(e) => set("sourceAuthor", e.target.value)} autoComplete="off" />
        </fieldset>

        {errors.general ? (
          <p className={ui.error} role="alert">
            {errors.general}
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Salvo…" : saveLabel}
        </Button>
      </form>
    </div>
  );
}
