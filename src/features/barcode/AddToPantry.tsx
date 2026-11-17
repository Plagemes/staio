"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { locationFromStorage, type Product } from "@/core/catalog";
import { addDays } from "@/core/expiry";
import { activeLots, type LedgerEvent, type Location } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getSetting, setSetting, usePantry } from "@/data";
import { Button } from "@/design";
import { readQuantity, type CaptureInput, type FieldErrors } from "../capture";
import { singleFlight, undoCapture, type SaveDeps } from "../capture/saveCapture";
import { dayOf, formatCalendarDate } from "../format";
import {
  EXPIRY_KIND_LABELS,
  FOOD_CATEGORY_GROUPS,
  FOOD_CATEGORY_LABELS,
  LOCATION_LABELS,
  LOCATION_ORDER,
  type ChosenExpiryKind,
} from "../labels";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import { captureHref } from "./links";
import {
  buildPackEvents,
  buildPackInputs,
  packsSummary,
  resolvePieces,
  checkPackGroups,
  clampPacks,
  defaultExpiryKind,
  draftFromProduct,
  estimatedExpiryDate,
  locationFor,
  missingFields,
  packsConfirmationText,
  splitPackGroups,
  type DirectAnswers,
  type PackEventsResult,
  type PackGroup,
} from "./directAdd";
import { loadRemembered, rememberChoice, type ChoiceStore, type Remembered } from "./memory";
import { PackCounter, PackGroupsEditor, PiecesField } from "../capture/PackControls";
import styles from "./BarcodeCapture.module.css";

const deps: SaveDeps = { appendEvents, getDeviceId, now: () => new Date().toISOString() };
const choiceStore: ChoiceStore = { get: (key) => getSetting(key), set: (key, value) => setSetting(key, value) };
const KINDS: readonly ChosenExpiryKind[] = ["use_by", "best_before"];
const SHORTCUTS: readonly (readonly [string, number])[] = [
  ["Tra 3 giorni", 3],
  ["Tra 1 settimana", 7],
  ["Tra 2 settimane", 14],
  ["Tra 1 mese", 30],
];

interface Added {
  events: LedgerEvent[];
  text: string;
}

