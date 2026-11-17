"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Product } from "@/core/catalog";
import type { LedgerEvent, Location } from "@/core/ledger";
import { appendEvents, getDeviceId } from "@/data";
import { Button } from "@/design";
import type { CaptureInput, FieldErrors } from "../capture";
import { saveCapture, singleFlight, undoCapture, type SaveDeps } from "../capture/saveCapture";
import { dayOf } from "../format";
import {
  EXPIRY_KIND_LABELS,
  FOOD_CATEGORY_GROUPS,
  FOOD_CATEGORY_LABELS,
  LOCATION_LABELS,
  LOCATION_ORDER,
  type ChosenExpiryKind,
} from "../labels";
import { qualityHref } from "../quality/links";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import { captureHref } from "./links";
import {
  confirmationText,
  draftFromProduct,
  estimatedExpiryText,
  inputFromDraft,
  locationFor,
  missingFields,
  type DirectAnswers,
} from "./directAdd";
import styles from "./BarcodeCapture.module.css";

const deps: SaveDeps = { appendEvents, getDeviceId, now: () => new Date().toISOString() };
const EXPIRY_CHOICES: readonly (ChosenExpiryKind | "none")[] = ["none", "use_by", "best_before"];

interface Added {
  events: LedgerEvent[];
  text: string;
}

