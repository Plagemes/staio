"use client";

// I valori nutrizionali nella scheda di un alimento in Dispensa. Quando il nome non basta a trovarli non è un vicolo
// cieco: da qui si collega l'alimento a uno della tabella (la stessa scelta di Nutrizione, «Voci non riconosciute») o si
// scrivono i valori a mano (lo stesso modulo di Cattura). Il risultato si vede subito nella scheda.
import { useMemo, useState } from "react";
import { activeLots, type Lot } from "@/core/ledger";
import { DEFAULT_STATE_PREFERENCE } from "@/core/nutrition";
import { appendEvents, getDeviceId, useEventLog, usePantry } from "@/data";
import { Button } from "@/design";
import { buildAttachCode, findCreationEvent, type EditTarget } from "../actions";
import { emptyForm, formFromProduct } from "../ai-capture/labelDraft";
import { NutritionReview } from "../ai-capture/NutritionReview";
import type { Product } from "@/core/catalog";
import { formatQuantity } from "@/core/units";
import { localCodeForName, nameKey, savedSummary } from "../capture/localProduct";
import { dayOf, formatCalendarDate } from "../format";
import { LOCATION_LABELS } from "../labels";
import { createFoodSearch, type FoodOption } from "../nutrition/candidates";
import { FoodPicker } from "../nutrition/FoodCandidates";
import { LotNutrients } from "../nutrition/Per100";
import { buildResolver } from "../nutrition/resolver";
import { useFoodCorrection } from "../nutrition/useCorrection";
import { useFoodOverrides, useFoods, useProducts } from "../nutrition/useNutrition";
import ui from "../ui.module.css";

export type LotValues =
  | { status: "loading" }
  /** `energy` c'è quando i valori trovati dicono le calorie: basta per il riepilogo, senza altri calcoli. */
  | { status: "found"; energy?: { kcal: number; basis: "g" | "ml"; estimated: boolean } }
  | { status: "none" };

/** Trova i valori di un alimento come li troverebbe il calcolo del giorno. */
export function useLotValues(lot: Pick<Lot, "lotId" | "productRef" | "barcode">): LotValues {
  const foods = useFoods();
  const products = useProducts();
  const overrides = useFoodOverrides();
  return useMemo(() => {
    if (!foods || !products) return { status: "loading" };
    const resolve = buildResolver({ foods, products, barcodes: new Map(lot.barcode ? [[lot.lotId, lot.barcode]] : []), overrides });
    const result = resolve({ kind: "pantry", productRef: lot.productRef, lotId: lot.lotId, preferStates: DEFAULT_STATE_PREFERENCE.pantry });
    if (!result) return { status: "none" };
    if ("failure" in result) return { status: "found" };
    const kcal = result.per100.energyKcal;
    if (typeof kcal !== "number") return { status: "found" };
    return { status: "found", energy: { kcal, basis: result.basis, estimated: result.origin !== "label" } };
  }, [foods, products, overrides, lot.lotId, lot.productRef, lot.barcode]);
}

/** Il riepilogo della riga richiusa: «~120 kcal per 100 g · stima», «mancano»; niente finché non si sa. */
export function lotValuesSummary(values: LotValues): string | undefined {
  if (values.status === "none") return "mancano";
  if (values.status !== "found" || !values.energy) return undefined;
  const { kcal, basis, estimated } = values.energy;
  return `${estimated ? "~" : ""}${Math.round(kcal)} kcal per 100 ${basis} · ${estimated ? "stima" : "etichetta"}`;
}

type Panel = "none" | "link" | "values";

