"use client";

// Scelte rapide delle bevande e elenco di quelle segnate oggi. Serve sia a Salute sia a Oggi:
// stesso codice, stessi eventi, stesso avviso con «Annulla».

import { useCallback, useMemo, useState } from "react";
import { InvalidDiaryEventError, type DiaryDrink } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent } from "@/core/ledger";
import { activeLots } from "@/core/ledger";
import { appendEvents, getAllEvents, getDeviceId, getPantry, useEventLog, usePantry } from "@/data";
import { Button, Value } from "@/design";
import {
  buildDrink,
  drinkCounts,
  drinkDetail,
  drinkKindOf,
  drinkMomentWord,
  inputOfPreset,
  linkedConsumes,
  pantryOptionsForDrink,
  removeDrink,
  retimeDrink,
  shortTime,
  type DrinkInput,
} from "../drinks";
import { formatMl, DRINK_PRESETS, type DrinkPreset } from "../health";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import { DrinkPantrySuggestion } from "./DrinkPantry";
import ui from "../ui.module.css";
import styles from "./health.module.css";

function presetHint(p: DrinkPreset): string {
  const parts = [formatMl(p.ml)];
  if (p.caffeineMg !== undefined) parts.push(`~${p.caffeineMg} mg caffeina`);
  if (p.alcoholG !== undefined) parts.push(`~${p.alcoholG.toString().replace(".", ",")} g alcol`);
  if (p.energyKcal !== undefined && p.energyKcal >= 5) parts.push(`~${p.energyKcal} kcal`);
  return parts.join(" · ");
}

/** `events`: ciò che è stato scritto, per chi vuole proporre qualcosa subito dopo. */
export type DrinkAction = { ok: true; events: AnyEvent[] } | { ok: false; error: string };

/** I consumi della dispensa legati a una bevanda (scalati con «Scala una bustina»); nessuno se non si riesce a leggere. */
async function consumesOfDrink(drinkEventId: string): Promise<ConsumeEvent[]> {
  try {
    const [events, pantry] = await Promise.all([getAllEvents(), getPantry()]);
    return linkedConsumes(drinkEventId, events, pantry.voidedEventIds);
  } catch {
    return [];
  }
}

/** Scrive, annulla e sposta le bevande. Ogni scrittura mostra l'avviso con «Annulla». */
export function useDrinkActions(timeZone: string) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);

  async function write(build: (deviceId: string, now: string) => { events: AnyEvent[]; message: string } | { error: string }): Promise<DrinkAction> {
    if (busy) return { ok: false, error: "Un attimo, sto ancora salvando." };
    setBusy(true);
    try {
      const built = build(await getDeviceId(), new Date().toISOString());
      if ("error" in built) return { ok: false, error: built.error };
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) return { ok: false, error: "Non sono riuscito a salvare. Riprova." };
      notice.show({ message: built.message, undo: built.events });
      return { ok: true, events: built.events };
    } catch (e) {
      if (e instanceof InvalidDiaryEventError) return { ok: false, error: "Questo valore non è accettabile: controlla il numero." };
      return { ok: false, error: "Non sono riuscito a salvare sul telefono. Riprova." };
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    timeZone,
    add: (input: DrinkInput, certainty?: "estimated" | "label" | "measured") =>
      write((deviceId, now) => buildDrink(input, { deviceId, now, timeZone }, { certainty })),
    /** Con `when` la bevanda è di un altro momento (un giorno passato): `at` e come dirlo nell'avviso. */
    addPreset: (p: DrinkPreset, when?: { at: string; dayLabel: string }) =>
      write((deviceId, now) => buildDrink(inputOfPreset(p), { deviceId, now, timeZone, ...(when ?? {}) })),
    /** «Annulla» su una bevanda già segnata: un `void`, e l'avviso permette di tornare indietro. */
    /** Annulla anche ciò che era stato scalato dalla dispensa per questa bevanda. */
    remove: async (drink: DiaryDrink) => {
      const linked = await consumesOfDrink(drink.eventId);
      return write((deviceId, now) => removeDrink(drink, linked, { deviceId, now, timeZone }));
    },
    retime: async (drink: DiaryDrink, date: string, timeText: string) => {
      const linked = await consumesOfDrink(drink.eventId);
      return write((deviceId, now) => {
        const r = retimeDrink(drink, date, timeText, { deviceId, now, timeZone }, linked);
        return r.ok ? { events: r.events, message: r.message } : { error: r.error };
      });
    },
  };
}

type Actions = ReturnType<typeof useDrinkActions>;