/** Azioni della scheda: aggiunta con un tocco e, subito dopo, la conferma con «Annulla». */
export function AddToPantry({
  product,
  scannedExpiry,
  onAgain,
}: {
  product: Product;
  /** Data letta da un codice GS1: precompila la scadenza. */
  scannedExpiry?: { date: string; kind: ChosenExpiryKind };
  onAgain: () => void;
}) {
  const ids = useId();
  const now = useNow();
  const today = now ? dayOf(now) : null;
  const draft = useMemo(() => draftFromProduct(product), [product]);
  const missing = useMemo(() => missingFields(draft), [draft]);
  const pantry = usePantry();
  const alreadyHave = useMemo(
    () => (pantry.data ? activeLots(pantry.data).filter((l) => l.barcode === product.barcode).length : 0),
    [pantry.data, product.barcode],
  );

  const [answers, setAnswers] = useState<DirectAnswers>(() =>
    scannedExpiry ? { expiryDate: scannedExpiry.date, expiryKind: scannedExpiry.kind } : {},
  );
  const [place, setPlace] = useState<Location | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [packs, setPacks] = useState(1);
  const [differentDates, setDifferentDates] = useState(false);
  const [groups, setGroups] = useState<PackGroup[]>([]);
  const [remembered, setRemembered] = useState<Remembered | undefined>(undefined);
  // pezzi dentro la confezione: la scritta «2 x 100 g» li precompila, la porzione e gli imballaggi li propongono soltanto
  const [piecesCount, setPiecesCount] = useState(() => (draft.piecesHint?.source === "label" ? draft.piecesHint.count : 0));
  const [eachText, setEachText] = useState<string | null>(null);
  const [piecesTouched, setPiecesTouched] = useState(false);

  const piecesTouchedRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);

  // il primo dato mancante parte già a fuoco
  useEffect(() => {
    const first = missingFields(draft)[0];
    const ref = first === "name" ? nameRef : first === "quantity" ? quantityRef : first === "category" ? categoryRef : null;
    ref?.current?.focus();
  }, [draft]);

  // categoria e luogo scelti l'ultima volta per questo codice, o per un prodotto simile
  useEffect(() => {
    let alive = true;
    loadRemembered(product, choiceStore)
      .then((r) => {
        if (!alive) return;
        setRemembered(r);
        if (r?.kind === "barcode" && r.pieces) {
          setPiecesCount((c) => (piecesTouchedRef.current ? c : r.pieces!.count));
          setEachText((t) => (piecesTouchedRef.current ? t : String(r.pieces!.each)));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [product]);

  const category = answers.category || remembered?.category || draft.category;
  const storagePlace = locationFromStorage(product.storageText);
  const location =
    place ??
    (remembered?.kind === "barcode" && remembered.category === category
      ? remembered.location
      : (storagePlace ?? locationFor(category)));
  const locationFromOff = place === null && !(remembered?.kind === "barcode" && remembered.category === category) && storagePlace !== undefined;
  const expiryKind: ChosenExpiryKind =
    answers.expiryKind && answers.expiryKind !== "none" ? answers.expiryKind : defaultExpiryKind(category);
  const quantityOne = answers.quantityText?.trim() || draft.quantityText || "";
  const totalOne = (() => {
    const reading = quantityOne === "" ? null : readQuantity(quantityOne);
    return reading?.ok ? reading.quantity : undefined;
  })();
  const resolved = resolvePieces(totalOne, piecesCount, eachText, draft.pieceName);
  const hint = draft.piecesHint;
  const suggestion =
    hint && hint.source !== "label" && piecesCount < 2 && totalOne
      ? {
          text: `Secondo Open Food Facts ${hint.source === "serving" ? "la porzione" : "l'imballaggio"} è da ${formatQuantity({ value: hint.each, unit: totalOne.unit })}: ${hint.count} pezzi?`,
          onUse: () => changePieces(hint.count, String(hint.each)),
        }
      : undefined;
  const estimate = today ? estimatedExpiryDate(category, location, today) : null;
  const splitDates = differentDates && packs > 1;

  // una sola scrittura alla volta: il secondo tocco riceve la risposta del primo
  const save = useMemo(
    () =>
      singleFlight(async (inputs: CaptureInput[]): Promise<PackEventsResult> => {
        const built = buildPackEvents(inputs, { now: deps.now(), deviceId: await deps.getDeviceId() });
        if (!built.ok) return built;
        const written = await deps.appendEvents(built.events);
        if (written.added === 0) return { ok: false, errors: { form: "Non sono riuscito a salvare. Riprova." } };
        return built;
      }),
    [],
  );
  const undo = useMemo(() => singleFlight((events: LedgerEvent[]) => undoCapture(events, deps)), []);

  function set(patch: DirectAnswers) {
    setAnswers((a) => ({ ...a, ...patch }));
    setErrors({});
  }

  function changePieces(count: number, text: string | null = null) {
    piecesTouchedRef.current = true;
    setPiecesTouched(true);
    setPiecesCount(count);
    setEachText(text);
    setErrors({});
  }

  function changePacks(next: number) {
    const n = clampPacks(next);
    setPacks(n);
    if (n === 1) setDifferentDates(false);
    else if (differentDates) setGroups(splitPackGroups(n, answers.expiryDate ?? ""));
  }

  function startDifferentDates() {
    setGroups(splitPackGroups(packs, answers.expiryDate ?? ""));
    setDifferentDates(true);
    setErrors({});
  }

  async function onAdd() {
    if (saving) return;
    if (resolved.error) {
      setErrors({ form: resolved.error });
      return;
    }
    const groupError = splitDates ? checkPackGroups(groups, packs) : null;
    if (groupError) {
      setErrors({ form: groupError });
      return;
    }
    const effective: PackGroup[] = splitDates
      ? groups.filter((g) => g.count > 0)
      : [{ count: packs, expiryDate: answers.expiryDate ?? "" }];
    setSaving(true);
    setMessage(null);
    try {
      const inputs = buildPackInputs(draft, location, { ...answers, category, expiryKind }, effective).map((i) =>
        resolved.pieces ? { ...i, pieces: resolved.pieces } : i,
      );
      const result = await save(inputs);
      if (!result.ok) {
        setErrors(result.errors);
        if (result.errors.price) setMoreOpen(true);
        if (result.errors.name) nameRef.current?.focus();
        else if (result.errors.quantity) quantityRef.current?.focus();
        else if (result.errors.category) categoryRef.current?.focus();
        return;
      }
      setErrors({});
      setAdded({ events: result.events, text: packsConfirmationText(result.events, dayOf(new Date().toISOString())) });
      if (category) {
        rememberChoice(product, { category, location, ...(resolved.pieces ? { pieces: resolved.pieces } : {}) }, choiceStore).catch(
          () => undefined,
        );
      }
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
    <div className={`${styles.add} ${ui.fields}`}>
      {missing.filter((f) => f !== "category").length > 0 ? (
        <p className={ui.hint}>
          {missing.filter((f) => f !== "category").length === 1
            ? "Un dato non l'ho trovato: scrivilo qui sotto e poi aggiungi."
            : "Alcuni dati non li ho trovati: scrivili qui sotto e poi aggiungi."}
        </p>
      ) : null}

      {alreadyHave > 0 ? <p className={ui.hint}>Ne hai già {alreadyHave} in dispensa.</p> : null}

      <PackCounter packs={packs} onChange={changePacks} quantityOne={quantityOne} />

      <PiecesField
        total={totalOne}
        count={piecesCount}
        onCount={(n) => changePieces(n, n >= 2 ? eachText : null)}
        eachText={eachText}
        onEachText={(t) => changePieces(piecesCount, t)}
        resolved={resolved}
        pieceName={draft.pieceName}
        note={
          hint && !piecesTouched && piecesCount === hint.count
            ? "Secondo Open Food Facts: puoi cambiarlo."
            : remembered?.kind === "barcode" && remembered.pieces && !piecesTouched
              ? "Come l'ultima volta che l'hai aggiunto."
              : undefined
        }
        suggestion={suggestion}
      />
      {totalOne && (packs > 1 || resolved.pieces) ? (
        <p className={ui.paragraph} aria-live="polite">
          {packsSummary(packs, totalOne, resolved.pieces)}
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
            Quantità di una confezione
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

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-category`}>
          Categoria
        </label>
        <select
          ref={categoryRef}
          id={`${ids}-category`}
          className={ui.input}
          value={category ?? ""}
          onChange={(e) => set({ category: e.target.value })}
          aria-invalid={err("category") ? true : undefined}
          aria-describedby={`${ids}-category-note${err("category") ? ` ${ids}-category-error` : ""}`}
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
        <p className={ui.hint} id={`${ids}-category-note`}>
          {answers.category
            ? "Serve a stimare la scadenza quando manca la data."
            : remembered && category === remembered.category
              ? remembered.kind === "barcode"
                ? "Come l'ultima volta che l'hai aggiunto. Serve a stimare la scadenza."
                : "Proposta da un prodotto simile che hai già aggiunto. Puoi cambiarla."
              : draft.category && category === draft.category
                ? "Proposta dal prodotto: serve a stimare la scadenza, puoi cambiarla."
                : "Non l'ho riconosciuta: scegline una, serve a stimare la scadenza."}
        </p>
        {err("category") ? (
          <p className={ui.error} id={`${ids}-category-error`}>
            {err("category")}
          </p>
        ) : null}
      </div>

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
        {locationFromOff ? (
          <p className={ui.hint}>Secondo Open Food Facts va tenuto qui: «{product.storageText?.slice(0, 90)}». Puoi cambiarlo.</p>
        ) : null}
      </fieldset>

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>
          Scadenza <span className={ui.optional}>(facoltativa)</span>
        </legend>
        <div className={ui.choices}>
          {KINDS.map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-kind`} value={k} checked={expiryKind === k} onChange={() => set({ expiryKind: k })} />
              <span>{EXPIRY_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>

        {splitDates ? (
          <>
            <PackGroupsEditor groups={groups} packs={packs} onChange={setGroups} onSameDate={() => setDifferentDates(false)} />
          </>
        ) : (
          <>
            <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
              Data in etichetta
            </label>
            <input
              id={`${ids}-date`}
              className={`${ui.input} ${styles.dateInput}`}
              type="date"
              value={answers.expiryDate ?? ""}
              onChange={(e) => set({ expiryDate: e.target.value })}
              aria-invalid={err("expiryDate") ? true : undefined}
              aria-describedby={`${ids}-date-note`}
            />
            {err("expiryDate") ? <p className={ui.error}>{err("expiryDate")}</p> : null}
            {today ? (
              <div className={styles.shortcuts}>
                {SHORTCUTS.map(([label, days]) => (
                  <button key={days} type="button" className={styles.shortcut} onClick={() => set({ expiryDate: addDays(today, days) })}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {packs > 1 ? (
              <div className={ui.row}>
                <Button variant="text" onClick={startDifferentDates}>
                  Date diverse
                </Button>
              </div>
            ) : null}
          </>
        )}
        <p className={ui.hint} id={`${ids}-date-note`}>
          {!splitDates && !answers.expiryDate ? "Scrivi o scegli la data stampata sulla confezione (giorno, mese, anno). " : ""}
          {splitDates ? "" : packs > 1 ? "La data vale per tutte le confezioni. " : ""}
          {!splitDates && !answers.expiryDate
            ? `Senza data uso una stima${estimate ? `: ${formatCalendarDate(estimate)}` : " dalla categoria"}. `
            : ""}
          {scannedExpiry && answers.expiryDate === scannedExpiry.date
            ? "Data letta dal codice: controllala."
            : "Il codice a barre contiene solo il codice del prodotto, non la data."}
        </p>
      </fieldset>

      <details className={styles.more} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>Prezzo (facoltativo)</summary>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-price`}>
            {packs > 1 ? "Prezzo di una confezione" : "Prezzo"} <span className={ui.optional}>(facoltativo)</span>
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
          {saving ? "Salvo…" : packs > 1 ? `Aggiungi ${packs} confezioni alla dispensa` : "Aggiungi alla dispensa"}
        </Button>
        <Button variant="outline" onClick={onAgain}>
          Leggi un altro codice
        </Button>
      </div>
      <Button variant="text" href={captureHref(product)}>
        Modifica prima di aggiungere
      </Button>
    </div>
  );
}
