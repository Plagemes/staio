"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { NUTRIENT_FIELDS, kjToKcal, type LabelReading, type NutrientField, type ReadProblem } from "@/core/ai";
import { applyLabelValues, type Product } from "@/core/catalog";
import { putProductRecord } from "@/data";
import { Button } from "@/design";
import ui from "../ui.module.css";
import styles from "./AiCapture.module.css";
import { ReadInfo } from "./AiNotices";
import { NUTRIENT_LABELS, canConfirm, draftProduct, liveProblems, numbersOf, rescaled, valuesFromForm, type LabelForm } from "./labelDraft";
import type { CallInfo } from "./reads";

const LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ["it", "Italiano"],
  ["en", "Inglese"],
  ["fr", "Francese"],
  ["de", "Tedesco"],
  ["es", "Spagnolo"],
];

interface Props {
  barcode: string;
  /** La scheda com'è adesso; assente se non ce n'è ancora una per questo codice. */
  product: Product | undefined;
  /** Letti da una foto (bozza dell'intelligenza artificiale) o scritti dall'utente. */
  by: "photo" | "manual";
  /** Il modulo di partenza: la bozza letta, vuoto, o i valori già sulla scheda. */
  initial: LabelForm;
  /** Solo per la foto: le note della lettura. */
  reading?: LabelReading;
  info?: CallInfo;
  previewUrl?: string;
  /** Il nome lo sa già chi chiama (modulo Cattura): non lo si chiede. */
  hideName?: boolean;
  /** La scheda nasce da un alimento senza codice a barre: il codice è locale (`Product.localFromName`). */
  localFromName?: boolean;
  /** Il controllo di allergeni ed esclusioni, mostrato sulla scheda come diventerebbe confermando. */
  safety?: (draft: Product) => ReactNode;
  /** A valori salvati: la scheda nuova e quella di prima, per poter annullare. */
  onSaved: (next: Product, previous: Product | undefined) => void;
  onCancel: () => void;
}

/**
 * Il modulo di revisione, campo per campo, con i controlli di plausibilità: è lo stesso per i valori letti da una foto e per
 * quelli scritti a mano. Nulla si salva finché l'utente non conferma; si salva sul telefono, legato al codice, con
 * certezza `label`. Un campo vuoto resta «non indicato».
 */
