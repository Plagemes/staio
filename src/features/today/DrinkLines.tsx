"use client";

// Le bevande di un momento, nel diario di Oggi: una riga per bevanda, che è un pulsante. Il tocco apre il foglio
// «Bevanda»: «Cambia ora», «Scala dalla dispensa» (se in casa c'è di che) e «Togli». La proposta di scalare compare
// sotto la riga a foglio chiuso: scrive e mostra l'avviso da sé, e un avviso non nasce mai sotto un foglio aperto.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { InvalidDiaryEventError, type DiaryDrink } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { activeLots, type PantryState } from "@/core/ledger";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Value } from "@/design";
import { ActionList, Sheet, type ActionItem } from "../common";
import { drinkDetail, drinkKindOf, linkedConsumes, pantryOptionsForDrink, removeDrink, retimeDrink, shortTime } from "../drinks";
import { formatMl } from "../health";
import { DrinkPantrySuggestion } from "../health/DrinkPantry";
import type { useDrinkActions } from "../health/Drinks";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { drinkConsumes } from "./dayRows";
import { entryElementId } from "./reveal";
import { inSentence } from "./summaries";
import styles from "./Today.module.css";

interface Props {
  drinks: readonly DiaryDrink[];
  /** Il giorno mostrato, `YYYY-MM-DD`. */
  date: string;
  now: string;
  actions: ReturnType<typeof useDrinkActions>;
  log: readonly AnyEvent[];
  pantry: PantryState;
  /** Solo per oggi: un tè o un caffè senza consumo collegato offre «Scala dalla dispensa». */
  scalable: boolean;
  onError: (message: string | null) => void;
}

type Built = { events: AnyEvent[]; message: string } | { error: string };

/**
 * Le scritture che partono da un foglio del diario: una sola `appendEvents`, poi il foglio si chiude (`close`), poi
 * nasce l'avviso con «Annulla» su tutti gli eventi scritti. Un secondo tocco mentre si salva non scrive niente.
 * Restituisce il testo dell'errore, da mostrare nel foglio, o `null`.
 */
export function useSheetWrite() {
  const notice = useNotice();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  async function write(build: (ctx: { deviceId: string; now: string }) => Built, close: () => void): Promise<string | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    try {
      const built = build({ deviceId: await getDeviceId(), now: new Date().toISOString() });
      if ("error" in built) return built.error;
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) return "Non sono riuscito a salvare. Riprova.";
      close();
      notice.show({ message: built.message, undo: built.events });
      return null;
    } catch (e) {
      if (e instanceof InvalidDiaryEventError) return "Questo valore non è accettabile: controlla il numero.";
      return "Non sono riuscito a salvare sul telefono. Riprova.";
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { write, busy };
}

