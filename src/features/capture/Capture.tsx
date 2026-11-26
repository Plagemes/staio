"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { isStoredProduct, type Product } from "@/core/catalog";
import { addDays } from "@/core/expiry";
import type { Location } from "@/core/ledger";
import { compositionFromProduct } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getProductRecord } from "@/data";
import { Button, Label, SectionHeader, cx } from "@/design";
import { searchRecipes } from "@/models3d/catalog";
import { ExpiryFromPhoto } from "../ai-capture/ExpiryFromPhoto";
import { emptyForm, formFromProduct } from "../ai-capture/labelDraft";
import { NutritionReview } from "../ai-capture/NutritionReview";
import { Per100Table } from "../nutrition/Per100";
import { readQuantity, type CaptureField, type CaptureInput, type FieldErrors } from "../capture";
import { captureParamsKey, mergeCaptureParams, readCaptureParams, resolveCaptureFields, type CaptureEdits } from "../captureParams";
import {
  buildPackEvents,
  checkPackGroups,
  clampPacks,
  confirmationText,
  defaultExpiryKind,
  packsConfirmationText,
  packsSummary,
  resolvePieces,
  splitPackGroups,
  type PackGroup,
} from "../barcode/directAdd";
import { EXPIRY_SHORTCUTS } from "../barcode/expiryShortcuts";
import { pieceNameFor } from "../pieces";
import { PackCounter, PackGroupsEditor, PiecesField } from "./PackControls";
import { localCodeForName, lotCodeFor, manualLotEvents, nameKey, offeredStoreProduct, replacesSavedText, savedSummary } from "./localProduct";
import { saveCapture } from "./saveCapture";
import { detailsSummary } from "./summary";
import { ActionBar, Disclosure } from "../common";
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
import { isFoodCategory } from "../lots";
import { itemKey, proposeLocation, readItemDefault, suggestNames } from "../memory/itemDefaults";
import { useItemDefaults } from "../memory/useItemDefaults";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import styles from "./Capture.module.css";

const CHOSEN_EXPIRY_KINDS: readonly ChosenExpiryKind[] = ["use_by", "best_before"];

function categoryFor(name: string): string {
  const model = name.trim().length >= 2 ? searchRecipes(name)[0]?.category : undefined;
  return suggestCategory(name, model) ?? "";
}

const subscribeNothing = () => () => {};
const readLocationSearch = () => window.location.search;
const noLocationSearch = () => "";