/** Azioni della scheda: aggiunta con un tocco e, subito dopo, la conferma con «Annulla». */
export function AddToPantry({ product, onAgain }: { product: Product; onAgain: () => void }) {
  const ids = useId();
  const now = useNow();
  const today = now ? dayOf(now) : null;
  const draft = useMemo(() => draftFromProduct(product), [product]);
  const missing = useMemo(() => missingFields(draft), [draft]);

  const [answers, setAnswers] = useState<DirectAnswers>({});
  const [place, setPlace] = useState<Location | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);

  // il primo dato mancante parte già a fuoco
  useEffect(() => {
    const first = missingFields(draft)[0];
    const ref = first === "name" ? nameRef : first === "quantity" ? quantityRef : first === "category" ? categoryRef : null;
    ref?.current?.focus();
  }, [draft]);

  const category = answers.category || draft.category;
  const location = place ?? locationFor(category);
  const expiryKind = answers.expiryKind ?? "none";

  // una sola scrittura alla volta: il secondo tocco riceve la risposta del primo
  const save = useMemo(() => singleFlight((input: CaptureInput) => saveCapture(input, deps)), []);
  const undo = useMemo(() => singleFlight((events: LedgerEvent[]) => undoCapture(events, deps)), []);

  function set(patch: DirectAnswers) {
    setAnswers((a) => ({ ...a, ...patch }));
    setErrors({});
  }

  async function onAdd() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await save(inputFromDraft(draft, location, answers));
      if (!result.ok) {
        setErrors(result.errors);
        if (result.errors.expiryDate || result.errors.price) setMoreOpen(true);
        if (result.errors.name) nameRef.current?.focus();
        else if (result.errors.quantity) quantityRef.current?.focus();
        else if (result.errors.category) categoryRef.current?.focus();
        return;
      }
      setErrors({});
      setAdded({ events: result.events, text: confirmationText(result.events[0], dayOf(new Date().toISOString())) });
    } catch {
      setErrors({ form: "Non sono riuscito a salvare sul telefono. Riprova." });
    } finally {
      setSaving(false);
    }
  }

  async function onUndo() {
    if (!added || saving) return;
    setSaving(true);
    try {
      await undo(added.events);
      setAdded(null);
      setMessage("Annullato: non è più in dispensa.");
    } catch {
      setMessage("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  if (added) {
    return (
      <div className={styles.added}>
        <p className={ui.paragraph} role="status">
          {added.text}
        </p>
        {message ? <p className={ui.error}>{message}</p> : null}
        <div className={ui.row}>
          <Button href="/app/dispensa">Vai alla dispensa</Button>
          <Button variant="outline" onClick={onAgain}>
            Leggi un altro codice
          </Button>
          <Button variant="text" onClick={() => void onUndo()} disabled={saving}>
            Annulla
          </Button>
        </div>
      </div>
    );
  }

  const err = (field: keyof FieldErrors) => errors[field];

  return (
    <div className={styles.add}>
      {missing.length > 0 ? (
        <p className={ui.hint}>
          {missing.length === 1 ? "Un dato non l'ho trovato: scrivilo qui sotto e poi aggiungi." : "Alcuni dati non li ho trovati: scrivili qui sotto e poi aggiungi."}
        </p>
      ) : null}

      {missing.includes("name") ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Nome
          </label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            className={ui.input}
            type="text"
            value={answers.name ?? ""}
            onChange={(e) => set({ name: e.target.value })}
            autoComplete="off"
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={err("name") ? `${ids}-name-error` : undefined}
          />
          {err("name") ? (
            <p className={ui.error} id={`${ids}-name-error`}>
              {err("name")}
            </p>
          ) : null}
        </div>
      ) : null}

      {missing.includes("quantity") ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-quantity`}>
            Quantità
          </label>
          <input
            ref={quantityRef}
            id={`${ids}-quantity`}
            className={ui.input}
            type="text"
            value={answers.quantityText ?? ""}
            onChange={(e) => set({ quantityText: e.target.value })}
            autoComplete="off"
            autoCapitalize="none"
            placeholder="500 g, 1 l, 6 uova"
            aria-invalid={err("quantity") ? true : undefined}
            aria-describedby={err("quantity") ? `${ids}-quantity-error` : undefined}
          />
          {err("quantity") ? (
            <p className={ui.error} id={`${ids}-quantity-error`}>
              {err("quantity")}
            </p>
          ) : null}
        </div>
      ) : null}

      {missing.includes("category") ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-category`}>
            Categoria
          </label>
          <select
            ref={categoryRef}
            id={`${ids}-category`}
            className={ui.input}
            value={answers.category ?? ""}
            onChange={(e) => set({ category: e.target.value })}
            aria-invalid={err("category") ? true : undefined}
            aria-describedby={err("category") ? `${ids}-category-error` : undefined}
          >
            <option value="">Scegli una categoria</option>
            {FOOD_CATEGORY_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {FOOD_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {err("category") ? (
            <p className={ui.error} id={`${ids}-category-error`}>
              {err("category")}
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Dove lo metti</legend>
        <div className={ui.choices}>
          {LOCATION_ORDER.map((l) => (
            <label key={l} className={ui.choice}>
              <input type="radio" name={`${ids}-location`} value={l} checked={location === l} onChange={() => setPlace(l)} />
              <span>{LOCATION_LABELS[l]}</span>
            </label>
          ))}
        </div>
        {expiryKind === "none" ? (
          <p className={ui.hint}>{today ? estimatedExpiryText(category, location, today) : "Senza data, la scadenza sarà una stima."}</p>
        ) : null}
      </fieldset>

      <details className={styles.more} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>Data stampata e prezzo (facoltativi)</summary>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-kind`}>
            Scadenza
          </label>
          <select
            id={`${ids}-kind`}
            className={ui.input}
            value={expiryKind}
            onChange={(e) => set({ expiryKind: e.target.value as ChosenExpiryKind | "none" })}
          >
            {EXPIRY_CHOICES.map((k) => (
              <option key={k} value={k}>
                {EXPIRY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {expiryKind !== "none" ? (
            <>
              <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                Data in etichetta
              </label>
              <input
                id={`${ids}-date`}
                className={ui.input}
                type="date"
                value={answers.expiryDate ?? ""}
                onChange={(e) => set({ expiryDate: e.target.value })}
                aria-invalid={err("expiryDate") ? true : undefined}
              />
              {err("expiryDate") ? <p className={ui.error}>{err("expiryDate")}</p> : null}
            </>
          ) : null}
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-price`}>
            Prezzo <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input
            id={`${ids}-price`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            value={answers.priceText ?? ""}
            onChange={(e) => set({ priceText: e.target.value })}
            autoComplete="off"
            placeholder="3,50"
            aria-invalid={err("price") ? true : undefined}
          />
          {err("price") ? <p className={ui.error}>{err("price")}</p> : null}
        </div>
      </details>

      {err("form") ? (
        <p className={ui.error} role="alert">
          {err("form")}
        </p>
      ) : null}
      {message ? <p className={ui.hint}>{message}</p> : null}

      <div className={ui.row}>
        <Button onClick={() => void onAdd()} disabled={saving}>
          {saving ? "Salvo…" : "Aggiungi alla dispensa"}
        </Button>
        <Button variant="outline" onClick={onAgain}>
          Leggi un altro codice
        </Button>
        <Button variant="text" href={qualityHref(product.barcode)}>
          Qualità
        </Button>
      </div>
      <Button variant="text" href={captureHref(product)}>
        Modifica prima di aggiungere
      </Button>
    </div>
  );
}