/** Le scelte rapide: un tocco segna la bevanda adesso. */
export function DrinkPresetChips({
  actions,
  onError,
  when,
  onAdded,
}: {
  actions: Actions;
  onError: (message: string | null) => void;
  /** Per una bevanda dimenticata di un giorno passato: l'istante in cui è stata bevuta. */
  when?: { at: string; dayLabel: string };
  /** Dopo una bevanda segnata adesso (non per un giorno passato): per proporre di scalarla dalla dispensa. */
  onAdded?: (name: string, events: readonly AnyEvent[]) => void;
}) {
  return (
    <div className={styles.buttons}>
      {DRINK_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={styles.chip}
          disabled={actions.busy}
          onClick={async () => {
            onError(null);
            const result = await actions.addPreset(p, when);
            if (!result.ok) onError(result.error);
            else if (!when) onAdded?.(p.name, result.events);
          }}
        >
          {p.name}
          <span className={styles.chipHint}>{presetHint(p)}</span>
        </button>
      ))}
    </div>
  );
}

/** Le bevande segnate, con l'ora, ciascuna annullabile e con l'ora correggibile. */
export function DrinkEntries({
  drinks,
  date,
  actions,
  onError,
  showCounts = false,
  showMoment = false,
  scalable = false,
}: {
  drinks: readonly DiaryDrink[];
  date: string;
  actions: Actions;
  onError: (message: string | null) => void;
  /** «Tè × 2»: un riepilogo sopra l'elenco, per vedere un doppio tocco. */
  showCounts?: boolean;
  /** Aggiunge il momento a cui la bevanda appartiene («colazione», «fuori pasto»...). */
  showMoment?: boolean;
  /** Solo per il giorno corrente: un tè o un caffè senza consumo collegato offre «Scala dalla dispensa». */
  scalable?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [timeText, setTimeText] = useState("");
  const [scaling, setScaling] = useState<string | null>(null);
  const log = useEventLog();
  const pantry = usePantry();
  const now = useNow();
  const closeScaling = useCallback(() => setScaling(null), []);
  // le bevande senza consumo collegato e con qualcosa da scalare in dispensa
  const scaleState = useMemo(() => {
    const offer = new Set<string>();
    if (!scalable || !log.data || !pantry.data || !now) return offer;
    const lots = activeLots(pantry.data);
    for (const d of drinks) {
      const kind = drinkKindOf(d.name);
      if (!kind || linkedConsumes(d.eventId, log.data, pantry.data.voidedEventIds).length > 0) continue;
      if (pantryOptionsForDrink(kind, lots, now, { timeZone: actions.timeZone }).length > 0) offer.add(d.eventId);
    }
    return offer;
  }, [scalable, log.data, pantry.data, now, drinks, actions.timeZone]);
  if (drinks.length === 0) return null;

  async function confirmTime(drink: DiaryDrink) {
    onError(null);
    const result = await actions.retime(drink, date, timeText);
    if (result.ok) setEditing(null);
    else onError(result.error);
  }

  return (
    <div className={styles.group}>
      {showCounts ? <p className={ui.paragraph}>{drinkCounts(drinks)}</p> : null}
      <ul className={styles.entries}>
        {drinks.map((d) => {
          const detail = drinkDetail(d);
          const open = editing === d.eventId;
          return (
            <li key={d.eventId} className={styles.entry}>
              <div className={styles.entryRow}>
                <span>
                  <span className={styles.entryTime}>{shortTime(d.at, actions.timeZone)}</span>{" "}
                  {detail.estimated ? <Value certainty="estimated">{detail.text}</Value> : detail.text}
                  {showMoment ? ` · ${drinkMomentWord(d.at, actions.timeZone)}` : ""}
                </span>
                <span className={styles.entryActions}>
                  <Button
                    variant="text"
                    disabled={actions.busy}
                    onClick={() => {
                      setEditing(open ? null : d.eventId);
                      setTimeText(shortTime(d.at, actions.timeZone).padStart(5, "0"));
                    }}
                    aria-expanded={open}
                  >
                    Cambia ora
                  </Button>
                  {scaleState.has(d.eventId) ? (
                    <Button variant="text" onClick={() => setScaling(scaling === d.eventId ? null : d.eventId)} aria-expanded={scaling === d.eventId}>
                      Scala dalla dispensa
                    </Button>
                  ) : null}
                  <Button variant="text" disabled={actions.busy} onClick={() => void actions.remove(d).then((r) => !r.ok && onError(r.error))}>
                    Annulla
                  </Button>
                </span>
              </div>
              {scaling === d.eventId && scaleState.has(d.eventId) ? (
                <DrinkPantrySuggestion
                  persistent
                  suggestion={{ kind: drinkKindOf(d.name)!, drinkEventId: d.eventId }}
                  timeZone={actions.timeZone}
                  onDone={closeScaling}
                />
              ) : null}
              {open ? (
                <div className={styles.inline}>
                  <label className={ui.srOnly} htmlFor={`drink-time-${d.eventId}`}>
                    Ora in cui l&apos;hai bevuto
                  </label>
                  <input
                    id={`drink-time-${d.eventId}`}
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={timeText}
                    onChange={(e) => setTimeText(e.target.value)}
                    placeholder="08:15"
                  />
                  <Button variant="outline" disabled={actions.busy} onClick={() => void confirmTime(d)}>
                    Salva
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
