"use client";

// Le bevande: le scelte rapide, «Un'altra bevanda» scritta a mano e le scritture che le accompagnano. Si segnano da
// Oggi e dal «+»: stesso codice, stessi eventi, stesso avviso con «Annulla».

import { useEffect, useId, useRef, useState } from "react";
import { familyConsumes, InvalidDiaryEventError, type DiaryDrink } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent } from "@/core/ledger";
import { appendEvents, getAllEvents, getDeviceId, getPantry } from "@/data";
import { buildDrink, inputOfPreset, linkedConsumes, removeDrink, retimeDrink, type DrinkInput } from "../drinks";
import { formatMl, DRINK_PRESETS, type DrinkPreset } from "../health";
import { useNotice } from "../notice";
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
    // tutta la famiglia: annullandone solo il consumo che vale, una sua correzione parallela tornerebbe a contare
    const linked = linkedConsumes(drinkEventId, events, pantry.voidedEventIds);
    return linked.length > 0 ? familyConsumes(events, linked) : [];
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

const readNumber = (text: string): number | undefined => {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^\d+(?:\.\d+)?$/.test(t)) return undefined;
  return Number(t);
};

/**
 * «Un'altra bevanda»: una bevanda che non è tra le scelte rapide, con nome e millilitri scritti a mano. È un passo del
 * foglio delle bevande: il pulsante che conferma sta nel piede del foglio e si lega al modulo con `formId`
 * (`<Button type="submit" form={formId}>`). Alcol e caffeina lasciati vuoti restano non indicati, non zero.
 */
export function CustomDrinkForm({
  actions,
  formId,
  onAdded,
}: {
  actions: Actions;
  formId: string;
  /** Dopo la scrittura, come per le scelte rapide: chi ospita il modulo chiude il foglio. */
  onAdded: (name: string, events: readonly AnyEvent[]) => void;
}) {
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const mlRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [name, setName] = useState("");
  const [ml, setMl] = useState("");
  const [caffeine, setCaffeine] = useState("");
  const [alcohol, setAlcohol] = useState("");
  const [error, setError] = useState<string | null>(null);

  // il passo si apre per scrivere
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit() {
    if (running.current) return;
    const drinkName = name.trim();
    const volume = readNumber(ml);
    if (drinkName === "") return setError("Scrivi che bevanda è.");
    if (volume === undefined || volume <= 0) return setError("Scrivi i millilitri, per esempio 250.");
    const caffeineMg = caffeine.trim() === "" ? undefined : readNumber(caffeine);
    const alcoholG = alcohol.trim() === "" ? undefined : readNumber(alcohol);
    if (caffeine.trim() !== "" && caffeineMg === undefined) return setError("La caffeina va scritta in milligrammi, solo il numero.");
    if (alcohol.trim() !== "" && alcoholG === undefined) return setError("L'alcol va scritto in grammi, solo il numero.");
    setError(null);
    running.current = true;
    try {
      const result = await actions.add({ name: drinkName, ml: volume, caffeineMg, alcoholG }, "label");
      if (result.ok) onAdded(drinkName, result.events);
      else setError(result.error);
    } finally {
      running.current = false;
    }
  }

  const field = (set: (value: string) => void) => (event: { target: { value: string } }) => {
    set(event.target.value);
    setError(null);
  };

  return (
    <form
      id={formId}
      className={ui.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
          Un&apos;altra bevanda
        </label>
        <input
          ref={nameRef}
          id={`${ids}-name`}
          className={ui.input}
          type="text"
          autoComplete="off"
          enterKeyHint="next"
          value={name}
          onChange={field(setName)}
          // Invio nel nome passa ai millilitri; conferma dagli altri campi
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            mlRef.current?.focus();
          }}
          placeholder="Succo d'arancia"
        />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-ml`}>
          Millilitri
        </label>
        <input ref={mlRef} id={`${ids}-ml`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={ml} onChange={field(setMl)} placeholder="250" />
      </div>
      <div className={styles.twoCols}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-caf`}>
            Caffeina, mg <span className={ui.optional}>(facoltativa)</span>
          </label>
          <input id={`${ids}-caf`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={caffeine} onChange={field(setCaffeine)} />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-alc`}>
            Alcol, grammi <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input id={`${ids}-alc`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={alcohol} onChange={field(setAlcohol)} />
        </div>
      </div>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
