"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Location } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Label } from "@/design";
import { searchRecipes } from "@/models3d/catalog";
import { readQuantity, type CaptureField, type CaptureInput, type FieldErrors } from "../capture";
import { captureParamsKey, mergeCaptureParams, readCaptureParams, resolveCaptureFields, type CaptureEdits } from "../captureParams";
import { saveCapture } from "./saveCapture";
import { dayOf } from "../format";
import {
  EXPIRY_KIND_LABELS,
  FOOD_CATEGORY_GROUPS,
  FOOD_CATEGORY_LABELS,
  LOCATION_LABELS,
  LOCATION_ORDER,
  suggestCategory,
  type ChosenExpiryKind,
} from "../labels";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import styles from "./Capture.module.css";

const EXPIRY_KINDS: readonly (ChosenExpiryKind | "none")[] = ["use_by", "best_before", "none"];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function categoryFor(name: string): string {
  const model = name.trim().length >= 2 ? searchRecipes(name)[0]?.category : undefined;
  return suggestCategory(name, model) ?? "";
}

const subscribeNothing = () => () => {};
const readLocationSearch = () => window.location.search;
const noLocationSearch = () => "";

export function Capture() {
  const notice = useNotice();
  const now = useNow();
  const ids = useId();
  const search = useSearchParams();
  // Dati arrivati dal codice a barre. Non si leggono una volta sola: la pagina può essere disegnata prima che i
  // parametri siano disponibili (pagina statica, copia in cache), quindi si leggono a ogni disegno, anche
  // dall'indirizzo reale del browser, e riempiono solo i campi che l'utente non ha ancora toccato.
  const locationSearch = useSyncExternalStore(subscribeNothing, readLocationSearch, noLocationSearch);
  const arrived = useMemo(
    () =>
      mergeCaptureParams(
        readCaptureParams((key) => search.get(key)),
        readCaptureParams((key) => new URLSearchParams(locationSearch).get(key)),
      ),
    [search, locationSearch],
  );
  const arrivedKey = captureParamsKey(arrived);
  // dopo un salvataggio i parametri già usati non devono ricomparire
  const [spentKey, setSpentKey] = useState<string | null>(null);
  const prefill = spentKey === arrivedKey ? {} : arrived;
  const [edits, setEdits] = useState<CaptureEdits>({});
  const edit = (patch: CaptureEdits) => setEdits((e) => ({ ...e, ...patch }));
  const fields = resolveCaptureFields(prefill, edits);
  const { name, quantityText, barcode, brand } = fields;

  const [location, setLocation] = useState<Location>("frigo");
  const [expiryKind, setExpiryKind] = useState<ChosenExpiryKind | "none">("none");
  const [expiryDate, setExpiryDate] = useState("");
  const [priceText, setPriceText] = useState("");
  const [alreadyHave, setAlreadyHave] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const focusField = (field: CaptureField) => {
    const map = { name: nameRef, quantity: quantityRef, category: categoryRef, expiryDate: dateRef, price: priceRef, form: nameRef };
    map[field].current?.focus();
  };

  const deferredName = useDeferredValue(name);
  const suggestions = useMemo(() => {
    const q = deferredName.trim();
    if (q.length < 2) return [];
    const list = searchRecipes(q).slice(0, 5);
    // se il nome scritto è già uno dei suggerimenti, non serve riproporlo
    return list.length === 1 && fold(list[0].name) === fold(q) ? [] : list;
  }, [deferredName]);

  // categoria: scelta dell'utente, poi parametro, poi proposta dal nome
  const category = fields.category ?? categoryFor(name);

  const reading = quantityText.trim() === "" ? null : readQuantity(quantityText);
  const today = now ? dayOf(now) : null;
  const pastDate = expiryKind !== "none" && today !== null && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && expiryDate < today;

  function pickSuggestion(recipeName: string) {
    edit({ name: recipeName });
    quantityRef.current?.focus();
  }

  function clearError(field: CaptureField) {
    if (errors[field] || errors.form) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const input: CaptureInput = { name, quantityText, location, category, expiryKind, expiryDate, priceText, alreadyHave, barcode, brand };
      const result = await saveCapture(input, { appendEvents, getDeviceId, now: () => new Date().toISOString() });
      if (!result.ok) {
        setErrors(result.errors);
        const first = (["name", "quantity", "category", "expiryDate", "price"] as const).find((f) => result.errors[f]);
        focusField(first ?? "name");
        return;
      }
      notice.show({ message: `Aggiunto: ${result.summary}.`, undo: result.events });
      setErrors({});
      setSpentKey(arrivedKey);
      setEdits({});
      setExpiryDate("");
      setExpiryKind("none");
      setPriceText("");
      nameRef.current?.focus();
    } catch {
      setErrors({ form: "Non sono riuscito a salvare sul telefono. Riprova." });
    } finally {
      setSaving(false);
    }
  }

  const err = (field: CaptureField) => errors[field];
  const describedBy = (field: CaptureField, extra?: string) =>
    [err(field) ? `${ids}-${field}-error` : undefined, extra].filter(Boolean).join(" ") || undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Cattura</h1>
        <Label>{barcode ? "Da codice a barre" : "A mano"}</Label>
      </div>

      {barcode ? (
        <div className={ui.callout} role="status">
          <p className={ui.paragraph}>
            Dati letti dal codice a barre {barcode}
            {brand ? ` (${brand})` : ""}. Controllali e completa il resto: verranno salvati come letti in etichetta.
          </p>
          <button
            type="button"
            className={styles.unlink}
            onClick={() => edit({ barcode: null, brand: null })}
          >
            Non è questo prodotto: scollega
          </button>
        </div>
      ) : (
        <div className={styles.entry}>
          <div className={styles.entryButtons}>
            <Button href="/app/cattura/codice" variant="outline">
              Leggi il codice a barre
            </Button>
            <Button href="/app/cattura/scontrino" variant="outline">
              Leggi lo scontrino
            </Button>
          </div>
          <Link href="/app/pasto" className={ui.textLink}>
            Hai mangiato? Registra un pasto, anche a voce o con una foto
          </Link>
          <Link href="/app/cattura/veloce" className={ui.textLink}>
            Ho già in casa: aggiunta rapida di più alimenti
          </Link>
        </div>
      )}

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Nome
          </label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            className={ui.input}
            type="text"
            value={name}
            onChange={(e) => {
              edit({ name: e.target.value });
              clearError("name");
            }}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="next"
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={describedBy("name", suggestions.length > 0 ? `${ids}-suggest` : undefined)}
            placeholder="Latte, uova, petto di pollo…"
          />
          {err("name") ? (
            <p className={ui.error} id={`${ids}-name-error`}>
              {err("name")}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <div id={`${ids}-suggest`} role="group" aria-label="Suggerimenti dal catalogo" className={styles.suggestions}>
              {suggestions.map((r) => (
                <button key={r.id} type="button" className={styles.suggestion} onClick={() => pickSuggestion(r.name)}>
                  {r.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-quantity`}>
            Quantità
          </label>
          <input
            ref={quantityRef}
            id={`${ids}-quantity`}
            className={ui.input}
            type="text"
            value={quantityText}
            onChange={(e) => {
              edit({ quantityText: e.target.value });
              clearError("quantity");
            }}
            autoComplete="off"
            autoCapitalize="none"
            enterKeyHint="next"
            aria-invalid={err("quantity") ? true : undefined}
            aria-describedby={describedBy("quantity", `${ids}-quantity-hint`)}
            placeholder="500 g, 1 l, 6 uova"
          />
          {err("quantity") ? (
            <p className={ui.error} id={`${ids}-quantity-error`}>
              {err("quantity")}
            </p>
          ) : null}
          <p className={ui.hint} id={`${ids}-quantity-hint`}>
            {reading?.ok
              ? `Letto come ${formatQuantity(reading.quantity)}. Un numero senza unità conta come pezzi.`
              : "Scrivila come la diresti: «500 g», «1 l», «6 uova»."}
          </p>
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Dove lo metti</legend>
          <div className={ui.choices}>
            {LOCATION_ORDER.map((l) => (
              <label key={l} className={ui.choice}>
                <input type="radio" name={`${ids}-location`} value={l} checked={location === l} onChange={() => setLocation(l)} />
                <span>{LOCATION_LABELS[l]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-category`}>
            Categoria
          </label>
          <select
            ref={categoryRef}
            id={`${ids}-category`}
            className={ui.input}
            value={category}
            onChange={(e) => {
              edit({ category: e.target.value });
              clearError("category");
            }}
            aria-invalid={err("category") ? true : undefined}
            aria-describedby={describedBy("category", `${ids}-category-hint`)}
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
          <p className={ui.hint} id={`${ids}-category-hint`}>
            {category !== "" && fields.category === undefined
              ? "Proposta dal nome: cambiala se non va bene."
              : "Serve a stimare la scadenza quando manca la data."}
          </p>
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Scadenza</legend>
          <div className={ui.choices}>
            {EXPIRY_KINDS.map((k) => (
              <label key={k} className={ui.choice}>
                <input
                  type="radio"
                  name={`${ids}-expiry`}
                  value={k}
                  checked={expiryKind === k}
                  onChange={() => {
                    setExpiryKind(k);
                    clearError("expiryDate");
                  }}
                />
                <span>{EXPIRY_KIND_LABELS[k]}</span>
              </label>
            ))}
          </div>
          {expiryKind !== "none" ? (
            <>
              <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                Data in etichetta
              </label>
              <input
                ref={dateRef}
                id={`${ids}-date`}
                className={ui.input}
                type="date"
                value={expiryDate}
                onChange={(e) => {
                  setExpiryDate(e.target.value);
                  clearError("expiryDate");
                }}
                aria-invalid={err("expiryDate") ? true : undefined}
                aria-describedby={describedBy("expiryDate", pastDate ? `${ids}-date-hint` : undefined)}
              />
              {err("expiryDate") ? (
                <p className={ui.error} id={`${ids}-expiryDate-error`}>
                  {err("expiryDate")}
                </p>
              ) : null}
              {pastDate ? (
                <p className={ui.hint} id={`${ids}-date-hint`}>
                  Questa data è già passata: lo salvo comunque.
                </p>
              ) : null}
            </>
          ) : (
            <p className={ui.hint}>Senza data, la scadenza sarà una stima dalla categoria e dal luogo, e si vedrà come stima.</p>
          )}
        </fieldset>

        <div className={ui.field}>
          <label className={ui.switch}>
            <input
              type="checkbox"
              role="switch"
              checked={alreadyHave}
              onChange={(e) => {
                setAlreadyHave(e.target.checked);
                clearError("price");
              }}
            />
            <span className={ui.switchText}>
              Ce l&apos;avevo già in casa
              <span className={ui.hint}>Lo registro come già presente, non come acquisto, e la quantità conta come stima.</span>
            </span>
          </label>
        </div>

        {alreadyHave ? null : (
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-price`}>
              Prezzo <span className={ui.optional}>(facoltativo)</span>
            </label>
            <input
              ref={priceRef}
              id={`${ids}-price`}
              className={ui.input}
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => {
                setPriceText(e.target.value);
                clearError("price");
              }}
              autoComplete="off"
              aria-invalid={err("price") ? true : undefined}
              aria-describedby={describedBy("price")}
              placeholder="3,50"
            />
            {err("price") ? (
              <p className={ui.error} id={`${ids}-price-error`}>
                {err("price")}
              </p>
            ) : null}
            <p className={ui.hint}>Prezzo totale in euro, per tutta la quantità.</p>
          </div>
        )}

        {err("form") ? (
          <p className={ui.error} role="alert">
            {err("form")}
          </p>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? "Salvo…" : "Aggiungi alla dispensa"}
        </Button>
      </form>
    </div>
  );
}