export function Capture() {
  const notice = useNotice();
  const router = useRouter();
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
  const { name, barcode, brand, daysAfterOpening } = fields;

  // Memoria per nome: propone, non salva. Ciò che propone si vede nei campi e l'alimento prende solo ciò che c'è nei campi.
  const { memory, remember } = useItemDefaults();
  const deferredName = useDeferredValue(name);
  const remembered = useMemo(() => readItemDefault(memory, deferredName), [memory, deferredName]);

  // La quantità dalla memoria riempie il campo solo se è vuoto e l'utente non l'ha toccato
  const quantityFromMemory = fields.quantityText === "" && edits.quantityText === undefined && Boolean(remembered?.quantityText);
  const quantityText = quantityFromMemory ? (remembered?.quantityText ?? "") : fields.quantityText;

  const [locationChoice, setLocationChoice] = useState<Location | null>(null);
  const [chosenKind, setChosenKind] = useState<ChosenExpiryKind | null>(null);
  const [expiryDate, setExpiryDate] = useState("");
  const [priceText, setPriceText] = useState("");
  const [alreadyHave, setAlreadyHave] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [packs, setPacks] = useState(1);
  const [piecesCount, setPiecesCount] = useState(0);
  const [eachText, setEachText] = useState<string | null>(null);
  const [differentDates, setDifferentDates] = useState(false);
  const [groups, setGroups] = useState<PackGroup[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const focusField = (field: CaptureField) => {
    const map = { name: nameRef, quantity: quantityRef, category: categoryRef, expiryDate: dateRef, price: priceRef, form: nameRef };
    // un campo dentro «Altri dettagli» si apre prima: il fuoco va dopo il disegno
    window.setTimeout(() => map[field].current?.focus(), 0);
  };

  const suggestions = useMemo(() => {
    const q = deferredName.trim();
    if (q.length < 2) return [];
    const seen = new Set([itemKey(q)]);
    const out: string[] = [];
    // prima i nomi già usati, poi quelli del catalogo; senza doppioni e senza ripetere ciò che è già scritto
    for (const candidate of [...suggestNames(memory, q, 5), ...searchRecipes(q).map((r) => r.name)]) {
      const key = itemKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
      if (out.length === 5) break;
    }
    return out;
  }, [deferredName, memory]);

  // categoria: scelta dell'utente, poi parametro, poi memoria per il nome, poi proposta dal nome
  const proposedCategory = prefill.category ?? remembered?.category ?? categoryFor(name);
  const category = edits.category ?? proposedCategory;
  const categoryChosen = edits.category !== undefined;
  // Il campo sta in vista solo se c'è un nome e nessuno ha riconosciuto la categoria; senza nome non c'è niente da riconoscere
  const categoryInView = name.trim() !== "" && proposedCategory === "";

  // luogo: scelta fatta qui, poi memoria, poi regola per categoria. Se l'utente cambia la categoria, il luogo ricordato per l'altra non vale più.
  const rememberedLocation = edits.category !== undefined && edits.category !== remembered?.category ? undefined : remembered?.location;
  const proposal = proposeLocation({ chosen: locationChoice, remembered: rememberedLocation, category });
  const location = proposal.location;

  // Valori nutrizionali facoltativi, legati a un codice: quello arrivato dal codice a barre, o uno locale ricavato dal nome.
  // La scheda si ritrova per nome: aggiungendo di nuovo lo stesso prodotto i valori sono già lì.
  // Due prodotti con lo stesso nome (due marche) sono due schede: «Non sono questi» passa alla variante successiva.
  const [variantState, setVariantState] = useState<{ key: string; n: number }>({ key: "", n: 0 });
  const variantOf = (n: string) => (variantState.key === nameKey(n) ? variantState.n : 0);
  const nutritionCode = barcode ? barcode : localCodeForName(deferredName, variantOf(deferredName));
  // Il collegamento a una scheda salvata lo sceglie l'utente, dopo averne visto i valori: mai in silenzio.
  const [choice, setChoice] = useState<{ code: string; use: boolean } | null>(null);
  const [stored, setStored] = useState<{ code: string; product: Product | undefined } | null>(null);
  const [editingNutrition, setEditingNutrition] = useState(false);
  useEffect(() => {
    if (!nutritionCode) return;
    let alive = true;
    getProductRecord(nutritionCode)
      .then((r) => alive && setStored({ code: nutritionCode, product: r && isStoredProduct(r.data) ? r.data : undefined }))
      .catch(() => alive && setStored({ code: nutritionCode, product: undefined }));
    return () => {
      alive = false;
    };
  }, [nutritionCode]);
  const loadedNutrition = nutritionCode !== undefined && stored?.code === nutritionCode;
  const storedProduct = loadedNutrition ? stored.product : undefined;
  const chosen = choice !== null && choice.code === nutritionCode ? choice.use : undefined;
  // codice interno del negozio con una scheda già salvata: può essere di un altro prodotto, si usa solo se l'utente lo sceglie
  const storeOffer = offeredStoreProduct(barcode, storedProduct);
  const savedProduct = storeOffer && chosen !== true ? undefined : storedProduct;
  const savedComposition = savedProduct?.nutrients ? compositionFromProduct(savedProduct) : undefined;
  // scheda che l'app aveva creato per questo nome (non un codice a barre letto): va proposta, non applicata
  const offeredProduct = !barcode && loadedNutrition && savedProduct?.localFromName && savedProduct.nutrients ? savedProduct : storeOffer;
  const barcodeIsLocal = savedProduct?.localFromName === true && Boolean(barcode);
  // arrivato da un codice che l'archivio non conosce: dall'indirizzo è venuto solo il codice e nessuna scheda ha dei valori
  const noDataForCode =
    Boolean(barcode) &&
    prefill.name === undefined &&
    prefill.quantityText === undefined &&
    prefill.brand === undefined &&
    !barcodeIsLocal &&
    !(loadedNutrition && storedProduct?.nutrients);
  const rejectSaved = () => {
    setChoice({ code: nutritionCode ?? "", use: false });
    if (barcode) return;
    setVariantState({ key: nameKey(name), n: variantOf(name) + 1 });
  };

  const reading = quantityText.trim() === "" ? null : readQuantity(quantityText);
  const today = now ? dayOf(now) : null;
  const pieceName = pieceNameFor(name);
  const resolvedPieces = resolvePieces(reading?.ok ? reading.quantity : undefined, piecesCount, eachText, pieceName);

  // Senza data non c'è scadenza scritta (vale la stima). Con una data, il tipo è quello scelto in «Altri dettagli» o, se non scelto, quello della categoria.
  const dateKind = chosenKind ?? defaultExpiryKind(category);
  const expiryKind = expiryDate.trim() === "" ? ("none" as const) : dateKind;
  const pastDate = today !== null && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && expiryDate < today;

  const splitDates = differentDates && packs > 1;

  function changePacks(next: number) {
    const n = clampPacks(next);
    setPacks(n);
    if (n === 1) setDifferentDates(false);
    else if (differentDates) setGroups(splitPackGroups(n, expiryDate));
  }

  function pickSuggestion(suggested: string) {
    edit({ name: suggested });
    quantityRef.current?.focus();
  }

  function clearError(field: CaptureField) {
    if (errors[field] || errors.form) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  /** Mostra gli errori e porta il fuoco sul primo campo; «Altri dettagli» si apre da sola se l'errore sta lì dentro. */
  function showErrors(raw: FieldErrors) {
    // senza nome il campo «Categoria» non è in vista: l'errore da dare è quello del nome
    const next = name.trim() === "" ? { ...raw, category: undefined } : raw;
    setErrors(next);
    if (next.price || (next.category && !categoryInView) || (next.expiryDate && splitDates)) setDetailsOpen(true);
    const first = (["name", "quantity", "category", "expiryDate", "price"] as const).find((f) => next[f]);
    focusField(first ?? "name");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || savingRef.current) return;
    if (resolvedPieces.error) {
      setErrors({ form: resolvedPieces.error });
      setDetailsOpen(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      // senza codice a barre, i valori scritti a mano legano il lotto alla scheda locale di questo nome
      const nameCode = localCodeForName(name, variantOf(name));
      // il lotto prende la scheda locale solo se l'utente ha scelto di usarla (o l'ha appena scritta)
      const localCode =
        !barcode && nameCode && stored?.code === nameCode && stored.product?.nutrients && choice?.code === nameCode && choice.use ? nameCode : undefined;
      const lotCode = lotCodeFor({ barcode, localCode, offered: storeOffer, chosen });
      const input: CaptureInput = {
        name,
        quantityText,
        location,
        category,
        expiryKind,
        expiryDate,
        priceText,
        alreadyHave,
        ...(lotCode ? { barcode: lotCode } : {}),
        brand,
        ...(daysAfterOpening !== undefined ? { daysAfterOpening } : {}),
        ...(resolvedPieces.pieces ? { pieces: resolvedPieces.pieces } : {}),
      };
      const deps = { appendEvents, getDeviceId, now: () => new Date().toISOString() };
      let result: Awaited<ReturnType<typeof saveCapture>>;
      if (packs === 1) {
        result = await saveCapture(input, deps, localCode ? { localCode } : {});
      } else {
        const groupError = splitDates ? checkPackGroups(groups, packs) : null;
        if (groupError) {
          setErrors({ form: groupError });
          setDetailsOpen(true);
          return;
        }
        const effective: PackGroup[] = splitDates ? groups.filter((g) => g.count > 0) : [{ count: packs, expiryDate }];
        const inputs = effective.flatMap((g) =>
          Array.from({ length: g.count }, () => ({ ...input, expiryDate: g.expiryDate, expiryKind: g.expiryDate === "" ? ("none" as const) : dateKind })),
        );
        const built = buildPackEvents(inputs, { now: deps.now(), deviceId: await deps.getDeviceId() });
        if (!built.ok) result = built;
        else {
          const events = localCode ? manualLotEvents(built.events, localCode) : built.events;
          const written = await deps.appendEvents(events);
          const first = events[0];
          const productName = first.type === "purchase" || first.type === "declare" ? first.productRef : name;
          result =
            written.added === 0
              ? { ok: false, errors: { form: "Non sono riuscito a salvare. Riprova." } }
              : { ok: true, events, lotId: built.lotIds[0], summary: `${packs} confezioni di ${productName}` };
        }
      }
      if (!result.ok) {
        showErrors(result.errors);
        return;
      }
      const when = dayOf(deps.now());
      notice.show({
        message: packs === 1 ? confirmationText(result.events[0], when) : packsConfirmationText(result.events, when),
        undo: result.events,
        link: { label: "Vedi", href: `/app/dispensa?lotto=${result.lotId}` },
      });
      // si ricorda la scelta fatta per questo nome; se non si scrive, il salvataggio resta valido
      const created = result.events[0];
      void remember({
        name: created.type === "purchase" || created.type === "declare" ? created.productRef : name,
        category,
        location,
        quantityText: quantityText.trim(),
      });
      const cameFromBarcode = Boolean(barcode);
      setErrors({});
      setSpentKey(arrivedKey);
      setEdits({});
      setLocationChoice(null);
      setChosenKind(null);
      setExpiryDate("");
      setPriceText("");
      setPacks(1);
      setPiecesCount(0);
      setEachText(null);
      setDifferentDates(false);
      setEditingNutrition(false);
      nameRef.current?.focus();
      if (cameFromBarcode) router.push("/app/cattura/codice");
    } catch {
      setErrors({ form: "Non sono riuscito a salvare sul telefono. Riprova." });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const err = (field: CaptureField) => errors[field];
  const describedBy = (field: CaptureField, extra?: string) =>
    [err(field) ? `${ids}-${field}-error` : undefined, extra].filter(Boolean).join(" ") || undefined;

  const categoryLabel = isFoodCategory(category) ? FOOD_CATEGORY_LABELS[category] : undefined;
  const summary = detailsSummary({
    categoryLabel: categoryInView ? undefined : categoryLabel,
    categoryChosen,
    expiryKind: chosenKind,
    datesSplit: splitDates,
    ...(resolvedPieces.pieces && reading?.ok
      ? { pieces: { count: resolvedPieces.pieces.count, each: resolvedPieces.pieces.each, unit: reading.quantity.unit, name: resolvedPieces.pieces.name } }
      : {}),
    priceText: alreadyHave ? "" : priceText,
    alreadyHave,
    nutrition: Boolean(savedComposition) && (Boolean(barcode) || chosen === true),
  });

  const categoryField = (
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
        {categoryInView || category === "" ? <option value="">Scegli una categoria</option> : null}
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
        {category !== "" && !categoryChosen ? "Proposta: cambiala se non va bene." : "Serve a stimare la scadenza quando manca la data."}
      </p>
    </div>
  );

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Aggiungi alla dispensa</h1>
        {barcode ? <Label>Da codice a barre</Label> : null}
      </div>

      {barcode ? (
        <div className={ui.callout} role="status">
          <p className={ui.paragraph}>
            {noDataForCode
              ? `Codice ${barcode}: non l'ho trovato. Scrivi tu i dati: la prossima volta li ritrovo dal codice.`
              : `${barcodeIsLocal ? "Valori inseriti da te" : `Dati letti dal codice a barre ${barcode}`}${brand ? ` (${brand})` : ""}. Controllali e completa il resto: verranno salvati come letti in etichetta.`}
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
          <Button href="/app/cattura/codice" variant="outline">
            Leggi un codice
          </Button>
          <div className={styles.entryButtons}>
            <Button href="/app/cattura/scontrino" variant="outline">
              Scontrino
            </Button>
            <Button href="/app/cattura/veloce" variant="outline">
              Più alimenti
            </Button>
          </div>
        </div>
      )}

      <section className={ui.section}>
        <SectionHeader label="A mano" />
        <form className={ui.form} onSubmit={onSubmit} noValidate>
          <div className={cx(ui.fields, styles.fieldStack)}>
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
                onKeyDown={(e) => {
                  // Invio passa alla quantità: il modulo si invia dall'ultimo campo o dal pulsante
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  quantityRef.current?.focus();
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
                <div id={`${ids}-suggest`} role="group" aria-label="Suggerimenti" className={styles.suggestions}>
                  {suggestions.map((s) => (
                    <button key={s} type="button" className={styles.suggestion} onClick={() => pickSuggestion(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {offeredProduct ? (
                <div className={ui.calloutStrong} role="status">
                  <p className={ui.paragraph}>
                    <strong>Ho valori salvati per «{offeredProduct.name?.trim() || name.trim()}».</strong> {savedSummary(offeredProduct)}{" "}
                    {chosen === true ? "Li uso per questo alimento." : "Sono quelli di questo prodotto?"}
                  </p>
                  <div className={ui.row}>
                    {chosen === true ? null : (
                      <Button variant="outline" onClick={() => setChoice({ code: nutritionCode ?? "", use: true })}>
                        Uso i valori salvati per «{offeredProduct.name?.trim() || name.trim()}»
                      </Button>
                    )}
                    <Button variant="text" onClick={rejectSaved}>
                      Non sono questi
                    </Button>
                  </div>
                  {chosen === undefined ? <p className={ui.hint}>Finché non scegli, il lotto resta senza questi valori.</p> : null}
                </div>
              ) : null}
            </div>

            <div className={ui.field}>
              <div className={styles.pair}>
                <div className={styles.pairMain}>
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
                    enterKeyHint="done"
                    aria-invalid={err("quantity") ? true : undefined}
                    aria-describedby={describedBy("quantity", quantityText.trim() === "" ? undefined : `${ids}-quantity-hint`)}
                    placeholder="500 g, 1 l, 6 uova"
                  />
                  {err("quantity") ? (
                    <p className={ui.error} id={`${ids}-quantity-error`}>
                      {err("quantity")}
                    </p>
                  ) : null}
                  {quantityText.trim() === "" ? null : (
                    <p className={ui.hint} id={`${ids}-quantity-hint`}>
                      {quantityFromMemory ? "Come l'ultima volta. " : ""}
                      {reading?.ok
                        ? `Letto come ${formatQuantity(reading.quantity)}. Un numero senza unità conta come pezzi.`
                        : "Scrivila come la diresti: «500 g», «1 l», «6 uova»."}
                    </p>
                  )}
                </div>
                <div className={styles.pairSide}>
                  <PackCounter packs={packs} onChange={changePacks} quantityOne={quantityText.trim()} />
                </div>
              </div>
            </div>

            <fieldset className={ui.field}>
              <legend className={ui.fieldLabel}>Dove lo metti</legend>
              <div className={ui.choices}>
                {LOCATION_ORDER.map((l) => (
                  <label key={l} className={ui.choice}>
                    <input type="radio" name={`${ids}-location`} value={l} checked={location === l} onChange={() => setLocationChoice(l)} />
                    <span>{LOCATION_LABELS[l]}</span>
                  </label>
                ))}
              </div>
              {proposal.from === "memory" ? <p className={ui.hint}>Come l&apos;ultima volta.</p> : null}
              {proposal.from === "category" ? <p className={ui.hint}>Proposto dalla categoria: puoi cambiarlo.</p> : null}
            </fieldset>

            <fieldset className={ui.field}>
              <legend className={ui.fieldLabel}>Scadenza</legend>
              {splitDates ? (
                <p className={ui.hint}>Ogni gruppo di confezioni ha la sua data: la scrivi in «Altri dettagli», sotto «Date diverse».</p>
              ) : (
                <>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                    Data in etichetta <span className={ui.optional}>(facoltativa)</span>
                  </label>
                  <input
                    ref={dateRef}
                    id={`${ids}-date`}
                    className={`${ui.input} ${styles.dateInput}`}
                    type="date"
                    value={expiryDate}
                    onChange={(e) => {
                      setExpiryDate(e.target.value);
                      clearError("expiryDate");
                    }}
                    aria-invalid={err("expiryDate") ? true : undefined}
                    aria-describedby={describedBy("expiryDate", expiryDate === "" || pastDate ? `${ids}-date-hint` : undefined)}
                  />
                  {today ? (
                    <div className={styles.shortcuts}>
                      {EXPIRY_SHORTCUTS.map(([label, days]) => (
                        <button
                          key={days}
                          type="button"
                          className={styles.shortcut}
                          onClick={() => {
                            setExpiryDate(addDays(today, days));
                            clearError("expiryDate");
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
              {err("expiryDate") ? (
                <p className={ui.error} id={`${ids}-expiryDate-error`}>
                  {err("expiryDate")}
                </p>
              ) : null}
              {!splitDates && expiryDate === "" ? (
                <p className={ui.hint} id={`${ids}-date-hint`}>
                  Senza data uso una stima dalla categoria e dal luogo.
                </p>
              ) : null}
              {!splitDates && pastDate ? (
                <p className={ui.hint} id={`${ids}-date-hint`}>
                  Questa data è già passata: lo salvo comunque.
                </p>
              ) : null}
              {splitDates ? null : (
                <ExpiryFromPhoto
                  today={today}
                  currentKind={chosenKind ?? "none"}
                  onPick={(date, kind) => {
                    setExpiryDate(date);
                    if (kind) setChosenKind(kind);
                    clearError("expiryDate");
                  }}
                />
              )}
            </fieldset>

            {categoryInView ? categoryField : null}
          </div>

          <Disclosure title="Altri dettagli" summary={summary} open={detailsOpen} onOpenChange={setDetailsOpen}>
            {categoryInView ? null : categoryField}

            <fieldset className={ui.field}>
              <legend className={ui.fieldLabel}>Tipo di data</legend>
              <div className={ui.choices}>
                {CHOSEN_EXPIRY_KINDS.map((k) => (
                  <label key={k} className={ui.choice}>
                    <input type="radio" name={`${ids}-expiry-kind`} value={k} checked={dateKind === k} onChange={() => setChosenKind(k)} />
                    <span>{EXPIRY_KIND_LABELS[k]}</span>
                  </label>
                ))}
              </div>
              <p className={ui.hint}>Vale solo se scrivi una data. Se non lo scegli, lo propongo dalla categoria.</p>
            </fieldset>

            <PiecesField
              total={reading?.ok ? reading.quantity : undefined}
              count={piecesCount}
              onCount={(n) => {
                setPiecesCount(n);
                if (n < 2) setEachText(null);
              }}
              eachText={eachText}
              onEachText={setEachText}
              resolved={resolvedPieces}
              pieceName={pieceName}
            />
            {reading?.ok && (packs > 1 || resolvedPieces.pieces) ? (
              <p className={ui.paragraph} aria-live="polite">
                {packsSummary(packs, reading.quantity, resolvedPieces.pieces)}
              </p>
            ) : null}

            {packs > 1 ? (
              <div className={ui.field}>
                <span className={ui.fieldLabel}>Date diverse</span>
                {splitDates ? (
                  <PackGroupsEditor groups={groups} packs={packs} onChange={setGroups} onSameDate={() => setDifferentDates(false)} />
                ) : (
                  <>
                    <p className={ui.hint}>Ora la data vale per tutte le confezioni.</p>
                    <div className={ui.row}>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setGroups(splitPackGroups(packs, expiryDate));
                          setDifferentDates(true);
                        }}
                      >
                        Date diverse
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

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
                <p className={ui.hint}>{packs > 1 ? "Prezzo di una confezione, in euro." : "Prezzo totale in euro, per tutta la quantità."}</p>
              </div>
            )}

            <div className={styles.nutrition}>
              <Label>Valori nutrizionali</Label>
              {nutritionCode === undefined ? (
                <p className={ui.hint}>Scrivi prima il nome dell&apos;alimento: i valori si ricordano per nome, e li ritrovi quando lo aggiungi di nuovo.</p>
              ) : !loadedNutrition ? (
                <p className={ui.hint}>Cerco i valori già salvati…</p>
              ) : savedComposition && !editingNutrition ? (
                <>
                  <Per100Table
                    per100={savedComposition.per100}
                    basis={savedComposition.basis}
                    estimated={false}
                    source={
                      savedProduct?.labelPhoto?.by === "manual" || savedProduct?.source === "manual"
                        ? `Inseriti da te, come stampati sull'etichetta. Li ritrovi aggiungendo di nuovo «${savedProduct?.name ?? name}».`
                        : "Dall'etichetta del prodotto."
                    }
                  />
                  <div className={ui.row}>
                    <Button variant="outline" onClick={() => setEditingNutrition(true)}>
                      Correggi i valori
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {storeOffer && chosen !== true ? <p className={ui.hint}>{replacesSavedText(storeOffer.name)}</p> : null}
                  <NutritionReview
                    key={nutritionCode}
                    barcode={nutritionCode}
                    product={savedProduct}
                    by="manual"
                    initial={savedProduct?.nutrients ? formFromProduct(savedProduct) : { ...emptyForm(), name: name.trim() }}
                    hideName
                    localFromName={!barcode}
                    onSaved={(next) => {
                      setStored({ code: nutritionCode, product: next });
                      // li ha appena scritti lui, per questo alimento: sono la sua scelta
                      setChoice({ code: nutritionCode, use: true });
                      setEditingNutrition(false);
                    }}
                    onCancel={() => setEditingNutrition(false)}
                  />
                </>
              )}
            </div>
          </Disclosure>

          {err("form") ? (
            <p className={ui.error} role="alert">
              {err("form")}
            </p>
          ) : null}

          <ActionBar>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvo…" : packs > 1 ? `Aggiungi ${packs} confezioni` : "Aggiungi alla dispensa"}
            </Button>
          </ActionBar>
        </form>
      </section>
    </div>
  );
}
