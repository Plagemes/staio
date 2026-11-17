"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { isStoredProduct, type Product } from "@/core/catalog";
import type { Location } from "@/core/ledger";
import { compositionFromProduct } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getProductRecord } from "@/data";
import { Button, Label } from "@/design";
import { searchRecipes } from "@/models3d/catalog";
import { ExpiryFromPhoto } from "../ai-capture/ExpiryFromPhoto";
import { emptyForm, formFromProduct } from "../ai-capture/labelDraft";
import { NutritionReview } from "../ai-capture/NutritionReview";
import { Per100Table } from "../nutrition/Per100";
import { readQuantity, type CaptureField, type CaptureInput, type FieldErrors } from "../capture";
import { captureParamsKey, mergeCaptureParams, readCaptureParams, resolveCaptureFields, type CaptureEdits } from "../captureParams";
import { buildPackEvents, checkPackGroups, clampPacks, packsSummary, resolvePieces, splitPackGroups, type PackGroup } from "../barcode/directAdd";
import { pieceNameFor } from "../pieces";
import { PackCounter, PackGroupsEditor, PiecesField } from "./PackControls";
import { localCodeForName, lotCodeFor, manualLotEvents, nameKey, offeredStoreProduct, replacesSavedText, savedSummary } from "./localProduct";
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
  const { name, quantityText, barcode, brand, daysAfterOpening } = fields;

  const [location, setLocation] = useState<Location>("frigo");
  const [expiryKind, setExpiryKind] = useState<ChosenExpiryKind | "none">("none");
  const [expiryDate, setExpiryDate] = useState("");
  const [priceText, setPriceText] = useState("");
  const [alreadyHave, setAlreadyHave] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [packs, setPacks] = useState(1);
  const [piecesCount, setPiecesCount] = useState(0);
  const [eachText, setEachText] = useState<string | null>(null);
  const [differentDates, setDifferentDates] = useState(false);
  const [groups, setGroups] = useState<PackGroup[]>([]);

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
  const rejectSaved = () => {
    setChoice({ code: nutritionCode ?? "", use: false });
    if (barcode) return;
    setVariantState({ key: nameKey(name), n: variantOf(name) + 1 });
  };

  const reading = quantityText.trim() === "" ? null : readQuantity(quantityText);
  const today = now ? dayOf(now) : null;
  const pieceName = pieceNameFor(name);
  const resolvedPieces = resolvePieces(reading?.ok ? reading.quantity : undefined, piecesCount, eachText, pieceName);
  const pastDate = expiryKind !== "none" && today !== null && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && expiryDate < today;

  const splitDates = differentDates && packs > 1 && expiryKind !== "none";

  function changePacks(next: number) {
    const n = clampPacks(next);
    setPacks(n);
    if (n === 1) setDifferentDates(false);
    else if (differentDates) setGroups(splitPackGroups(n, expiryDate));
  }

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
    if (resolvedPieces.error) {
      setErrors({ form: resolvedPieces.error });
      return;
    }
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
          return;
        }
        const effective: PackGroup[] = splitDates ? groups.filter((g) => g.count > 0) : [{ count: packs, expiryDate }];
        const inputs = effective.flatMap((g) =>
          Array.from({ length: g.count }, () => ({ ...input, expiryDate: g.expiryDate, expiryKind: g.expiryDate === "" && splitDates ? ("none" as const) : expiryKind })),
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
      setPacks(1);
      setPiecesCount(0);
      setEachText(null);
      setDifferentDates(false);
      setEditingNutrition(false);
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
            {barcodeIsLocal ? "Valori inseriti da te" : `Dati letti dal codice a barre ${barcode}`}
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
          <Link href="/app/qualita/scaffale" className={ui.textLink}>
            In negozio? Confronta sullo scaffale
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
          {offeredProduct ? (
            <div className={ui.calloutStrong} role="status">
              <p className={ui.paragraph}>
                <strong>Ho valori salvati per «{offeredProduct.name?.trim() || name.trim()}».</strong> {savedSummary(offeredProduct)}{" "}
                {chosen === true ? "Li uso per questo alimento." : "Sono quelli di questo prodotto?"}
              </p>
              <div className={ui.row}>
                {chosen === true ? null : (
                  <Button onClick={() => setChoice({ code: nutritionCode ?? "", use: true })}>Uso i valori salvati per «{offeredProduct.name?.trim() || name.trim()}»</Button>
                )}
                <Button variant="outline" onClick={rejectSaved}>
                  Non sono questi
                </Button>
              </div>
              {chosen === undefined ? <p className={ui.hint}>Finché non scegli, il lotto resta senza questi valori.</p> : null}
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

        <PackCounter packs={packs} onChange={changePacks} quantityOne={quantityText.trim()} />

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
          {splitDates ? (
            <PackGroupsEditor groups={groups} packs={packs} onChange={setGroups} onSameDate={() => setDifferentDates(false)} />
          ) : expiryKind !== "none" ? (
            <>
              <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                Data in etichetta
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
                aria-describedby={describedBy("expiryDate", pastDate ? `${ids}-date-hint` : undefined)}
              />
              {err("expiryDate") ? (
                <p className={ui.error} id={`${ids}-expiryDate-error`}>
                  {err("expiryDate")}
                </p>
              ) : null}
              {expiryDate === "" ? (
                <p className={ui.hint}>Scrivi o scegli la data stampata sulla confezione (giorno, mese, anno).</p>
              ) : null}
              {pastDate ? (
                <p className={ui.hint} id={`${ids}-date-hint`}>
                  Questa data è già passata: lo salvo comunque.
                </p>
              ) : null}
              {packs > 1 ? (
                <div className={ui.row}>
                  <Button
                    variant="text"
                    onClick={() => {
                      setGroups(splitPackGroups(packs, expiryDate));
                      setDifferentDates(true);
                    }}
                  >
                    Date diverse
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className={ui.hint}>Senza data, la scadenza sarà una stima dalla categoria e dal luogo, e si vedrà come stima.</p>
          )}
          {splitDates ? null : (
            <ExpiryFromPhoto
              today={today}
              currentKind={expiryKind}
              onPick={(date, kind) => {
                setExpiryDate(date);
                if (kind) setExpiryKind(kind);
                clearError("expiryDate");
              }}
            />
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
            <p className={ui.hint}>{packs > 1 ? "Prezzo di una confezione, in euro." : "Prezzo totale in euro, per tutta la quantità."}</p>
          </div>
        )}

        <details className={styles.nutrition}>
          <summary>Valori nutrizionali (facoltativi)</summary>
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
                  Modifica i valori
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
        </details>

        {err("form") ? (
          <p className={ui.error} role="alert">
            {err("form")}
          </p>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? "Salvo…" : packs > 1 ? `Aggiungi ${packs} confezioni alla dispensa` : "Aggiungi alla dispensa"}
        </Button>
      </form>

      <Link href="/app/dispensa" className={ui.textLink}>
        Vai alla dispensa
      </Link>
    </div>
  );
}
