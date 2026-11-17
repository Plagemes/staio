"use client";

// Dopo un tè o un caffè segnato: una riga facoltativa che propone di scalare una dose dalla dispensa. Un tocco e fatto,
// altrimenti sparisce da sola (o al tocco successivo, fuori dalla riga). Mai in automatico, mai una domanda che blocca.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnyEvent } from "@/core/events";
import { activeLots } from "@/core/ledger";
import { appendEvents, getDeviceId, usePantry } from "@/data";
import { Button } from "@/design";
import { buildDrinkConsume, drinkKindOf, pantryOptionsForDrink, type DrinkKind } from "../drinks";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import styles from "./health.module.css";

/** Quanto resta visibile la proposta se non la si tocca. */
const VISIBLE_MS = 12_000;

/** Il prodotto scelto l'ultima volta per ogni bevanda, nelle impostazioni locali. */
export const drinkProductKey = (kind: DrinkKind): string => `drinkProduct.${kind}`;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export interface DrinkSuggestion {
  kind: DrinkKind;
  drinkEventId: string;
}

/** Tiene la proposta in corso: si apre dopo una bevanda segnata adesso e si chiude da sola o a mano. */
export function useDrinkSuggestion() {
  const [suggestion, setSuggestion] = useState<DrinkSuggestion | null>(null);
  /** Da chiamare con gli eventi appena scritti di una bevanda segnata adesso. */
  const offer = useCallback((name: string, events: readonly AnyEvent[] | undefined) => {
    const kind = drinkKindOf(name);
    const drink = events?.find((e) => e.type === "drink");
    setSuggestion(kind && drink ? { kind, drinkEventId: drink.id } : null);
  }, []);
  const dismiss = useCallback(() => setSuggestion(null), []);
  return { suggestion, offer, dismiss };
}

interface Props {
  suggestion: DrinkSuggestion | null;
  timeZone: string;
  onDone: () => void;
  /** Aperta a mano dalla riga della bevanda: non sparisce da sola dopo qualche secondo. */
  persistent?: boolean;
}

export function DrinkPantrySuggestion({ suggestion, timeZone, onDone, persistent = false }: Props) {
  const pantry = usePantry();
  const now = useNow();
  const notice = useNotice();
  const ref = useRef<HTMLDivElement>(null);
  // la scelta e l'errore valgono per una proposta sola: cambiando bevanda si ricomincia
  const [pick, setPick] = useState<{ id: string; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(null);
  const kind = suggestion?.kind ?? "tea";
  const remembered = useSetting(drinkProductKey(kind), isText, "");

  const options = useMemo(
    () =>
      suggestion && pantry.data && now
        ? pantryOptionsForDrink(kind, activeLots(pantry.data), now, { preferredProduct: remembered.value || undefined, timeZone })
        : [],
    [suggestion, kind, pantry.data, now, remembered.value, timeZone],
  );

  const id = suggestion?.drinkEventId;
  useEffect(() => {
    if (!id) return;
    const timer = persistent ? undefined : window.setTimeout(onDone, VISIBLE_MS);
    // al tocco successivo, fuori dalla riga, la proposta sparisce
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDone();
    };
    const arm = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearTimeout(arm);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [id, onDone, persistent]);

  if (!suggestion || options.length === 0) return null;
  const index = pick?.id === suggestion.drinkEventId ? pick.index : 0;
  const option = options[index % options.length];
  const error = failure?.id === suggestion.drinkEventId ? failure.text : null;
  const fail = (text: string) => setFailure({ id: suggestion.drinkEventId, text });

  async function apply() {
    if (!suggestion || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const built = buildDrinkConsume(option, suggestion.drinkEventId, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!built.ok) {
        fail(built.error);
        return;
      }
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) {
        fail("Non sono riuscito a salvare. Riprova.");
        return;
      }
      notice.show({ message: built.message, undo: built.events });
      // ricorda la scelta per la volta dopo, se è diversa; un errore qui non toglie niente a ciò che è stato fatto
      try {
        if ((await getSetting(drinkProductKey(suggestion.kind))) !== option.lot.productRef) await setSetting(drinkProductKey(suggestion.kind), option.lot.productRef);
      } catch {}
      onDone();
    } catch {
      fail("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.suggest} ref={ref} role="group" aria-label="Scalare dalla dispensa">
      <Button variant="outline" disabled={busy} onClick={() => void apply()}>
        Scala {option.dose.text} da {option.lot.productRef}
      </Button>
      {options.length > 1 ? (
        <Button variant="text" disabled={busy} onClick={() => setPick({ id: suggestion.drinkEventId, index: index + 1 })}>
          Altro
        </Button>
      ) : null}
      <span className={ui.hint}>Dose tipica: è una stima.</span>
      {error ? (
        <span className={ui.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
