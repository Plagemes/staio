"use client";

// Le bevande di un momento, nel diario di Oggi: una riga per bevanda, che è un pulsante. Toccandola compaiono sotto
// «Cambia ora», «Togli» e, se in casa c'è di che, «Scala dalla dispensa».
import { useCallback, useMemo, useState } from "react";
import type { DiaryDrink } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { activeLots, type PantryState } from "@/core/ledger";
import { Button, Value } from "@/design";
import { drinkDetail, drinkKindOf, linkedConsumes, pantryOptionsForDrink, removeDrink, shortTime } from "../drinks";
import { DrinkPantrySuggestion } from "../health/DrinkPantry";
import type { useDrinkActions } from "../health/Drinks";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
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

export function DrinkLines({ drinks, date, now, actions, log, pantry, scalable, onError }: Props) {
  const { recordWith, busy: removing } = useRecord();
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"time" | "scale" | null>(null);
  const [timeText, setTimeText] = useState("");
  const closePanel = useCallback(() => setPanel(null), []);
  const timeZone = actions.timeZone;
  const busy = actions.busy || removing;

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

  async function confirmTime(drink: DiaryDrink) {
    onError(null);
    const result = await actions.retime(drink, date, timeText);
    if (result.ok) setOpenId(null);
    else onError(result.error);
  }

  async function remove(drink: DiaryDrink) {
    onError(null);
    // ciò che era stato scalato dalla dispensa per questa bevanda torna indietro con lei
    const linked = linkedConsumes(drink.eventId, log, pantry.voidedEventIds);
    const result = await recordWith((deviceId) => ({
      events: removeDrink(drink, linked, { deviceId, now: new Date().toISOString(), timeZone }).events,
      message: `Tolto: ${inSentence(drink.name)} delle ${shortTime(drink.at, timeZone)}${linked.length > 0 ? ", e anche ciò che avevi scalato dalla dispensa" : ""}.`,
    }));
    if (result.ok) setOpenId(null);
    else onError(result.error);
  }

  return (
    <ul className={styles.drinks}>
      {drinks.map((d) => {
        const detail = drinkDetail(d);
        const time = shortTime(d.at, timeZone);
        const open = openId === d.eventId;
        const kind = drinkKindOf(d.name);
        const scale = kind !== undefined && canScale.has(d.eventId);
        return (
          <li key={d.eventId} className={styles.drink}>
            <button
              type="button"
              className={styles.drinkRow}
              aria-expanded={open}
              onClick={() => {
                onError(null);
                setPanel(null);
                setOpenId(open ? null : d.eventId);
              }}
            >
              <span className={styles.mealTime}>{time}</span>
              <span>{detail.estimated ? <Value certainty="estimated">{detail.text}</Value> : detail.text}</span>
            </button>
            {open ? (
              <div className={styles.momentChoices} role="group" aria-label={`${d.name} delle ${time}`}>
                <Button
                  variant="text"
                  disabled={busy}
                  aria-expanded={panel === "time"}
                  onClick={() => {
                    setTimeText(time.padStart(5, "0"));
                    setPanel(panel === "time" ? null : "time");
                  }}
                >
                  Cambia ora
                </Button>
                <Button variant="text" disabled={busy} onClick={() => void remove(d)}>
                  Togli
                </Button>
                {scale ? (
                  <Button variant="text" disabled={busy} aria-expanded={panel === "scale"} onClick={() => setPanel(panel === "scale" ? null : "scale")}>
                    Scala dalla dispensa
                  </Button>
                ) : null}
              </div>
            ) : null}
            {open && panel === "scale" && scale ? (
              <DrinkPantrySuggestion persistent suggestion={{ kind, drinkEventId: d.eventId }} timeZone={timeZone} onDone={closePanel} />
            ) : null}
            {open && panel === "time" ? (
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
                <Button variant="outline" disabled={busy} onClick={() => void confirmTime(d)}>
                  Salva
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