export function NutritionReview({ barcode, product, by, initial, reading, info, previewUrl, hideName = false, localFromName = false, safety, onSaved, onCancel }: Props) {
  const ids = useId();
  const [form, setFormState] = useState<LabelForm>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAt] = useState(() => new Date().toISOString());

  const setForm = (update: (f: LabelForm) => LabelForm) => setFormState(update);
  const problems = useMemo(() => [...(reading?.problems ?? []), ...liveProblems(form)], [reading, form]);
  const draft = useMemo(() => draftProduct(form, product, barcode, readAt, by), [form, product, barcode, readAt, by]);
  const confirmable = canConfirm(form);
  const fieldKeys: readonly string[] = [...NUTRIENT_FIELDS, "energyKj", "serving"];
  const forField = (field: string): ReadProblem[] => problems.filter((p) => p.field === field);
  const general = problems.filter((p) => p.field === undefined || !fieldKeys.includes(p.field));
  const generalWarnings = general.filter((p) => p.severity !== "info");
  const generalInfos = general.filter((p) => p.severity === "info");

  async function onConfirm() {
    if (saving || !canConfirm(form)) return;
    setSaving(true);
    setError(null);
    try {
      const next = applyLabelValues(product, barcode, { ...valuesFromForm(form, product), ...(localFromName ? { localFromName: true as const } : {}) }, new Date().toISOString(), by);
      await putProductRecord({ barcode, fetchedAt: next.fetchedAt, data: next });
      onSaved(next, product);
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
      setSaving(false);
    }
  }

  const msgs = (field: string) => {
    const list = forField(field);
    if (list.length === 0) return null;
    return (
      <div id={`${ids}-${field}-msg`}>
        {list.map((m, i) => (
          <p key={`${m.code}-${i}`} className={m.severity === "error" ? styles.fieldMsgError : styles.fieldMsg}>
            {m.message}
          </p>
        ))}
      </div>
    );
  };
  const hasError = (field: string) => forField(field).some((m) => m.severity === "error");
  const text = (key: keyof LabelForm) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setForm((cur) => ({ ...cur, [key]: v }));
  };
  const showIngredients = !product?.ingredientsText;
  const detailsOpen = form.ingredients !== "" || form.allergens !== "" || form.traces !== "";

  return (
    // dentro il modulo di Cattura: Invio in un campo non deve aggiungere l'alimento alla dispensa
    <div
      className={styles.inline}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      <div className={ui.callout} role="note">
        <p className={ui.paragraph}>
          {by === "photo" ? (
            <>
              <strong>Sono valori letti da una foto, non misure.</strong> Controllali uno per uno con la confezione: nulla viene salvato finché non confermi.
            </>
          ) : (
            <>
              <strong>Scrivi i valori come sono stampati sull&apos;etichetta, per 100 g o 100 ml.</strong> Lascia vuoto ciò che non c&apos;è: resta «non indicato», non diventa zero.
            </>
          )}
        </p>
      </div>
      {previewUrl ? (
        <>
          {/* anteprima locale della foto appena ridotta: non passa da next/image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.preview} src={previewUrl} alt="Anteprima della foto dell'etichetta inviata" />
        </>
      ) : null}
      {info ? <ReadInfo info={info} problems={[]} /> : null}

      {generalWarnings.length > 0 ? (
        <div className={ui.callout}>
          <p className={ui.paragraph}>
            <strong>Da sapere</strong>
          </p>
          <ul className={ui.bullets}>
            {generalWarnings.map((p, i) => (
              <li key={`${p.code}-${i}`} className={ui.paragraph}>
                {p.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {generalInfos.length > 0 ? (
        <details className={styles.notes}>
          <summary>Note della lettura ({generalInfos.length})</summary>
          <ul className={ui.bullets}>
            {generalInfos.map((p, i) => (
              <li key={`${p.code}-${i}`} className={ui.hint}>
                {p.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-basis`}>
          Valori riferiti a
        </label>
        <select
          id={`${ids}-basis`}
          className={ui.input}
          value={form.basis === "unclear" ? "" : form.basis}
          onChange={(e) => {
            const v = e.target.value;
            setForm((f) => ({ ...f, basis: v === "100g" || v === "100ml" || v === "serving" ? v : "unclear" }));
          }}
        >
          <option value="">Scegli</option>
          <option value="100g">100 g</option>
          <option value="100ml">100 ml</option>
          <option value="serving">Una porzione</option>
        </select>
        {form.basis === "serving" ? (
          <>
            <label className={ui.fieldLabel} htmlFor={`${ids}-serving`}>
              Quanto è la porzione
            </label>
            <div className={styles.nutInput}>
              <input
                id={`${ids}-serving`}
                className={ui.input}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.serving}
                aria-invalid={hasError("serving") ? true : undefined}
                onChange={text("serving")}
              />
              <select
                className={ui.input}
                aria-label="Unità della porzione"
                value={form.servingUnit}
                onChange={(e) => {
                  const v = e.target.value === "ml" ? "ml" : "g";
                  setForm((f) => ({ ...f, servingUnit: v }));
                }}
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
              </select>
            </div>
            {msgs("serving")}
            <div className={ui.row}>
              <Button variant="outline" onClick={() => setForm((f) => rescaled(f))} disabled={form.serving.trim() === ""}>
                Riporta a 100 {form.servingUnit}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div className={styles.nutGrid}>
        {NUTRIENT_FIELDS.map((f: NutrientField) => (
          <div key={f} className={styles.nutRow}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-${f}`}>
              {NUTRIENT_LABELS[f].label}
            </label>
            <div className={styles.nutInput}>
              <input
                id={`${ids}-${f}`}
                className={ui.input}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.values[f]}
                aria-invalid={hasError(f) ? true : undefined}
                aria-describedby={forField(f).length > 0 ? `${ids}-${f}-msg` : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  // cambiando il valore dell'energia, la conferma dell'unità va data di nuovo
                  setForm((cur) => ({ ...cur, values: { ...cur.values, [f]: v }, ...(f === "energyKcal" ? { kcalConfirmed: false } : {}) }));
                }}
              />
              <span className={styles.nutUnit}>{NUTRIENT_LABELS[f].unit}</span>
            </div>
            {msgs(f)}
            {f === "energyKcal" ? (
              <>
                {forField(f).some((m) => m.code === "kj_as_kcal") ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const kcal = numbersOf(form).nutrients.energyKcal;
                      if (kcal !== undefined) setForm((cur) => ({ ...cur, values: { ...cur.values, energyKcal: String(kjToKcal(kcal)) } }));
                    }}
                  >
                    Sono kJ: converti in kcal
                  </Button>
                ) : null}
                {forField(f).some((m) => m.code === "energy_unit") ? (
                  <label className={ui.choice}>
                    <input type="checkbox" checked={form.kcalConfirmed} onChange={(e) => setForm((cur) => ({ ...cur, kcalConfirmed: e.target.checked }))} />
                    <span>Confermo: sono kcal, non kJ</span>
                  </label>
                ) : null}
                <label className={ui.fieldLabel} htmlFor={`${ids}-kj`}>
                  Energia in kJ <span className={ui.optional}>(facoltativa)</span>
                </label>
                <div className={styles.nutInput}>
                  <input
                    id={`${ids}-kj`}
                    className={ui.input}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.energyKj}
                    aria-invalid={hasError("energyKj") ? true : undefined}
                    onChange={text("energyKj")}
                  />
                  <span className={styles.nutUnit}>kJ</span>
                </div>
                {msgs("energyKj")}
              </>
            ) : null}
          </div>
        ))}
      </div>

      {!product?.name && !hideName ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Nome del prodotto <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input id={`${ids}-name`} className={ui.input} type="text" autoComplete="off" value={form.name} onChange={text("name")} />
        </div>
      ) : null}

      <details className={styles.notes} open={detailsOpen}>
        <summary>Ingredienti e allergeni (facoltativi)</summary>
        <div className={styles.inline}>
          {showIngredients ? (
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${ids}-ingredients`}>
                Ingredienti
              </label>
              <textarea id={`${ids}-ingredients`} className={styles.phrase} rows={4} value={form.ingredients} onChange={text("ingredients")} />
              <label className={ui.fieldLabel} htmlFor={`${ids}-lang`}>
                Lingua degli ingredienti
              </label>
              <select id={`${ids}-lang`} className={ui.input} value={form.ingredientsLang} onChange={text("ingredientsLang")}>
                <option value="">Non so</option>
                {LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <label className={ui.choice}>
                <input
                  type="checkbox"
                  checked={form.ingredientsComplete}
                  disabled={form.ingredients.trim() === ""}
                  onChange={(e) => setForm((cur) => ({ ...cur, ingredientsComplete: e.target.checked }))}
                />
                <span>È tutto l&apos;elenco degli ingredienti, dalla prima all&apos;ultima voce</span>
              </label>
              <p className={ui.hint}>
                Se non lo confermi, il controllo degli allergeni dice «incerto» per ciò che non trova. Legge bene solo gli ingredienti in italiano, come sono stampati: non tradurli.
              </p>
            </div>
          ) : null}
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-allergens`}>
              Allergeni dichiarati <span className={ui.optional}>(separati da virgola)</span>
            </label>
            <input id={`${ids}-allergens`} className={ui.input} type="text" autoComplete="off" value={form.allergens} onChange={text("allergens")} />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-traces`}>
              Possibili tracce <span className={ui.optional}>(separate da virgola)</span>
            </label>
            <input id={`${ids}-traces`} className={ui.input} type="text" autoComplete="off" value={form.traces} onChange={text("traces")} />
          </div>
        </div>
      </details>

      {safety ? safety(draft) : null}

      {!confirmable ? <p className={ui.hint}>Per salvare: scrivi almeno un valore, correggi i campi segnati e scegli a cosa si riferiscono.</p> : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={ui.row}>
        <Button onClick={() => void onConfirm()} disabled={!confirmable || saving}>
          {saving ? "Salvo…" : "Salva sul telefono"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Scarta
        </Button>
      </div>
    </div>
  );
}