export function DrinkLines({ drinks, date, now, actions, log, pantry, scalable, onError }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scalingId, setScalingId] = useState<string | null>(null);
  const stopScaling = useCallback(() => setScalingId(null), []);
  const timeZone = actions.timeZone;

  // le bevande senza consumo collegato e con qualcosa da scalare in dispensa
  const canScale = useMemo(() => {
    const offer = new Set<string>();
    if (!scalable) return offer;
    const lots = activeLots(pantry);
    for (const d of drinks) {
      const kind = drinkKindOf(d.name);
      if (!kind || linkedConsumes(d.eventId, log, pantry.voidedEventIds).length > 0) continue;
      if (pantryOptionsForDrink(kind, lots, now, { timeZone }).length > 0) offer.add(d.eventId);
    }
    return offer;
  }, [scalable, log, pantry, now, drinks, timeZone]);

  if (drinks.length === 0) return null;
  const open = drinks.find((d) => d.eventId === openId);

  return (
    <>
      <ul className={styles.drinks}>
        {drinks.map((d) => {
          const detail = drinkDetail(d);
          const kind = drinkKindOf(d.name);
          return (
            <li key={d.eventId} id={entryElementId(d.eventId)} className={styles.drink}>
              <button
                type="button"
                className={styles.drinkRow}
                aria-haspopup="dialog"
                onClick={() => {
                  onError(null);
                  setScalingId(null);
                  setOpenId(d.eventId);
                }}
              >
                <span className={styles.mealTime}>{shortTime(d.at, timeZone)}</span>
                <span>{detail.estimated ? <Value certainty="estimated">{detail.text}</Value> : detail.text}</span>
              </button>
              {scalingId === d.eventId && kind && canScale.has(d.eventId) ? (
                <DrinkPantrySuggestion persistent suggestion={{ kind, drinkEventId: d.eventId }} timeZone={timeZone} onDone={stopScaling} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {open ? (
        <DrinkSheet
          key={open.eventId}
          drink={open}
          date={date}
          log={log}
          pantry={pantry}
          timeZone={timeZone}
          scale={canScale.has(open.eventId)}
          onClose={() => setOpenId(null)}
          onScale={() => {
            setOpenId(null);
            setScalingId(open.eventId);
          }}
        />
      ) : null}
    </>
  );
}

type Step = "main" | "time";

/** Il foglio «Bevanda»: un passo per chiamata, «Indietro» e il tasto indietro tornano al passo principale. */
function DrinkSheet({
  drink,
  date,
  log,
  pantry,
  timeZone,
  scale,
  onClose,
  onScale,
}: {
  drink: DiaryDrink;
  date: string;
  log: readonly AnyEvent[];
  pantry: PantryState;
  timeZone: string;
  scale: boolean;
  onClose: () => void;
  /** «Scala dalla dispensa»: il foglio si chiude e la proposta compare sotto la riga, dove il suo avviso si vede. */
  onScale: () => void;
}) {
  const ids = useId();
  const { write, busy } = useSheetWrite();
  const [step, setStep] = useState<Step>("main");
  const [timeText, setTimeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // tutta la famiglia dei consumi collegati: annullandone solo quello che vale, gli altri tornerebbero a contare
  const linked = useMemo(() => drinkConsumes(drink.eventId, log, pantry.voidedEventIds), [drink.eventId, log, pantry.voidedEventIds]);
  const time = shortTime(drink.at, timeZone);
  const kind = drinkKindOf(drink.name);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };
  const back = () => go("main");

  async function saveTime() {
    setError(null);
    const failure = await write(({ deviceId, now }) => {
      const r = retimeDrink(drink, date, timeText, { deviceId, now, timeZone }, linked);
      return r.ok ? { events: r.events, message: r.message } : { error: r.error };
    }, onClose);
    if (failure) setError(failure);
  }

  async function remove() {
    setError(null);
    // ciò che era stato scalato dalla dispensa per questa bevanda torna indietro con lei
    const failure = await write(
      ({ deviceId, now }) => ({
        events: removeDrink(drink, linked, { deviceId, now, timeZone }).events,
        message: `Tolto: ${inSentence(drink.name)} delle ${time}${linked.length > 0 ? ", e anche ciò che avevi scalato dalla dispensa" : ""}.`,
      }),
      onClose,
    );
    if (failure) setError(failure);
  }

  const items: ActionItem[] = [
    {
      id: "time",
      label: "Cambia ora",
      hint: `Adesso: ${time}`,
      disabled: busy,
      onSelect: () => {
        setTimeText(time.padStart(5, "0"));
        go("time");
      },
    },
    ...(scale && kind ? [{ id: "scale", label: "Scala dalla dispensa", disabled: busy, onSelect: onScale }] : []),
    { id: "remove", label: "Togli", danger: true, disabled: busy, onSelect: () => void remove() },
  ];

  const errorLine = error ? (
    <p className={ui.error} role="alert">
      {error}
    </p>
  ) : null;

  let body;
  let footer;
  if (step === "time") {
    body = (
      <form
        id={`${ids}-time`}
        className={ui.field}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void saveTime();
        }}
      >
        <label className={ui.fieldLabel} htmlFor={`${ids}-time-input`}>
          Ora in cui l&apos;hai bevuto
        </label>
        <input
          id={`${ids}-time-input`}
          className={ui.input}
          type="time"
          value={timeText}
          onChange={(e) => {
            setTimeText(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
        {errorLine}
      </form>
    );
    footer = (
      <div className={styles.stepFooter}>
        <Button variant="text" disabled={busy} onClick={back}>
          Indietro
        </Button>
        <Button type="submit" form={`${ids}-time`} disabled={busy}>
          Salva
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <ActionList items={items} />
        {errorLine}
      </>
    );
  }

  return (
    <Sheet title={`${drink.name}, ${formatMl(drink.ml)}`} onClose={onClose} busy={busy} footer={footer} onBack={step === "main" ? undefined : back}>
      {body}
    </Sheet>
  );
}
