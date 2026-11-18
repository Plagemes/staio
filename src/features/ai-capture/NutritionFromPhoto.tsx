"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { isAiError, type LabelReading } from "@/core/ai";
import { hasFullNutrients, type Product } from "@/core/catalog";
import { Button } from "@/design";
import { IMAGE_ERROR_MESSAGES, ImageError, RECEIPT_IMAGE_LIMITS, prepareImage } from "../ai/image";
import { describeAiError } from "../ai/messages";
import { activeModel, configIssue, dexieSettingsStore, destinationHost } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import ui from "../ui.module.css";
import styles from "./AiCapture.module.css";
import { emptyForm, formFromProduct, formFromReading, type LabelForm } from "./labelDraft";
import { NutritionReview } from "./NutritionReview";
import { readNutritionLabel, type CallInfo } from "./reads";

interface PhotoDraft {
  reading: LabelReading;
  info: CallInfo;
  form: LabelForm;
  previewUrl: string;
  /** Cambia a ogni lettura: la revisione riparte da zero. */
  run: number;
}

interface Props {
  barcode: string;
  /** La scheda com'è adesso; assente se Open Food Facts non conosce il codice. */
  product: Product | undefined;
  /** Il controllo di allergeni ed esclusioni, mostrato sulla scheda come diventerebbe confermando. */
  safety?: (draft: Product) => ReactNode;
  /** A valori salvati: la scheda nuova e quella di prima, per poter annullare. */
  onSaved: (next: Product, previous: Product | undefined) => void;
}

/**
 * I modi di dare i valori nutrizionali a un prodotto, nella sua scheda dove i valori mancano: «Scrivi i valori nutrizionali»
 * (sempre) e «Fotografa la tabella nutrizionale» (solo con una chiave per l'intelligenza artificiale). Con i valori già
 * completi resta «Modifica i valori». Entrambe le strade finiscono nello stesso modulo di revisione.
 */
export function NutritionEntry({ barcode, product, safety, onSaved }: Props) {
  const { settings, ready } = useAiSettings();
  const abortRef = useRef<AbortController | null>(null);
  const runs = useRef(0);
  const [busy, setBusy] = useState<"preparing" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);
  const previewUrl = photo?.previewUrl;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const canPhoto = ready && configIssue(settings) === null;
  const model = activeModel(settings);
  const complete = product !== undefined && hasFullNutrients(product);
  const hasValues = product?.nutrients !== undefined;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhoto(null);
    setManual(false);
    setBusy("preparing");
    try {
      const prepared = await prepareImage(file, RECEIPT_IMAGE_LIMITS);
      setBusy("reading");
      const out = await readNutritionLabel({ store: dexieSettingsStore(), image: prepared.image, signal: controller.signal });
      runs.current += 1;
      setPhoto({ reading: out.reading, info: out.info, form: formFromReading(out.reading, product), previewUrl: URL.createObjectURL(prepared.blob), run: runs.current });
    } catch (e) {
      setError(
        e instanceof ImageError
          ? IMAGE_ERROR_MESSAGES[e.kind]
          : isAiError(e)
            ? describeAiError(e, { provider: settings.provider, model })
            : "La lettura non è riuscita. Riprova.",
      );
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  function saved(next: Product, previous: Product | undefined) {
    setPhoto(null);
    setManual(false);
    onSaved(next, previous);
  }

  return (
    <div className={styles.inline}>
      {manual ? null : (
        <>
          <div className={styles.pick}>
            {canPhoto && !complete ? (
              <label className={styles.file}>
                <input type="file" accept="image/*" capture="environment" onChange={onFile} disabled={busy !== null} />
                <span>
                  {busy === "preparing" ? "Preparo la foto…" : busy === "reading" ? "Leggo la tabella…" : photo ? "Un'altra foto" : "Fotografa la tabella nutrizionale"}
                </span>
              </label>
            ) : null}
            {busy === "reading" ? (
              <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                Annulla
              </Button>
            ) : null}
            {busy === null ? (
              <Button
                variant="outline"
                onClick={() => {
                  setPhoto(null);
                  setError(null);
                  setManual(true);
                }}
              >
                {hasValues ? "Modifica i valori" : "Scrivi i valori nutrizionali"}
              </Button>
            ) : null}
          </div>
          {canPhoto && !complete ? (
            <p className={ui.hint}>
              Con la foto, all&apos;intelligenza artificiale ({destinationHost(settings)}) va solo la foto, ridotta sul telefono, e la richiesta. Inquadra la tabella (e, se vuoi, gli ingredienti) da vicino e dritta.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {photo ? (
        <NutritionReview
          key={photo.run}
          barcode={barcode}
          product={product}
          by="photo"
          initial={photo.form}
          reading={photo.reading}
          info={photo.info}
          previewUrl={photo.previewUrl}
          safety={safety}
          onSaved={saved}
          onCancel={() => setPhoto(null)}
        />
      ) : null}
      {manual ? (
        <NutritionReview
          barcode={barcode}
          product={product}
          by="manual"
          initial={product?.nutrients ? formFromProduct(product) : emptyForm()}
          safety={safety}
          onSaved={saved}
          onCancel={() => setManual(false)}
        />
      ) : null}
    </div>
  );
}