export function LotNutrition({ lot }: { lot: Lot }) {
  const values = useLotValues(lot);
  const foods = useFoods();
  const products = useProducts();
  const overrides = useFoodOverrides();
  const log = useEventLog();
  const pantry = usePantry();
  const apply = useFoodCorrection(overrides);
  const search = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);
  const [panel, setPanel] = useState<Panel>("none");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  /** Il codice di una scheda salvata che l'utente ha riconosciuto come sua. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Valori pronti, in attesa di dire a quali confezioni dare il codice. */
  const [pending, setPending] = useState<{ code: string; also: ReadonlySet<string> } | null>(null);

  if (values.status === "found") {
    return (
      <>
        {done ? (
          <p className={ui.hint} role="status">
            {done}
          </p>
        ) : null}
        <LotNutrients lotId={lot.lotId} productRef={lot.productRef} barcode={lot.barcode} />
      </>
    );
  }
  if (values.status === "loading") return <p className={ui.hint}>Cerco i valori nutrizionali…</p>;

  // Senza codice a barre i valori si legano a un codice locale ricavato dal nome. Due prodotti con lo stesso nome (due marche)
  // sono due schede: se per il nome ce n'è già una, la si propone e basta, mai in silenzio; «Non sono questi» passa alla successiva.
  const code = lot.barcode ?? localCodeForName(lot.productRef, variant);
  const stored = code ? products?.get(code) : undefined;
  const offered = !lot.barcode && stored?.localFromName === true && stored.nutrients ? stored : undefined;
  /** Le altre confezioni con lo stesso nome e senza codice: ricevono il codice solo se l'utente le vede e lo conferma. */
  const others = pantry.data ? activeLots(pantry.data).filter((l) => l.lotId !== lot.lotId && !l.barcode && nameKey(l.productRef) === nameKey(lot.productRef)) : [];

  async function link(option: FoodOption) {
    setError(null);
    const failed = await apply({ mealRefs: [], pantry: true }, lot.productRef, option);
    if (failed) setError(failed);
    else {
      setDone(`Collegato a «${option.name}»: da ora i valori di «${lot.productRef}» vengono da lì.`);
      setPanel("none");
    }
  }

  /** Il codice locale va su questa confezione e sulle altre che l'utente ha scelto: è ciò che le lega ai valori. */
  async function attachCode(localCode: string, alsoIds: ReadonlySet<string>) {
    if (lot.barcode || !log.data || !pantry.data) return;
    const voided = pantry.data.voidedEventIds;
    const targets: EditTarget[] = [lot, ...others.filter((l) => alsoIds.has(l.lotId))].flatMap((l) => {
      const creation = findCreationEvent(log.data ?? [], l.lotId, voided);
      return creation ? [{ lot: l, creation }] : [];
    });
    const result = buildAttachCode(targets, localCode, { now: new Date().toISOString(), deviceId: await getDeviceId() });
    if (!result.ok) throw new Error(result.error);
    if (result.events.length > 0) await appendEvents(result.events);
  }

  const savedText = `Valori salvati per «${lot.productRef}»: li trovi qui sotto e contano nei nutrienti.`;

  function finish(localCode: string, alsoIds: ReadonlySet<string>) {
    void attachCode(localCode, alsoIds)
      .then(() => {
        setDone(savedText);
        setPanel("none");
        setPending(null);
      })
      .catch(() => setError("Ho salvato i valori ma non sono riuscito a legarli a questo alimento. Riprova."));
  }

  /** Valori pronti (salvati ora, o già salvati e riconosciuti): se ci sono altre confezioni con lo stesso nome si chiede a quali dare il codice. */
  function ready(localCode: string) {
    if (lot.barcode) {
      setDone(savedText);
      setPanel("none");
    } else if (others.length === 0) finish(localCode, new Set());
    else setPending({ code: localCode, also: new Set() });
  }

  const useOffered = offered !== undefined && chosen !== code;

  return (
    <div className={ui.field}>
      {done ? (
        <p className={ui.hint} role="status">
          {done}
        </p>
      ) : null}
      <p className={ui.hint}>Non ho trovato valori nutrizionali per questo nome: finché non li colleghi, ciò che mangi non conta nei nutrienti.</p>
      {panel === "none" ? (
        <div className={ui.row}>
          <Button variant="outline" disabled={!search} onClick={() => setPanel("link")}>
            Collega a un alimento
          </Button>
          {code ? (
            <Button variant="outline" onClick={() => setPanel("values")}>
              Scrivi i valori a mano
            </Button>
          ) : null}
        </div>
      ) : null}
      {panel === "link" && search ? (
        <FoodPicker label={lot.productRef} search={search} onPick={(o) => void link(o)} onClose={() => setPanel("none")} />
      ) : null}
      {panel === "values" && code && pending ? (
        <div className={ui.calloutStrong} role="group" aria-label="Altre confezioni con lo stesso nome">
          <p className={ui.paragraph}>
            <strong>Do questi valori a questa confezione.</strong> Hai altre confezioni di «{lot.productRef}» senza valori: scegli se darli anche a loro.
          </p>
          <div className={ui.choices}>
            {others.map((l) => (
              <label key={l.lotId} className={ui.choice}>
                <input
                  type="checkbox"
                  checked={pending.also.has(l.lotId)}
                  onChange={() =>
                    setPending((p) => {
                      if (!p) return p;
                      const also = new Set(p.also);
                      if (!also.delete(l.lotId)) also.add(l.lotId);
                      return { ...p, also };
                    })
                  }
                />
                <span>{`${LOCATION_LABELS[l.location]} · ${formatQuantity({ value: l.remaining, unit: l.unit })} · entrata il ${formatCalendarDate(dayOf(l.createdAt))}`}</span>
              </label>
            ))}
          </div>
          <div className={ui.row}>
            <Button onClick={() => finish(pending.code, pending.also)}>{pending.also.size > 0 ? `Collega (${pending.also.size + 1} confezioni)` : "Collega solo questa"}</Button>
          </div>
        </div>
      ) : null}
      {panel === "values" && code && !pending && useOffered ? (
        <div className={ui.calloutStrong} role="status">
          <p className={ui.paragraph}>
            <strong>Ho valori salvati per «{offered.name?.trim() || lot.productRef}».</strong> {savedSummary(offered)} Sono quelli di questo prodotto?
          </p>
          <div className={ui.row}>
            <Button
              onClick={() => {
                setChosen(code);
                ready(code);
              }}
            >
              Uso i valori salvati per «{offered.name?.trim() || lot.productRef}»
            </Button>
            <Button variant="outline" onClick={() => setVariant(variant + 1)}>
              Non sono questi
            </Button>
          </div>
          <p className={ui.hint}>Finché non scegli, questa confezione resta senza valori.</p>
        </div>
      ) : null}
      {panel === "values" && code && !pending && !useOffered ? (
        <NutritionReview
          key={code}
          barcode={code}
          product={stored}
          by="manual"
          initial={stored?.nutrients ? formFromProduct(stored as Product) : { ...emptyForm(), name: lot.productRef }}
          hideName
          localFromName={!lot.barcode}
          onSaved={() => {
            // li ha appena scritti lui, per questo alimento: sono la sua scelta
            setChosen(code);
            ready(code);
          }}
          onCancel={() => setPanel("none")}
        />
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
